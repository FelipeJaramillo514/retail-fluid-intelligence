#!/usr/bin/env python3
"""ETL del proyecto: Extrae, Transforma y Carga las ventas de un retail.

Fuentes (múltiples, como pide el enunciado):

* **CSV**  ``data/raw/sales_data_sample.csv``   pedidos (Kaggle, obtenido por ``extract_kaggle.py``).
* **JSON** ``data/raw/un_m49_countries.json``   clasificación geográfica M49 de la ONU (scraping).
           ``etl/reference/territory_regions.json`` y ``country_iso3.json``  territorios comerciales y
           código ISO de cada país del CSV.
* **SQL**  ``etl/reference/reference_source.sql``  agrupación de los estados de los pedidos.

Salidas (en ``data/processed``): ``retail_sales.db`` (SQLite que lee la web), ``etl_summary.json``,
``anova_results.json`` y, opcionalmente, CSV para Power BI en ``data/processed/powerbi``.

Los resultados sólo reemplazan a los anteriores si TODOS los controles de calidad pasan.

Uso::

    python etl/etl.py
    python etl/etl.py --raw data/raw --out data/processed
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
from collections import OrderedDict, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_NAME = "sales_data_sample.csv"
GEO_NAME = "un_m49_countries.json"

REQUIRED = ["ORDERNUMBER", "ORDERLINENUMBER", "ORDERDATE", "QUANTITYORDERED", "PRICEEACH", "SALES",
            "PRODUCTCODE", "PRODUCTLINE", "CUSTOMERNAME", "COUNTRY", "STATUS", "TERRITORY", "MSRP"]
OPTIONAL = ["ADDRESSLINE2", "STATE", "POSTALCODE"]

DDL = """
CREATE TABLE dim_customer (customer_name TEXT PRIMARY KEY, country TEXT, city TEXT, state TEXT, postal_code TEXT);
CREATE TABLE dim_product (product_code TEXT PRIMARY KEY, product_line TEXT, msrp REAL);
CREATE TABLE dim_geography (country TEXT, territory TEXT, region TEXT, PRIMARY KEY(country,territory));
CREATE TABLE dim_region (territory TEXT PRIMARY KEY, region TEXT NOT NULL);
CREATE TABLE dim_country (
 country TEXT PRIMARY KEY NOT NULL, country_name TEXT NOT NULL,
 iso2 TEXT NOT NULL UNIQUE, iso3 TEXT NOT NULL UNIQUE, m49_code TEXT NOT NULL UNIQUE,
 region_m49 TEXT NOT NULL, subregion_m49 TEXT NOT NULL
);
CREATE TABLE fact_sales (
 order_number INTEGER NOT NULL, order_line_number INTEGER NOT NULL, order_date TEXT NOT NULL,
 year INTEGER NOT NULL, month INTEGER NOT NULL, year_month TEXT NOT NULL, status TEXT, status_group TEXT,
 quantity INTEGER NOT NULL, unit_price REAL NOT NULL, sales REAL NOT NULL,
 product_code TEXT, product_line TEXT, customer_name TEXT, country TEXT, territory TEXT, region TEXT,
 city TEXT, state TEXT, postal_code TEXT, deal_size TEXT, msrp REAL, discount_proxy REAL,
 PRIMARY KEY(order_number,order_line_number),
 FOREIGN KEY(product_code) REFERENCES dim_product(product_code),
 FOREIGN KEY(customer_name) REFERENCES dim_customer(customer_name),
 FOREIGN KEY(country) REFERENCES dim_country(country),
 FOREIGN KEY(territory) REFERENCES dim_region(territory),
 FOREIGN KEY(status) REFERENCES status_reference(status_code)
);
CREATE TABLE abc_customers (
 customer_name TEXT PRIMARY KEY, sales REAL NOT NULL, cumulative_sales REAL NOT NULL,
 cumulative_pct REAL NOT NULL, abc_class TEXT NOT NULL CHECK (abc_class IN ('A','B','C')),
 FOREIGN KEY(customer_name) REFERENCES dim_customer(customer_name)
);
CREATE INDEX ix_fact_date ON fact_sales(order_date);
CREATE INDEX ix_fact_country ON fact_sales(country);
CREATE INDEX ix_fact_customer ON fact_sales(customer_name);
"""


class EtlError(Exception):
    """Un control de calidad falló: se aborta sin tocar los resultados anteriores."""


def log(message: str) -> None:
    print(message, flush=True)


# =========================================================================================
# EXTRACT
# =========================================================================================
def read_csv(path: Path) -> tuple[list[dict], str]:
    """Lee el CSV de pedidos. Kaggle lo publica en Windows-1252; se prueba UTF-8 primero."""
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - cp1252 casi nunca falla
        text = raw.decode("latin-1")
    rows = list(csv.DictReader(text.splitlines()))
    return rows, digest


def read_status_reference(sql_path: Path) -> dict[str, str]:
    """Ejecuta el script SQL en una base en memoria y devuelve {estado: grupo}."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(sql_path.read_text(encoding="utf-8"))
    mapping = dict(conn.execute("SELECT status_code, status_group FROM status_reference"))
    conn.close()
    return mapping


