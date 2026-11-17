'use strict';

const $ = (selector) => document.querySelector(selector);
const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let metadata = null;
let currentData = null;
let fetchSequence = 0;

const geo = {
  Australia: [134, -25], Austria: [14.1, 47.6], Belgium: [4.7, 50.8], Canada: [-106, 56],
  Denmark: [9.5, 56], Finland: [26, 64], France: [2, 46.5], Germany: [10.4, 51],
  Ireland: [-8, 53], Italy: [12.5, 42.8], Japan: [138, 36], Norway: [9, 62],
  Philippines: [122, 12], Singapore: [103.8, 1.3], Spain: [-4, 40], Sweden: [16, 62],
  Switzerland: [8.2, 46.8], UK: [-2, 54], USA: [-98, 39],
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function compact(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${fmt2.format(value / 1_000_000)} M`;
  if (abs >= 10_000) return `${fmt0.format(value / 1_000)} mil`;
  return fmt0.format(value);
}

function signedPercent(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const amount = fmtPct.format(Math.abs(value));
  return value > 0 ? `+${amount}` : value < 0 ? `−${amount}` : amount;
}

function monthLabel(key, long = false) {
  if (!key) return '—';
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const label = new Intl.DateTimeFormat('es-CO', { month: long ? 'long' : 'short', timeZone: 'UTC' }).format(date);
  return `${label}${long ? ' ' : ' '}${year}`;
}

function fillSelect(select, values, allLabel) {
  const defaultOption = `<option value="">${escapeHtml(allLabel)}</option>`;
  select.innerHTML = defaultOption + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
}

function filterParams() {
  const params = new URLSearchParams();
  const values = {
    year: $('#yearFilter').value,
    country: $('#countryFilter').value,
    region: $('#regionFilter').value,
    productLine: $('#lineFilter').value,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params;
}

function appendOptions() {
  fillSelect($('#yearFilter'), metadata.years, 'Todos');
  fillSelect($('#countryFilter'), metadata.countries, 'Todos');
  fillSelect($('#regionFilter'), metadata.regions, 'Todas');
  fillSelect($('#lineFilter'), metadata.productLines, 'Todas');
}

function renderTrend(items) {
  const svg = $('#trendChart');
  const W = 900; const H = 290; const left = 55; const right = 18; const top = 18; const bottom = 34;
  if (!items.length) { svg.innerHTML = emptyChart('No hay ventas para esta selección.'); return; }
  const values = items.map((item) => item.sales);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const yMin = Math.max(0, minValue - (maxValue - minValue) * .1);
  const yMax = maxValue + Math.max((maxValue - yMin) * .13, 1);
  const x = (index) => left + (items.length < 2 ? (W - left - right) / 2 : index * (W - left - right) / (items.length - 1));
  const y = (value) => top + (yMax - value) / (yMax - yMin || 1) * (H - top - bottom);
  const points = items.map((item, index) => [x(index), y(item.sales)]);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${points.at(-1)[0].toFixed(1)} ${(H - bottom).toFixed(1)} L ${points[0][0].toFixed(1)} ${(H - bottom).toFixed(1)} Z`;
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, index) => {
    const value = yMin + (yMax - yMin) * index / ticks;
    const py = y(value);
    return `<line class="grid-line" x1="${left}" y1="${py}" x2="${W - right}" y2="${py}"/><text class="axis-label" x="${left - 9}" y="${py + 3}" text-anchor="end">${compact(value)}</text>`;
  }).join('');
  const labelIndexes = new Set([0, Math.round((items.length - 1) / 3), Math.round((items.length - 1) * 2 / 3), items.length - 1]);
  const xLabels = [...labelIndexes].filter((index) => items[index]).map((index) => `<text class="axis-label" x="${x(index)}" y="${H - 9}" text-anchor="middle">${escapeHtml(monthLabel(items[index].key))}</text>`).join('');
  const circles = points.map(([px, py], index) => `<circle class="trend-point" cx="${px}" cy="${py}" r="2.9"><title>${escapeHtml(monthLabel(items[index].key, true))} · ${fmt2.format(items[index].sales)} en ventas registradas</title></circle>`).join('');
  svg.innerHTML = `${grid}<path class="trend-area" d="${area}"/><path class="trend-line" d="${path}"/>${circles}${xLabels}`;
  $('#trendRange').textContent = items.length > 1 ? `${monthLabel(items[0].key, true)} — ${monthLabel(items.at(-1).key, true)}` : monthLabel(items[0].key, true);
}

