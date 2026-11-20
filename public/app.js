'use strict';

const $ = (selector) => document.querySelector(selector);
const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let metadata = null;
let currentData = null;
let fetchSequence = 0;
let activeView = 'method';

const geo = {
  Australia: [134, -25], Austria: [14.1, 47.6], Belgium: [4.7, 50.8], Canada: [-106, 56],
  Denmark: [9.5, 56], Finland: [26, 64], France: [2, 46.5], Germany: [10.4, 51],
  Ireland: [-8, 53], Italy: [12.5, 42.8], Japan: [138, 36], Norway: [9, 62],
  Philippines: [122, 12], Singapore: [103.8, 1.3], Spain: [-4, 40], Sweden: [16, 62],
  Switzerland: [8.2, 46.8], UK: [-2, 54], USA: [-98, 39],
};

window.__rfGeo = geo;

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
  if (!items.length) {
    svg.innerHTML = emptyChart('No hay ventas para esta selección.');
    $('#trendRange').textContent = 'Sin meses observados';
    return;
  }
  const values = items.map((item) => item.sales);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const yMin = Math.max(0, minValue - (maxValue - minValue) * .1);
  const yMax = maxValue + Math.max((maxValue - yMin) * .13, 1);
  const start = monthIndex(items[0].key);
  const duration = monthIndex(items.at(-1).key) - start;
  const x = (index) => left + (duration
    ? (monthIndex(items[index].key) - start) * (W - left - right) / duration
    : (W - left - right) / 2);
  const y = (value) => top + (yMax - value) / (yMax - yMin || 1) * (H - top - bottom);
  const points = items.map((item, index) => [x(index), y(item.sales)]);
  const segments = [];
  points.forEach((point, index) => {
    if (index === 0 || monthIndex(items[index].key) - monthIndex(items[index - 1].key) > 1) segments.push([]);
    segments.at(-1).push(point);
  });
  const draw = (segment) => segment.map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const path = segments.map(draw).join(' ');
  const area = segments.map((segment) => `${draw(segment)} L ${segment.at(-1)[0]} ${H - bottom} L ${segment[0][0]} ${H - bottom} Z`).join(' ');
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

function monthIndex(key) {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + month - 1;
}

function renderTable(selector, items, columns, noData = 'Sin datos para esta selección.') {
  $(selector).innerHTML = items.length
    ? items.map((item) => `<tr>${columns.map((value) => `<td>${escapeHtml(value(item))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">${escapeHtml(noData)}</td></tr>`;
}

function renderYearBars(items) {
  const host = $('#yearBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos</div>'; return; }
  const max = Math.max(...items.map((item) => item.sales), 1);
  host.innerHTML = items.map((item) => {
    const height = item.sales / max * 77;
    return `<div class="year-column" title="${escapeHtml(item.key)} · ${fmt2.format(item.sales)}">
      <span class="year-value">${compact(item.sales)}</span><div class="year-bar" style="height:${height}%"></div><span class="year-label">${escapeHtml(item.key)}</span>
    </div>`;
  }).join('');
}

function renderRankBars(host, items, limit, selectable = false) {
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos en esta selección.</div>'; return; }
  const list = items.slice(0, limit);
  const max = Math.max(...list.map((item) => item.sales), 1);
  host.innerHTML = list.map((item) => {
    const name = escapeHtml(item.key);
    const value = fmt2.format(item.sales);
    const width = Math.max(2, item.sales / max * 100);
    const tag = selectable ? 'button' : 'div';
    const control = selectable ? ` type="button" data-country="${name}"` : '';
    return `<${tag} class="rank-row" title="${name} · ${value} en ventas"${control}>
      <span class="rank-label">${name}</span><span class="rank-track"><i class="rank-fill" style="width:${width}%"></i></span><span class="rank-value">${value}</span>
    </${tag}>`;
  }).join('');
}

function renderAnnual(data) {
  renderYearBars(data.annualComparison);
  const endMonth = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, data.comparableThroughMonth - 1, 1)));
  $('#annualPeriod').textContent = data.comparableThroughMonth === 1 ? 'Enero de cada año' : `Enero a ${endMonth} de cada año`;
  renderTable('#annualTable', data.annualComparison, [
    (item) => item.key, (item) => fmt2.format(item.observedSales), (item) => fmt2.format(item.sales),
    (item) => item.growth == null ? 'Sin base' : signedPercent(item.growth),
  ]);
}

