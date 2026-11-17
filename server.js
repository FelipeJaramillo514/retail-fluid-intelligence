'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.RETAIL_DATA_DIR || path.join(ROOT, 'data', 'processed'));
const PUBLIC = path.join(__dirname, 'public');
const DB_PATH = path.join(DATA_DIR, 'retail_sales.db');
const PORT = Number(process.env.PORT || 3000);

if (!fs.existsSync(DB_PATH)) {
  throw new Error(`No se encontró la base SQLite del ETL: ${DB_PATH}. Ejecuta python etl.py en la raíz del proyecto.`);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const etlSummary = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'etl_summary.json'), 'utf8'));
const anovaResult = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'anova_results.json'), 'utf8'));

function distinctValues(column) {
  const allowed = new Set(['year', 'country', 'region', 'product_line']);
  if (!allowed.has(column)) throw new Error('Columna no permitida');
  return db.prepare(`SELECT DISTINCT ${column} AS value FROM fact_sales WHERE ${column} IS NOT NULL ORDER BY value`).all().map((r) => r.value);
}

const metadata = {
  ...etlSummary,
  years: distinctValues('year'),
  countries: distinctValues('country'),
  regions: distinctValues('region'),
  productLines: distinctValues('product_line'),
  anova: anovaResult,
  limitations: {
    currency: 'La fuente no identifica la moneda.',
    profit: 'No hay costo ni gastos; no se puede calcular utilidad o rentabilidad real.',
    channel: 'No hay canal de venta; territorio y región no son canales.',
    discount: 'discount_proxy es una brecha calculada frente a MSRP, no un descuento promocional observado.',
  },
};

function buildWhere(filters, includeYear = true) {
  const clauses = [];
  const params = [];
  if (includeYear && filters.year) { clauses.push('year = ?'); params.push(Number(filters.year)); }
  if (filters.country) { clauses.push('country = ?'); params.push(filters.country); }
  if (filters.region) { clauses.push('region = ?'); params.push(filters.region); }
  if (filters.productLine) { clauses.push('product_line = ?'); params.push(filters.productLine); }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function readRows(filters, includeYear = true) {
  const where = buildWhere(filters, includeYear);
  return db.prepare(`
    SELECT order_number, order_date, year, quantity, unit_price, sales, product_code,
      product_line, customer_name, country, region, city, msrp, discount_proxy
    FROM fact_sales ${where.sql}
  `).all(...where.params);
}

function monthKey(dateText) { return String(dateText).slice(0, 7); }
function previousMonth(key) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function previousYearMonth(key) {
  const [year, month] = key.split('-');
  return `${Number(year) - 1}-${month}`;
}
function aggregateMap(rows, keyFn, valueFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null || key === '') continue;
    const current = map.get(key) || { key, salesCents: 0, units: 0, lines: 0 };
    const values = valueFn(row);
    current.salesCents += Math.round((values.sales || 0) * 100);
    current.units += values.units || 0;
    current.lines += 1;
    map.set(key, current);
  }
  return [...map.values()].map((item) => ({ ...item, sales: item.salesCents / 100 }));
}

