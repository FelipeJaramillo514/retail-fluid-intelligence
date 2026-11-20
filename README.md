# Retail Fluid Intelligence

Aplicación local de analítica de ventas construida con **NestJS** (TypeScript), gráficos SVG y una capa 3D con **Three.js** (gotas líquidas con shader, nudo toroidal, banda de Möbius, poliedros y un globo interactivo de ventas por país). El servidor consulta SQLite en modo solo lectura; no contiene cifras de ventas escritas manualmente.

## Requisitos e inicio

Requiere Node.js 22.5 o posterior (`node:sqlite`).

```powershell
npm install
npm start          # compila con Nest y arranca en http://127.0.0.1:3000
npm run start:dev  # modo vigilancia
```

Abre <http://127.0.0.1:3000>. La portada **¿Qué hicimos?** explica paso a paso cómo obtuvimos, transformamos, validamos, cargamos y analizamos los datos. Al final del recorrido puedes continuar con el punto 1 del taller. El paquete incluye `data/processed/retail_sales.db` y los JSON de resumen ETL y ANOVA.

Si se ejecutó el ETL del proyecto y se quiere consultar otra carpeta de datos, establece `RETAIL_DATA_DIR` con la ruta que contiene esos tres archivos:

```powershell
$env:RETAIL_DATA_DIR = 'C:\ruta\data\processed'
npm start
```

## Extracción y ETL (scraping + CSV, JSON y SQL)

La carpeta `etl/` contiene el proceso completo que alimenta la web y Power BI. Requiere Python 3.10 o posterior.

```powershell
pip install -r etl/requirements.txt
npm run etl:extract   # Scrapy: ficha de Kaggle, tablas M49 de la ONU y CSV de pedidos -> data/raw
npm run etl:run       # ETL: valida, transforma y carga -> data/processed
```

| Script | Qué hace |
|---|---|
| `etl/extract_kaggle.py` | Spider de Scrapy (respeta `robots.txt`). Lee el bloque `ld+json` de Kaggle, las tablas M49 de la ONU en inglés y español, descarga el ZIP público (CC0) y extrae `sales_data_sample.csv`. Escribe `extraction_manifest.json` con las huellas SHA-256. Con `--publish-evidence` copia el manifiesto a `public/evidence` para que la web lo muestre. |
| `etl/etl.py` | Cruza el **CSV** de pedidos, los **JSON** (M49, territorios comerciales y códigos ISO) y el **SQL** de clasificación de estados. Valida duplicados, campos obligatorios, cantidades y ventas, conversiones, integridad y llaves foráneas; carga `retail_sales.db`, genera `etl_summary.json`, `anova_results.json` y los CSV para Power BI (`data/processed/powerbi`). Si un control falla, aborta sin tocar los resultados anteriores. |
| `etl/compare_processed.py` | Compara dos carpetas de resultados tabla por tabla, el resumen y el ANOVA. |
| `etl/reference/` | Fuentes de referencia: `territory_regions.json`, `country_iso3.json` y `reference_source.sql`. |

Verificación: se extrajo el CSV con el scraper (misma huella SHA-256 que el registro del proyecto, `6a20c7e5…`) y se corrió el ETL; `compare_processed.py` confirmó que las 8 tablas de SQLite, el resumen y el ANOVA coinciden con los resultados ya validados del equipo. Los datos crudos (`data/raw`) y los CSV de Power BI no se versionan: se regeneran con los comandos anteriores.

## Despliegue en Vercel

El repositorio incluye `vercel.json`. Importa el repo en Vercel sin cambiar nada: `npm run vercel-build` compila Nest y copia Three.js a `public/vendor`; `public/` se sirve como estático y `/api/*` lo atiende la función `api/index.js`, que incluye `dist/` y `data/`. Usa Node 22.x (necesario para `node:sqlite`).

## Requerimientos analíticos

| Punto | Resultado en la web |
|---|---|
| 1. Total de ventas mensuales por país | Serie mensual filtrable y tabla con el desglose por mes y país. |
| 2. Rentabilidad por categoría de producto | Cobertura parcial. Ventas por categoría y explicación del costo que falta para calcular margen. |
| 3. Clientes con mayores ingresos generados | Ranking filtrable por ventas y participación de cada cliente sobre el total. |
| 4. Comparativa año a año de ventas | Totales observados y variación de enero a mayo en cada año. La vista conserva los años de referencia para comparar con 2005. |
| 5. Tasa de crecimiento mensual | Gráfico y tabla con ventas del mes, ventas del mes anterior y variación cuando existe una base positiva. |
| 6. Promedio de ventas por región | Media por línea de pedido, por territorio comercial y por región M49 extraída de la web de la ONU. |
| 7. Productos más vendidos por canal | Cobertura parcial. Ranking real por unidades totales y explicación del campo de canal ausente. |
| 8. Mapa geográfico de ventas | Burbujas con tamaño por total de ventas y selección de país desde el mapa o la lista. |
| 9. Relación entre descuentos y volumen de compra | Cobertura parcial. Dispersión y correlación entre la brecha frente a MSRP y las unidades por línea. |
| 10. Análisis ABC de clientes (ventas acumuladas) | Curva y tabla de todos los clientes filtrados, con cortes acumulados de 80 % y 95 %. |

El recorrido incluye el registro de la ejecución de Scrapy y un ejemplo real de una línea de pedido antes y después del ETL. La web y Power BI consumen salidas del mismo ETL. Al actualizar los datos, ejecuta la extracción con `--publish-evidence` (o copia `data/raw/extraction_manifest.json` a `public/evidence/`). La web muestra el registro si su huella coincide con la registrada en el resumen ETL.

## Interpretación de datos

- El dataset de referencia es [Sample Sales Data en Kaggle](https://www.kaggle.com/datasets/kyanyoga/sample-sales-data). Revisa sus condiciones de uso antes de redistribuir los datos.
- La fuente no documenta moneda; el dashboard no asigna un símbolo monetario.
- No hay costos ni gastos, así que las ventas por línea no representan utilidad o rentabilidad real.
- No existe canal de venta. Los productos por canal no se pueden calcular y territorio no se interpreta como canal.
- `discount_proxy` representa una brecha respecto a MSRP, no un descuento promocional observado.
- El mapa coloca las burbujas en posiciones aproximadas sobre una geometría simplificada de [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/).
- ANOVA es una comparación ómnibus exploratoria de ventas por línea de producto y no identifica qué pares difieren ni implica causalidad.

## Estructura

- `src/`: NestJS. `data/` (SQLite de solo lectura), `dashboard/` (`/api/meta`, `/api/dashboard` y cálculos), `main.ts` (arranque y estáticos; Three.js se sirve desde `node_modules`).
- `etl/`: scraping con Scrapy y ETL en Python (ver la sección «Extracción y ETL»).
- `public/3d/`: fondo, figura de cabecera y globo. Si WebGL no está disponible, la interfaz 2D sigue funcionando.
- `public/`: interfaz, estilos, gráficos SVG e interacciones.
- `data/processed/`: SQLite de lectura y resultados de ETL/ANOVA que alimentan la aplicación.