function renderGrowth(items) {
  const svg = $('#growthChart');
  renderTable('#growthTable', [...items].reverse(), [
    (item) => monthLabel(item.key, true),
    (item) => fmt2.format(item.sales),
    (item) => monthLabel(item.previousKey, true),
    (item) => item.previousSales == null ? 'Sin datos' : fmt2.format(item.previousSales),
    (item) => item.growth == null ? 'Sin base' : signedPercent(item.growth),
  ]);
  const comparable = items.filter((item) => item.growth != null);
  if (!comparable.length) {
    svg.innerHTML = emptyChart('No hay meses con una base de comparación.');
    return;
  }
  const left = 76;
  const right = 874;
  const top = 20;
  const bottom = 250;
  const start = monthIndex(items[0].key);
  const slotCount = monthIndex(items.at(-1).key) - start + 1;
  const slot = (right - left) / slotCount;
  const x = (item) => left + slot * (monthIndex(item.key) - start + .5);
  const min = Math.min(0, ...comparable.map((item) => item.growth)) * 1.1;
  const max = Math.max(.01, ...comparable.map((item) => item.growth)) * 1.1;
  const y = (rate) => bottom - (rate - min) / (max - min) * (bottom - top);
  const grid = [...new Set([min, 0, max])].map((rate) => `<line class="grid-line ${rate === 0 ? 'growth-baseline' : ''}" x1="${left}" x2="${right}" y1="${y(rate)}" y2="${y(rate)}"/><text class="axis-label" x="${left - 9}" y="${y(rate) + 4}" text-anchor="end">${signedPercent(rate)}</text>`).join('');
  const bars = comparable.map((item) => {
    const w = Math.min(44, slot * .65);
    return `<rect class="growth-bar ${item.growth < 0 ? 'growth-negative' : ''}" x="${x(item) - w / 2}" y="${Math.min(y(0), y(item.growth))}" width="${w}" height="${Math.max(1, Math.abs(y(0) - y(item.growth)))}" rx="3"><title>${monthLabel(item.key, true)} · ${signedPercent(item.growth)}</title></rect>`;
  }).join('');
  const labelStep = Math.max(1, Math.ceil(items.length / 5));
  const labels = items.filter((_, index) => index % labelStep === 0)
    .map((item) => `<text class="axis-label" x="${x(item)}" y="275" text-anchor="middle">${monthLabel(item.key)}</text>`).join('');
  svg.innerHTML = `${grid}${bars}${labels}`;
}

function renderProductLineBars(items) {
  const host = $('#lineBars');
  if (!items.length) { host.innerHTML = '<div class="empty-inline">Sin datos en esta selección.</div>'; return; }
  const max = Math.max(...items.map((item) => item.sales), 1);
  host.innerHTML = items.map((item) => `<div class="category-row" title="${escapeHtml(item.key)} · ${fmt2.format(item.sales)} · ${fmt0.format(item.units)} unidades">
    <span class="category-name">${escapeHtml(item.key)}</span><span class="category-meter"><i style="width:${Math.max(2, item.sales / max * 100)}%"></i></span><span class="category-value">${fmt2.format(item.sales)}</span>
  </div>`).join('');
}

