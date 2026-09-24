'use strict';

const { db } = require('./db');
const { listarColunas } = require('./rotas/colunas');

/**
 * Campos padrão de cada tela.
 * - campo: nome do dado no corpo da requisição (para a regra de obrigatório)
 * - tabela: false quando o campo só aparece no formulário (não tem coluna na tabela)
 * - calculado: coluna só de exibição, sem regra de obrigatório
 * - sempreObrigatorio / sempreVisivel: regras que não podem ser desligadas
 * - obrigatorioPadrao: valor inicial da regra de obrigatório
 */
const CAMPOS_PADRAO = {
  demanda: [
    { chave: 'id', rotulo: 'Número (#)', calculado: true },
    { chave: 'titulo', rotulo: 'Título', campo: 'titulo', sempreObrigatorio: true, sempreVisivel: true },
    { chave: 'cliente', rotulo: 'Cliente', campo: 'cliente_id', sempreObrigatorio: true },
    { chave: 'responsavel', rotulo: 'Responsável', campo: 'responsavel_id' },
    { chave: 'status', rotulo: 'Status', campo: 'status', sempreObrigatorio: true },
    { chave: 'prioridade', rotulo: 'Prioridade', campo: 'prioridade', sempreObrigatorio: true },
    { chave: 'prazo', rotulo: 'Prazo', campo: 'prazo' },
    { chave: 'descricao', rotulo: 'Descrição', campo: 'descricao', tabela: false },
    { chave: 'observacoes', rotulo: 'Observações', campo: 'observacoes', tabela: false },
  ],
  cliente: [
    { chave: 'nome', rotulo: 'Cliente (nome ou razão social)', campo: 'nome', sempreObrigatorio: true, sempreVisivel: true },
    { chave: 'contato', rotulo: 'Contato (e-mail e telefone)', calculado: true },
    { chave: 'total', rotulo: 'Demandas', calculado: true },
    { chave: 'abertas', rotulo: 'Em aberto', calculado: true },
    { chave: 'vencidas', rotulo: 'Vencidas', calculado: true },
    { chave: 'documento', rotulo: 'CPF ou CNPJ', campo: 'documento', tabela: false },
    { chave: 'email', rotulo: 'E-mail', campo: 'email', tabela: false },
    { chave: 'telefone', rotulo: 'Telefone', campo: 'telefone', tabela: false },
    { chave: 'observacoes', rotulo: 'Observações', campo: 'observacoes', tabela: false },
  ],
  preco: [
    { chave: 'cliente', rotulo: 'Cliente', campo: 'cliente_id', sempreObrigatorio: true, sempreVisivel: true },
    { chave: 'numero_contrato', rotulo: 'Nº do contrato', campo: 'numero_contrato' },
    { chave: 'valor_ticket', rotulo: 'Valor do ticket', campo: 'valor_ticket', obrigatorioPadrao: true },
    { chave: 'inicio_contrato', rotulo: 'Início do contrato', campo: 'inicio_contrato' },
    { chave: 'vencimento_contrato', rotulo: 'Vencimento do contrato', campo: 'vencimento_contrato' },
    { chave: 'atendimento', rotulo: 'Atendimento aplicado', campo: 'atendimento' },
  ],
};

const ENTIDADES_LAYOUT = Object.keys(CAMPOS_PADRAO);

/**
 * Lista completa dos campos de uma tela, na ordem configurada: campos padrão e colunas
 * personalizadas, com visibilidade, obrigatoriedade e o que pode ou não ser alterado.
 */
async function montarLayout(entidade) {
  const [colunas, salvos] = await Promise.all([
    listarColunas(entidade),
    db.all('SELECT chave, ordem, visivel, obrigatorio FROM layout_campos WHERE entidade = ?', [entidade]),
  ]);
  const config = new Map(salvos.map((s) => [s.chave, s]));

  const itens = [
    ...CAMPOS_PADRAO[entidade].map((d) => ({
      chave: d.chave,
      rotulo: d.rotulo,
      origem: 'padrao',
      campo: d.campo || null,
      tabela: d.tabela !== false,
      podeOcultar: d.tabela !== false && !d.sempreVisivel,
      podeObrigar: !d.calculado && !d.sempreObrigatorio,
      visivel: true,
      obrigatorio: Boolean(d.sempreObrigatorio || d.obrigatorioPadrao),
    })),
    ...colunas.map((c) => ({
      chave: `extra_${c.id}`,
      rotulo: c.nome,
      origem: 'personalizado',
      campo: null,
      coluna: { id: c.id, tipo: c.tipo, opcoes: c.opcoes, preenchidos: c.preenchidos, entidade: c.entidade, nome: c.nome },
      tabela: true,
      podeOcultar: true,
      podeObrigar: true,
      visivel: true,
      obrigatorio: false,
    })),
  ];

  itens.forEach((item, i) => {
    const s = config.get(item.chave);
    item.posicaoPadrao = i;
    item.ordemSalva = s ? s.ordem : null;
    if (!s) return;
    if (item.podeOcultar) item.visivel = s.visivel;
    if (item.podeObrigar) item.obrigatorio = s.obrigatorio;
  });

  // Itens sem configuração salva (campos novos) entram depois dos já ordenados, na posição padrão
  itens.sort((a, b) => {
    const oa = a.ordemSalva ?? 100000 + a.posicaoPadrao;
    const ob = b.ordemSalva ?? 100000 + b.posicaoPadrao;
    return oa - ob;
  });
  return itens.map(({ posicaoPadrao, ordemSalva, ...item }) => item);
}

const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Aplica as regras de campo obrigatório configuradas no layout.
 * @param {Validador} v validador já preenchido com os campos padrão
 * @param {Array} layout resultado de montarLayout
 * @param {object} campos valores das colunas personalizadas já validados ({ [colunaId]: valor })
 * @param {'criar'|'atualizar'|'parcial'} modo em 'parcial' só os campos enviados são conferidos;
 *   nas colunas personalizadas, fora da criação, só as enviadas são conferidas
 * @param {Set<string>} enviados nomes dos campos padrão enviados (modo parcial)
 */
function aplicarObrigatorios(v, layout, campos, modo = 'criar', enviados = new Set()) {
  for (const item of layout) {
    if (!item.obrigatorio || !item.podeObrigar) continue;
    if (item.origem === 'personalizado') {
      const id = item.coluna.id;
      const enviado = Object.prototype.hasOwnProperty.call(campos, id);
      if (modo !== 'criar' && !enviado) continue;
      if (vazio(campos[id]) && !v.erros[`campo_${id}`]) v.erro(`campo_${id}`, `${item.rotulo}: preenchimento obrigatório.`);
    } else if (item.campo) {
      if (modo === 'parcial' && !enviados.has(item.campo)) continue;
      if (vazio(v.saida[item.campo]) && !v.erros[item.campo]) v.erro(item.campo, `Informe ${item.rotulo.toLowerCase()}.`);
    }
  }
}

module.exports = { CAMPOS_PADRAO, ENTIDADES_LAYOUT, montarLayout, aplicarObrigatorios };
