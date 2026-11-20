'use strict';

// Empaqueta la app Nest ya compilada (dist/app.factory.js) en un único archivo CommonJS.
// Nest 12 y sus dependencias son ESM; el runtime de Vercel no permite require() de ESM,
// así que se resuelven y convierten aquí en tiempo de build.
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(root, 'dist', 'app.factory.js')],
  outfile: path.join(root, 'dist', 'vercel.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
  // Dependencias opcionales de Nest que este proyecto no usa.
  external: [
    '@nestjs/microservices', '@nestjs/microservices/*', '@nestjs/websockets', '@nestjs/websockets/*',
    '@nestjs/platform-fastify', 'class-validator', 'class-transformer', 'cache-manager', '@fastify/*',
    'mock-aws-s3', 'aws-sdk', 'nock',
  ],
});
console.log('Función empaquetada en dist/vercel.cjs');