function renderAbc(summary, data) {
  const colors = { A: '#84d2e5', B: '#e3a0ff', C: '#e689ab' };
  const denominator = Math.max(data.summary.customers, 1);
  $('#abcTotal').textContent = `${fmt0.format(data.summary.customers)} CLIENTES`;
  $('#abcCards').innerHTML = summary.map((item) => `<article class="abc-card" style="--abc-color:${colors[item.key]}">
    <span class="abc-letter">${escapeHtml(item.key)}</span><div><strong>${fmt0.format(item.customers)}</strong><small>clientes en clase ${escapeHtml(item.key)}</small></div><em>${fmtPct.format(item.customers / denominator)}</em>
  </article>`).join('');
  renderPareto(data.pareto);
  renderCustomerTable(data.abcCustomers);
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
  const land = '<image href="/world-map.svg" width="900" height="390" aria-hidden="true"/>';
  const filtered = items.filter((item) => Object.hasOwn(geo, item.key));
  const max = Math.max(...filtered.map((item) => item.sales), 1);
  const circles = filtered.map((item) => {
    const [lon, lat] = geo[item.key];
    const [x, y] = project([lon, lat]);
    const radius = 3.5 + Math.sqrt(item.sales / max) * 12;
    const label = `${escapeHtml(item.key)} · ${fmt2.format(item.sales)} en ventas`;
    return `<circle class="map-point" role="button" tabindex="0" aria-label="${label}" data-country="${escapeHtml(item.key)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}"><title>${label}</title></circle>`;
  }).join('');
  const note = items.length ? '' : emptyChart('No hay ventas para esta selección.');
  svg.innerHTML = `<rect class="map-bg" x="${left}" y="${top}" width="${W - left - right}" height="${H - top - bottom}" rx="13"/>${parallels}${meridians}${land}${circles}${note}`;
  $('#geoCount').textContent = `${fmt0.format(filtered.length)} PAÍSES`;
  svg.setAttribute('aria-label', `Mapa de ventas con ${filtered.length} de ${items.length} países geolocalizados`);
}

function renderRegionBars(host, items) {
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
  $('#scatterCorrelation').textContent = `Correlación de Pearson · ${correlation == null ? 'sin base' : fmt2.format(correlation)}`;
  $('#scatterN').textContent = `${fmt0.format(points.length)} líneas en la dispersión`;
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
}

function renderMethod(meta, extraction) {
  $('#methodPeriod').textContent = `${meta.date_min} — ${meta.date_max}`;
  $('#methodSales').textContent = fmt2.format(meta.sales_total);
  $('#methodScope').textContent = `${fmt0.format(meta.rows)} líneas de pedido`;
  $('#methodRows').textContent = fmt0.format(meta.rows);
  $('#methodCustomers').textContent = fmt0.format(meta.customers);
  $('#methodProducts').textContent = fmt0.format(meta.products);
  $('#methodCountries').textContent = fmt0.format(meta.countries.length);
  const cleaning = meta.quality || {};
  const rowsIn = cleaning.rows_in ?? meta.rows;
  const rowsOut = cleaning.rows_out ?? meta.rows;
  $('#cleanRows').textContent = `${fmt0.format(rowsIn)} → ${fmt0.format(rowsOut)}`;
  $('#cleanRemoved').textContent = fmt0.format(rowsIn - rowsOut);
  const quality = meta.quality;
  if (quality) {
    $('#qualityChecks').textContent = [
      quality.duplicate_keys, quality.missing_required_fields, quality.foreign_key_violations,
    ].map((value) => fmt0.format(value)).join(' · ');
    $('#qualityCard').hidden = false;
  }
  const geography = meta.web_geography;
  if (geography) {
    $('#geographyReconciliation').textContent = `El cruce M49 identificó ${fmt0.format(geography.countries_matched)} países de la muestra. Líneas de venta sin coincidencia geográfica: ${fmt0.format(geography.unmatched_sales_rows)}.`;
    $('#geographyReconciliation').hidden = false;
  }
  if (extraction?.sha256 && extraction.sha256 === meta.source_sha256) {
    const dataset = extraction.dataset_page;
    $('#evidenceExtractor').textContent = extraction.extractor;
    $('#evidenceDataset').textContent = `${dataset.title} · versión ${dataset.version} · ${dataset.license}`;
    $('#evidenceRows').textContent = `${fmt0.format(extraction.rows)} líneas en el CSV de pedidos y ${fmt0.format(extraction.geography_page.rows)} registros extraídos de las tablas HTML de la ONU.`;
    $('#evidenceTime').textContent = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota',
    }).format(new Date(extraction.extracted_at_utc));
    $('#evidenceHash').textContent = extraction.sha256;
    $('#extractionEvidence').hidden = false;
  }
  $('#methodAnovaF').textContent = fmt2.format(meta.anova.F);
  $('#methodAnovaP').textContent = Number(meta.anova.p_value).toExponential(2).replace('.', ',');
  $('#methodAnovaDecision').textContent = meta.anova.p_value < meta.anova.alpha ? 'Rechazar H₀' : 'No rechazar H₀';
  $('#m49Panel').hidden = !meta.hasM49;
  const welch = meta.anova.welch;
  if (welch) {
    $('#welchResult').hidden = false;
    $('#welchResult').textContent = `El ANOVA de Welch admite varianzas distintas. F = ${fmt2.format(welch.F)} y p = ${Number(welch.p_value).toExponential(2).replace('.', ',')}. Ambos análisis se ejecutaron sobre la muestra completa.`;
  }
}

