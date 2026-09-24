'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { gerarHashSenha, validarForcaSenha, exigirAdmin, ehAdmin } = require('../auth');
const { Validador, ErroHttp, ErroValidacao, naoEncontrado, idParam } = require('../validacao');

const r = express.Router();

const PAPEIS = { admin: 'Administrador', usuario: 'Usuário' };

function clientesDoUsuario(id) {
  return db.prepare('SELECT cliente_id FROM usuario_clientes WHERE usuario_id = ?').all(id).map((l) => l.cliente_id);
}

/**
 * Lista de pessoas que podem ser responsáveis por demandas.
 * Para cada pessoa, informa a quais clientes (dentre os visíveis a quem pergunta) ela tem acesso.
 */
r.get('/opcoes', (req, res) => {
  const usuarios = db.prepare(`SELECT id, nome, papel FROM usuarios WHERE ativo = 1 ORDER BY nome COLLATE NOCASE`).all();
  const vinculos = db.prepare('SELECT usuario_id, cliente_id FROM usuario_clientes').all();
  const visiveis = ehAdmin(req.usuario) ? null : new Set(clientesDoUsuario(req.usuario.id));
  const mapa = new Map();
  for (const v of vinculos) {
    if (visiveis && !visiveis.has(v.cliente_id)) continue;
    if (!mapa.has(v.usuario_id)) mapa.set(v.usuario_id, []);
    mapa.get(v.usuario_id).push(v.cliente_id);
  }
  res.json(usuarios.map((u) => ({
    id: u.id,
    nome: u.nome,
    todos: u.papel === 'admin',
    clientes: mapa.get(u.id) || [],
  })));
});

// A partir daqui, apenas administradores
r.use(exigirAdmin);

r.get('/', (_req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
      (SELECT COUNT(*) FROM demandas d WHERE d.responsavel_id = u.id AND d.status <> 'concluida') AS demandas_abertas
    FROM usuarios u ORDER BY u.nome COLLATE NOCASE`).all();
  res.json(usuarios.map((u) => ({ ...u, ativo: !!u.ativo, clientes: clientesDoUsuario(u.id) })));
});

function validarUsuario(body, { novo }) {
  const v = new Validador(body)
    .texto('nome', 'o nome', { obrigatorio: true, max: 120 })
    .email('email', 'o e-mail', { obrigatorio: true })
    .enumeracao('papel', 'o perfil', PAPEIS, { padrao: 'usuario' });
  const senha = body.senha;
  if (novo || (senha !== undefined && senha !== null && senha !== '')) {
    const erro = validarForcaSenha(senha);
    if (erro) v.erro('senha', erro);
  }
  const d = v.verificar();
  d.ativo = body.ativo === undefined ? true : !!body.ativo;
  d.senha = senha || null;
  const ids = Array.isArray(body.clienteIds) ? body.clienteIds : [];
  d.clienteIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (d.clienteIds.length) {
    const marcadores = d.clienteIds.map(() => '?').join(',');
    const existentes = db.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE id IN (${marcadores})`).get(...d.clienteIds).n;
    if (existentes !== d.clienteIds.length) throw new ErroValidacao({ clienteIds: 'Há clientes inválidos na seleção.' });
  }
  return d;
}

function emailEmUso(email, ignorarId = 0) {
  return !!db.prepare('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?').get(email, ignorarId);
}

function salvarVinculos(usuarioId, clienteIds) {
  db.prepare('DELETE FROM usuario_clientes WHERE usuario_id = ?').run(usuarioId);
  const ins = db.prepare('INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)');
  for (const c of clienteIds) ins.run(usuarioId, c);
}

r.post('/', (req, res) => {
  const d = validarUsuario(req.body, { novo: true });
  if (emailEmUso(d.email)) throw new ErroValidacao({ email: 'Já existe um usuário com este e-mail.' });
  const id = transacao(() => {
    const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, ativo) VALUES (?, ?, ?, ?, ?)')
      .run(d.nome, d.email, gerarHashSenha(d.senha), d.papel, d.ativo ? 1 : 0);
    const novoId = Number(info.lastInsertRowid);
    salvarVinculos(novoId, d.clienteIds);
    return novoId;
  });
  res.status(201).json({ id, mensagem: 'Usuário cadastrado com sucesso.' });
});

function adminsAtivos(ignorarId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND id <> ?`).get(ignorarId).n;
}

r.put('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!atual) throw naoEncontrado('Usuário');
  const d = validarUsuario(req.body, { novo: false });
  if (emailEmUso(d.email, id)) throw new ErroValidacao({ email: 'Já existe um usuário com este e-mail.' });
  if (id === req.usuario.id && (d.papel !== 'admin' || !d.ativo)) {
    throw new ErroHttp(400, 'Você não pode remover seu próprio perfil de administrador nem desativar sua conta.');
  }
  if (atual.papel === 'admin' && (d.papel !== 'admin' || !d.ativo) && adminsAtivos(id) === 0) {
    throw new ErroHttp(400, 'O sistema precisa de pelo menos um administrador ativo.');
  }
  transacao(() => {
    db.prepare(`UPDATE usuarios SET nome = ?, email = ?, papel = ?, ativo = ?, atualizado_em = datetime('now') WHERE id = ?`)
      .run(d.nome, d.email, d.papel, d.ativo ? 1 : 0, id);
    if (d.senha) {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHashSenha(d.senha), id);
      if (id !== req.usuario.id) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    }
    if (!d.ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    salvarVinculos(id, d.clienteIds);
  });
  res.json({ mensagem: 'Usuário atualizado com sucesso.' });
});

r.delete('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!atual) throw naoEncontrado('Usuário');
  if (id === req.usuario.id) throw new ErroHttp(400, 'Você não pode excluir a própria conta.');
  if (atual.papel === 'admin' && atual.ativo && adminsAtivos(id) === 0) {
    throw new ErroHttp(400, 'O sistema precisa de pelo menos um administrador ativo.');
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  res.json({ mensagem: 'Usuário excluído. As demandas dele ficaram sem responsável.' });
});

module.exports = r;
