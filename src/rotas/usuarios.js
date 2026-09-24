'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { gerarHashSenha, validarForcaSenha, exigirAdmin, ehAdmin } = require('../auth');
const { Validador, ErroHttp, ErroValidacao, naoEncontrado, idParam } = require('../validacao');

const r = express.Router();

const PAPEIS = { admin: 'Administrador', usuario: 'Usuário' };

async function clientesDoUsuario(id) {
  return (await db.all('SELECT cliente_id FROM usuario_clientes WHERE usuario_id = ?', [id])).map((l) => l.cliente_id);
}

/**
 * Lista de pessoas que podem ser responsáveis por demandas.
 * Para cada pessoa, informa a quais clientes (dentre os visíveis a quem pergunta) ela tem acesso.
 */
r.get('/opcoes', async (req, res) => {
  const usuarios = await db.all('SELECT id, nome, papel FROM usuarios WHERE ativo = 1 ORDER BY lower(nome)');
  const vinculos = await db.all('SELECT usuario_id, cliente_id FROM usuario_clientes');
  const visiveis = ehAdmin(req.usuario) ? null : new Set(await clientesDoUsuario(req.usuario.id));
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

r.get('/', async (_req, res) => {
  const usuarios = await db.all(`
    SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
      (SELECT COUNT(*) FROM demandas d WHERE d.responsavel_id = u.id AND d.status <> 'concluida') AS demandas_abertas
    FROM usuarios u ORDER BY lower(u.nome)`);
  const vinculos = await db.all('SELECT usuario_id, cliente_id FROM usuario_clientes');
  res.json(usuarios.map((u) => ({
    ...u,
    ativo: !!u.ativo,
    clientes: vinculos.filter((v) => v.usuario_id === u.id).map((v) => v.cliente_id),
  })));
});

async function validarUsuario(body, { novo }) {
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
    const existentes = (await db.get(`SELECT COUNT(*) AS n FROM clientes WHERE id IN (${marcadores})`, d.clienteIds)).n;
    if (existentes !== d.clienteIds.length) throw new ErroValidacao({ clienteIds: 'Há clientes inválidos na seleção.' });
  }
  return d;
}

async function emailEmUso(email, ignorarId = 0) {
  return !!(await db.get('SELECT 1 FROM usuarios WHERE lower(email) = lower(?) AND id <> ?', [email, ignorarId]));
}

async function salvarVinculos(t, usuarioId, clienteIds) {
  await t.exec('DELETE FROM usuario_clientes WHERE usuario_id = ?', [usuarioId]);
  for (const c of clienteIds) {
    await t.exec('INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)', [usuarioId, c]);
  }
}

r.post('/', async (req, res) => {
  const d = await validarUsuario(req.body, { novo: true });
  if (await emailEmUso(d.email)) throw new ErroValidacao({ email: 'Já existe um usuário com este e-mail.' });
  const hash = gerarHashSenha(d.senha);
  const id = await transacao(async (t) => {
    const novo = await t.get('INSERT INTO usuarios (nome, email, senha_hash, papel, ativo) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [d.nome, d.email, hash, d.papel, d.ativo ? 1 : 0]);
    await salvarVinculos(t, novo.id, d.clienteIds);
    return novo.id;
  });
  res.status(201).json({ id, mensagem: 'Usuário cadastrado com sucesso.' });
});

async function adminsAtivos(ignorarId) {
  return (await db.get(`SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND id <> ?`, [ignorarId])).n;
}

r.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const atual = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!atual) throw naoEncontrado('Usuário');
  const d = await validarUsuario(req.body, { novo: false });
  if (await emailEmUso(d.email, id)) throw new ErroValidacao({ email: 'Já existe um usuário com este e-mail.' });
  if (id === req.usuario.id && (d.papel !== 'admin' || !d.ativo)) {
    throw new ErroHttp(400, 'Você não pode remover seu próprio perfil de administrador nem desativar sua conta.');
  }
  if (atual.papel === 'admin' && (d.papel !== 'admin' || !d.ativo) && (await adminsAtivos(id)) === 0) {
    throw new ErroHttp(400, 'O sistema precisa de pelo menos um administrador ativo.');
  }
  const hash = d.senha ? gerarHashSenha(d.senha) : null;
  await transacao(async (t) => {
    await t.exec('UPDATE usuarios SET nome = ?, email = ?, papel = ?, ativo = ?, atualizado_em = now() WHERE id = ?',
      [d.nome, d.email, d.papel, d.ativo ? 1 : 0, id]);
    if (hash) {
      await t.exec('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [hash, id]);
      if (id !== req.usuario.id) await t.exec('DELETE FROM sessoes WHERE usuario_id = ?', [id]);
    }
    if (!d.ativo) await t.exec('DELETE FROM sessoes WHERE usuario_id = ?', [id]);
    await salvarVinculos(t, id, d.clienteIds);
  });
  res.json({ mensagem: 'Usuário atualizado com sucesso.' });
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const atual = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!atual) throw naoEncontrado('Usuário');
  if (id === req.usuario.id) throw new ErroHttp(400, 'Você não pode excluir a própria conta.');
  if (atual.papel === 'admin' && atual.ativo && (await adminsAtivos(id)) === 0) {
    throw new ErroHttp(400, 'O sistema precisa de pelo menos um administrador ativo.');
  }
  await db.exec('DELETE FROM usuarios WHERE id = ?', [id]);
  res.json({ mensagem: 'Usuário excluído. As demandas dele ficaram sem responsável.' });
});

module.exports = r;
