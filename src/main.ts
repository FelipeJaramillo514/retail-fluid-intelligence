import * as path from 'node:path';
import { createApp } from './app.factory';
import { DataService } from './data/data.service';

async function bootstrap() {
  const app = await createApp();
  const root = path.resolve(__dirname, '..');
  const port = Number(process.env.PORT || 3000);

  // Three.js se sirve localmente desde node_modules (en Vercel se copia a public/vendor).
  app.useStaticAssets(path.join(root, 'node_modules', 'three'), { prefix: '/vendor/three/', maxAge: '1h' });
  app.useStaticAssets(path.join(root, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') });
  app.enableShutdownHooks();

  await app.listen(port, '127.0.0.1');
  const data = app.get(DataService);
  console.log(`Retail Fluid Intelligence (NestJS) disponible en http://127.0.0.1:${port}`);
  console.log(`SQLite en modo solo lectura: ${data.dbPath}`);
}

bootstrap();
