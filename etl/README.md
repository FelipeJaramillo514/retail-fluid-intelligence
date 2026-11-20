# ETL del proyecto

Flujo completo, de la web al modelo:

```
Kaggle (ficha + ZIP)  ─┐
ONU M49 (tablas HTML) ─┼─ extract_kaggle.py (Scrapy) ─► data/raw/{sales_data_sample.csv, un_m49_countries.json, extraction_manifest.json}
                       │
reference/*.json,*.sql ┘
                                   etl.py ─► data/processed/{retail_sales.db, etl_summary.json, anova_results.json, powerbi/*.csv}
                                                         │
                                                         ├─► web (NestJS lee la base en solo lectura)
                                                         └─► Power BI (Power Query importa powerbi/*.csv, DAX calcula los indicadores)
```

## Pasos

```powershell
pip install -r etl/requirements.txt
python etl/extract_kaggle.py            # data/raw
python etl/etl.py                       # data/processed
python etl/compare_processed.py data/processed <otra-carpeta>   # opcional
```

Todos aceptan `--help`. Las rutas se pueden cambiar con `--raw`, `--out` y `--reference`.

## Controles de calidad del ETL

El ETL se detiene (código de salida 2) y no modifica `data/processed` si encuentra:

- campos obligatorios vacíos o fechas/números que no se pueden convertir;
- claves `(pedido, línea)` repetidas;
- cantidades no positivas o ventas negativas;
- estados sin clasificar en el SQL, territorios sin región o países sin coincidencia M49;
- una huella SHA-256 del CSV distinta de la del manifiesto;
- fallos de `PRAGMA integrity_check`, de `PRAGMA foreign_key_check`, o un total de ventas cargado distinto del del CSV.

## Notas sobre los datos

- `discount_proxy = max(0, (MSRP − precio unitario) / MSRP)`. Es una brecha frente al precio de lista, **no** un descuento promocional observado.
- `state`, `postal_code` y `address_line_2` quedan vacíos cuando la fuente no los trae (muchos países no usan estados). Ningún análisis los usa.
- El CSV no trae moneda, costos ni canal de venta; por eso no hay rentabilidad ni productos por canal.
- El ANOVA y el de Welch se calculan en Python puro (la distribución F con la función beta incompleta), sin dependencias externas.
