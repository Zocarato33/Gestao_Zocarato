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

function criarSessao(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(hashToken(token), usuarioId, Date.now() + SESSAO_MS);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSAO_MS,
    path: '/',
  });
}

function encerrarSessao(req, res) {
  const token = req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
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
function carregarUsuario(req, res, next) {
  req.usuario = null;
  const token = req.cookies[COOKIE];
  if (!token) return next();
  const th = hashToken(token);
  const linha = db.prepare(`
    SELECT u.id, u.nome, u.email, u.papel, u.ativo, s.expira_em
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?`).get(th);
  if (!linha || linha.expira_em < Date.now() || !linha.ativo) {
    if (linha) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(th);
    return next();
  }
  // Renova apenas se passou mais de 10 minutos da última renovação
  const novoVencimento = Date.now() + SESSAO_MS;
  if (novoVencimento - linha.expira_em > 10 * 60 * 1000) {
    db.prepare('UPDATE sessoes SET expira_em = ? WHERE token_hash = ?').run(novoVencimento, th);
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

function podeAcessarCliente(usuario, clienteId) {
  if (ehAdmin(usuario)) {
    return !!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(clienteId);
  }
  return !!db.prepare('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(usuario.id, clienteId);
}

/** Verifica se um usuário (possível responsável) tem acesso ao cliente informado. */
function usuarioTemAcessoAoCliente(usuarioId, clienteId) {
  const u = db.prepare('SELECT papel, ativo FROM usuarios WHERE id = ?').get(usuarioId);
  if (!u || !u.ativo) return false;
  if (u.papel === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(usuarioId, clienteId);
}

// ---------- Limite de tentativas de login ----------

const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;

function chaveTentativa(req, email) {
  return `${req.ip}|${String(email || '').toLowerCase()}`;
}

function verificarBloqueio(req, email) {
  const chave = chaveTentativa(req, email);
  const reg = tentativas.get(chave);
  if (reg && reg.bloqueadoAte > Date.now()) {
    const minutos = Math.ceil((reg.bloqueadoAte - Date.now()) / 60000);
    throw new ErroHttp(429, `Muitas tentativas de acesso. Tente novamente em ${minutos} minuto(s).`);
  }
}

function registrarFalha(req, email) {
  const chave = chaveTentativa(req, email);
  const agora = Date.now();
  const reg = tentativas.get(chave) || { contagem: 0, inicio: agora, bloqueadoAte: 0 };
  if (agora - reg.inicio > JANELA_MS) {
    reg.contagem = 0;
    reg.inicio = agora;
  }
  reg.contagem += 1;
  if (reg.contagem >= MAX_TENTATIVAS) reg.bloqueadoAte = agora + JANELA_MS;
  tentativas.set(chave, reg);
}

function limparFalhas(req, email) {
  tentativas.delete(chaveTentativa(req, email));
}

setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of tentativas) {
    if (agora - v.inicio > JANELA_MS && v.bloqueadoAte < agora) tentativas.delete(k);
  }
}, JANELA_MS).unref();

module.exports = {
  gerarHashSenha, conferirSenha, HASH_FICTICIO, validarForcaSenha,
  criarSessao, encerrarSessao, lerCookies, carregarUsuario, exigirLogin, exigirAdmin,
  ehAdmin, filtroClientes, podeAcessarCliente, usuarioTemAcessoAoCliente,
  verificarBloqueio, registrarFalha, limparFalhas,
};
