'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { filtroClientes, podeAcessarCliente, usuarioTemAcessoAoCliente } = require('../auth');
const { listarColunas } = require('./colunas');
const {
  Validador, ErroValidacao, naoEncontrado, idParam, hoje, somarDias, dataValida, termoLike,
  STATUS, PRIORIDADES, validarValorColuna,
} = require('../validacao');

const r = express.Router();

const ORDENACOES = {
  titulo: 'd.titulo COLLATE NOCASE',
  cliente: 'c.nome COLLATE NOCASE',
  responsavel: 'u.nome COLLATE NOCASE',
  status: `CASE d.status WHEN 'pendente' THEN 1 WHEN 'em_andamento' THEN 2 WHEN 'aguardando_cliente' THEN 3 ELSE 4 END`,
  prioridade: `CASE d.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`,
  prazo: 'd.prazo',
  atualizado_em: 'd.atualizado_em',
  criado_em: 'd.criado_em',
};

const SELECT_BASE = `
  SELECT d.id, d.titulo, d.descricao, d.cliente_id, c.nome AS cliente_nome,
    d.responsavel_id, u.nome AS responsavel_nome, d.status, d.prioridade, d.prazo, d.observacoes,
    d.criado_em, d.atualizado_em, cr.nome AS criado_por_nome
  FROM demandas d
  JOIN clientes c ON c.id = d.cliente_id
  LEFT JOIN usuarios u ON u.id = d.responsavel_id
  LEFT JOIN usuarios cr ON cr.id = d.criado_por`;

function anexarCampos(demandas) {
  if (!demandas.length) return demandas;
  const ids = demandas.map((d) => d.id);
  const valores = new Map();
  // Busca em lotes para não estourar o limite de parâmetros do SQLite
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500);
    const linhas = db.prepare(`SELECT demanda_id, coluna_id, valor FROM valores_colunas
      WHERE demanda_id IN (${lote.map(() => '?').join(',')})`).all(...lote);
    for (const l of linhas) {
      if (!valores.has(l.demanda_id)) valores.set(l.demanda_id, {});
      valores.get(l.demanda_id)[l.coluna_id] = l.valor;
    }
  }
  const h = hoje();
  return demandas.map((d) => ({
    ...d,
    vencida: d.status !== 'concluida' && !!d.prazo && d.prazo < h,
    campos: valores.get(d.id) || {},
  }));
}

