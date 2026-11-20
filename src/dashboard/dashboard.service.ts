import { BadRequestException, Injectable } from '@nestjs/common';
import { DataService, Filters, SalesRow } from '../data/data.service';

interface AggBase {
  key: string | number;
  salesCents: number;
  units: number;
  lines: number;
}

// Campos adicionales (rank, productLine, abcClass…) se añaden en cada cálculo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Agg = AggBase & { sales: number } & Record<string, any>;

type Values = { sales?: number; units?: number };

function monthKey(dateText: string): string { return String(dateText).slice(0, 7); }

function previousMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousYearMonth(key: string): string {
  const [year, month] = key.split('-');
  return `${Number(year) - 1}-${month}`;
}

function aggregateMap(rows: SalesRow[], keyFn: (r: SalesRow) => string | number | null | undefined, valueFn: (r: SalesRow) => Values): Agg[] {
  const map = new Map<string | number, AggBase>();
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
  return [...map.values()].map((item) => ({ ...item, sales: item.salesCents / 100 }) as Agg);
}

@Injectable()
export class DashboardService {
  constructor(private readonly data: DataService) {}

  get metadata() { return this.data.metadata; }

  /** Valida los filtros contra los valores presentes en los datos. */
  validate(filters: Filters): void {
    const m = this.data.metadata;
    if (filters.year && !m.years.includes(Number(filters.year))) throw new BadRequestException('Año no disponible en los datos.');
    if (filters.country && !m.countries.includes(filters.country)) throw new BadRequestException('País no disponible en los datos.');
    if (filters.region && !m.regions.includes(filters.region)) throw new BadRequestException('Región no disponible en los datos.');
    if (filters.productLine && !m.productLines.includes(filters.productLine)) throw new BadRequestException('Línea de producto no disponible en los datos.');
  }

