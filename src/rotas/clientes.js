'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { filtroClientes, podeAcessarCliente, ehAdmin } = require('../auth');
const { Validador, naoEncontrado, idParam, hoje, termoLike, validarValorColuna } = require('../validacao');
const { listarColunas } = require('./colunas');

const r = express.Router();

async function validarCliente(body) {
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

  // Campos personalizados (apenas os enviados são alterados)
  const brutos = body.campos && typeof body.campos === 'object' ? body.campos : {};
  const campos = {};
  for (const col of await listarColunas('cliente')) {
    if (!Object.prototype.hasOwnProperty.call(brutos, col.id)) continue;
    const res = validarValorColuna(col, brutos[col.id]);
    if (res.erro) v.erro(`campo_${col.id}`, `${col.nome}: ${res.erro}`);
    else campos[col.id] = res.valor;
  }
  const d = v.verificar();
  d.campos = campos;
  return d;
}

async function salvarCampos(t, clienteId, campos) {
  for (const [colId, valor] of Object.entries(campos)) {
    if (valor === null) {
      await t.exec('DELETE FROM valores_colunas_clientes WHERE cliente_id = ? AND coluna_id = ?', [clienteId, Number(colId)]);
    } else {
      await t.exec(`INSERT INTO valores_colunas_clientes (cliente_id, coluna_id, valor) VALUES (?, ?, ?)
        ON CONFLICT (cliente_id, coluna_id) DO UPDATE SET valor = excluded.valor`, [clienteId, Number(colId), valor]);
    }
  }
}

/** Valores das colunas personalizadas, por cliente: { [clienteId]: { [colunaId]: valor } }. */
async function camposDosClientes(ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  const linhas = await db.all('SELECT cliente_id, coluna_id, valor FROM valores_colunas_clientes WHERE cliente_id = ANY(?)', [ids]);
  for (const l of linhas) {
    if (!mapa.has(l.cliente_id)) mapa.set(l.cliente_id, {});
    mapa.get(l.cliente_id)[l.coluna_id] = l.valor;
  }
  return mapa;
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
      OR c.email ILIKE ? ESCAPE '\\' OR c.telefone ILIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM valores_colunas_clientes v WHERE v.cliente_id = c.id AND v.valor ILIKE ? ESCAPE '\\'))`;
    const termo = termoLike(busca);
    params.push(termo, termo, termo, termo, termo);
  }
  sql += ' GROUP BY c.id ORDER BY lower(c.nome)';
  const lista = await db.all(sql, params);
  const campos = await camposDosClientes(lista.map((c) => c.id));
  res.json(lista.map((c) => ({ ...c, abertas: c.abertas || 0, vencidas: c.vencidas || 0, campos: campos.get(c.id) || {} })));
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
    campos: (await camposDosClientes([id])).get(id) || {},
    hoje: h,
    demandas: demandas.map((d) => ({ ...d, vencida: !!d.vencida })),
    usuariosComAcesso,
  });
});

r.post('/', async (req, res) => {
  const d = await validarCliente(req.body);
  const id = await transacao(async (t) => {
    const novo = await t.get(`INSERT INTO clientes (nome, documento, email, telefone, observacoes, criado_por)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, [d.nome, d.documento, d.email, d.telefone, d.observacoes, req.usuario.id]);
    // Quem cadastra passa a ter acesso ao cliente
    if (!ehAdmin(req.usuario)) {
      await t.exec('INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)', [req.usuario.id, novo.id]);
    }
    await salvarCampos(t, novo.id, d.campos);
    return novo.id;
  });
  res.status(201).json({ id, mensagem: 'Cliente cadastrado com sucesso.' });
});

r.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await carregarAcessivel(req.usuario, id);
  const d = await validarCliente(req.body);
  await transacao(async (t) => {
    await t.exec(`UPDATE clientes SET nome = ?, documento = ?, email = ?, telefone = ?, observacoes = ?,
      atualizado_em = now() WHERE id = ?`, [d.nome, d.documento, d.email, d.telefone, d.observacoes, id]);
    await salvarCampos(t, id, d.campos);
  });
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