function emptyChart(message) {
  return `<text x="50%" y="50%" text-anchor="middle" fill="#7a7c96" font-family="var(--mono)" font-size="12">${escapeHtml(message)}</text>`;
}

function renderSummary(data) {
  $('#kpiSales').textContent = fmt2.format(data.summary.sales);
  $('#kpiUnits').textContent = fmt0.format(data.summary.units);
  $('#kpiCustomers').textContent = fmt0.format(data.summary.customers);
  $('#kpiLines').textContent = `${fmt0.format(data.summary.lines)} líneas`;
  $('#kpiOrders').textContent = `${fmt0.format(data.summary.orders)} pedidos`;
  renderTrend(data.monthly);
  renderTable('#monthlyCountryTable', data.monthlyByCountry, [
    (item) => monthLabel(item.month, true), (item) => item.country, (item) => fmt0.format(item.lines),
    (item) => fmt0.format(item.units), (item) => fmt2.format(item.sales),
  ]);
  renderProductLineBars(data.productLines);
  renderRankBars($('#customerBars'), data.customers, 10);
  renderTable('#topCustomerTable', data.customers, [
    (item) => item.rank, (item) => item.key, (item) => fmt2.format(item.sales),
    (item) => fmtPct.format(data.summary.sales ? item.sales / data.summary.sales : 0),
  ]);
  renderAnnual(data);
  renderGrowth(data.monthlyGrowth);
  renderAbc(data.abcSummary, data);
  renderRankBars($('#countryBars'), data.countrySales, data.countrySales.length, true);
  renderMap(data.countrySales);
  renderRegionBars($('#regionBars'), data.regionSales);
  renderRegionBars($('#m49RegionBars'), data.m49RegionSales);
  renderProducts(data.topProducts);
  renderScatter(data.discountPoints, data.discountQuantityCorrelation);
  updateFilterContext();
  // La capa 3D (globo) escucha este evento; si aún no cargó, lee el último estado.
  window.__rfLastData = { countrySales: data.countrySales };
  document.dispatchEvent(new CustomEvent('rf:data', { detail: window.__rfLastData }));
}

function updateFilterContext() {
  updateCountryChip();
  if (activeView === 'annual') $('#filterCount').textContent = 'COMPARACIÓN DE TODOS LOS AÑOS';
  else if (currentData) $('#filterCount').textContent = `${fmt0.format(currentData.summary.lines)} LÍNEAS EN LA VISTA`;
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
    if (sequence === fetchSequence) document.querySelectorAll('.filter-control select').forEach((select) => {
      select.disabled = activeView === 'annual' && select.id === 'yearFilter';
    });
  }
}

