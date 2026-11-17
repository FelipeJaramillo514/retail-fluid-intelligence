# Retail Fluid Intelligence

Aplicación local de analítica de ventas construida con Node.js y SVG. El servidor consulta SQLite en modo solo lectura; no contiene cifras de ventas escritas manualmente.

## Requisitos e inicio

Requiere Node.js 22.5 o posterior (`node:sqlite`). No usa paquetes externos.

```powershell
npm start
```

Abre <http://127.0.0.1:3000>. El paquete incluye `data/processed/retail_sales.db` y los JSON de resumen ETL y ANOVA necesarios para mostrar los resultados.

Si se ejecutó el ETL del proyecto y se quiere consultar otra carpeta de datos, establece `RETAIL_DATA_DIR` con la ruta que contiene esos tres archivos:

```powershell
$env:RETAIL_DATA_DIR = 'C:\ruta\data\processed'
npm start
```

## Vistas

- **Resumen:** ventas mensuales, comparación anual, países, líneas de producto y filtros por año, país, región y línea.
- **Clientes & ABC:** clientes con mayores ventas, tabla y curva acumulada ABC con cortes 80%/95%.
- **Mercado & ANOVA:** mapa esquemático por país, ventas promedio por línea agrupadas por región, productos más vendidos, relación entre `discount_proxy` y unidades, y resultado ANOVA.

## Interpretación de datos

- El dataset de referencia es [Sample Sales Data en Kaggle](https://www.kaggle.com/datasets/kyanyoga/sample-sales-data). Revisa sus condiciones de uso antes de redistribuir los datos.
- La fuente no documenta moneda; el dashboard no asigna un símbolo monetario.
- No hay costos ni gastos, así que las ventas por línea no representan utilidad o rentabilidad real.
- No existe canal de venta. Los productos por canal no se pueden calcular y territorio no se interpreta como canal.
- `discount_proxy` representa una brecha respecto a MSRP, no un descuento promocional observado.
- El mapa ubica burbujas en centroides aproximados; representa totales reales por país, pero no fronteras geográficas.
- ANOVA es una comparación ómnibus exploratoria de ventas por línea de producto y no identifica qué pares difieren ni implica causalidad.

## Estructura

- `server.js`: API HTTP y servidor local.
- `public/`: interfaz, estilos, gráficos SVG e interacciones.
- `data/processed/`: SQLite de lectura y resultados de ETL/ANOVA que alimentan la aplicación.
