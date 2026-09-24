'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { filtroClientes, podeAcessarCliente, ehAdmin } = require('../auth');
const { Validador, naoEncontrado, idParam, hoje, termoLike } = require('../validacao');

const r = express.Router();

function validarCliente(body) {
  const v = new Validador(body)
    .texto('nome', 'o nome do cliente', { obrigatorio: true, min: 2, max: 150 })
    .texto('documento', 'o CPF/CNPJ', { max: 20 })
    .email('email', 'o e-mail')
    .texto('telefone', 'o telefone', { max: 30 })
    .texto('observacoes', 'as observações', { max: 2000 });
  const doc = v.saida.documento;
  if (doc) {
    const digitos = doc.replace(/\D/g, '');
    if (digitos.length !== 11 && digitos.length !== 14) v.erro('documento', 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
  }
  const tel = v.saida.telefone;
  if (tel && !/^[\d\s()+-]{8,30}$/.test(tel)) v.erro('telefone', 'Informe um telefone válido.');
  return v.verificar();
}

function carregarAcessivel(usuario, id) {
  if (!podeAcessarCliente(usuario, id)) throw naoEncontrado('Cliente');
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
}

r.get('/', (req, res) => {
  const f = filtroClientes(req.usuario);
  const busca = String(req.query.busca || '').trim();
  const params = [hoje(), ...f.params];
  let sql = `
    SELECT c.id, c.nome, c.documento, c.email, c.telefone, c.atualizado_em,
      COUNT(d.id) AS total,
      SUM(CASE WHEN d.status <> 'concluida' THEN 1 ELSE 0 END) AS abertas,
      SUM(CASE WHEN d.status <> 'concluida' AND d.prazo IS NOT NULL AND d.prazo < ? THEN 1 ELSE 0 END) AS vencidas
    FROM clientes c
    LEFT JOIN demandas d ON d.cliente_id = c.id
    WHERE ${f.sql}`;
  if (busca) {
    sql += ` AND (c.nome LIKE ? ESCAPE '\\' OR c.documento LIKE ? ESCAPE '\\'
      OR c.email LIKE ? ESCAPE '\\' OR c.telefone LIKE ? ESCAPE '\\')`;
    const termo = termoLike(busca);
    params.push(termo, termo, termo, termo);
  }
  sql += ' GROUP BY c.id ORDER BY c.nome COLLATE NOCASE';
  const lista = db.prepare(sql).all(...params);
  res.json(lista.map((c) => ({ ...c, abertas: c.abertas || 0, vencidas: c.vencidas || 0 })));
});

r.get('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const cliente = carregarAcessivel(req.usuario, id);
  const h = hoje();
  const demandas = db.prepare(`
    SELECT d.id, d.titulo, d.status, d.prioridade, d.prazo, d.atualizado_em,
      d.responsavel_id, u.nome AS responsavel_nome,
      CASE WHEN d.status <> 'concluida' AND d.prazo IS NOT NULL AND d.prazo < ? THEN 1 ELSE 0 END AS vencida
    FROM demandas d LEFT JOIN usuarios u ON u.id = d.responsavel_id
    WHERE d.cliente_id = ?
    ORDER BY CASE d.status WHEN 'concluida' THEN 1 ELSE 0 END, d.prazo IS NULL, d.prazo, d.id DESC`).all(h, id);
  const usuariosComAcesso = ehAdmin(req.usuario)
    ? db.prepare(`SELECT u.id, u.nome FROM usuario_clientes uc JOIN usuarios u ON u.id = uc.usuario_id
        WHERE uc.cliente_id = ? ORDER BY u.nome COLLATE NOCASE`).all(id)
    : undefined;
  res.json({
    ...cliente,
    hoje: h,
    demandas: demandas.map((d) => ({ ...d, vencida: !!d.vencida })),
    usuariosComAcesso,
  });
});

r.post('/', (req, res) => {
  const d = validarCliente(req.body);
  const id = transacao(() => {
    const info = db.prepare(`INSERT INTO clientes (nome, documento, email, telefone, observacoes, criado_por)
      VALUES (?, ?, ?, ?, ?, ?)`).run(d.nome, d.documento, d.email, d.telefone, d.observacoes, req.usuario.id);
    const novoId = Number(info.lastInsertRowid);
    // Quem cadastra passa a ter acesso ao cliente
    if (!ehAdmin(req.usuario)) {
      db.prepare('INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)').run(req.usuario.id, novoId);
    }
    return novoId;
  });
  res.status(201).json({ id, mensagem: 'Cliente cadastrado com sucesso.' });
});

r.put('/:id', (req, res) => {
  const id = idParam(req.params.id);
  carregarAcessivel(req.usuario, id);
  const d = validarCliente(req.body);
  db.prepare(`UPDATE clientes SET nome = ?, documento = ?, email = ?, telefone = ?, observacoes = ?,
    atualizado_em = datetime('now') WHERE id = ?`).run(d.nome, d.documento, d.email, d.telefone, d.observacoes, id);
  res.json({ mensagem: 'Cliente atualizado com sucesso.' });
});

r.delete('/:id', (req, res) => {
  const id = idParam(req.params.id);
  carregarAcessivel(req.usuario, id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM demandas WHERE cliente_id = ?').get(id).n;
  db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
  res.json({
    mensagem: n
      ? `Cliente excluído junto com ${n} demanda(s) vinculada(s).`
      : 'Cliente excluído com sucesso.',
  });
});

module.exports = r;
