'use strict';

// Función serverless de Vercel: reutiliza la app Nest compilada en dist/.
const { createApp } = require('../dist/app.factory');

let handler;

module.exports = async (req, res) => {
  if (!handler) {
    const app = await createApp();
    await app.init();
    handler = app.getHttpAdapter().getInstance();
  }
  return handler(req, res);
};