  build(filters: Filters) {
    const { etlSummary, metadata, m49Regions } = this.data;
    const rows = this.data.readRows(filters, true);
    const comparisonRows = filters.year ? this.data.readRows(filters, false) : rows;
    const totalSalesCents = rows.reduce((sum, row) => sum + Math.round(row.sales * 100), 0);
    const totalSales = totalSalesCents / 100;
    const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
    const customers = new Set(rows.map((row) => row.customer_name).filter(Boolean)).size;
    const totalOrders = new Set(rows.map((row) => row.order_number)).size;

    const monthRows = aggregateMap(rows, (row) => monthKey(row.order_date), (row) => ({ sales: row.sales, units: row.quantity }));
    monthRows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const comparisonMonths = aggregateMap(comparisonRows, (row) => monthKey(row.order_date), (row) => ({ sales: row.sales }));
    const comparisonByMonth = new Map(comparisonMonths.map((item) => [item.key as string, item]));
    const monthlyGrowth = monthRows.map((item) => {
      const previousKey = previousMonth(item.key as string);
      const previousSales = comparisonByMonth.get(previousKey)?.sales ?? null;
      return { ...item, previousKey, previousSales, growth: previousSales ? (item.sales - previousSales) / previousSales : null };
    });
    const lastMonth = monthRows.at(-1) || null;
    const lastGrowth = monthlyGrowth.at(-1);
    const priorMonth = lastMonth ? comparisonByMonth.get(previousMonth(lastMonth.key as string)) : null;
    const priorYear = lastMonth ? comparisonByMonth.get(previousYearMonth(lastMonth.key as string)) : null;
    const yoy = lastMonth && priorYear?.sales ? (lastMonth.sales - priorYear.sales) / priorYear.sales : null;

    const monthlyByCountry = aggregateMap(
      rows,
      (row) => `${monthKey(row.order_date)}|${row.country}`,
      (row) => ({ sales: row.sales, units: row.quantity }),
    ).sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .map(({ key, sales, units, lines }) => ({ month: String(key).slice(0, 7), country: String(key).slice(8), sales, units, lines }));

    const yearly = aggregateMap(rows, (row) => row.year, (row) => ({ sales: row.sales, units: row.quantity }));
    yearly.sort((a, b) => Number(a.key) - Number(b.key));
    // El último año de la muestra termina en mayo. Se compara el mismo tramo de calendario en cada año.
    const comparableThroughMonth = Number(String(etlSummary.date_max).slice(5, 7));
    const observedYears = new Map(aggregateMap(comparisonRows, (row) => row.year, (row) => ({ sales: row.sales }))
      .map(({ key, sales }) => [key, sales]));
    const comparableYears = new Map(aggregateMap(
      comparisonRows.filter((row) => Number(row.order_date.slice(5, 7)) <= comparableThroughMonth),
      (row) => row.year, (row) => ({ sales: row.sales }),
    ).map(({ key, sales }) => [key, sales]));
    const annualComparison = (metadata.years as number[]).map((year) => {
      const periodSales = comparableYears.get(year) ?? 0;
      const priorPeriodSales = comparableYears.get(year - 1);
      return {
        key: year,
        observedSales: observedYears.get(year) ?? 0,
        sales: periodSales,
        growth: priorPeriodSales ? (periodSales - priorPeriodSales) / priorPeriodSales : null,
      };
    });

    const countrySales = aggregateMap(rows, (row) => row.country, (row) => ({ sales: row.sales, units: row.quantity }));
    countrySales.sort((a, b) => b.sales - a.sales);
    const regionSales = aggregateMap(rows, (row) => row.region, (row) => ({ sales: row.sales, units: row.quantity }))
      .map((item) => ({ ...item, averagePerLine: item.lines ? item.sales / item.lines : 0 }));
    regionSales.sort((a, b) => b.averagePerLine - a.averagePerLine);
    const m49RegionSales = aggregateMap(rows, (row) => m49Regions.get(row.country), (row) => ({ sales: row.sales, units: row.quantity }))
      .map((item) => ({ ...item, averagePerLine: item.sales / item.lines }))
      .sort((a, b) => b.averagePerLine - a.averagePerLine);
    const productLines = aggregateMap(rows, (row) => row.product_line, (row) => ({ sales: row.sales, units: row.quantity }));
    productLines.sort((a, b) => b.sales - a.sales);

    const products = aggregateMap(rows, (row) => row.product_code, (row) => ({ sales: row.sales, units: row.quantity }));
    const productLineByCode = new Map<string, string>();
    for (const row of rows) if (!productLineByCode.has(row.product_code)) productLineByCode.set(row.product_code, row.product_line);
    for (const item of products) item.productLine = productLineByCode.get(item.key as string) || 'Sin línea';
    products.sort((a, b) => b.units - a.units || b.sales - a.sales);

    const customerSales = aggregateMap(rows, (row) => row.customer_name, (row) => ({ sales: row.sales }));
    customerSales.sort((a, b) => b.sales - a.sales || String(a.key).localeCompare(String(b.key)));
    let cumulativeSalesCents = 0;
    let lastRankSales: number | null = null;
    let rank = 0;
    for (const item of customerSales) {
      if (lastRankSales === null || item.sales !== lastRankSales) rank += 1;
      lastRankSales = item.sales;
      cumulativeSalesCents += Math.round(item.sales * 100);
      const cumulativePct = totalSalesCents ? cumulativeSalesCents / totalSalesCents : 0;
      item.rank = rank;
      item.cumulativeSales = cumulativeSalesCents / 100;
      item.cumulativePct = cumulativePct;
      item.abcClass = cumulativePct <= 0.8 ? 'A' : cumulativePct <= 0.95 ? 'B' : 'C';
    }
    const abcSummary = ['A', 'B', 'C'].map((abcClass) => {
      const group = customerSales.filter((item) => item.abcClass === abcClass);
      return { key: abcClass, customers: group.length, sales: group.reduce((sum, item) => sum + item.sales, 0) };
    });

    const discountPoints = rows
      .filter((row) => Number.isFinite(row.discount_proxy) && Number.isFinite(row.quantity))
      .map((row) => ({ discountProxy: row.discount_proxy as number, units: row.quantity, sales: row.sales }));
    const n = discountPoints.length;
    const meanX = n ? discountPoints.reduce((s, p) => s + p.discountProxy, 0) / n : 0;
    const meanY = n ? discountPoints.reduce((s, p) => s + p.units, 0) / n : 0;
    const covariance = discountPoints.reduce((s, p) => s + (p.discountProxy - meanX) * (p.units - meanY), 0);
    const varianceX = discountPoints.reduce((s, p) => s + (p.discountProxy - meanX) ** 2, 0);
    const varianceY = discountPoints.reduce((s, p) => s + (p.units - meanY) ** 2, 0);
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
        mom: lastGrowth?.growth ?? null,
        priorMonth: priorMonth?.key || null,
        yoy,
        priorYearMonth: priorYear?.key || null,
      },
      monthly: monthRows,
      monthlyByCountry,
      monthlyGrowth,
      yearly,
      annualComparison,
      comparableThroughMonth,
      countrySales,
      regionSales,
      m49RegionSales,
      productLines,
      topProducts: products.slice(0, 10),
      customers: customerSales.slice(0, 20),
      abcCustomers: customerSales,
      abcSummary,
      pareto: customerSales.map(({ key, sales, cumulativePct, rank: r, abcClass }) => ({ customer: key, sales, cumulativePct, rank: r, abcClass })),
      discountPoints,
      discountQuantityCorrelation,
    };
  }
}
