import {
  el, icone, limpar, sucesso, erro, confirmar, ocupado, TIPOS_COLUNA,
} from './ui.js';
import { put, estado, recarregarColunas } from './api.js';
import { abrirGerenciadorColunas, abrirEdicaoColuna, excluirColuna } from './colunas.js';

const TELAS = [
  { entidade: 'demanda', rotulo: 'Demandas' },
  { entidade: 'cliente', rotulo: 'Clientes' },
  { entidade: 'preco', rotulo: 'Tabela de Preços' },
];

const assinatura = (lista) => JSON.stringify(lista.map((i) => [i.chave, i.visivel, i.obrigatorio]));

export function renderLayoutCampos(raiz) {
  let tela = TELAS[0].entidade;
  let original = [];
  let local = [];

  const abas = el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Telas' });
  const corpo = el('div', { class: 'layout-corpo' });
  const salvar = el('button', { type: 'button', class: 'botao botao-primario', text: 'Salvar alterações' });
  const descartar = el('button', { type: 'button', class: 'botao botao-secundario', text: 'Descartar' });
  const aviso = el('span', { class: 'aviso-alteracoes', text: 'Alterações não salvas' });

  limpar(raiz).append(
    el('header', { class: 'cabecalho-pagina' },
      el('div', {}, el('h1', { text: 'Layout | Regras Campos' }),
        el('p', { class: 'cabecalho-texto', text: 'Defina, para cada tela, quais colunas aparecem na tabela, em que ordem, e quais campos são obrigatórios.' })),
      el('div', { class: 'cabecalho-acoes' },
        el('button', { type: 'button', class: 'botao botao-secundario', onClick: () => abrirGerenciadorColunas(aoMudarColunas, tela) },
          icone('mais', 18), el('span', { text: 'Nova coluna' })))),
    abas, corpo,
    el('div', { class: 'barra-salvar' }, aviso, descartar, salvar));

  const sujo = () => assinatura(local) !== assinatura(original);

  function atualizarBarra() {
    const s = sujo();
    salvar.disabled = !s;
    descartar.disabled = !s;
    aviso.hidden = !s;
  }

  function carregarTela() {
    original = (estado.layout[tela] || []).map((i) => ({ ...i }));
    local = original.map((i) => ({ ...i }));
    render();
  }

  /** Depois de criar, renomear ou excluir uma coluna, mantém as alterações ainda não salvas. */
  async function aoMudarColunas() {
    try {
      await recarregarColunas(tela);
    } catch (e) {
      erro(e.message);
      return;
    }
    const pendentes = new Map(local.map((i, n) => [i.chave, { ...i, n }]));
    original = (estado.layout[tela] || []).map((i) => ({ ...i }));
    local = original
      .map((i, n) => {
        const p = pendentes.get(i.chave);
        return p ? { ...i, visivel: p.visivel, obrigatorio: p.obrigatorio, n: p.n } : { ...i, n: 1e6 + n };
      })
      .sort((a, b) => a.n - b.n)
      .map(({ n, ...i }) => i);
    render();
  }

  async function trocarTela(nova) {
    if (nova === tela) return;
    if (sujo() && !(await confirmar({
      titulo: 'Descartar alterações?',
      mensagem: 'As alterações desta tela ainda não foram salvas.',
      botao: 'Descartar e trocar',
    }))) return;
    tela = nova;
    carregarTela();
  }

  function mover(chave, direcao) {
    const naTabela = local.filter((i) => i.tabela);
    const pos = naTabela.findIndex((i) => i.chave === chave);
    const alvo = naTabela[pos + direcao];
    if (!alvo) return;
    const a = local.findIndex((i) => i.chave === chave);
    const b = local.findIndex((i) => i.chave === alvo.chave);
    [local[a], local[b]] = [local[b], local[a]];
    render();
    // Mantém o foco no mesmo botão para permitir mover várias posições pelo teclado
    corpo.querySelector(`[data-mover="${chave}:${direcao}"]`)?.focus();
  }

  function descricaoTipo(item) {
    if (item.origem === 'personalizado') return `Personalizado, ${TIPOS_COLUNA[item.coluna.tipo].toLowerCase()}`;
    return 'Padrão';
  }

  function caixa(item, prop, habilitada, dica) {
    const c = el('input', { type: 'checkbox', checked: item[prop], disabled: !habilitada, title: habilitada ? '' : dica });
    c.addEventListener('change', () => { item[prop] = c.checked; atualizarBarra(); });
    return el('label', { class: 'checagem checagem-celula', title: habilitada ? '' : dica },
      c, el('span', { class: 'sr', text: `${prop === 'visivel' ? 'Visível' : 'Obrigatório'}: ${item.rotulo}` }));
  }

  function acoesColuna(item) {
    if (item.origem !== 'personalizado') return el('span', { class: 'meta', text: '' });
    const col = { ...item.coluna };
    return el('div', { class: 'acoes-linha' },
      el('button', {
        type: 'button', class: 'botao-icone', title: 'Renomear', 'aria-label': `Renomear ${item.rotulo}`,
        onClick: () => abrirEdicaoColuna(col, aoMudarColunas),
      }, icone('lapis', 17)),
      el('button', {
        type: 'button', class: 'botao-icone perigo', title: 'Excluir coluna', 'aria-label': `Excluir ${item.rotulo}`,
        onClick: async () => { if (await excluirColuna(col)) aoMudarColunas(); },
      }, icone('lixeira', 17)));
  }

  function linhaTabela(item, pos, total) {
    return el('tr', {},
      el('td', { class: 'col-ordem', dataset: { rotulo: 'Ordem' } },
        el('div', { class: 'ordem-controles' },
          el('span', { class: 'ordem-numero', text: String(pos + 1) }),
          el('button', {
            type: 'button', class: 'botao-icone', disabled: pos === 0, title: 'Mover para cima',
            'aria-label': `Mover ${item.rotulo} para cima`, dataset: { mover: `${item.chave}:-1` },
            onClick: () => mover(item.chave, -1),
          }, icone('cima', 16)),
          el('button', {
            type: 'button', class: 'botao-icone', disabled: pos === total - 1, title: 'Mover para baixo',
            'aria-label': `Mover ${item.rotulo} para baixo`, dataset: { mover: `${item.chave}:1` },
            onClick: () => mover(item.chave, 1),
          }, icone('baixo', 16)))),
      el('td', { dataset: { rotulo: 'Campo' } },
        el('strong', { text: item.rotulo }), el('small', { class: 'celula-sub', text: descricaoTipo(item) })),
      el('td', { class: 'centro', dataset: { rotulo: 'Visível na tabela' } },
        caixa(item, 'visivel', item.podeOcultar, 'Esta coluna identifica o registro e fica sempre visível.')),
      el('td', { class: 'centro', dataset: { rotulo: 'Obrigatório' } },
        caixa(item, 'obrigatorio', item.podeObrigar, item.origem === 'padrao' && !item.campo
          ? 'Coluna calculada pelo sistema, não é preenchida.'
          : 'Este campo é sempre obrigatório.')),
      el('td', { class: 'col-acoes', dataset: { rotulo: 'Ações' } }, acoesColuna(item)));
  }

  function linhaFormulario(item) {
    return el('tr', {},
      el('td', { dataset: { rotulo: 'Campo' } },
        el('strong', { text: item.rotulo }), el('small', { class: 'celula-sub', text: 'Padrão, aparece só no formulário' })),
      el('td', { class: 'centro', dataset: { rotulo: 'Obrigatório' } },
        caixa(item, 'obrigatorio', item.podeObrigar, 'Este campo é sempre obrigatório.')));
  }

  function render() {
    limpar(abas).append(...TELAS.map((t) => el('button', {
      type: 'button', role: 'tab', class: `aba${t.entidade === tela ? ' ativa' : ''}`,
      'aria-selected': String(t.entidade === tela), onClick: () => trocarTela(t.entidade),
    }, t.rotulo)));

    const naTabela = local.filter((i) => i.tabela);
    const soFormulario = local.filter((i) => !i.tabela);
    limpar(corpo).append(...[
      el('section', { class: 'painel-cartao' },
        el('h2', { class: 'subtitulo-secao', text: 'Colunas da tabela' }),
        el('p', { class: 'meta', text: 'A ordem abaixo é a ordem das colunas na tabela, da esquerda para a direita. Colunas ocultas continuam nos formulários.' }),
        el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela tabela-layout' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', class: 'col-ordem', text: 'Ordem' }),
            el('th', { scope: 'col', text: 'Campo' }),
            el('th', { scope: 'col', class: 'centro', text: 'Visível na tabela' }),
            el('th', { scope: 'col', class: 'centro', text: 'Obrigatório' }),
            el('th', { scope: 'col', class: 'col-acoes' }, el('span', { class: 'sr', text: 'Ações' })))),
          el('tbody', {}, naTabela.map((item, i) => linhaTabela(item, i, naTabela.length)))))),
      soFormulario.length
        ? el('section', { class: 'painel-cartao' },
          el('h2', { class: 'subtitulo-secao', text: 'Campos só do formulário' }),
          el('p', { class: 'meta', text: 'Estes campos não têm coluna na tabela; aqui você define se são obrigatórios.' }),
          el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela tabela-layout' },
            el('thead', {}, el('tr', {},
              el('th', { scope: 'col', text: 'Campo' }),
              el('th', { scope: 'col', class: 'centro', text: 'Obrigatório' }))),
            el('tbody', {}, soFormulario.map(linhaFormulario)))))
        : null,
    ].filter(Boolean));
    atualizarBarra();
  }

  salvar.addEventListener('click', async () => {
    await ocupado(salvar, async () => {
      try {
        const r = await put(`/api/layout/${tela}`, {
          campos: local.map((i) => ({ chave: i.chave, visivel: i.visivel, obrigatorio: i.obrigatorio })),
        });
        estado.layout[tela] = r.layout;
        sucesso(r.mensagem);
        carregarTela();
      } catch (e) {
        erro(e.message);
      }
    });
    atualizarBarra(); // ocupado() reabilita o botão ao terminar
  });
  descartar.addEventListener('click', carregarTela);

  carregarTela();
}
