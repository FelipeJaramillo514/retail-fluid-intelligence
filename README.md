# Retail Fluid Intelligence

Aplicación local de analítica de ventas construida con Node.js y SVG. El servidor consulta SQLite en modo solo lectura; no contiene cifras de ventas escritas manualmente.

## Requisitos e inicio

Requiere Node.js 22.5 o posterior (`node:sqlite`). No usa paquetes externos.

```powershell
npm start
```

Abre <http://127.0.0.1:3000>. La portada **¿Qué hicimos?** explica paso a paso cómo obtuvimos, transformamos, validamos, cargamos y analizamos los datos. Al final del recorrido puedes continuar con el punto 1 del taller. El paquete incluye `data/processed/retail_sales.db` y los JSON de resumen ETL y ANOVA.

Si se ejecutó el ETL del proyecto y se quiere consultar otra carpeta de datos, establece `RETAIL_DATA_DIR` con la ruta que contiene esos tres archivos:

```powershell
$env:RETAIL_DATA_DIR = 'C:\ruta\data\processed'
npm start
```

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

El recorrido incluye el registro de la ejecución de Scrapy y un ejemplo real de una línea de pedido antes y después del ETL. La web y Power BI consumen salidas del mismo ETL. Al actualizar los datos empaquetados, copia también `data/raw/extraction_manifest.json` del proyecto a `web/public/evidence/extraction_manifest.json`. La web muestra el registro si su huella coincide con la registrada en el resumen ETL.

## Interpretación de datos

- El dataset de referencia es [Sample Sales Data en Kaggle](https://www.kaggle.com/datasets/kyanyoga/sample-sales-data). Revisa sus condiciones de uso antes de redistribuir los datos.
- La fuente no documenta moneda; el dashboard no asigna un símbolo monetario.
- No hay costos ni gastos, así que las ventas por línea no representan utilidad o rentabilidad real.
- No existe canal de venta. Los productos por canal no se pueden calcular y territorio no se interpreta como canal.
- `discount_proxy` representa una brecha respecto a MSRP, no un descuento promocional observado.
- El mapa coloca las burbujas en posiciones aproximadas sobre una geometría simplificada de [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/).
- ANOVA es una comparación ómnibus exploratoria de ventas por línea de producto y no identifica qué pares difieren ni implica causalidad.

## Estructura

- `server.js`: API HTTP y servidor local.
- `public/`: interfaz, estilos, gráficos SVG e interacciones.
- `data/processed/`: SQLite de lectura y resultados de ETL/ANOVA que alimentan la aplicación.
