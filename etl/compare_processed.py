#!/usr/bin/env python3
"""Compara dos carpetas de resultados del ETL (por ejemplo, la de referencia del equipo y una recién generada).

Revisa tabla por tabla de SQLite (todas las filas y columnas, con tolerancia numérica), el resumen
``etl_summary.json`` y los resultados estadísticos ``anova_results.json``.

Uso::

    python etl/compare_processed.py data/processed otra_carpeta/processed

Termina con código 0 si todo coincide y 1 si hay diferencias.
"""
from __future__ import annotations

import json
import math
import sqlite3
import sys
from pathlib import Path

TABLES = ["fact_sales", "dim_customer", "dim_product", "dim_country", "dim_geography", "dim_region",
          "status_reference", "abc_customers"]
# Claves del resumen que deben coincidir (las extra del ETL nuevo, como los recuentos de calidad detallados, se ignoran).
SUMMARY_KEYS = ["rows", "customers", "products", "countries", "date_min", "date_max", "sales_total", "source_sha256"]
QUALITY_KEYS = ["duplicate_keys", "missing_required_fields", "sqlite_integrity", "foreign_key_violations"]


def same(a, b, rel=1e-9) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return a == b
        return math.isclose(float(a), float(b), rel_tol=rel, abs_tol=1e-9)
    return a == b


def rows(db: Path, table: str) -> list[tuple]:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    data = conn.execute(f"SELECT * FROM {table}").fetchall()
    conn.close()
    return sorted(data, key=lambda r: tuple("" if v is None else str(v) for v in r))


def compare_tables(a_dir: Path, b_dir: Path, report: list[str]) -> None:
    for table in TABLES:
        a, b = rows(a_dir / "retail_sales.db", table), rows(b_dir / "retail_sales.db", table)
        if len(a) != len(b):
            report.append(f"{table}: {len(a)} filas vs {len(b)}")
            continue
        bad = [(x, y) for x, y in zip(a, b) if len(x) != len(y) or not all(same(p, q) for p, q in zip(x, y))]
        if bad:
            report.append(f"{table}: {len(bad)} filas distintas. Ejemplo: {bad[0][0]} vs {bad[0][1]}")
        else:
            print(f"  OK  {table:17} {len(a):5} filas idénticas")


def compare_json(a_dir: Path, b_dir: Path, report: list[str]) -> None:
    sa = json.loads((a_dir / "etl_summary.json").read_text(encoding="utf-8"))
    sb = json.loads((b_dir / "etl_summary.json").read_text(encoding="utf-8"))
    bad = [k for k in SUMMARY_KEYS if not same(sa.get(k), sb.get(k))]
    bad += [f"quality.{k}" for k in QUALITY_KEYS if not same(sa.get("quality", {}).get(k), sb.get("quality", {}).get(k))]
    bad += [f"web_geography.{k}" for k in ("countries_matched", "unmatched_sales_rows")
            if not same(sa.get("web_geography", {}).get(k), sb.get("web_geography", {}).get(k))]
    if bad:
        report.append(f"etl_summary.json difiere en: {bad}")
    else:
        print("  OK  etl_summary.json   claves principales idénticas")

    aa = json.loads((a_dir / "anova_results.json").read_text(encoding="utf-8"))
    ab = json.loads((b_dir / "anova_results.json").read_text(encoding="utf-8"))
    bad = [k for k in ("n", "F", "df_between", "df_within", "p_value", "alpha", "decision") if not same(aa.get(k), ab.get(k), 1e-6)]
    bad += [f"welch.{k}" for k in ("F", "df_between", "df_within", "p_value") if not same(aa["welch"].get(k), ab["welch"].get(k), 1e-6)]
    for group, info in aa["groups"].items():
        other = ab["groups"].get(group)
        if not other or info["n"] != other["n"] or not same(info["mean_sales"], other["mean_sales"]):
            bad.append(f"groups.{group}")
    if bad:
        report.append(f"anova_results.json difiere en: {bad}")
    else:
        print(f"  OK  anova_results.json F={ab['F']:.4f} p={ab['p_value']:.3e} (7 grupos y ANOVA de Welch iguales)")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    a_dir, b_dir = Path(sys.argv[1]), Path(sys.argv[2])
    print(f"Comparando\n  A: {a_dir}\n  B: {b_dir}")
    report: list[str] = []
    compare_tables(a_dir, b_dir, report)
    compare_json(a_dir, b_dir, report)
    if report:
        print("\nDIFERENCIAS:")
        for line in report:
            print("  -", line)
        return 1
    print("\nTodo coincide.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