function switchView(view, toggleUrl = false) {
  const selected = document.getElementById(`view-${view}`);
  if (!selected?.classList.contains('view-section')) {
    if (view !== 'method') switchView('method');
    return;
  }
  activeView = view;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('active', section === selected));
  $('.filterbar').hidden = view === 'method' || view === 'answers';
  $('#resetFilters').hidden = view === 'method' || view === 'answers';
  updateAnalysisNavigation(view);
  $('#yearFilter').disabled = view === 'annual';
  updateFilterContext();
  if (toggleUrl) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== view || url.hash) {
      url.searchParams.set('view', view);
      url.hash = '';
      window.history.pushState(null, '', url);
    }
    selected.querySelector('h2')?.focus({ preventScroll: true });
    if (view === 'method') window.scrollTo({ top: 0, behavior: 'instant' });
    else $('.filterbar').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth' });
  }
}

function updateAnalysisNavigation(view) {
  const items = [...document.querySelectorAll('.main-nav .nav-item[data-view]')];
  const index = items.findIndex((item) => item.dataset.view === view);
  $('.analysis-navigation').hidden = index <= 0;
  if (index <= 0) return;
  const previous = items[index - 1];
  const next = items[index + 1];
  const previousLink = $('#previousAnalysis');
  const nextLink = $('#nextAnalysis');
  previousLink.dataset.view = previous.dataset.view;
  previousLink.href = previous.href;
  previousLink.textContent = index === 1 ? '← Recorrido del proyecto'
    : previous.dataset.view === 'answers' ? '← Respuestas a las 10 preguntas' : `← ${menuLabel(previous)}`;
  nextLink.hidden = !next;
  if (next) {
    nextLink.dataset.view = next.dataset.view;
    nextLink.href = next.href;
    nextLink.textContent = `${menuLabel(next)} →`;
  }
}

function menuLabel(item) {
  return [...item.children].map((child) => child.textContent.trim()).join(' ');
}

// Seleccionar un país lo filtra; volver a seleccionar el mismo país quita el filtro.
function toggleCountry(country) {
  const select = $('#countryFilter');
  if (select.disabled) return;
  select.value = select.value === country ? '' : country;
  loadDashboard();
}

// ---------------------------------------------------------------------------------------------
// Respuestas explícitas a las 10 preguntas del taller (calculadas con toda la muestra, sin filtros)
// ---------------------------------------------------------------------------------------------
const answerCatalog = [
  { n: 1, view: 'overview', web: 'Total de ventas mensuales por país', q: 'Total de ventas mensuales por país',
    pbi: [{ page: 'Ventas por mes y país', what: 'matriz de cada mes por país, con totales' }, { page: 'Ventas y geografía', what: 'gráfico de ventas mensuales' }] },
  { n: 2, view: 'profit', web: 'Rentabilidad por categoría', q: 'Rentabilidad por categoría de producto', partial: true,
    pbi: [{ page: 'Productos y precio', what: 'ventas por categoría (sin costos)' }] },
  { n: 3, view: 'customers', web: 'Mayores clientes', q: 'Clientes con mayores ingresos generados',
    pbi: [{ page: 'Clientes y ABC', what: 'clientes con mayores ventas' }] },
  { n: 4, view: 'annual', web: 'Comparativa anual', q: 'Comparativa año a año de ventas',
    pbi: [{ page: 'Evolución', what: 'ventas de enero a mayo por año y tabla comparativa' }] },
  { n: 5, view: 'growth', web: 'Crecimiento mensual', q: 'Tasa de crecimiento mensual',
    pbi: [{ page: 'Evolución', what: 'crecimiento frente al mes anterior' }] },
  { n: 6, view: 'regions', web: 'Promedio por región', q: 'Promedio de ventas por región',
    pbi: [{ page: 'Ventas y geografía', what: 'venta media por región comercial' }, { page: 'ETL y ANOVA', what: 'venta media por región M49' }] },
  { n: 7, view: 'channels', web: 'Productos por canal', q: 'Productos más vendidos por canal', partial: true,
    pbi: [{ page: 'Productos y precio', what: 'productos por unidades (sin canal)' }] },
  { n: 8, view: 'market', web: 'Mapa de ventas', q: 'Mapa geográfico de ventas',
    pbi: [{ page: 'Ventas y geografía', what: 'mapa de ventas por país' }] },
  { n: 9, view: 'discount', web: 'Descuentos y volumen', q: 'Relación entre descuentos y volumen de compra', partial: true,
    pbi: [{ page: 'Productos y precio', what: 'dispersión de la brecha frente a MSRP y las unidades' }] },
  { n: 10, view: 'abc', web: 'Clientes ABC', q: 'Análisis ABC de clientes (ventas acumuladas)',
    pbi: [{ page: 'Clientes y ABC', what: 'resumen ABC, curva acumulada y tabla de clasificación' }] },
];

