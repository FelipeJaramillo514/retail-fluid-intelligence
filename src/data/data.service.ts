import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface SalesRow {
  order_number: number;
  order_date: string;
  year: number;
  quantity: number;
  unit_price: number;
  sales: number;
  product_code: string;
  product_line: string;
  customer_name: string;
  country: string;
  region: string;
  city: string;
  msrp: number;
  discount_proxy: number | null;
}

export interface Filters {
  year?: string | null;
  country?: string | null;
  region?: string | null;
  productLine?: string | null;
}

const FILTERABLE = new Set(['year', 'country', 'region', 'product_line']);

/** Acceso de solo lectura al SQLite del ETL y a los JSON de resumen. */
@Injectable()
export class DataService implements OnModuleDestroy {
  // En desarrollo el código vive en dist/data; empaquetado (Vercel) queda en dist/. Se busca la
  // carpeta que contiene data/processed en lugar de depender de la profundidad de __dirname.
  readonly root = [process.cwd(), path.resolve(__dirname, '..'), path.resolve(__dirname, '..', '..')]
    .find((dir) => fs.existsSync(path.join(dir, 'data', 'processed', 'retail_sales.db')))
    ?? path.resolve(__dirname, '..', '..');
  readonly dataDir = path.resolve(process.env.RETAIL_DATA_DIR || path.join(this.root, 'data', 'processed'));
  readonly dbPath = path.join(this.dataDir, 'retail_sales.db');
  readonly db: DatabaseSync;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly etlSummary: any;
  readonly m49Regions: Map<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly metadata: any;

  constructor() {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`No se encontró la base SQLite del ETL: ${this.dbPath}. Ejecuta python etl.py en la raíz del proyecto.`);
    }
    this.db = new DatabaseSync(this.dbPath, { readOnly: true });
    this.etlSummary = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'etl_summary.json'), 'utf8'));
    const anova = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'anova_results.json'), 'utf8'));

    const hasCountryDimension = Boolean(
      this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'dim_country'").get(),
    );
    this.m49Regions = hasCountryDimension
      ? new Map(
          (this.db.prepare('SELECT country, region_m49 FROM dim_country').all() as { country: string; region_m49: string }[])
            .map(({ country, region_m49 }) => [country, region_m49] as [string, string]),
        )
      : new Map();

    this.metadata = {
      ...this.etlSummary,
      years: this.distinctValues('year'),
      countries: this.distinctValues('country'),
      regions: this.distinctValues('region'),
      productLines: this.distinctValues('product_line'),
      hasM49: hasCountryDimension,
      anova,
      limitations: {
        currency: 'La fuente no identifica la moneda.',
        profit: 'No hay costo ni gastos; no se puede calcular utilidad o rentabilidad real.',
        channel: 'No hay canal de venta; territorio y región no son canales.',
        discount: 'discount_proxy es una brecha calculada frente a MSRP, no un descuento promocional observado.',
      },
    };
  }

  private distinctValues(column: string): (string | number)[] {
    if (!FILTERABLE.has(column)) throw new Error('Columna no permitida');
    return (this.db
      .prepare(`SELECT DISTINCT ${column} AS value FROM fact_sales WHERE ${column} IS NOT NULL ORDER BY value`)
      .all() as { value: string | number }[]).map((r) => r.value);
  }

  private buildWhere(filters: Filters, includeYear: boolean) {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (includeYear && filters.year) { clauses.push('year = ?'); params.push(Number(filters.year)); }
    if (filters.country) { clauses.push('country = ?'); params.push(filters.country); }
    if (filters.region) { clauses.push('region = ?'); params.push(filters.region); }
    if (filters.productLine) { clauses.push('product_line = ?'); params.push(filters.productLine); }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  readRows(filters: Filters, includeYear = true): SalesRow[] {
    const where = this.buildWhere(filters, includeYear);
    return this.db.prepare(`
      SELECT order_number, order_date, year, quantity, unit_price, sales, product_code,
        product_line, customer_name, country, region, city, msrp, discount_proxy
      FROM fact_sales ${where.sql}
    `).all(...where.params) as unknown as SalesRow[];
  }

  onModuleDestroy() {
    try { this.db.close(); } catch { /* ya cerrada */ }
  }
}
