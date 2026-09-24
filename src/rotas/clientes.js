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

async function carregarAcessivel(usuario, id) {
  if (!(await podeAcessarCliente(usuario, id))) throw naoEncontrado('Cliente');
  return db.get('SELECT * FROM clientes WHERE id = ?', [id]);
}

r.get('/', async (req, res) => {
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
    sql += ` AND (c.nome ILIKE ? ESCAPE '\\' OR c.documento ILIKE ? ESCAPE '\\'
      OR c.email ILIKE ? ESCAPE '\\' OR c.telefone ILIKE ? ESCAPE '\\')`;
    const termo = termoLike(busca);
    params.push(termo, termo, termo, termo);
  }
  sql += ' GROUP BY c.id ORDER BY lower(c.nome)';
  const lista = await db.all(sql, params);
  res.json(lista.map((c) => ({ ...c, abertas: c.abertas || 0, vencidas: c.vencidas || 0 })));
});

r.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const cliente = await carregarAcessivel(req.usuario, id);
  const h = hoje();
  const demandas = await db.all(`
    SELECT d.id, d.titulo, d.status, d.prioridade, d.prazo, d.atualizado_em,
      d.responsavel_id, u.nome AS responsavel_nome,
      CASE WHEN d.status <> 'concluida' AND d.prazo IS NOT NULL AND d.prazo < ? THEN 1 ELSE 0 END AS vencida
    FROM demandas d LEFT JOIN usuarios u ON u.id = d.responsavel_id
    WHERE d.cliente_id = ?
    ORDER BY CASE d.status WHEN 'concluida' THEN 1 ELSE 0 END, d.prazo IS NULL, d.prazo, d.id DESC`, [h, id]);
  const usuariosComAcesso = ehAdmin(req.usuario)
    ? await db.all(`SELECT u.id, u.nome FROM usuario_clientes uc JOIN usuarios u ON u.id = uc.usuario_id
        WHERE uc.cliente_id = ? ORDER BY lower(u.nome)`, [id])
    : undefined;
  res.json({
    ...cliente,
    hoje: h,
    demandas: demandas.map((d) => ({ ...d, vencida: !!d.vencida })),
    usuariosComAcesso,
  });
});

r.post('/', async (req, res) => {
  const d = validarCliente(req.body);
  const id = await transacao(async (t) => {
    const novo = await t.get(`INSERT INTO clientes (nome, documento, email, telefone, observacoes, criado_por)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, [d.nome, d.documento, d.email, d.telefone, d.observacoes, req.usuario.id]);
    // Quem cadastra passa a ter acesso ao cliente
    if (!ehAdmin(req.usuario)) {
      await t.exec('INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)', [req.usuario.id, novo.id]);
    }
    return novo.id;
  });
  res.status(201).json({ id, mensagem: 'Cliente cadastrado com sucesso.' });
});

r.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await carregarAcessivel(req.usuario, id);
  const d = validarCliente(req.body);
  await db.exec(`UPDATE clientes SET nome = ?, documento = ?, email = ?, telefone = ?, observacoes = ?,
    atualizado_em = now() WHERE id = ?`, [d.nome, d.documento, d.email, d.telefone, d.observacoes, id]);
  res.json({ mensagem: 'Cliente atualizado com sucesso.' });
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await carregarAcessivel(req.usuario, id);
  const n = (await db.get('SELECT COUNT(*) AS n FROM demandas WHERE cliente_id = ?', [id])).n;
  await db.exec('DELETE FROM clientes WHERE id = ?', [id]);
  res.json({
    mensagem: n
      ? `Cliente excluído junto com ${n} demanda(s) vinculada(s).`
      : 'Cliente excluído com sucesso.',
  });
});

module.exports = r;