function correlationStrength(r) {
  const a = Math.abs(r);
  return a < 0.1 ? 'casi nula' : a < 0.3 ? 'débil' : a < 0.6 ? 'moderada' : 'fuerte';
}

function buildAnswers(d) {
  const total = d.summary.sales;
  const share = (value) => fmtPct.format(total ? value / total : 0);
  const name = (value) => `<strong>${escapeHtml(value)}</strong>`;
  const money = (value) => `<strong>${fmt2.format(value)}</strong>`;
  const months = d.monthly;
  const bestMonth = months.reduce((best, item) => (item.sales > best.sales ? item : best), months[0]);
  const topCountry = d.countrySales[0];
  const lines = d.productLines;
  const growthItems = d.monthlyGrowth.filter((item) => item.growth != null);
  const bestGrowth = growthItems.reduce((best, item) => (item.growth > best.growth ? item : best), growthItems[0]);
  const worstGrowth = growthItems.reduce((worst, item) => (item.growth < worst.growth ? item : worst), growthItems[0]);
  const regions = d.regionSales;
  const spread = regions.length > 1 ? regions[0].averagePerLine / regions.at(-1).averagePerLine - 1 : 0;
  const top3 = d.countrySales.slice(0, 3);
  const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, d.comparableThroughMonth - 1, 1)));
  const abc = Object.fromEntries(d.abcSummary.map((item) => [item.key, item]));
  const r = d.discountQuantityCorrelation;
  const top = d.customers.slice(0, 3);
  const annual = d.annualComparison.filter((item) => item.sales > 0);

  return {
    1: `En ${fmt0.format(months.length)} meses y ${fmt0.format(d.countrySales.length)} países se registraron ${money(total)} en ventas. El mes más alto fue ${name(monthLabel(bestMonth.key, true))} (${fmt2.format(bestMonth.sales)}) y el país con más ventas, ${name(topCountry.key)} (${fmt2.format(topCountry.sales)}; ${share(topCountry.sales)} del total). La tabla de esa sección desglosa cada mes por país.`,
    2: `<strong>No se puede calcular la rentabilidad</strong>: la fuente no trae costos ni gastos, y sin costo no hay margen. Lo que sí se puede responder es qué categoría vende más: ${name(lines[0].key)} con ${fmt2.format(lines[0].sales)} (${share(lines[0].sales)} de las ventas)${lines[1] ? `, seguida de ${name(lines[1].key)} con ${fmt2.format(lines[1].sales)} (${share(lines[1].sales)})` : ''}.`,
    3: `Los tres clientes que más ingresos generan son ${top.map((c) => `${name(c.key)} (${fmt2.format(c.sales)}; ${share(c.sales)})`).join(', ')}. Juntos aportan ${share(top.reduce((sum, c) => sum + c.sales, 0))} de las ventas.`,
    4: `Comparando enero a ${monthName} de cada año: ${annual.map((item) => `${item.key} vendió ${fmt2.format(item.sales)}${item.growth == null ? '' : ` (${signedPercent(item.growth)} frente al año anterior)`}`).join('; ')}. Se comparan meses equivalentes porque el último año de la muestra termina en ${monthName}.`,
    5: `El mayor crecimiento mensual fue en ${name(monthLabel(bestGrowth.key, true))} (${signedPercent(bestGrowth.growth)}) y la mayor caída en ${name(monthLabel(worstGrowth.key, true))} (${signedPercent(worstGrowth.growth)}). El último mes, ${name(monthLabel(d.summary.latestMonth, true))}, ${d.summary.mom == null ? 'no tiene mes anterior con qué compararse' : `varió ${signedPercent(d.summary.mom)} frente al mes anterior`}.`,
    6: `Promedio de venta por línea de pedido: ${regions.map((item) => `${name(item.key)} ${fmt2.format(item.averagePerLine)}`).join('; ')}. La diferencia entre la región más alta y la más baja es de ${fmtPct.format(spread)}.`,
    7: `<strong>No se puede calcular por canal</strong>: la fuente no trae el canal de venta. Lo que sí se puede responder es qué productos se venden más por unidades: ${d.topProducts.slice(0, 3).map((p) => `${name(p.key)} (${escapeHtml(p.productLine)}; ${fmt0.format(p.units)} unidades)`).join(', ')}.`,
    8: `${name(topCountry.key)} concentra el ${share(topCountry.sales)} de las ventas (${fmt2.format(topCountry.sales)}). Los tres primeros países, ${top3.map((c) => escapeHtml(c.key)).join(', ')}, suman ${share(top3.reduce((sum, c) => sum + c.sales, 0))}.`,
    9: r == null ? 'No hay observaciones suficientes para calcular la relación.' : `La correlación de Pearson entre la brecha frente al precio de lista (MSRP) y las unidades por línea es <strong>${fmt2.format(r)}</strong>: relación lineal ${correlationStrength(r)}. Esto describe asociación, no causa, y la brecha es una aproximación porque la fuente no registra descuentos promocionales.`,
    10: `${name(`${fmt0.format(abc.A.customers)} clientes`)} (${fmtPct.format(abc.A.customers / d.summary.customers)}) forman la clase A y generan ${name(share(abc.A.sales))} de las ventas; ${fmt0.format(abc.B.customers)} clientes (${fmtPct.format(abc.B.customers / d.summary.customers)}) forman la clase B con ${share(abc.B.sales)}; y ${fmt0.format(abc.C.customers)} (${fmtPct.format(abc.C.customers / d.summary.customers)}) forman la clase C con ${share(abc.C.sales)}. La clase A llega hasta el 80 % acumulado, la B hasta el 95 % y la C es el resto.`,
  };
}

