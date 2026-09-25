import {
  el, icone, limpar, opcoesSelect, debounce, sucesso, erro, confirmar, descreverPrazo, vazio,
  guardar, recuperar, chipStatus, chipPrioridade, dataBr, numeroBr, STATUS, PRIORIDADES,
} from './ui.js';
import { get, del, consulta, estado, ehAdmin, colunasTabela } from './api.js';
import { abrirFormDemanda } from './demandaForm.js';
import { abrirGerenciadorColunas, abrirEdicaoColuna, excluirColuna } from './colunas.js';

const CHAVE_FILTROS = 'gd:filtros:v1';
const FILTROS_PADRAO = {
  busca: '', cliente: '', responsavel: '', status: '', prioridade: '', prazo: '', de: '', ate: '',
  ordenar: '', direcao: 'asc',
};

const COLUNAS_FIXAS = [
  { chave: 'id', rotulo: '#', ordenavel: false },
  { chave: 'titulo', rotulo: 'Título', ordenavel: true },
  { chave: 'cliente', rotulo: 'Cliente', ordenavel: true },
  { chave: 'responsavel', rotulo: 'Responsável', ordenavel: true },
  { chave: 'status', rotulo: 'Status', ordenavel: true },
  { chave: 'prioridade', rotulo: 'Prioridade', ordenavel: true },
  { chave: 'prazo', rotulo: 'Prazo', ordenavel: true },
];

