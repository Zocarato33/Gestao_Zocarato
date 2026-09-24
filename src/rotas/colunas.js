'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const { exigirAdmin } = require('../auth');
const { Validador, naoEncontrado, idParam, TIPOS_COLUNA } = require('../validacao');

const r = express.Router();

const NOMES_RESERVADOS = [
  'id', 'título', 'titulo', 'descrição', 'descricao', 'cliente', 'responsável', 'responsavel',
  'status', 'prioridade', 'prazo', 'observações', 'observacoes', 'ações', 'acoes',
];

function listarColunas() {
  return db.prepare(`
    SELECT c.id, c.nome, c.tipo, c.opcoes, c.ordem,
      (SELECT COUNT(*) FROM valores_colunas v WHERE v.coluna_id = c.id AND v.valor IS NOT NULL) AS preenchidos
    FROM colunas c ORDER BY c.ordem, c.id`).all()
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

function validarNome(v, ignorarId = 0) {
  const nome = v.saida.nome;
  if (!nome || v.erros.nome) return;
  if (NOMES_RESERVADOS.includes(nome.toLowerCase())) {
    v.erro('nome', 'Este nome já é usado por um campo padrão da demanda.');
  } else if (db.prepare('SELECT 1 FROM colunas WHERE nome = ? AND id <> ?').get(nome, ignorarId)) {
    v.erro('nome', 'Já existe uma coluna com este nome.');
  }
}

r.get('/', (_req, res) => res.json(listarColunas()));

r.use(exigirAdmin);

r.post('/', (req, res) => {
  const v = new Validador(req.body)
    .texto('nome', 'o nome da coluna', { obrigatorio: true, max: 40 })
    .enumeracao('tipo', 'o tipo do campo', TIPOS_COLUNA);
  validarNome(v);
  let opcoes = null;
  if (v.saida.tipo === 'lista') {
    const o = validarOpcoes(req.body.opcoes);
    if (o.erro) v.erro('opcoes', o.erro);
    else opcoes = o.opcoes;
  }
  const d = v.verificar();
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM colunas').get().o;
  const info = db.prepare('INSERT INTO colunas (nome, tipo, opcoes, ordem) VALUES (?, ?, ?, ?)')
    .run(d.nome, d.tipo, opcoes ? JSON.stringify(opcoes) : null, ordem);
  res.status(201).json({ id: Number(info.lastInsertRowid), mensagem: `Coluna "${d.nome}" criada.` });
});

r.put('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const col = db.prepare('SELECT * FROM colunas WHERE id = ?').get(id);
  if (!col) throw naoEncontrado('Coluna');
  const v = new Validador(req.body).texto('nome', 'o nome da coluna', { obrigatorio: true, max: 40 });
  validarNome(v, id);
  let opcoes = null;
  if (col.tipo === 'lista') {
    const o = validarOpcoes(req.body.opcoes ?? JSON.parse(col.opcoes || '[]'));
    if (o.erro) v.erro('opcoes', o.erro);
    else opcoes = o.opcoes;
  }
  const d = v.verificar();
  let removidos = 0;
  transacao(() => {
    db.prepare('UPDATE colunas SET nome = ?, opcoes = ? WHERE id = ?')
      .run(d.nome, opcoes ? JSON.stringify(opcoes) : null, id);
    if (opcoes) {
      // Valores que não existem mais na lista são limpos para manter a consistência
      const marcadores = opcoes.map(() => '?').join(',');
      removidos = Number(db.prepare(`DELETE FROM valores_colunas WHERE coluna_id = ? AND valor NOT IN (${marcadores})`)
        .run(id, ...opcoes).changes);
    }
  });
  res.json({
    mensagem: removidos
      ? `Coluna atualizada. ${removidos} valor(es) com opções removidas foram apagados.`
      : 'Coluna atualizada com sucesso.',
  });
});

r.delete('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const col = db.prepare('SELECT * FROM colunas WHERE id = ?').get(id);
  if (!col) throw naoEncontrado('Coluna');
  const n = db.prepare('SELECT COUNT(*) AS n FROM valores_colunas WHERE coluna_id = ?').get(id).n;
  db.prepare('DELETE FROM colunas WHERE id = ?').run(id);
  res.json({ mensagem: `Coluna "${col.nome}" excluída${n ? ` com ${n} valor(es) preenchido(s)` : ''}.` });
});

module.exports = { router: r, listarColunas };
