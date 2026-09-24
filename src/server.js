'use strict';

const path = require('node:path');
const express = require('express');
const { prontoParaUso, descricaoBanco } = require('./db');
const { lerCookies, carregarUsuario, exigirLogin } = require('./auth');
const { ErroHttp, EM_PLATAFORMA, envBool } = require('./validacao');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
if (envBool('TRUST_PROXY', EM_PLATAFORMA)) app.set('trust proxy', 1);

// Cabeçalhos de segurança
app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
app.use(lerCookies);
// Garante que as tabelas existam antes da primeira consulta
app.use('/api', async (_req, _res, next) => {
  await prontoParaUso();
  next();
});
app.use('/api', carregarUsuario);

// Proteção adicional contra CSRF: requisições que alteram dados precisam do cabeçalho da aplicação
app.use('/api', (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'gestao-demandas') {
    return next(new ErroHttp(403, 'Requisição recusada.'));
  }
  next();
});

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth', require('./rotas/auth'));
app.use('/api/usuarios', exigirLogin, require('./rotas/usuarios'));
app.use('/api/clientes', exigirLogin, require('./rotas/clientes'));
app.use('/api/colunas', exigirLogin, require('./rotas/colunas').router);
app.use('/api/demandas', exigirLogin, require('./rotas/demandas'));

app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Recurso não encontrado.')));

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));
app.get('/{*caminho}', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Tratamento centralizado de erros
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof ErroHttp) {
    return res.status(err.status).json({ erro: err.message, campos: err.campos || undefined });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Os dados enviados excedem o tamanho permitido.' });
  }
  // Violações de unicidade, chave estrangeira e restrições CHECK do PostgreSQL
  if (['23505', '23503', '23514'].includes(err.code)) {
    return res.status(409).json({ erro: 'A operação viola uma regra de integridade dos dados.' });
  }
  console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ erro: 'Erro interno no servidor. Tente novamente em instantes.' });
});

if (require.main === module) {
  prontoParaUso()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Gestão de Demandas em execução: http://localhost:${PORT}`);
        console.log(`Banco de dados: ${descricaoBanco()}`);
      });
    })
    .catch((erro) => {
      console.error('Não foi possível conectar ao banco de dados:', erro.message);
      process.exit(1);
    });
}

module.exports = app;
