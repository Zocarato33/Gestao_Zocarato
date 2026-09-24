'use strict';

const express = require('express');
const { transacao } = require('../db');
const { exigirAdmin } = require('../auth');
const { ENTIDADES_LAYOUT, montarLayout } = require('../layout');
const { ErroHttp, ErroValidacao } = require('../validacao');

const r = express.Router();

// Todos os usuários precisam do layout para desenhar tabelas e formulários
r.get('/', async (_req, res) => {
  const listas = await Promise.all(ENTIDADES_LAYOUT.map((e) => montarLayout(e)));
  res.json(Object.fromEntries(ENTIDADES_LAYOUT.map((e, i) => [e, listas[i]])));
});

r.put('/:entidade', exigirAdmin, async (req, res) => {
  const { entidade } = req.params;
  if (!ENTIDADES_LAYOUT.includes(entidade)) throw new ErroHttp(404, 'Tela não encontrada.');
  const enviados = Array.isArray(req.body.campos) ? req.body.campos : null;
  if (!enviados) throw new ErroValidacao({ campos: 'Envie a lista de campos.' });

  const atual = await montarLayout(entidade);
  const porChave = new Map(atual.map((i) => [i.chave, i]));
  const vistos = new Set();
  const ordenados = [];
  for (const e of enviados) {
    const item = e && porChave.get(e.chave);
    if (!item) throw new ErroValidacao({ campos: 'A lista contém campos desconhecidos. Recarregue a página e tente de novo.' });
    if (vistos.has(item.chave)) throw new ErroValidacao({ campos: 'A lista contém campos repetidos.' });
    vistos.add(item.chave);
    ordenados.push({
      chave: item.chave,
      // Regras travadas mantêm o valor atual, mesmo que outro seja enviado
      visivel: item.podeOcultar ? e.visivel !== false : item.visivel,
      obrigatorio: item.podeObrigar ? e.obrigatorio === true : item.obrigatorio,
    });
  }
  // Campos que não vieram na lista (por exemplo, uma coluna criada em outra aba) vão para o final
  for (const item of atual) {
    if (!vistos.has(item.chave)) ordenados.push({ chave: item.chave, visivel: item.visivel, obrigatorio: item.obrigatorio });
  }

  await transacao(async (t) => {
    for (const [i, item] of ordenados.entries()) {
      await t.exec(`INSERT INTO layout_campos (entidade, chave, ordem, visivel, obrigatorio) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (entidade, chave) DO UPDATE SET ordem = excluded.ordem, visivel = excluded.visivel,
          obrigatorio = excluded.obrigatorio`, [entidade, item.chave, i + 1, item.visivel, item.obrigatorio]);
    }
  });
  res.json({ mensagem: 'Layout e regras salvos.', layout: await montarLayout(entidade) });
});

module.exports = r;