function dashboard(filters) {
  const rows = readRows(filters, true);
  const comparisonRows = filters.year ? readRows(filters, false) : rows;
  const totalSalesCents = rows.reduce((sum, row) => sum + Math.round(row.sales * 100), 0);
  const totalSales = totalSalesCents / 100;
  const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
  const customers = new Set(rows.map((row) => row.customer_name).filter(Boolean)).size;
  const totalOrders = new Set(rows.map((row) => row.order_number)).size;
  const monthRows = aggregateMap(rows, (row) => monthKey(row.order_date), (row) => ({ sales: row.sales, units: row.quantity }));
  monthRows.sort((a, b) => a.key.localeCompare(b.key));
  const lastMonth = monthRows.at(-1) || null;
  const priorMonth = lastMonth ? monthRows.find((item) => item.key === previousMonth(lastMonth.key)) : null;
  const mom = priorMonth && priorMonth.sales !== 0 ? (lastMonth.sales - priorMonth.sales) / priorMonth.sales : null;

  const comparisonMonths = aggregateMap(comparisonRows, (row) => monthKey(row.order_date), (row) => ({ sales: row.sales }));
  const latestComparable = lastMonth;
  const priorYear = latestComparable ? comparisonMonths.find((item) => item.key === previousYearMonth(latestComparable.key)) : null;
  const yoy = priorYear && priorYear.sales !== 0 ? (latestComparable.sales - priorYear.sales) / priorYear.sales : null;

  const yearly = aggregateMap(rows, (row) => row.year, (row) => ({ sales: row.sales, units: row.quantity }));
  yearly.sort((a, b) => Number(a.key) - Number(b.key));
  const countrySales = aggregateMap(rows, (row) => row.country, (row) => ({ sales: row.sales, units: row.quantity }));
  countrySales.sort((a, b) => b.sales - a.sales);
  const regionSales = aggregateMap(rows, (row) => row.region, (row) => ({ sales: row.sales, units: row.quantity }));
  regionSales.forEach((item) => { item.averagePerLine = item.lines ? item.sales / item.lines : 0; });
  regionSales.sort((a, b) => b.averagePerLine - a.averagePerLine);
  const productLines = aggregateMap(rows, (row) => row.product_line, (row) => ({ sales: row.sales, units: row.quantity }));
  productLines.sort((a, b) => b.sales - a.sales);

  const products = aggregateMap(rows, (row) => row.product_code, (row) => ({ sales: row.sales, units: row.quantity }));
  const productLineByCode = new Map();
  for (const row of rows) if (!productLineByCode.has(row.product_code)) productLineByCode.set(row.product_code, row.product_line);
  for (const item of products) item.productLine = productLineByCode.get(item.key) || 'Sin línea';
  products.sort((a, b) => b.units - a.units || b.sales - a.sales);

  const customerSales = aggregateMap(rows, (row) => row.customer_name, (row) => ({ sales: row.sales }));
  customerSales.sort((a, b) => b.sales - a.sales || String(a.key).localeCompare(String(b.key)));
  let cumulativeSalesCents = 0;
  let lastRankSales = null;
  let rank = 0;
  for (let i = 0; i < customerSales.length; i += 1) {
    const item = customerSales[i];
    if (lastRankSales === null || item.sales !== lastRankSales) rank += 1;
    lastRankSales = item.sales;
    cumulativeSalesCents += Math.round(item.sales * 100);
    const cumulativeSales = cumulativeSalesCents / 100;
    item.rank = rank;
    item.cumulativeSales = cumulativeSales;
    item.cumulativePct = totalSalesCents ? cumulativeSalesCents / totalSalesCents : 0;
    item.abcClass = item.cumulativePct <= 0.8 ? 'A' : item.cumulativePct <= 0.95 ? 'B' : 'C';
  }
  const abcSummary = ['A', 'B', 'C'].map((abcClass) => {
    const group = customerSales.filter((item) => item.abcClass === abcClass);
    return { key: abcClass, customers: group.length, sales: group.reduce((sum, item) => sum + item.sales, 0) };
  });

  const discountPoints = rows
    .filter((row) => Number.isFinite(row.discount_proxy) && Number.isFinite(row.quantity))
    .map((row) => ({ discountProxy: row.discount_proxy, units: row.quantity, sales: row.sales }));
  const meanX = discountPoints.length ? discountPoints.reduce((sum, point) => sum + point.discountProxy, 0) / discountPoints.length : 0;
  const meanY = discountPoints.length ? discountPoints.reduce((sum, point) => sum + point.units, 0) / discountPoints.length : 0;
  const covariance = discountPoints.reduce((sum, point) => sum + (point.discountProxy - meanX) * (point.units - meanY), 0);
  const varianceX = discountPoints.reduce((sum, point) => sum + (point.discountProxy - meanX) ** 2, 0);
  const varianceY = discountPoints.reduce((sum, point) => sum + (point.units - meanY) ** 2, 0);
  const discountQuantityCorrelation = varianceX && varianceY ? covariance / Math.sqrt(varianceX * varianceY) : null;

  return {
    filters,
    summary: {
      sales: totalSales,
      units: totalUnits,
      customers,
      orders: totalOrders,
      lines: rows.length,
      averagePerLine: rows.length ? totalSales / rows.length : 0,
      latestMonth: lastMonth?.key || null,
      latestMonthSales: lastMonth?.sales ?? null,
      mom,
      priorMonth: priorMonth?.key || null,
      yoy,
      priorYearMonth: priorYear?.key || null,
    },
    monthly: monthRows,
    yearly,
    countrySales,
    regionSales,
    productLines,
    topProducts: products.slice(0, 10),
    customers: customerSales.slice(0, 20),
    abcSummary,
    pareto: customerSales.slice(0, 20).map(({ key, sales, cumulativePct, rank, abcClass }) => ({ customer: key, sales, cumulativePct, rank, abcClass })),
    discountPoints,
    discountQuantityCorrelation,
  };
}

function sendJson(res, value) {
  const payload = JSON.stringify(value);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendError(res, 400, 'Solicitud inválida.'); }

  if (url.pathname === '/api/meta') return sendJson(res, metadata);
  if (url.pathname === '/api/dashboard') {
    const year = url.searchParams.get('year');
    const country = url.searchParams.get('country');
    const region = url.searchParams.get('region');
    const productLine = url.searchParams.get('productLine');
    if (year && !metadata.years.includes(Number(year))) return sendError(res, 400, 'Año no disponible en los datos.');
    if (country && !metadata.countries.includes(country)) return sendError(res, 400, 'País no disponible en los datos.');
    if (region && !metadata.regions.includes(region)) return sendError(res, 400, 'Región no disponible en los datos.');
    if (productLine && !metadata.productLines.includes(productLine)) return sendError(res, 400, 'Línea de producto no disponible en los datos.');
    try { return sendJson(res, dashboard({ year, country, region, productLine })); }
    catch (error) { console.error(error); return sendError(res, 500, 'No se pudo calcular el tablero.'); }
  }

  let requested;
  try { requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
  catch { return sendError(res, 400, 'Ruta inválida.'); }
  const filePath = path.resolve(PUBLIC, requested);
  if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== path.join(PUBLIC, 'index.html')) return sendError(res, 403, 'Ruta no permitida.');
  fs.readFile(filePath, (error, content) => {
    if (error) return sendError(res, 404, 'No se encontró el recurso.');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Retail Fluid Intelligence disponible en http://127.0.0.1:${PORT}`);
  console.log(`SQLite en modo solo lectura: ${DB_PATH}`);
});

function close() {
  try { db.close(); } catch {}
  server.close(() => process.exit(0));
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
