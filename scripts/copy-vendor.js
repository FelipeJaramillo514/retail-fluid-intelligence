'use strict';

// Copia a public/vendor/three sólo los módulos de Three.js que usa la web,
// para que Vercel los sirva como archivos estáticos.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const from = path.join(root, 'node_modules', 'three');
const to = path.join(root, 'public', 'vendor', 'three');
const files = [
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/environments/RoomEnvironment.js',
  'examples/jsm/geometries/ParametricGeometry.js',
];

fs.rmSync(to, { recursive: true, force: true });
for (const file of files) {
  const target = path.join(to, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(from, file), target);
}
console.log(`Three.js copiado a ${path.relative(root, to)} (${files.length} archivos)`);