# =========================================================================================
# TRANSFORM
# =========================================================================================
def parse_date(text: str) -> datetime:
    for fmt in ("%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"fecha no reconocida: {text!r}")


def transform(rows: list[dict], status_map: dict[str, str], territories: dict[str, str]) -> tuple[list[dict], dict]:
    """Limpia tipos, valida fila a fila y calcula los campos derivados."""
    stats = defaultdict(int)
    stats["rows_in"] = len(rows)
    clean: list[dict] = []
    seen: dict[tuple, dict] = {}
    for line_no, row in enumerate(rows, start=2):
        if any(not (row.get(col) or "").strip() for col in REQUIRED):
            stats["rows_missing_required"] += 1
            continue
        try:
            order = int(row["ORDERNUMBER"])
            line = int(row["ORDERLINENUMBER"])
            date = parse_date(row["ORDERDATE"])
            qty = int(float(row["QUANTITYORDERED"]))
            price = float(row["PRICEEACH"])
            sales = float(row["SALES"])
            msrp = float(row["MSRP"])
        except ValueError:
            stats["conversion_errors"] += 1
            continue
        if qty <= 0:
            stats["non_positive_quantities"] += 1
        if sales < 0:
            stats["negative_sales"] += 1
        status = row["STATUS"].strip()
        territory = row["TERRITORY"].strip()
        record = {
            "order_number": order, "order_line_number": line,
            "order_date": date.strftime("%Y-%m-%d"), "year": date.year, "month": date.month,
            "year_month": date.strftime("%Y-%m-01"),
            "status": status, "status_group": status_map.get(status),
            "quantity": qty, "unit_price": price, "sales": sales,
            "product_code": row["PRODUCTCODE"].strip(), "product_line": row["PRODUCTLINE"].strip(),
            "customer_name": row["CUSTOMERNAME"].strip(), "country": row["COUNTRY"].strip(),
            "territory": territory, "region": territories.get(territory),
            "city": (row.get("CITY") or "").strip(), "state": (row.get("STATE") or "").strip(),
            "postal_code": (row.get("POSTALCODE") or "").strip(), "deal_size": (row.get("DEALSIZE") or "").strip(),
            "msrp": msrp,
            # Brecha frente al precio de lista (MSRP); NO es un descuento promocional observado.
            "discount_proxy": max(0.0, (msrp - price) / msrp) if msrp else 0.0,
            "_address2": (row.get("ADDRESSLINE2") or "").strip(),
        }
        key = (order, line)
        if key in seen:
            if seen[key] == record:
                stats["exact_duplicates_removed"] += 1
            else:
                stats["duplicate_keys"] += 1
            continue
        seen[key] = record
        clean.append(record)
    # Campos opcionales con valores faltantes (informativo).
    stats["missing_address_line_2"] = sum(1 for r in clean if not r["_address2"])
    stats["missing_state"] = sum(1 for r in clean if not r["state"])
    stats["missing_postal_code"] = sum(1 for r in clean if not r["postal_code"])
    return clean, dict(stats)  # en el orden del CSV


def build_dimensions(clean: list[dict], territories: dict[str, str], iso3_map: dict[str, str], m49: list[dict]) -> dict:
    """Dimensiones. Clientes, productos y geografía conservan la primera aparición en el CSV."""
    by_iso3 = {row["iso3"]: row for row in m49}
    customers: "OrderedDict[str, tuple]" = OrderedDict()
    products: "OrderedDict[str, tuple]" = OrderedDict()
    geography: "OrderedDict[tuple, str]" = OrderedDict()
    countries: "OrderedDict[str, None]" = OrderedDict()
    for r in clean:
        customers.setdefault(r["customer_name"], (r["customer_name"], r["country"], r["city"], r["state"], r["postal_code"]))
        products.setdefault(r["product_code"], (r["product_code"], r["product_line"], r["msrp"]))
        geography.setdefault((r["country"], r["territory"]), r["region"])
        countries.setdefault(r["country"], None)
    dim_country, unmatched = [], []
    for country in sorted(countries):
        entry = by_iso3.get(iso3_map.get(country, ""))
        if not entry:
            unmatched.append(country)
            continue
        dim_country.append((country, entry["country_es"], entry["iso2"], entry["iso3"], entry["m49_code"],
                            entry["region_es"], entry["subregion_es"]))
    return {"dim_country": dim_country, "unmatched_countries": unmatched,
            "customers": customers, "products": products, "geography": geography}


def abc_classification(clean: list[dict]) -> list[tuple]:
    """Análisis ABC: clase A hasta el 80 % acumulado de ventas, B hasta el 95 %, C el resto."""
    totals: dict[str, int] = defaultdict(int)
    for r in clean:
        totals[r["customer_name"]] += round(r["sales"] * 100)
    grand = sum(totals.values())
    ranking = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    out, cumulative = [], 0
    for name, cents in ranking:
        cumulative += cents
        pct = cumulative / grand if grand else 0.0
        out.append((name, cents / 100, cumulative / 100, pct, "A" if pct <= 0.8 else "B" if pct <= 0.95 else "C"))
    return out


# --- Estadística (ANOVA de una vía y ANOVA de Welch) sin dependencias externas -----------
def _betacf(a: float, b: float, x: float) -> float:
    tiny, eps = 1e-300, 3e-16
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 500):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """Función beta incompleta regularizada I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def f_survival(f_value: float, df1: float, df2: float) -> float:
    """P(F > f) para una F de Fisher-Snedecor, calculada sin restar cerca de 1 (conserva p muy pequeños)."""
    return _betai(df2 / 2.0, df1 / 2.0, df2 / (df2 + df1 * f_value))


def anova_by_product_line(clean: list[dict]) -> dict:
    groups: "OrderedDict[str, list[float]]" = OrderedDict()
    for r in clean:
        groups.setdefault(r["product_line"], []).append(r["sales"])
    k, n = len(groups), sum(len(v) for v in groups.values())
    means = {g: sum(v) / len(v) for g, v in groups.items()}
    grand = sum(sum(v) for v in groups.values()) / n
    ss_between = sum(len(v) * (means[g] - grand) ** 2 for g, v in groups.items())
    ss_within = sum(sum((x - means[g]) ** 2 for x in v) for g, v in groups.items())
    df_b, df_w = k - 1, n - k
    f_value = (ss_between / df_b) / (ss_within / df_w)
    # ANOVA de Welch (varianzas distintas)
    var = {g: sum((x - means[g]) ** 2 for x in v) / (len(v) - 1) for g, v in groups.items()}
    w = {g: len(v) / var[g] for g, v in groups.items()}
    w_total = sum(w.values())
    mean_w = sum(w[g] * means[g] for g in groups) / w_total
    num = sum(w[g] * (means[g] - mean_w) ** 2 for g in groups) / df_b
    lam = sum((1 - w[g] / w_total) ** 2 / (len(groups[g]) - 1) for g in groups)
    f_welch = num / (1 + 2 * (k - 2) / (k * k - 1) * lam)
    df_w_welch = (k * k - 1) / (3 * lam)
    alpha = 0.05
    p_value = f_survival(f_value, df_b, df_w)
    return {
        "test": "ANOVA de una via: SALES por PRODUCTLINE",
        "observational_unit": "linea de pedido",
        "n": n,
        "groups": {g: {"n": len(v), "mean_sales": means[g]} for g, v in groups.items()},
        "F": f_value, "df_between": df_b, "df_within": df_w, "p_value": p_value, "alpha": alpha,
        "decision": "Rechazar H0: al menos una media difiere" if p_value < alpha else "No rechazar H0",
        "null_hypothesis": "Las medias de ventas por linea de producto son iguales",
        "limitations": ("Las lineas dentro de la misma orden/cliente pueden no ser independientes; el dataset no permite "
                        "inferencia causal. ANOVA omnibus no identifica que pares difieren."),
        "welch": {"F": f_welch, "df_between": df_b, "df_within": df_w_welch,
                  "p_value": f_survival(f_welch, df_b, df_w_welch)},
    }


# =========================================================================================
# LOAD + VALIDATE
# =========================================================================================
def load(db_path: Path, clean: list[dict], dims: dict, territories: dict[str, str], abc: list[tuple], sql_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(DDL)
    conn.executescript(sql_path.read_text(encoding="utf-8").replace("CREATE TABLE status_reference", "CREATE TABLE IF NOT EXISTS status_reference"))
    conn.executemany("INSERT INTO dim_region VALUES (?, ?)", sorted(territories.items()))
    conn.executemany("INSERT INTO dim_country VALUES (?,?,?,?,?,?,?)", dims["dim_country"])
    conn.executemany("INSERT INTO dim_customer VALUES (?,?,?,?,?)", dims["customers"].values())
    conn.executemany("INSERT INTO dim_product VALUES (?,?,?)", dims["products"].values())
    conn.executemany("INSERT INTO dim_geography VALUES (?,?,?)", [(c, t, r) for (c, t), r in dims["geography"].items()])
    cols = ["order_number", "order_line_number", "order_date", "year", "month", "year_month", "status", "status_group",
            "quantity", "unit_price", "sales", "product_code", "product_line", "customer_name", "country", "territory",
            "region", "city", "state", "postal_code", "deal_size", "msrp", "discount_proxy"]
    conn.executemany(f"INSERT INTO fact_sales ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                     [tuple(r[c] for c in cols) for r in clean])
    conn.executemany("INSERT INTO abc_customers VALUES (?,?,?,?,?)", abc)
    conn.commit()
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    fk_violations = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    total_cents = conn.execute("SELECT ROUND(SUM(sales) * 100) FROM fact_sales").fetchone()[0]
    conn.close()
    return {"sqlite_integrity": integrity, "foreign_key_violations": fk_violations, "db_sales_cents": int(total_cents)}


def export_powerbi_csv(db_path: Path, out_dir: Path) -> None:
    """Un CSV por tabla, listos para que Power Query los importe."""
    out_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    for table in ("fact_sales", "dim_customer", "dim_product", "dim_country", "dim_geography", "dim_region", "abc_customers"):
        cursor = conn.execute(f"SELECT * FROM {table}")
        with open(out_dir / f"{table}.csv", "w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow([c[0] for c in cursor.description])
            writer.writerows(cursor)
    conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="ETL de ventas del retail: CSV + JSON + SQL -> SQLite validada.")
    parser.add_argument("--raw", type=Path, default=ROOT / "data" / "raw", help="carpeta con el CSV y el JSON M49")
    parser.add_argument("--reference", type=Path, default=ROOT / "etl" / "reference", help="JSON/SQL de referencia")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "processed", help="carpeta de resultados")
    parser.add_argument("--no-powerbi-csv", action="store_true", help="no exportar los CSV para Power BI")
    args = parser.parse_args()

    csv_path, geo_path = args.raw / CSV_NAME, args.raw / GEO_NAME
    for needed in (csv_path, geo_path, args.reference / "territory_regions.json", args.reference / "country_iso3.json",
                   args.reference / "reference_source.sql"):
        if not needed.exists():
            raise EtlError(f"Falta {needed}. Ejecuta primero: python etl/extract_kaggle.py")

    log("1/4 Extracción: leyendo CSV, JSON y SQL")
    rows, csv_sha = read_csv(csv_path)
    m49 = json.loads(geo_path.read_text(encoding="utf-8"))
    territories = json.loads((args.reference / "territory_regions.json").read_text(encoding="utf-8"))["territories"]
    iso3_map = json.loads((args.reference / "country_iso3.json").read_text(encoding="utf-8"))["countries"]
    status_map = read_status_reference(args.reference / "reference_source.sql")
    manifest_path = args.raw / "extraction_manifest.json"
    if manifest_path.exists():
        recorded = json.loads(manifest_path.read_text(encoding="utf-8")).get("sha256")
        if recorded and recorded != csv_sha:
            raise EtlError("La huella SHA-256 del CSV no coincide con la del manifiesto de extracción.")
        log(f"    huella SHA-256 verificada contra el manifiesto: {csv_sha[:16]}…")
    log(f"    {len(rows)} filas de entrada · {len(m49)} países/áreas M49 · {len(status_map)} estados")

    log("2/4 Transformación: tipos, calidad y campos derivados")
    clean, stats = transform(rows, status_map, territories)
    dims = build_dimensions(clean, territories, iso3_map, m49)
    clean = sorted(clean, key=lambda r: (r["order_number"], r["order_line_number"]))
    abc = abc_classification(clean)
    anova = anova_by_product_line(clean)

    problems = []
    for key in ("rows_missing_required", "conversion_errors", "non_positive_quantities", "negative_sales", "duplicate_keys"):
        if stats.get(key):
            problems.append(f"{key} = {stats[key]}")
    unknown_status = sorted({r["status"] for r in clean if r["status_group"] is None})
    if unknown_status:
        problems.append(f"estados sin clasificar en el SQL: {unknown_status}")
    unknown_territory = sorted({r["territory"] for r in clean if r["region"] is None})
    if unknown_territory:
        problems.append(f"territorios sin región en el JSON: {unknown_territory}")
    if dims["unmatched_countries"]:
        problems.append(f"países sin coincidencia M49: {dims['unmatched_countries']}")
    if problems:
        raise EtlError("Controles de calidad fallidos:\n  - " + "\n  - ".join(problems))

    log("3/4 Carga: SQLite con modelo de hechos y dimensiones")
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".etl_", dir=args.out))
    try:
        db_tmp = tmp / "retail_sales.db"
        loaded = load(db_tmp, clean, dims, territories, abc, args.reference / "reference_source.sql")
        csv_cents = sum(round(r["sales"] * 100) for r in clean)
        if loaded["sqlite_integrity"] != "ok" or loaded["foreign_key_violations"]:
            raise EtlError(f"Integridad de SQLite fallida: {loaded}")
        if loaded["db_sales_cents"] != csv_cents:
            raise EtlError("El total de ventas cargado no coincide con el del CSV.")
        if len(clean) != len(rows):
            raise EtlError(f"Filas de entrada ({len(rows)}) y de salida ({len(clean)}) no coinciden.")

        dates = [r["order_date"] for r in clean]
        summary = OrderedDict([
            ("rows", len(clean)),
            ("customers", len(dims["customers"])),
            ("products", len(dims["products"])),
            ("countries", len(dims["dim_country"])),
            ("date_min", min(dates)),
            ("date_max", max(dates)),
            ("sales_total", csv_cents / 100),
            ("csv_source", os.path.relpath(csv_path, ROOT).replace("\\", "/") if csv_path.is_relative_to(ROOT) else str(csv_path)),
            ("source_note", "El CSV contiene pedidos. JSON aporta territorios comerciales y países extraídos del HTML M49. SQL aporta la clasificación de estados."),
            ("web_geography", {"source": "https://unstats.un.org/unsd/methodology/m49/overview/",
                               "countries_matched": len(dims["dim_country"]), "unmatched_sales_rows": 0}),
            ("source_sha256", csv_sha),
            ("quality", OrderedDict([
                ("duplicate_keys", stats.get("duplicate_keys", 0)),
                ("missing_required_fields", stats.get("rows_missing_required", 0)),
                ("sqlite_integrity", loaded["sqlite_integrity"]),
                ("foreign_key_violations", loaded["foreign_key_violations"]),
                ("rows_in", stats["rows_in"]),
                ("rows_out", len(clean)),
                ("exact_duplicates_removed", stats.get("exact_duplicates_removed", 0)),
                ("non_positive_quantities", stats.get("non_positive_quantities", 0)),
                ("negative_sales", stats.get("negative_sales", 0)),
                ("conversion_errors", stats.get("conversion_errors", 0)),
                ("missing_address_line_2", stats["missing_address_line_2"]),
                ("missing_state", stats["missing_state"]),
                ("missing_postal_code", stats["missing_postal_code"]),
            ])),
        ])
        (tmp / "etl_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        (tmp / "anova_results.json").write_text(json.dumps(anova, ensure_ascii=False, indent=2), encoding="utf-8")

        # Todo validado: se reemplazan los resultados anteriores.
        for name in ("retail_sales.db", "etl_summary.json", "anova_results.json"):
            os.replace(tmp / name, args.out / name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not args.no_powerbi_csv:
        export_powerbi_csv(args.out / "retail_sales.db", args.out / "powerbi")
    log("4/4 Validación superada")
    q = summary["quality"]
    log(f"    filas {q['rows_in']} → {q['rows_out']} · duplicados {q['duplicate_keys']} · campos obligatorios ausentes {q['missing_required_fields']}")
    log(f"    integridad SQLite: {q['sqlite_integrity']} · llaves foráneas inválidas: {q['foreign_key_violations']}")
    log(f"    ventas totales: {summary['sales_total']:,.2f} · periodo {summary['date_min']} → {summary['date_max']}")
    log(f"    ANOVA: F = {anova['F']:.4f} · p = {anova['p_value']:.3e} · Welch F = {anova['welch']['F']:.4f}")
    log(f"    resultados en {args.out}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except EtlError as error:
        print(f"\nETL abortado, no se modificaron los resultados anteriores.\n{error}", file=sys.stderr)
        sys.exit(2)
