'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const { ErroHttp, proibido } = require('./validacao');

const COOKIE = 'gd_sessao';
const SESSAO_MS = (Number(process.env.SESSAO_HORAS) || 12) * 60 * 60 * 1000;
const COOKIE_SECURE = String(process.env.COOKIE_SECURE).toLowerCase() === 'true';

// ---------- Senhas (scrypt nativo do Node) ----------

function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function conferirSenha(senha, armazenado) {
  const [alg, salHex, hashHex] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = crypto.scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(esperado, obtido);
}

// Hash usado para equalizar o tempo de resposta quando o e-mail não existe
const HASH_FICTICIO = gerarHashSenha(crypto.randomBytes(12).toString('hex'));

function validarForcaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter ao menos 8 caracteres.';
  if (senha.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

// ---------- Sessões ----------

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function criarSessao(res, usuarioId, executor = db) {
  const token = crypto.randomBytes(32).toString('base64url');
  await executor.exec('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)',
    [hashToken(token), usuarioId, Date.now() + SESSAO_MS]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSAO_MS,
    path: '/',
  });
}

async function encerrarSessao(req, res) {
  const token = req.cookies[COOKIE];
  if (token) await db.exec('DELETE FROM sessoes WHERE token_hash = ?', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/', sameSite: 'strict', secure: COOKIE_SECURE, httpOnly: true });
}

function lerCookies(req, _res, next) {
  req.cookies = {};
  const bruto = req.headers.cookie;
  if (bruto) {
    for (const parte of bruto.split(';')) {
      const i = parte.indexOf('=');
      if (i < 0) continue;
      const nome = parte.slice(0, i).trim();
      try {
        req.cookies[nome] = decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        /* cookie malformado: ignorado */
      }
    }
  }
  next();
}

/** Carrega o usuário da sessão, se houver, e renova a validade (sessão deslizante). */
async function carregarUsuario(req, res, next) {
  req.usuario = null;
  const token = req.cookies[COOKIE];
  if (!token) return next();
  const th = hashToken(token);
  const linha = await db.get(`
    SELECT u.id, u.nome, u.email, u.papel, u.ativo, s.expira_em
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?`, [th]);
  if (!linha || linha.expira_em < Date.now() || !linha.ativo) {
    if (linha) await db.exec('DELETE FROM sessoes WHERE token_hash = ?', [th]);
    return next();
  }
  // Renova apenas se passou mais de 10 minutos da última renovação
  const novoVencimento = Date.now() + SESSAO_MS;
  if (novoVencimento - linha.expira_em > 10 * 60 * 1000) {
    await db.exec('UPDATE sessoes SET expira_em = ? WHERE token_hash = ?', [novoVencimento, th]);
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: SESSAO_MS, path: '/',
    });
  }
  req.usuario = { id: linha.id, nome: linha.nome, email: linha.email, papel: linha.papel };
  next();
}

function exigirLogin(req, _res, next) {
  if (!req.usuario) return next(new ErroHttp(401, 'Sua sessão expirou. Entre novamente.'));
  next();
}

function exigirAdmin(req, _res, next) {
  if (!req.usuario) return next(new ErroHttp(401, 'Sua sessão expirou. Entre novamente.'));
  if (req.usuario.papel !== 'admin') return next(proibido());
  next();
}

// ---------- Controle de acesso a dados ----------

const ehAdmin = (u) => u && u.papel === 'admin';

/**
 * Retorna um fragmento SQL e parâmetros que restringem clientes visíveis ao usuário.
 * Administradores enxergam todos os clientes; demais usuários, apenas os vinculados.
 */
function filtroClientes(usuario, colunaClienteId = 'c.id') {
  if (ehAdmin(usuario)) return { sql: '1 = 1', params: [] };
  return {
    sql: `${colunaClienteId} IN (SELECT cliente_id FROM usuario_clientes WHERE usuario_id = ?)`,
    params: [usuario.id],
  };
}

async function podeAcessarCliente(usuario, clienteId) {
  if (ehAdmin(usuario)) {
    return !!(await db.get('SELECT 1 FROM clientes WHERE id = ?', [clienteId]));
  }
  return !!(await db.get('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?',
    [usuario.id, clienteId]));
}

/** Verifica se um usuário (possível responsável) tem acesso ao cliente informado. */
async function usuarioTemAcessoAoCliente(usuarioId, clienteId) {
  const u = await db.get('SELECT papel, ativo FROM usuarios WHERE id = ?', [usuarioId]);
  if (!u || !u.ativo) return false;
  if (u.papel === 'admin') return true;
  return !!(await db.get('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?',
    [usuarioId, clienteId]));
}

// ---------- Limite de tentativas de login ----------
// Guardado no banco para valer entre instâncias do servidor (inclusive funções serverless).

const JANELA_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;

function chaveTentativa(req, email) {
  return `${req.ip}|${String(email || '').toLowerCase()}`;
}

async function verificarBloqueio(req, email) {
  const reg = await db.get('SELECT bloqueado_ate FROM tentativas_login WHERE chave = ?', [chaveTentativa(req, email)]);
  if (reg && reg.bloqueado_ate > Date.now()) {
    const minutos = Math.ceil((reg.bloqueado_ate - Date.now()) / 60000);
    throw new ErroHttp(429, `Muitas tentativas de acesso. Tente novamente em ${minutos} minuto(s).`);
  }
}

async function registrarFalha(req, email) {
  const agora = Date.now();
  // Reinicia a contagem quando a janela expirou; bloqueia ao atingir o limite
  await db.exec(`
    INSERT INTO tentativas_login (chave, contagem, inicio, bloqueado_ate) VALUES (?, 1, ?, 0)
    ON CONFLICT (chave) DO UPDATE SET
      contagem = CASE WHEN ? - tentativas_login.inicio > ? THEN 1 ELSE tentativas_login.contagem + 1 END,
      inicio = CASE WHEN ? - tentativas_login.inicio > ? THEN ? ELSE tentativas_login.inicio END`,
  [chaveTentativa(req, email), agora, agora, JANELA_MS, agora, JANELA_MS, agora]);
  await db.exec('UPDATE tentativas_login SET bloqueado_ate = ? WHERE chave = ? AND contagem >= ?',
    [agora + JANELA_MS, chaveTentativa(req, email), MAX_TENTATIVAS]);
  // Limpeza oportunista de registros antigos
  await db.exec('DELETE FROM tentativas_login WHERE ? - inicio > ? AND bloqueado_ate < ?', [agora, JANELA_MS, agora]);
}

async function limparFalhas(req, email) {
  await db.exec('DELETE FROM tentativas_login WHERE chave = ?', [chaveTentativa(req, email)]);
}

module.exports = {
  gerarHashSenha, conferirSenha, HASH_FICTICIO, validarForcaSenha,
  criarSessao, encerrarSessao, lerCookies, carregarUsuario, exigirLogin, exigirAdmin,
  ehAdmin, filtroClientes, podeAcessarCliente, usuarioTemAcessoAoCliente,
  verificarBloqueio, registrarFalha, limparFalhas,
};