/** Monta as condições de filtro. Retorna {where, params}. */
function montarFiltros(usuario, q, { incluirStatusPrazo = true } = {}) {
  const f = filtroClientes(usuario, 'd.cliente_id');
  const cond = [f.sql];
  const params = [...f.params];
  const h = hoje();

  const busca = String(q.busca || '').trim();
  if (busca) {
    const t = termoLike(busca);
    cond.push(`(d.titulo LIKE ? ESCAPE '\\' OR d.descricao LIKE ? ESCAPE '\\' OR d.observacoes LIKE ? ESCAPE '\\'
      OR c.nome LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM valores_colunas v WHERE v.demanda_id = d.id AND v.valor LIKE ? ESCAPE '\\')
      OR CAST(d.id AS TEXT) = ?)`);
    params.push(t, t, t, t, t, busca.replace(/^#/, ''));
  }
  if (q.cliente) {
    cond.push('d.cliente_id = ?');
    params.push(Number(q.cliente) || 0);
  }
  if (q.responsavel === 'nenhum') cond.push('d.responsavel_id IS NULL');
  else if (q.responsavel) {
    cond.push('d.responsavel_id = ?');
    params.push(Number(q.responsavel) || 0);
  }
  if (q.prioridade && PRIORIDADES[q.prioridade]) {
    cond.push('d.prioridade = ?');
    params.push(q.prioridade);
  }

  if (incluirStatusPrazo) {
    if (q.status === 'abertas') cond.push(`d.status <> 'concluida'`);
    else if (q.status && STATUS[q.status]) {
      cond.push('d.status = ?');
      params.push(q.status);
    }
    switch (q.prazo) {
      case 'vencidas':
        cond.push(`d.status <> 'concluida' AND d.prazo IS NOT NULL AND d.prazo < ?`);
        params.push(h);
        break;
      case 'hoje':
        cond.push('d.prazo = ?');
        params.push(h);
        break;
      case 'semana':
        cond.push('d.prazo BETWEEN ? AND ?');
        params.push(h, somarDias(h, 7));
        break;
      case 'sem_prazo':
        cond.push('d.prazo IS NULL');
        break;
      case 'periodo':
        if (dataValida(q.de)) {
          cond.push('d.prazo >= ?');
          params.push(q.de);
        }
        if (dataValida(q.ate)) {
          cond.push('d.prazo <= ?');
          params.push(q.ate);
        }
        break;
      default:
    }
  }
  return { where: cond.join(' AND '), params };
}

r.get('/', (req, res) => {
  const q = req.query;
  const { where, params } = montarFiltros(req.usuario, q);
  const campoOrdem = ORDENACOES[q.ordenar];
  const direcao = q.direcao === 'desc' ? 'DESC' : 'ASC';
  const ordem = campoOrdem
    ? `${campoOrdem === 'd.prazo' ? 'd.prazo IS NULL, ' : ''}${campoOrdem} ${direcao}, d.id DESC`
    : `CASE WHEN d.status = 'concluida' THEN 1 ELSE 0 END, d.prazo IS NULL, d.prazo ASC,
       ${ORDENACOES.prioridade}, d.id DESC`;
  const demandas = anexarCampos(db.prepare(`${SELECT_BASE} WHERE ${where} ORDER BY ${ordem}`).all(...params));

  // Indicadores: respeitam busca, cliente, responsável e prioridade (os cartões detalham status e prazo)
  const ctx = montarFiltros(req.usuario, q, { incluirStatusPrazo: false });
  const ind = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN d.status <> 'concluida' THEN 1 ELSE 0 END) AS abertas,
      SUM(CASE WHEN d.status = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN d.status <> 'concluida' AND d.prazo IS NOT NULL AND d.prazo < ? THEN 1 ELSE 0 END) AS vencidas
    FROM demandas d JOIN clientes c ON c.id = d.cliente_id
    WHERE ${ctx.where}`).get(hoje(), ...ctx.params);

  res.json({
    hoje: hoje(),
    demandas,
    indicadores: {
      total: ind.total || 0,
      abertas: ind.abertas || 0,
      concluidas: ind.concluidas || 0,
      vencidas: ind.vencidas || 0,
    },
  });
});

function carregarDemanda(usuario, id) {
  const d = db.prepare(`${SELECT_BASE} WHERE d.id = ?`).get(id);
  if (!d || !podeAcessarCliente(usuario, d.cliente_id)) throw naoEncontrado('Demanda');
  return anexarCampos([d])[0];
}

r.get('/:id', (req, res) => {
  res.json(carregarDemanda(req.usuario, idParam(req.params.id)));
});

/**
 * Valida os dados completos de uma demanda (campos padrão + personalizados).
 */
function validarDemanda(usuario, body, atual = null) {
  const v = new Validador(body)
    .texto('titulo', 'o título', { obrigatorio: true, min: 3, max: 200 })
    .texto('descricao', 'a descrição', { max: 5000 })
    .id('cliente_id', 'o cliente', { obrigatorio: true })
    .id('responsavel_id', 'o responsável')
    .enumeracao('status', 'o status', STATUS, { padrao: 'pendente' })
    .enumeracao('prioridade', 'a prioridade', PRIORIDADES, { padrao: 'normal' })
    .data('prazo', 'o prazo')
    .texto('observacoes', 'as observações', { max: 5000 });

  const clienteId = v.saida.cliente_id;
  if (clienteId && !v.erros.cliente_id && !podeAcessarCliente(usuario, clienteId)) {
    v.erro('cliente_id', 'Cliente não encontrado ou sem permissão de acesso.');
  }
  const respId = v.saida.responsavel_id;
  // Um responsável que foi desativado ou perdeu o acesso continua na demanda até ser trocado,
  // desde que o cliente também não mude
  const mantido = atual && atual.responsavel_id === respId && atual.cliente_id === clienteId;
  if (respId && !mantido && !v.erros.responsavel_id && clienteId && !v.erros.cliente_id
    && !usuarioTemAcessoAoCliente(respId, clienteId)) {
    v.erro('responsavel_id', 'Este responsável não tem acesso ao cliente selecionado.');
  }

  // Campos personalizados
  const colunas = listarColunas();
  const brutos = body.campos && typeof body.campos === 'object' ? body.campos : {};
  const campos = {};
  for (const col of colunas) {
    if (!Object.prototype.hasOwnProperty.call(brutos, col.id)) continue;
    const res = validarValorColuna(col, brutos[col.id]);
    if (res.erro) v.erro(`campo_${col.id}`, `${col.nome}: ${res.erro}`);
    else campos[col.id] = res.valor;
  }
  const d = v.verificar();
  d.campos = campos;
  return d;
}

function salvarCampos(demandaId, campos) {
  const upsert = db.prepare(`INSERT INTO valores_colunas (demanda_id, coluna_id, valor) VALUES (?, ?, ?)
    ON CONFLICT (demanda_id, coluna_id) DO UPDATE SET valor = excluded.valor`);
  const apagar = db.prepare('DELETE FROM valores_colunas WHERE demanda_id = ? AND coluna_id = ?');
  for (const [colId, valor] of Object.entries(campos)) {
    if (valor === null) apagar.run(demandaId, Number(colId));
    else upsert.run(demandaId, Number(colId), valor);
  }
}

r.post('/', (req, res) => {
  const d = validarDemanda(req.usuario, req.body);
  const id = transacao(() => {
    const info = db.prepare(`INSERT INTO demandas
      (titulo, descricao, cliente_id, responsavel_id, status, prioridade, prazo, observacoes, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      d.titulo, d.descricao, d.cliente_id, d.responsavel_id, d.status, d.prioridade, d.prazo, d.observacoes,
      req.usuario.id,
    );
    const novoId = Number(info.lastInsertRowid);
    salvarCampos(novoId, d.campos);
    return novoId;
  });
  res.status(201).json({ id, mensagem: 'Demanda criada com sucesso.', demanda: carregarDemanda(req.usuario, id) });
});