function bindViewLinks(root) {
  root.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    switchView(link.dataset.view, true);
  }));
}

function renderAnswers(data) {
  const answers = buildAnswers(data);
  $('#answersIndex').innerHTML = answerCatalog.map((item) => `<tr>
    <td>${String(item.n).padStart(2, '0')}</td>
    <td><a href="#answer-${item.n}">${escapeHtml(item.q)}</a>${item.partial ? ' <span class="answer-chip">parcial</span>' : ''}</td>
    <td><a data-view="${item.view}" href="?view=${item.view}">${escapeHtml(item.web)}</a></td>
    <td>${item.pbi.map((p) => `«${escapeHtml(p.page)}»`).join(' · ')}</td>
  </tr>`).join('');
  $('#answersList').innerHTML = answerCatalog.map((item) => `<article class="panel answer-card${item.partial ? ' is-partial' : ''}" id="answer-${item.n}">
    <header class="answer-head"><span class="requirement-number">${String(item.n).padStart(2, '0')}</span><h3>${escapeHtml(item.q)}</h3>${item.partial ? '<span class="answer-chip">Cobertura parcial</span>' : ''}</header>
    <p class="answer-label">RESPUESTA</p>
    <p class="answer-text">${answers[item.n]}</p>
    <dl class="answer-where">
      <div><dt>EN LA WEB</dt><dd><a data-view="${item.view}" href="?view=${item.view}">Punto ${String(item.n).padStart(2, '0')} · ${escapeHtml(item.web)} →</a></dd></div>
      <div><dt>EN POWER BI</dt><dd>${item.pbi.map((p) => `Página «${escapeHtml(p.page)}» <span class="answer-detail">· ${escapeHtml(p.what)}</span>`).join('<br>')}</dd></div>
    </dl>
  </article>`).join('');
  bindViewLinks($('#view-answers'));
}

