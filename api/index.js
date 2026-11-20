'use strict';

// Función serverless de Vercel: usa la app Nest empaquetada (dist/vercel.cjs, ver scripts/bundle.js).
const { createApp } = require('../dist/vercel.cjs');

let handler;

module.exports = async (req, res) => {
  if (!handler) {
    const app = await createApp();
    await app.init();
    handler = app.getHttpAdapter().getInstance();
  }
  return handler(req, res);
};