export function renderPainel(raiz) {
  const filtros = { ...FILTROS_PADRAO, ...recuperar(CHAVE_FILTROS, {}) };
  let dados = { demandas: [], indicadores: {}, hoje: '' };
  let requisicao = 0;

  // ---------- Estrutura ----------
  const acoes = el('div', { class: 'cabecalho-acoes' },
    ehAdmin()
      ? el('button', { type: 'button', class: 'botao botao-secundario', onClick: () => abrirGerenciadorColunas(() => carregar()) },
        icone('colunas', 18), el('span', { text: 'Colunas' }))
      : null,
    el('button', { type: 'button', class: 'botao botao-primario', onClick: () => abrirFormDemanda({ aoSalvar: carregar }) },
      icone('mais', 18), el('span', { text: 'Nova demanda' })));

  const indicadores = el('section', { class: 'indicadores', 'aria-label': 'Indicadores' });
  const busca = el('input', {
    type: 'search', class: 'busca-input', placeholder: 'Buscar por título, descrição, cliente ou número',
    value: filtros.busca, 'aria-label': 'Buscar demandas',
  });
  const selCliente = el('select', { 'aria-label': 'Filtrar por cliente' });
  const selResp = el('select', { 'aria-label': 'Filtrar por responsável' });
  const selStatus = el('select', { 'aria-label': 'Filtrar por status' });
  const selPrioridade = el('select', { 'aria-label': 'Filtrar por prioridade' });
  const selPrazo = el('select', { 'aria-label': 'Filtrar por prazo' });
  const de = el('input', { type: 'date', 'aria-label': 'Prazo a partir de', value: filtros.de });
  const ate = el('input', { type: 'date', 'aria-label': 'Prazo até', value: filtros.ate });
  const periodo = el('div', { class: 'filtro-periodo' }, el('span', { text: 'de' }), de, el('span', { text: 'até' }), ate);
  const limparBtn = el('button', { type: 'button', class: 'botao botao-texto', text: 'Limpar filtros' });
  const contagem = el('p', { class: 'contagem' });
  const alternarFiltros = el('button', {
    type: 'button', class: 'botao botao-secundario so-celular', 'aria-expanded': 'false',
  }, icone('filtro', 18), el('span', { text: 'Filtros' }));

  const painelFiltros = el('div', { class: 'filtros', id: 'filtros' },
    rotular('Cliente', selCliente), rotular('Responsável', selResp), rotular('Status', selStatus),
    rotular('Prioridade', selPrioridade), rotular('Prazo', selPrazo), periodo, limparBtn);

  const tabelaArea = el('div', { class: 'tabela-area' });

  limpar(raiz).append(
    el('header', { class: 'cabecalho-pagina' },
      el('div', {},
        el('h1', { text: 'Demandas' }),
        el('p', { class: 'cabecalho-texto', text: 'Clique em uma demanda para abrir e editar.' })),
      acoes),
    indicadores,
    el('section', { class: 'barra-filtros', 'aria-label': 'Pesquisa e filtros' },
      el('div', { class: 'busca' }, icone('busca', 18), busca, alternarFiltros),
      painelFiltros),
    contagem,
    tabelaArea,
  );

  function rotular(texto, controle) {
    return el('label', { class: 'filtro' }, el('span', { class: 'filtro-rotulo', text: texto }), controle);
  }

  alternarFiltros.addEventListener('click', () => {
    const aberto = painelFiltros.classList.toggle('aberto');
    alternarFiltros.setAttribute('aria-expanded', String(aberto));
  });

  function preencherFiltros() {
    selCliente.replaceChildren(...opcoesSelect(estado.clientes.map((c) => [c.id, c.nome]), filtros.cliente, 'Todos os clientes'));
    selResp.replaceChildren(...opcoesSelect(
      [['nenhum', 'Sem responsável'], ...estado.responsaveis.map((r) => [r.id, r.nome])], filtros.responsavel, 'Todos'));
    selStatus.replaceChildren(...opcoesSelect([['abertas', 'Em aberto (não concluídas)'], ...Object.entries(STATUS)], filtros.status, 'Todos'));
    selPrioridade.replaceChildren(...opcoesSelect(PRIORIDADES, filtros.prioridade, 'Todas'));
    selPrazo.replaceChildren(...opcoesSelect([
      ['vencidas', 'Vencidas'], ['hoje', 'Vencem hoje'], ['semana', 'Próximos 7 dias'],
      ['sem_prazo', 'Sem prazo'], ['periodo', 'Período específico'],
    ], filtros.prazo, 'Qualquer prazo'));
    periodo.hidden = filtros.prazo !== 'periodo';
  }

  function aplicar(novos) {
    Object.assign(filtros, novos);
    guardar(CHAVE_FILTROS, filtros);
    periodo.hidden = filtros.prazo !== 'periodo';
    carregar();
  }

  busca.addEventListener('input', debounce(() => aplicar({ busca: busca.value.trim() }), 300));
  selCliente.addEventListener('change', () => aplicar({ cliente: selCliente.value }));
  selResp.addEventListener('change', () => aplicar({ responsavel: selResp.value }));
  selStatus.addEventListener('change', () => aplicar({ status: selStatus.value }));
  selPrioridade.addEventListener('change', () => aplicar({ prioridade: selPrioridade.value }));
  selPrazo.addEventListener('change', () => aplicar({ prazo: selPrazo.value }));
  de.addEventListener('change', () => aplicar({ de: de.value }));
  ate.addEventListener('change', () => aplicar({ ate: ate.value }));
  limparBtn.addEventListener('click', () => {
    Object.assign(filtros, FILTROS_PADRAO);
    busca.value = '';
    de.value = '';
    ate.value = '';
    preencherFiltros();
    aplicar({});
  });

  // ---------- Indicadores ----------
  function renderIndicadores() {
    const i = dados.indicadores;
    const cartoes = [
      { chave: 'total', rotulo: 'Demandas totais', valor: i.total, filtro: { status: '', prazo: '' }, ativo: !filtros.status && !filtros.prazo },
      { chave: 'abertas', rotulo: 'Em aberto', valor: i.abertas, filtro: { status: 'abertas', prazo: '' }, ativo: filtros.status === 'abertas' && !filtros.prazo },
      { chave: 'concluidas', rotulo: 'Concluídas', valor: i.concluidas, filtro: { status: 'concluida', prazo: '' }, ativo: filtros.status === 'concluida' && !filtros.prazo },
      { chave: 'vencidas', rotulo: 'Vencidas', valor: i.vencidas, filtro: { status: '', prazo: 'vencidas' }, ativo: filtros.prazo === 'vencidas' && !filtros.status },
    ];
    limpar(indicadores).append(...cartoes.map((c) => el('button', {
      type: 'button',
      class: `indicador ind-${c.chave}${c.ativo ? ' ativo' : ''}${c.chave === 'vencidas' && c.valor > 0 ? ' alerta' : ''}`,
      'aria-pressed': String(c.ativo),
      title: `Mostrar: ${c.rotulo.toLowerCase()}`,
      onClick: () => {
        selStatus.value = c.filtro.status;
        selPrazo.value = c.filtro.prazo;
        aplicar(c.filtro);
      },
    }, el('span', { class: 'indicador-valor', text: String(c.valor ?? 0) }), el('span', { class: 'indicador-rotulo', text: c.rotulo }))));
  }

  // ---------- Tabela ----------
  function cabecalho() {
    const tr = el('tr');
    for (const item of colunasTabela('demanda')) {
      if (item.origem === 'personalizado') {
        const col = estado.colunas.find((x) => x.id === item.coluna.id) || item.coluna;
        const th = el('th', { scope: 'col', class: 'col-extra' }, el('span', { text: col.nome }));
        if (ehAdmin()) th.append(menuColuna(col));
        tr.append(th);
        continue;
      }
      const c = COLUNAS_FIXAS.find((x) => x.chave === item.chave);
      if (!c) continue;
      if (!c.ordenavel) {
        tr.append(el('th', { scope: 'col', class: `col-${c.chave}`, text: c.rotulo }));
        continue;
      }
      const ativo = filtros.ordenar === c.chave;
      const btn = el('button', {
        type: 'button', class: `ordenar${ativo ? ' ativo' : ''}`,
        onClick: () => aplicar({
          ordenar: ativo && filtros.direcao === 'desc' ? '' : c.chave,
          direcao: ativo && filtros.direcao === 'asc' ? 'desc' : 'asc',
        }),
      }, c.rotulo, ativo ? el('span', { class: 'seta', text: filtros.direcao === 'asc' ? ' ▲' : ' ▼' }) : icone('ordenar', 14));
      tr.append(el('th', {
        scope: 'col', class: `col-${c.chave}`,
        'aria-sort': ativo ? (filtros.direcao === 'asc' ? 'ascending' : 'descending') : 'none',
      }, btn));
    }
    tr.append(el('th', { scope: 'col', class: 'col-acoes' }, el('span', { class: 'sr', text: 'Ações' })));
    return el('thead', {}, tr);
  }

  function menuColuna(col) {
    const menu = el('div', { class: 'menu', hidden: true, role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onClick: () => { fechar(); abrirEdicaoColuna(col, carregar); } },
        icone('lapis', 16), 'Renomear'),
      el('button', {
        type: 'button', role: 'menuitem', class: 'perigo',
        onClick: async () => { fechar(); if (await excluirColuna(col)) carregar(); },
      }, icone('lixeira', 16), 'Excluir coluna'));
    const gatilho = el('button', {
      type: 'button', class: 'botao-icone menu-gatilho', 'aria-label': `Opções da coluna ${col.nome}`, 'aria-haspopup': 'menu',
      onClick: (e) => {
        e.stopPropagation();
        const abrir = menu.hidden;
        document.querySelectorAll('.menu').forEach((x) => { x.hidden = true; });
        menu.hidden = !abrir;
        if (abrir) setTimeout(() => document.addEventListener('click', fechar, { once: true }));
      },
    }, icone('menu', 16));
    function fechar() { menu.hidden = true; }
    return el('span', { class: 'menu-wrap' }, gatilho, menu);
  }

  function celula(rotulo, conteudo, classe = '') {
    return el('td', { dataset: { rotulo }, class: classe }, conteudo);
  }

  /** Valor de uma coluna personalizada formatado para leitura. */
  function valorLegivel(col, valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (col.tipo === 'numero') return numeroBr(valor);
    if (col.tipo === 'data') return dataBr(valor);
    return String(valor);
  }

  // A tabela é só de visualização: as alterações são feitas ao abrir a demanda
  function linha(d) {
    const tr = el('tr', {
      class: `linha-clicavel ${d.vencida ? 'vencida ' : ''}${d.status === 'concluida' ? 'concluida' : ''}`,
      dataset: { id: d.id },
      title: 'Abrir demanda',
    });
    tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) abrir(d.id); });

    // Células padrão; a ordem e quais aparecem vêm do layout configurado
    const fixas = {
      id: () => celula('Nº', el('button', { type: 'button', class: 'link-id', text: `#${d.id}`, title: 'Abrir demanda', onClick: () => abrir(d.id) }), 'col-id'),
      titulo: () => celula('Título', el('div', { class: 'titulo-wrap' },
        el('strong', { class: 'celula-titulo-texto', text: d.titulo }), el('small', { class: 'celula-sub', text: d.cliente_nome })), 'col-titulo'),
      cliente: () => celula('Cliente', el('span', { text: d.cliente_nome }), 'col-cliente'),
      responsavel: () => celula('Responsável', d.responsavel_nome
        ? el('span', { text: d.responsavel_nome })
        : el('span', { class: 'meta', text: 'Sem responsável' }), 'col-responsavel'),
      status: () => celula('Status', chipStatus(d.status), 'col-status'),
      prioridade: () => celula('Prioridade', chipPrioridade(d.prioridade), 'col-prioridade'),
      prazo: () => celula('Prazo', el('div', { class: 'prazo-wrap' },
        d.prazo ? el('span', { text: dataBr(d.prazo) }) : null,
        el('small', { class: `prazo-situacao${d.vencida ? ' vencido' : ''}`, text: descreverPrazo(d.prazo, dados.hoje, d.status === 'concluida') })), 'col-prazo'),
    };

    for (const item of colunasTabela('demanda')) {
      if (item.origem !== 'personalizado') {
        if (fixas[item.chave]) tr.append(fixas[item.chave]());
        continue;
      }
      const col = estado.colunas.find((x) => x.id === item.coluna.id) || item.coluna;
      tr.append(celula(col.nome, el('span', { text: valorLegivel(col, d.campos[col.id]) }), `col-extra${col.tipo === 'numero' ? ' num' : ''}`));
    }

    tr.append(celula('Ações', el('div', { class: 'acoes-linha' },
      el('button', { type: 'button', class: 'botao-icone', title: 'Abrir e editar', 'aria-label': `Abrir demanda ${d.id}`, onClick: () => abrir(d.id) }, icone('abrir', 17)),
      el('button', { type: 'button', class: 'botao-icone perigo', title: 'Excluir demanda', 'aria-label': `Excluir demanda ${d.id}`, onClick: () => excluir(d) }, icone('lixeira', 17))),
    'col-acoes'));
    return tr;
  }

  /** Número e título só ficam fixos na rolagem lateral quando são as duas primeiras colunas. */
  function fixarInicio() {
    const [a, b] = colunasTabela('demanda').map((i) => i.chave);
    return a === 'id' && b === 'titulo';
  }

  function abrir(id) {
    abrirFormDemanda({ id, aoSalvar: carregar });
  }

  async function excluir(d) {
    const ok = await confirmar({
      titulo: 'Excluir demanda?',
      mensagem: `A demanda #${d.id} "${d.titulo}" será excluída permanentemente.`,
      detalhe: 'Esta ação não pode ser desfeita.',
    });
    if (!ok) return;
    try {
      const r = await del(`/api/demandas/${d.id}`);
      sucesso(r.mensagem);
      carregar();
    } catch (e) {
      erro(e.message);
    }
  }

  function renderTabela() {
    limpar(tabelaArea);
    const n = dados.demandas.length;
    contagem.textContent = n === 1 ? '1 demanda encontrada' : `${n} demandas encontradas`;
    if (!n) {
      const filtrando = Object.entries(filtros).some(([k, v]) => !['ordenar', 'direcao'].includes(k) && v);
      tabelaArea.append(filtrando
        ? vazio('Nenhuma demanda com esses filtros.', 'Ajuste a pesquisa ou limpe os filtros para ver todas.',
          el('button', { type: 'button', class: 'botao botao-secundario', text: 'Limpar filtros', onClick: () => limparBtn.click() }))
        : vazio('Nenhuma demanda cadastrada.',
          estado.clientes.length ? 'Registre a primeira demanda para começar o acompanhamento.' : 'Comece cadastrando um cliente no menu Clientes.',
          estado.clientes.length
            ? el('button', { type: 'button', class: 'botao botao-primario', text: 'Criar demanda', onClick: () => abrirFormDemanda({ aoSalvar: carregar }) })
            : el('a', { class: 'botao botao-primario', href: '#/clientes', text: 'Ir para clientes' })));
      return;
    }
    const tbody = el('tbody', {}, dados.demandas.map(linha));
    tabelaArea.append(el('div', { class: 'tabela-rolagem' },
      el('table', { class: `tabela tabela-demandas${fixarInicio() ? ' fixar-inicio' : ''}` }, cabecalho(), tbody)));
  }

  async function carregar() {
    const minha = ++requisicao;
    tabelaArea.classList.add('carregando');
    try {
      const r = await get(`/api/demandas${consulta(filtros)}`);
      if (minha !== requisicao) return; // resposta antiga descartada
      dados = r;
      renderIndicadores();
      renderTabela();
    } catch (e) {
      if (minha !== requisicao) return;
      limpar(tabelaArea).append(vazio('Não foi possível carregar as demandas.', e.message,
        el('button', { type: 'button', class: 'botao botao-secundario', text: 'Tentar novamente', onClick: carregar })));
    } finally {
      if (minha === requisicao) tabelaArea.classList.remove('carregando');
    }
  }

  preencherFiltros();
  carregar();
}