async function loadDataPreview() {
  try {
    const r = await fetch('/evidence/data_preview.json');
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const build = (id, cols, rows, mark) => {
      const t = $(id);
      if (!t) return;
      t.textContent = '';
      const head = t.createTHead().insertRow();
      cols.forEach((c) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = c;
        const cls = mark(c);
        if (cls) th.className = cls;
        head.appendChild(th);
      });
      const body = t.createTBody();
      rows.forEach((row) => {
        const tr = body.insertRow();
        row.forEach((v, i) => {
          const td = tr.insertCell();
          const cls = mark(cols[i]);
          if (v === null) { td.textContent = 'descartada'; td.className = 'cell-drop'; return; }
          td.textContent = v === '' ? '(vacío)' : String(v);
          if (v === '') td.className = 'cell-empty';
          else if (cls) td.className = cls.replace('col-', 'cell-');
        });
      });
    };
    const dropped = new Set(d.droppedColumns);
    const created = new Set(d.newColumns);
    const converted = new Set(d.convertedColumns);
    build('#previewRawTable', d.rawColumns, d.raw, (c) => (dropped.has(c) ? 'col-drop' : ''));
    build('#previewProcessedTable', d.processedColumns, d.processed, (c) => (created.has(c) ? 'col-new' : converted.has(c) ? 'col-conv' : ''));
  } catch {
    document.querySelectorAll('.data-preview').forEach((el) => { el.hidden = true; });
  }
}

async function loadAnswers() {
  try {
    const response = await fetch('/api/dashboard');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo calcular.');
    renderAnswers(data);
  } catch (error) {
    $('#answersIndex').innerHTML = '<tr><td colspan="4">No se pudieron calcular las respuestas.</td></tr>';
    $('#answersList').innerHTML = `<div class="error-state" role="alert">${escapeHtml(error.message)}</div>`;
  }
}

function activateMapCountry(event) {
  const control = event.target.closest('[data-country]');
  if (control) toggleCountry(control.dataset.country);
}

function updateCountryChip() {
  const country = $('#countryFilter').value;
  $('#countryChip').hidden = !country;
  $('#chipName').textContent = country;
}

async function init() {
  document.querySelectorAll('.filter-control select').forEach((select) => select.addEventListener('change', loadDashboard));
  $('#resetFilters').addEventListener('click', () => {
    document.querySelectorAll('.filter-control select').forEach((select) => { select.value = ''; });
    loadDashboard();
  });
  document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    switchView(link.dataset.view, true);
  }));
  document.addEventListener('rf:country', (event) => toggleCountry(event.detail.country));
  $('#clearCountry').addEventListener('click', () => {
    $('#countryFilter').value = '';
    loadDashboard();
  });
  $('#countryBars').addEventListener('click', activateMapCountry);
  $('#geoMap').addEventListener('click', activateMapCountry);
  $('#geoMap').addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || !event.target.closest('[data-country]')) return;
    event.preventDefault();
    activateMapCountry(event);
  });
  const viewFromUrl = () => new URLSearchParams(window.location.search).get('view') || 'method';
  switchView(viewFromUrl());
  window.addEventListener('popstate', () => switchView(viewFromUrl()));

  try {
    const [response, extraction] = await Promise.all([
      fetch('/api/meta'),
      fetch('/evidence/extraction_manifest.json').then(
        (manifest) => manifest.ok ? manifest.json() : null
      ).catch(() => null),
    ]);
    metadata = await response.json();
    if (!response.ok) throw new Error(metadata.error || 'No se pudo leer la metadata del ETL.');
    appendOptions();
    $('#footerSource').textContent = `${fmt0.format(metadata.rows)} líneas · ${metadata.date_min} — ${metadata.date_max}`;
    $('#filterCount').textContent = `${fmt0.format(metadata.rows)} LÍNEAS DISPONIBLES`;
    renderMethod(metadata, extraction);
    $('#loadingState').hidden = true;
    loadAnswers();
    loadDataPreview();
    await loadDashboard();
  } catch (errorValue) {
    $('#loadingState').hidden = true;
    $('#errorState').hidden = false;
    $('#errorState').textContent = errorValue.message;
  }
}

init();