function renderYearBars(items) {
  const host = $('#yearBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos</div>'; return; }
  const max = Math.max(...items.map((item) => item.sales), 1);
  host.innerHTML = items.map((item) => {
    const height = Math.max(4, item.sales / max * 100);
    return `<div class="year-column" title="${escapeHtml(item.key)} · ${fmt2.format(item.sales)}">
      <span class="year-value">${compact(item.sales)}</span><div class="year-bar" style="height:${height}%"></div><span class="year-label">${escapeHtml(item.key)}</span>
    </div>`;
  }).join('');
}

function renderRankBars(host, items, formatter, limit = 8) {
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos en esta selección.</div>'; return; }
  const list = items.slice(0, limit);
  const max = Math.max(...list.map((item) => item.sales), 1);
  host.innerHTML = list.map((item) => {
    const name = item.key;
    const value = formatter(item);
    const width = Math.max(2, item.sales / max * 100);
    return `<div class="rank-row" title="${escapeHtml(name)} · ${fmt2.format(item.sales)} en ventas">
      <span class="rank-label">${escapeHtml(name)}</span><span class="rank-track"><i class="rank-fill" style="width:${width}%"></i></span><span class="rank-value">${escapeHtml(value)}</span>
    </div>`;
  }).join('');
}

function renderCountryBars(items) {
  renderRankBars($('#countryBars'), items, (item) => compact(item.sales), 8);
}

function renderProductLineBars(items) {
  const host = $('#lineBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos en esta selección.</div>'; return; }
  const max = Math.max(...items.map((item) => item.sales), 1);
  host.innerHTML = items.map((item) => `<div class="category-row" title="${escapeHtml(item.key)} · ${fmt2.format(item.sales)} · ${fmt0.format(item.units)} unidades">
    <span class="category-name">${escapeHtml(item.key)}</span><span class="category-meter"><i style="width:${Math.max(2, item.sales / max * 100)}%"></i></span><span class="category-value">${compact(item.sales)}</span>
  </div>`).join('');
}

function renderAbc(summary, data) {
  const colors = { A: '#80dfbd', B: '#aaa0ff', C: '#e2af8d' };
  const denominator = Math.max(data.summary.customers, 1);
  $('#abcTotal').textContent = `${fmt0.format(data.summary.customers)} CLIENTES`;
  $('#abcCards').innerHTML = summary.map((item) => `<article class="abc-card" style="--abc-color:${colors[item.key]}">
    <span class="abc-letter">${escapeHtml(item.key)}</span><div><strong>${fmt0.format(item.customers)}</strong><small>clientes en clase ${escapeHtml(item.key)}</small></div><em>${fmtPct.format(item.customers / denominator)}</em>
  </article>`).join('');
  renderPareto(data.pareto);
  renderCustomerTable(data.customers);
}

