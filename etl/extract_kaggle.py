#!/usr/bin/env python3
"""Extracción (la «E» del ETL) con Scrapy.

Qué hace, en un solo recorrido:

1. Ficha del dataset en Kaggle: lee el bloque de metadatos ``application/ld+json`` incrustado
   en el HTML (título, autor, licencia, versión y tamaño del ZIP anunciado).
2. Página M49 de la ONU: lee las tablas HTML en inglés y en español y las une por código M49
   para guardar la clasificación geográfica de cada país (``un_m49_countries.json``).
3. Descarga el ZIP público del dataset (licencia CC0), contrasta su tamaño con el anunciado y
   extrae ``sales_data_sample.csv``, el archivo de pedidos.
4. Escribe ``extraction_manifest.json`` con las huellas SHA-256 de cada pieza, para poder
   demostrar después que el CSV con el que se trabajó es el que se extrajo.

Uso::

    pip install -r etl/requirements.txt
    python etl/extract_kaggle.py                 # escribe en data/raw
    python etl/extract_kaggle.py --publish-evidence   # además copia el manifiesto a public/evidence

Respeta robots.txt, usa un User-Agent identificable y espera un segundo entre peticiones.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import scrapy
from scrapy.crawler import CrawlerProcess

DATASET_URL = "https://www.kaggle.com/datasets/kyanyoga/sample-sales-data"
DOWNLOAD_URL = "https://api.kaggle.com/v1/datasets/download/kyanyoga/sample-sales-data"
M49_URL = "https://unstats.un.org/unsd/methodology/m49/overview/"
CSV_NAME = "sales_data_sample.csv"
GEO_NAME = "un_m49_countries.json"

# Columnas de la tabla M49 (en el mismo orden en inglés y en español).
M49_COLUMNS = [
    "global_code", "global_name", "region_code", "region_name", "subregion_code", "subregion_name",
    "intermediate_code", "intermediate_name", "country_name", "m49_code", "iso2", "iso3",
    "ldc", "lldc", "sids", "developed_status",
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cell_text(td) -> str:
    return " ".join("".join(td.css("*::text").getall()).split())


def parse_m49_table(response: scrapy.http.Response, table_id: str) -> list[dict]:
    """Devuelve las filas de una tabla M49 como diccionarios (sin la fila de cabecera)."""
    rows = []
    for tr in response.css(f"table#{table_id} tbody tr"):
        cells = [cell_text(td) for td in tr.css("td")]
        if len(cells) < len(M49_COLUMNS) - 1:  # fila incompleta o vacía
            continue
        rows.append(dict(zip(M49_COLUMNS, cells)))
    return rows


class RetailSourcesSpider(scrapy.Spider):
    name = "retail_sources"
    custom_settings = {
        "USER_AGENT": "retail-fluid-intelligence-etl/1.0 (proyecto academico; extraccion de datos publicos)",
        "ROBOTSTXT_OBEY": True,
        "DOWNLOAD_DELAY": 1,
        "CONCURRENT_REQUESTS": 1,
        "RETRY_TIMES": 2,
        "DOWNLOAD_TIMEOUT": 60,
        "DOWNLOAD_MAXSIZE": 20 * 1024 * 1024,
        "LOG_LEVEL": "INFO",
        "TELNETCONSOLE_ENABLED": False,
    }

    def __init__(self, out_dir: Path, evidence_dir: Path | None = None, **kwargs):
        super().__init__(**kwargs)
        self.out_dir = out_dir
        self.evidence_dir = evidence_dir
        self.dataset_page: dict | None = None
        self.geography: dict | None = None
        self.csv_info: dict | None = None
        self.errors: list[str] = []

    # --- peticiones -------------------------------------------------------------------
    def _requests(self):
        for url, callback in ((DATASET_URL, self.parse_dataset), (M49_URL, self.parse_m49), (DOWNLOAD_URL, self.parse_download)):
            yield scrapy.Request(url, callback=callback, errback=self.on_error, dont_filter=True)

    async def start(self):  # Scrapy >= 2.13
        for request in self._requests():
            yield request

    def start_requests(self):  # Scrapy < 2.13
        yield from self._requests()

    def on_error(self, failure):
        self.errors.append(f"{failure.request.url}: {failure.getErrorMessage()}")
        self.logger.error("Falló %s: %s", failure.request.url, failure.getErrorMessage())

    # --- 1. Kaggle: metadatos incrustados ----------------------------------------------
    def parse_dataset(self, response):
        raw = response.css('script[type="application/ld+json"]::text').get()
        if not raw:
            self.errors.append("La ficha de Kaggle no trae el bloque application/ld+json.")
            return
        meta = json.loads(raw)
        distribution = (meta.get("distribution") or [{}])[0]
        size_text = str(distribution.get("contentSize", ""))
        listed_bytes = int(size_text.split()[0]) if size_text.split() and size_text.split()[0].isdigit() else None
        license_info = meta.get("license") or {}
        self.dataset_page = {
            "url": DATASET_URL,
            "title": meta.get("name"),
            "author": (meta.get("creator") or {}).get("name"),
            "license": license_info.get("name"),
            "license_url": license_info.get("url"),
            "identifier": meta.get("identifier"),
            "version": str(meta.get("version")),
            "listed_distribution": distribution.get("contentUrl"),
            "listed_archive_bytes": listed_bytes,
            "html_sha256": sha256(response.body),
        }
        self.logger.info("Ficha de Kaggle leída: %s (%s)", meta.get("name"), license_info.get("name"))

    # --- 2. ONU: tablas M49 en inglés y español ---------------------------------------
    def parse_m49(self, response):
        english = parse_m49_table(response, "downloadTableEN")
        spanish = {row["m49_code"]: row for row in parse_m49_table(response, "downloadTableES")}
        if not english or not spanish:
            self.errors.append("No se encontraron las tablas downloadTableEN/ES en la página M49.")
            return
        countries = []
        for en in english:
            es = spanish.get(en["m49_code"], {})
            countries.append({
                "m49_code": en["m49_code"],
                "iso2": en["iso2"],
                "iso3": en["iso3"],
                "country_en": en["country_name"],
                "country_es": es.get("country_name", ""),
                "region_en": en["region_name"],
                "region_es": es.get("region_name", ""),
                "subregion_en": en["subregion_name"],
                "subregion_es": es.get("subregion_name", ""),
                "intermediate_region_en": en["intermediate_name"],
                "intermediate_region_es": es.get("intermediate_name", ""),
            })
        payload = json.dumps(countries, ensure_ascii=False, indent=2) + "\n"
        self.out_dir.mkdir(parents=True, exist_ok=True)
        (self.out_dir / GEO_NAME).write_text(payload, encoding="utf-8")
        self.geography = {
            "url": M49_URL,
            "file": GEO_NAME,
            "rows": len(countries),
            "sha256": sha256(payload.encode("utf-8")),
        }
        self.logger.info("Tablas M49 leídas: %d países y áreas", len(countries))

    # --- 3. Kaggle: ZIP con el CSV de pedidos -----------------------------------------
    def parse_download(self, response):
        try:
            archive = zipfile.ZipFile(io.BytesIO(response.body))
            csv_bytes = archive.read(CSV_NAME)
        except (zipfile.BadZipFile, KeyError) as exc:
            self.errors.append(f"El ZIP descargado no es válido o no trae {CSV_NAME}: {exc}")
            return
        self.out_dir.mkdir(parents=True, exist_ok=True)
        (self.out_dir / CSV_NAME).write_bytes(csv_bytes)
        text = csv_bytes.decode("utf-8", errors="replace")
        rows = sum(1 for _ in csv.reader(io.StringIO(text))) - 1
        self.csv_info = {"bytes": len(csv_bytes), "rows": rows, "sha256": sha256(csv_bytes), "zip_bytes": len(response.body)}
        self.logger.info("CSV extraído: %d filas, %d bytes", rows, len(csv_bytes))

    # --- 4. Manifiesto -----------------------------------------------------------------
    def closed(self, reason):
        if self.errors or not (self.dataset_page and self.geography and self.csv_info):
            self.errors.append("Extracción incompleta: no se escribe el manifiesto.")
            return
        listed = self.dataset_page.get("listed_archive_bytes")
        size_ok = listed is None or listed == self.csv_info["zip_bytes"]
        if not size_ok:
            self.logger.warning("El ZIP pesa %d bytes y Kaggle anuncia %d.", self.csv_info["zip_bytes"], listed)
        manifest = {
            "dataset": DATASET_URL,
            "download": DOWNLOAD_URL,
            "extractor": f"Scrapy {scrapy.__version__}",
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
            "file": CSV_NAME,
            "bytes": self.csv_info["bytes"],
            "rows": self.csv_info["rows"],
            "sha256": self.csv_info["sha256"],
            "dataset_page": self.dataset_page,
            "geography_page": self.geography,
        }
        text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        (self.out_dir / "extraction_manifest.json").write_text(text, encoding="utf-8")
        if self.evidence_dir:
            self.evidence_dir.mkdir(parents=True, exist_ok=True)
            (self.evidence_dir / "extraction_manifest.json").write_text(text, encoding="utf-8")
        self.logger.info("Manifiesto escrito. Tamaño del ZIP coincide con el anunciado: %s", size_ok)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Extrae el CSV de pedidos (Kaggle) y la tabla M49 (ONU) con Scrapy.")
    parser.add_argument("--out", type=Path, default=root / "data" / "raw", help="carpeta de salida (por defecto data/raw)")
    parser.add_argument("--publish-evidence", action="store_true", help="copia el manifiesto a public/evidence para que la web lo muestre")
    args = parser.parse_args()

    process = CrawlerProcess(install_root_handler=True)
    crawler = process.create_crawler(RetailSourcesSpider)
    process.crawl(crawler, out_dir=args.out, evidence_dir=(root / "public" / "evidence") if args.publish_evidence else None)
    process.start()

    spider = crawler.spider
    if spider.errors:
        print("\nExtracción fallida:", *spider.errors, sep="\n  - ", file=sys.stderr)
        return 1
    print(f"\nListo. Archivos en {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
