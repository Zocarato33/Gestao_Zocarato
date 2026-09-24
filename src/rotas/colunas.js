'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { exigirAdmin } = require('../auth');
const { Validador, naoEncontrado, idParam, TIPOS_COLUNA } = require('../validacao');

const r = express.Router();

// Cada entidade guarda os valores das suas colunas numa tabela própria
const ENTIDADES = {
  demanda: { tabela: 'valores_colunas' },
  cliente: { tabela: 'valores_colunas_clientes' },
};

// Nomes já usados pelos campos e colunas padrão de cada tela
const NOMES_RESERVADOS = {
  demanda: [
    'id', 'título', 'titulo', 'descrição', 'descricao', 'cliente', 'responsável', 'responsavel',
    'status', 'prioridade', 'prazo', 'observações', 'observacoes', 'ações', 'acoes',
  ],
  cliente: [
    'id', 'cliente', 'nome', 'nome ou razão social', 'razão social', 'razao social', 'cpf', 'cnpj', 'cpf/cnpj',
    'cpf ou cnpj', 'documento', 'e-mail', 'email', 'telefone', 'contato', 'observações', 'observacoes',
    'demandas', 'em aberto', 'vencidas', 'ações', 'acoes',
  ],
};

const entidadeValida = (e) => (Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? e : 'demanda');

async function listarColunas(entidade = 'demanda') {
  const { tabela } = ENTIDADES[entidadeValida(entidade)];
  return (await db.all(`
    SELECT c.id, c.nome, c.tipo, c.opcoes, c.ordem, c.entidade,
      (SELECT COUNT(*) FROM ${tabela} v WHERE v.coluna_id = c.id AND v.valor IS NOT NULL) AS preenchidos
    FROM colunas c WHERE c.entidade = ? ORDER BY c.ordem, c.id`, [entidadeValida(entidade)]))
    .map((c) => ({ ...c, opcoes: c.opcoes ? JSON.parse(c.opcoes) : [] }));
}

function validarOpcoes(bruto) {
  const lista = Array.isArray(bruto) ? bruto : String(bruto || '').split(/\r?\n|;/);
  const limpas = [];
  for (const item of lista) {
    const t = String(item).trim();
    if (!t) continue;
    if (t.length > 60) return { erro: 'Cada opção deve ter no máximo 60 caracteres.' };
    if (!limpas.some((o) => o.toLowerCase() === t.toLowerCase())) limpas.push(t);
  }
  if (!limpas.length) return { erro: 'Informe ao menos uma opção.' };
  if (limpas.length > 50) return { erro: 'Máximo de 50 opções.' };
  return { opcoes: limpas };
}

async function validarNome(v, entidade, ignorarId = 0) {
  const nome = v.saida.nome;
  if (!nome || v.erros.nome) return;
  if (NOMES_RESERVADOS[entidade].includes(nome.toLowerCase())) {
    v.erro('nome', `Este nome já é usado por um campo padrão ${entidade === 'cliente' ? 'do cliente' : 'da demanda'}.`);
  } else if (await db.get('SELECT 1 FROM colunas WHERE entidade = ? AND lower(nome) = lower(?) AND id <> ?',
    [entidade, nome, ignorarId])) {
    v.erro('nome', 'Já existe uma coluna com este nome.');
  }
}

r.get('/', async (req, res) => res.json(await listarColunas(req.query.entidade)));

r.use(exigirAdmin);

r.post('/', async (req, res) => {
  const v = new Validador(req.body)
    .texto('nome', 'o nome da coluna', { obrigatorio: true, max: 40 })
    .enumeracao('tipo', 'o tipo do campo', TIPOS_COLUNA)
    .enumeracao('entidade', 'a tela da coluna', ENTIDADES, { padrao: 'demanda' });
  if (!v.erros.entidade) await validarNome(v, v.saida.entidade);
  let opcoes = null;
  if (v.saida.tipo === 'lista') {
    const o = validarOpcoes(req.body.opcoes);
    if (o.erro) v.erro('opcoes', o.erro);
    else opcoes = o.opcoes;
  }
  const d = v.verificar();
  const nova = await db.get(`INSERT INTO colunas (nome, tipo, opcoes, entidade, ordem)
    VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM colunas WHERE entidade = ?)) RETURNING id`,
  [d.nome, d.tipo, opcoes ? JSON.stringify(opcoes) : null, d.entidade, d.entidade]);
  res.status(201).json({ id: nova.id, mensagem: `Coluna "${d.nome}" criada.` });
});

r.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const col = await db.get('SELECT * FROM colunas WHERE id = ?', [id]);
  if (!col) throw naoEncontrado('Coluna');
  const v = new Validador(req.body).texto('nome', 'o nome da coluna', { obrigatorio: true, max: 40 });
  await validarNome(v, col.entidade, id);
  let opcoes = null;
  if (col.tipo === 'lista') {
    const o = validarOpcoes(req.body.opcoes ?? JSON.parse(col.opcoes || '[]'));
    if (o.erro) v.erro('opcoes', o.erro);
    else opcoes = o.opcoes;
  }
  const d = v.verificar();
  const removidos = await transacao(async (t) => {
    await t.exec('UPDATE colunas SET nome = ?, opcoes = ? WHERE id = ?', [d.nome, opcoes ? JSON.stringify(opcoes) : null, id]);
    if (!opcoes) return 0;
    // Valores que não existem mais na lista são limpos para manter a consistência
    const marcadores = opcoes.map(() => '?').join(',');
    return (await t.exec(`DELETE FROM ${ENTIDADES[col.entidade].tabela} WHERE coluna_id = ? AND valor NOT IN (${marcadores})`,
      [id, ...opcoes])).rowCount;
  });
  res.json({
    mensagem: removidos
      ? `Coluna atualizada. ${removidos} valor(es) com opções removidas foram apagados.`
      : 'Coluna atualizada com sucesso.',
  });
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const col = await db.get('SELECT * FROM colunas WHERE id = ?', [id]);
  if (!col) throw naoEncontrado('Coluna');
  const n = (await db.get(`SELECT COUNT(*) AS n FROM ${ENTIDADES[col.entidade].tabela} WHERE coluna_id = ?`, [id])).n;
  await db.exec('DELETE FROM colunas WHERE id = ?', [id]);
  res.json({ mensagem: `Coluna "${col.nome}" excluída${n ? ` com ${n} valor(es) preenchido(s)` : ''}.` });
});

module.exports = { router: r, listarColunas };