function renderPareto(items) {
  const svg = $('#paretoChart');
  const W = 900; const H = 320; const left = 47; const right = 23; const top = 16; const bottom = 38;
  if (!items.length) { svg.innerHTML = emptyChart('No hay clientes para esta selección.'); return; }
  const maxIndex = items.length - 1;
  const x = (index) => left + (maxIndex ? index / maxIndex : .5) * (W - left - right);
  const y = (value) => top + (1 - value) * (H - top - bottom);
  const ticks = [0, .25, .5, .75, 1];
  const grid = ticks.map((tick) => `<line class="grid-line" x1="${left}" y1="${y(tick)}" x2="${W - right}" y2="${y(tick)}"/><text class="axis-label" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${Math.round(tick * 100)}%</text>`).join('');
  const threshold80 = `<line class="pareto-threshold" x1="${left}" y1="${y(.8)}" x2="${W - right}" y2="${y(.8)}"/><text class="axis-label" x="${W - right - 3}" y="${y(.8) - 5}" text-anchor="end">umbral 80%</text>`;
  const threshold95 = `<line class="pareto-threshold" x1="${left}" y1="${y(.95)}" x2="${W - right}" y2="${y(.95)}"/><text class="axis-label" x="${W - right - 3}" y="${y(.95) - 5}" text-anchor="end">umbral 95%</text>`;
  const coords = items.map((item, index) => [x(index), y(item.cumulativePct)]);
  const path = coords.map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${path} L ${coords.at(-1)[0]} ${H - bottom} L ${coords[0][0]} ${H - bottom} Z`;
  const points = coords.map(([px, py], index) => `<circle class="pareto-point" cx="${px}" cy="${py}" r="3"><title>${escapeHtml(items[index].customer)} · acumulado ${fmtPct.format(items[index].cumulativePct)} · clase ${items[index].abcClass}</title></circle>`).join('');
  svg.innerHTML = `${grid}${threshold80}${threshold95}<path class="pareto-area" d="${area}"/><path class="pareto-line" d="${path}"/>${points}<text class="axis-label" x="${left}" y="${H - 10}">1</text><text class="axis-label" x="${W - right}" y="${H - 10}" text-anchor="end">${items.length}</text><text class="axis-label" x="${(W + left - right) / 2}" y="${H - 10}" text-anchor="middle">CLIENTES EN ORDEN DE VENTAS</text>`;
}

function renderCustomerTable(items) {
  const body = $('#customerTable');
  if (!items.length) { body.innerHTML = '<tr><td colspan="6">Sin clientes para esta selección.</td></tr>'; return; }
  body.innerHTML = items.map((item) => `<tr>
    <td>${fmt0.format(item.rank)}</td><td>${escapeHtml(item.key)}</td><td><span class="class-pill class-${escapeHtml(item.abcClass)}">${escapeHtml(item.abcClass)}</span></td>
    <td>${fmt2.format(item.sales)}</td><td>${fmt2.format(item.cumulativeSales)}</td><td><span class="table-progress"><i style="width:${Math.min(100, item.cumulativePct * 100)}%"></i></span>${fmtPct.format(item.cumulativePct)}</td>
  </tr>`).join('');
}

function renderMap(items) {
  const svg = $('#geoMap');
  const W = 900; const H = 390; const left = 22; const right = 22; const top = 20; const bottom = 18;
  const project = ([lon, lat]) => [left + (lon + 180) / 360 * (W - left - right), top + (90 - lat) / 180 * (H - top - bottom)];
  const parallels = [-60, -30, 0, 30, 60].map((lat) => { const [, y] = project([0, lat]); return `<line class="map-grid" x1="${left}" y1="${y}" x2="${W - right}" y2="${y}"/>`; }).join('');
  const meridians = [-120, -60, 0, 60, 120].map((lon) => { const [x] = project([lon, 0]); return `<line class="map-grid" x1="${x}" y1="${top}" x2="${x}" y2="${H - bottom}"/>`; }).join('');
  // Simplified continent silhouettes are a visual base only; data is encoded solely by country markers.
  const land = [
    'M80 82 L116 58 164 62 202 78 218 101 208 127 180 139 169 160 144 166 131 190 115 184 101 151 83 129 72 105Z',
    'M177 194 L207 208 220 236 213 274 198 308 187 337 174 327 172 292 160 264 164 230Z',
    'M366 84 L397 70 430 77 451 96 473 93 495 109 526 112 551 133 542 154 516 151 499 168 472 163 454 179 431 170 414 151 393 148 382 126Z',
    'M442 182 L470 177 491 194 503 225 495 260 480 295 461 318 447 290 436 255 425 224 430 199Z',
    'M549 91 L579 71 619 75 650 95 668 118 655 135 626 131 605 144 578 132 560 116Z',
    'M680 212 L712 202 743 213 754 231 739 249 709 245 690 233Z',
  ].map((d) => `<path class="map-land" d="${d}"/>`).join('');
  const filtered = items.filter((item) => geo[item.key]);
  const max = Math.max(...filtered.map((item) => item.sales), 1);
  const circles = filtered.map((item) => {
    const [lon, lat] = geo[item.key];
    const [x, y] = project([lon, lat]);
    const radius = 3.5 + Math.sqrt(item.sales / max) * 12;
    return `<circle class="map-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}"><title>${escapeHtml(item.key)} · ${fmt2.format(item.sales)} en ventas</title></circle>`;
  }).join('');
  svg.innerHTML = `<rect class="map-bg" x="${left}" y="${top}" width="${W - left - right}" height="${H - top - bottom}" rx="13"/>${parallels}${meridians}${land}${circles}`;
  const countries = new Set(items.map((item) => item.key));
  $('#geoCount').textContent = `${fmt0.format(filtered.length)} PAÍSES`;
  $('#geoMap').setAttribute('aria-label', `Mapa de burbujas con ${filtered.length} países geolocalizados de ${countries.size} países filtrados`);
}

function renderRegionBars(items) {
  const host = $('#regionBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos para esta selección.</div>'; return; }
  const max = Math.max(...items.map((item) => item.averagePerLine), 1);
  host.innerHTML = items.map((item) => `<div class="region-row" title="${escapeHtml(item.key)} · media ${fmt2.format(item.averagePerLine)} · ${fmt0.format(item.lines)} líneas">
    <span class="region-name">${escapeHtml(item.key)}</span><span class="region-average">${fmt2.format(item.averagePerLine)}</span><span class="region-rail"><i style="width:${Math.max(2, item.averagePerLine / max * 100)}%"></i></span>
  </div>`).join('');
}

function renderProducts(items) {
  const host = $('#productBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos para esta selección.</div>'; return; }
  const max = Math.max(...items.map((item) => item.units), 1);
  host.innerHTML = items.map((item) => `<div class="product-row" title="${escapeHtml(item.key)} · ${fmt0.format(item.units)} unidades · ${fmt2.format(item.sales)} en ventas">
    <span class="product-code">${escapeHtml(item.key)}<small class="product-line-name">${escapeHtml(item.productLine)}</small></span><span class="product-rail"><i style="width:${Math.max(2, item.units / max * 100)}%"></i></span><span class="product-units">${fmt0.format(item.units)} un.</span>
  </div>`).join('');
}

function renderScatter(points, correlation) {
  const svg = $('#scatterChart');
  const W = 720; const H = 290; const left = 48; const right = 15; const top = 15; const bottom = 37;
  if (!points.length) { svg.innerHTML = emptyChart('Sin observaciones de precio y cantidad.'); return; }
  const maxX = Math.max(...points.map((point) => point.discountProxy), .01);
  const maxY = Math.max(...points.map((point) => point.units), 1);
  const x = (value) => left + value / maxX * (W - left - right);
  const y = (value) => H - bottom - value / maxY * (H - top - bottom);
  const grid = [0, .25, .5, .75, 1].map((tick) => {
    const py = H - bottom - tick * (H - top - bottom);
    const px = left + tick * (W - left - right);
    return `<line class="scatter-grid" x1="${left}" y1="${py}" x2="${W - right}" y2="${py}"/><line class="scatter-grid" x1="${px}" y1="${top}" x2="${px}" y2="${H - bottom}"/>`;
  }).join('');
  const dots = points.map((point) => `<circle class="scatter-dot" cx="${x(point.discountProxy).toFixed(1)}" cy="${y(point.units).toFixed(1)}" r="2.1"><title>Brecha vs MSRP (proxy): ${fmtPct.format(point.discountProxy)} · cantidad: ${fmt0.format(point.units)} unidades · venta registrada: ${fmt2.format(point.sales)}</title></circle>`).join('');
  const labels = `<text class="axis-label" x="${left}" y="${H - 11}">0%</text><text class="axis-label" x="${W - right}" y="${H - 11}" text-anchor="end">${fmtPct.format(maxX)}</text><text class="axis-label" x="${(W + left - right) / 2}" y="${H - 1}" text-anchor="middle">BRECHA VS MSRP · PROXY</text><text class="axis-label" transform="translate(13 ${(H + top - bottom) / 2}) rotate(-90)" text-anchor="middle">UNIDADES POR LÍNEA</text>`;
  svg.innerHTML = `${grid}${dots}${labels}`;
  $('#scatterCorrelation').textContent = `Correlación de Pearson: ${correlation == null ? 'no disponible' : fmt2.format(correlation)}`;
  $('#scatterN').textContent = `n = ${fmt0.format(points.length)} líneas`;
}

function renderAnova(anova) {
  $('#anovaF').textContent = fmt2.format(anova.F);
  $('#anovaP').textContent = Number(anova.p_value).toExponential(2).replace('.', ',');
  $('#anovaDf').textContent = `(${anova.df_between}; ${anova.df_within})`;
  $('#anovaAlpha').textContent = fmt2.format(anova.alpha).replace('0,', ',');
  $('#anovaDecision').textContent = anova.p_value < anova.alpha ? 'Se rechaza H₀' : 'No se rechaza H₀';
  $('#anovaSummary').textContent = `H₀: las medias de venta por línea de producto son iguales. F(${anova.df_between}, ${anova.df_within}) = ${fmt2.format(anova.F)}; p = ${Number(anova.p_value).toExponential(2)}. La prueba está calculada sobre el conjunto completo y no cambia con los filtros del tablero.`;
}

function renderMethod(meta) {
  $('#methodPeriod').textContent = `${meta.date_min} — ${meta.date_max}`;
  $('#methodSales').textContent = fmt2.format(meta.sales_total);
  $('#methodScope').textContent = `${fmt0.format(meta.rows)} líneas de pedido`;
  $('#methodRows').textContent = fmt0.format(meta.rows);
  $('#methodCustomers').textContent = fmt0.format(meta.customers);
  $('#methodProducts').textContent = fmt0.format(meta.products);
  $('#methodCountries').textContent = fmt0.format(meta.countries.length);
  $('#methodAnovaF').textContent = fmt2.format(meta.anova.F);
  $('#methodAnovaP').textContent = Number(meta.anova.p_value).toExponential(2).replace('.', ',');
  $('#methodAnovaDecision').textContent = meta.anova.p_value < meta.anova.alpha ? 'Rechazar H₀' : 'No rechazar H₀';
}

function emptyChart(message) {
  return `<text x="50%" y="50%" text-anchor="middle" fill="#7f9188" font-family="var(--mono)" font-size="12">${escapeHtml(message)}</text>`;
}

function renderSummary(data) {
  $('#kpiSales').textContent = fmt2.format(data.summary.sales);
  $('#kpiUnits').textContent = fmt0.format(data.summary.units);
  $('#kpiCustomers').textContent = fmt0.format(data.summary.customers);
  $('#kpiLines').textContent = `${fmt0.format(data.summary.lines)} líneas`;
  $('#kpiOrders').textContent = `${fmt0.format(data.summary.orders)} pedidos`;
  $('#kpiMom').textContent = signedPercent(data.summary.mom);
  $('#momContext').textContent = data.summary.latestMonth && data.summary.priorMonth ? `${monthLabel(data.summary.latestMonth)} vs ${monthLabel(data.summary.priorMonth)}` : 'mes previo no disponible';
  $('#kpiYoy').textContent = `YoY ${signedPercent(data.summary.yoy)}`;
  $('#latestMonthLabel').textContent = data.summary.latestMonth ? `${monthLabel(data.summary.latestMonth).toUpperCase()} · ÚLTIMO MES` : 'SIN PERÍODO';
  $('#yoyContext').textContent = data.summary.yoy == null
    ? 'No hay observación del mismo mes del año anterior para esta selección.'
    : `${monthLabel(data.summary.latestMonth, true)} frente a ${monthLabel(data.summary.priorYearMonth, true)} · ${signedPercent(data.summary.yoy)}.`;
  renderTrend(data.monthly);
  renderYearBars(data.yearly);
  renderCountryBars(data.countrySales);
  renderProductLineBars(data.productLines);
  renderAbc(data.abcSummary, data);
  renderMap(data.countrySales);
  renderRegionBars(data.regionSales);
  renderProducts(data.topProducts);
  renderScatter(data.discountPoints, data.discountQuantityCorrelation);
  $('#filterCount').textContent = `${fmt0.format(data.summary.lines)} LÍNEAS EN LA VISTA`;
}

async function loadDashboard() {
  const sequence = ++fetchSequence;
  const params = filterParams();
  const loading = $('#loadingState');
  const error = $('#errorState');
  error.hidden = true;
  loading.hidden = !currentData;
  document.querySelectorAll('.filter-control select').forEach((select) => { select.disabled = true; });
  try {
    const response = await fetch(`/api/dashboard?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la vista.');
    if (sequence !== fetchSequence) return;
    currentData = result;
    renderSummary(result);
    loading.hidden = true;
  } catch (errorValue) {
    if (sequence !== fetchSequence) return;
    error.hidden = false;
    error.textContent = errorValue.message;
    loading.hidden = true;
  } finally {
    if (sequence === fetchSequence) document.querySelectorAll('.filter-control select').forEach((select) => { select.disabled = false; });
  }
}

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  if (!reducedMotion) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function init() {
  try {
    const response = await fetch('/api/meta');
    metadata = await response.json();
    if (!response.ok) throw new Error(metadata.error || 'No se pudo leer la metadata del ETL.');
    appendOptions();
    $('#footerSource').textContent = `${fmt0.format(metadata.rows)} líneas · ${metadata.date_min} — ${metadata.date_max}`;
    $('#filterCount').textContent = `${fmt0.format(metadata.rows)} LÍNEAS DISPONIBLES`;
    renderMethod(metadata);
    renderAnova(metadata.anova);
    $('#loadingState').hidden = true;
    await loadDashboard();
  } catch (errorValue) {
    $('#loadingState').hidden = true;
    $('#errorState').hidden = false;
    $('#errorState').textContent = errorValue.message;
  }

  document.querySelectorAll('.filter-control select').forEach((select) => select.addEventListener('change', loadDashboard));
  $('#resetFilters').addEventListener('click', () => {
    document.querySelectorAll('.filter-control select').forEach((select) => { select.value = ''; });
    loadDashboard();
  });
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelectorAll('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (['overview', 'customers', 'market', 'method'].includes(requestedView)) switchView(requestedView);
}

init();
