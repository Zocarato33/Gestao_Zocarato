'use strict';

// Ponto de entrada da função serverless na Vercel. Os arquivos estáticos de public/ são
// servidos pelo CDN, e as rotas /api/* chegam aqui pela regra de rewrite do vercel.json.
module.exports = require('../src/server');
