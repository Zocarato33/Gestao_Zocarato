'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { exigirAdmin } = require('../auth');
const { listarColunas } = require('./colunas');
const { montarLayout, aplicarObrigatorios } = require('../layout');
const {
  Validador, naoEncontrado, idParam, hoje, termoLike, validarValorColuna,
} = require('../validacao');

const r = express.Router();

// Tabela de preços contém informação comercial: acesso restrito a administradores
r.use(exigirAdmin);

/** Aceita 1500, "1500.5", "1.500,50" ou "R$ 1.500,50". Retorna número, null (vazio) ou NaN (inválido). */
function lerValor(bruto) {
  if (bruto === undefined || bruto === null || bruto === '') return null;
  if (typeof bruto === 'number') return bruto;
  let t = String(bruto).replace(/R\$|\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Number(t) : Number.NaN;
}

async function validarPreco(body, modo = 'criar') {
  const v = new Validador(body)
    .id('cliente_id', 'o cliente', { obrigatorio: true })
    .texto('numero_contrato', 'o número do contrato', { max: 60 })
    .data('inicio_contrato', 'o início do contrato')
    .data('vencimento_contrato', 'o vencimento do contrato')
    .texto('atendimento', 'o atendimento aplicado', { max: 200 });

  const valor = lerValor(body.valor_ticket);
  if (Number.isNaN(valor)) v.erro('valor_ticket', 'Informe um valor válido, por exemplo 1.500,00.');
  else if (valor !== null && (valor < 0 || valor >= 1e12)) v.erro('valor_ticket', 'Valor fora do intervalo permitido.');
  v.saida.valor_ticket = Number.isNaN(valor) ? null : valor;

  const clienteId = v.saida.cliente_id;
  if (clienteId && !v.erros.cliente_id && !(await db.get('SELECT 1 FROM clientes WHERE id = ?', [clienteId]))) {
    v.erro('cliente_id', 'Cliente não encontrado.');
  }
  const { inicio_contrato: inicio, vencimento_contrato: fim } = v.saida;
  if (inicio && fim && !v.erros.inicio_contrato && !v.erros.vencimento_contrato && fim < inicio) {
    v.erro('vencimento_contrato', 'O vencimento não pode ser anterior ao início do contrato.');
  }

  const brutos = body.campos && typeof body.campos === 'object' ? body.campos : {};
  const campos = {};
  for (const col of await listarColunas('preco')) {
    if (!Object.prototype.hasOwnProperty.call(brutos, col.id)) continue;
    const res = validarValorColuna(col, brutos[col.id]);
    if (res.erro) v.erro(`campo_${col.id}`, `${col.nome}: ${res.erro}`);
    else campos[col.id] = res.valor;
  }
  aplicarObrigatorios(v, await montarLayout('preco'), campos, modo);
  const d = v.verificar();
  d.campos = campos;
  return d;
}

async function salvarCampos(t, precoId, campos) {
  for (const [colId, valor] of Object.entries(campos)) {
    if (valor === null) {
      await t.exec('DELETE FROM valores_colunas_precos WHERE preco_id = ? AND coluna_id = ?', [precoId, Number(colId)]);
    } else {
      await t.exec(`INSERT INTO valores_colunas_precos (preco_id, coluna_id, valor) VALUES (?, ?, ?)
        ON CONFLICT (preco_id, coluna_id) DO UPDATE SET valor = excluded.valor`, [precoId, Number(colId), valor]);
    }
  }
}

const SELECT_BASE = `
  SELECT p.id, p.cliente_id, c.nome AS cliente_nome, p.numero_contrato, p.valor_ticket, p.inicio_contrato,
    p.vencimento_contrato, p.atendimento, p.criado_em, p.atualizado_em
  FROM precos p JOIN clientes c ON c.id = p.cliente_id`;

async function anexarCampos(precos) {
  if (!precos.length) return precos;
  const linhas = await db.all('SELECT preco_id, coluna_id, valor FROM valores_colunas_precos WHERE preco_id = ANY(?)',
    [precos.map((p) => p.id)]);
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.preco_id)) mapa.set(l.preco_id, {});
    mapa.get(l.preco_id)[l.coluna_id] = l.valor;
  }
  return precos.map((p) => ({ ...p, campos: mapa.get(p.id) || {} }));
}

async function carregar(id) {
  const p = await db.get(`${SELECT_BASE} WHERE p.id = ?`, [id]);
  if (!p) throw naoEncontrado('Registro');
  return (await anexarCampos([p]))[0];
}

r.get('/', async (req, res) => {
  const cond = ['1 = 1'];
  const params = [];
  const busca = String(req.query.busca || '').trim();
  if (busca) {
    const t = termoLike(busca);
    cond.push(`(c.nome ILIKE ? ESCAPE '\\' OR p.numero_contrato ILIKE ? ESCAPE '\\' OR p.atendimento ILIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM valores_colunas_precos v WHERE v.preco_id = p.id AND v.valor ILIKE ? ESCAPE '\\'))`);
    params.push(t, t, t, t);
  }
  if (req.query.cliente) {
    cond.push('p.cliente_id = ?');
    params.push(Number(req.query.cliente) || 0);
  }
  const precos = await db.all(`${SELECT_BASE} WHERE ${cond.join(' AND ')}
    ORDER BY p.vencimento_contrato IS NULL, p.vencimento_contrato, lower(c.nome), p.id`, params);
  res.json({ hoje: hoje(), precos: await anexarCampos(precos) });
});

r.get('/:id', async (req, res) => {
  res.json(await carregar(idParam(req.params.id)));
});

r.post('/', async (req, res) => {
  const d = await validarPreco(req.body, 'criar');
  const id = await transacao(async (t) => {
    const novo = await t.get(`INSERT INTO precos
      (cliente_id, numero_contrato, valor_ticket, inicio_contrato, vencimento_contrato, atendimento, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
      d.cliente_id, d.numero_contrato, d.valor_ticket, d.inicio_contrato, d.vencimento_contrato, d.atendimento, req.usuario.id,
    ]);
    await salvarCampos(t, novo.id, d.campos);
    return novo.id;
  });
  res.status(201).json({ id, mensagem: 'Registro incluído na tabela de preços.', preco: await carregar(id) });
});

r.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await carregar(id);
  const d = await validarPreco(req.body, 'atualizar');
  await transacao(async (t) => {
    await t.exec(`UPDATE precos SET cliente_id = ?, numero_contrato = ?, valor_ticket = ?, inicio_contrato = ?,
      vencimento_contrato = ?, atendimento = ?, atualizado_em = now() WHERE id = ?`, [
      d.cliente_id, d.numero_contrato, d.valor_ticket, d.inicio_contrato, d.vencimento_contrato, d.atendimento, id,
    ]);
    await salvarCampos(t, id, d.campos);
  });
  res.json({ mensagem: 'Registro atualizado.', preco: await carregar(id) });
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await carregar(id);
  await db.exec('DELETE FROM precos WHERE id = ?', [id]);
  res.json({ mensagem: 'Registro excluído da tabela de preços.' });
});

module.exports = r;