function atualizar(req, res, parcial) {
  const id = idParam(req.params.id);
  const atual = carregarDemanda(req.usuario, id);
  let corpo = req.body || {};
  if (parcial) {
    // Edição em linha: combina os campos enviados com os dados atuais
    const base = {
      titulo: atual.titulo, descricao: atual.descricao, cliente_id: atual.cliente_id,
      responsavel_id: atual.responsavel_id, status: atual.status, prioridade: atual.prioridade,
      prazo: atual.prazo, observacoes: atual.observacoes,
    };
    const permitidos = Object.keys(base);
    const extra = {};
    for (const k of permitidos) if (Object.prototype.hasOwnProperty.call(corpo, k)) extra[k] = corpo[k];
    corpo = { ...base, ...extra, campos: corpo.campos || {} };
    if (Object.keys(extra).length === 0 && Object.keys(corpo.campos).length === 0) {
      throw new ErroValidacao({}, 'Nenhuma alteração enviada.');
    }
  }
  const d = validarDemanda(req.usuario, corpo, atual);
  transacao(() => {
    db.prepare(`UPDATE demandas SET titulo = ?, descricao = ?, cliente_id = ?, responsavel_id = ?, status = ?,
      prioridade = ?, prazo = ?, observacoes = ?, atualizado_em = datetime('now') WHERE id = ?`).run(
      d.titulo, d.descricao, d.cliente_id, d.responsavel_id, d.status, d.prioridade, d.prazo, d.observacoes, id,
    );
    salvarCampos(id, d.campos);
  });
  res.json({ mensagem: 'Demanda atualizada com sucesso.', demanda: carregarDemanda(req.usuario, id) });
}

r.put('/:id', (req, res) => atualizar(req, res, false));
r.patch('/:id', (req, res) => atualizar(req, res, true));

r.delete('/:id', (req, res) => {
  const id = idParam(req.params.id);
  carregarDemanda(req.usuario, id);
  db.prepare('DELETE FROM demandas WHERE id = ?').run(id);
  res.json({ mensagem: 'Demanda excluída com sucesso.' });
});

module.exports = r;
