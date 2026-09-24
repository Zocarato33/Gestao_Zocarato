import {
  el, icone, limpar, opcoesSelect, debounce, sucesso, erro, confirmar, descreverPrazo, vazio,
  guardar, recuperar, STATUS, PRIORIDADES,
} from './ui.js';
import { get, patch, del, consulta, estado, ehAdmin } from './api.js';
import { abrirFormDemanda, controleColuna, preencherResponsaveis } from './demandaForm.js';
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
        el('p', { class: 'cabecalho-texto', text: 'Edite direto na tabela: cada alteração é salva na hora.' })),
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
    for (const c of COLUNAS_FIXAS) {
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
    for (const col of estado.colunas) {
      const th = el('th', { scope: 'col', class: 'col-extra' }, el('span', { text: col.nome }));
      if (ehAdmin()) th.append(menuColuna(col));
      tr.append(th);
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

  function linha(d) {
    const tr = el('tr', { class: `${d.vencida ? 'vencida ' : ''}${d.status === 'concluida' ? 'concluida' : ''}`, dataset: { id: d.id } });

    const titulo = el('input', { type: 'text', class: 'celula-input celula-titulo', value: d.titulo, maxlength: 200, 'aria-label': 'Título' });
    titulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') titulo.blur(); if (e.key === 'Escape') { titulo.value = d.titulo; titulo.blur(); } });
    titulo.addEventListener('change', () => {
      if (titulo.value.trim().length < 3) {
        erro('O título deve ter ao menos 3 caracteres.');
        titulo.value = d.titulo;
        return;
      }
      salvar(d, { titulo: titulo.value });
    });

    const cliente = el('select', { class: 'celula-input', 'aria-label': 'Cliente' },
      opcoesSelect(estado.clientes.map((c) => [c.id, c.nome]), d.cliente_id));
    if (!estado.clientes.some((c) => c.id === d.cliente_id)) cliente.prepend(el('option', { value: d.cliente_id, text: d.cliente_nome, selected: true }));
    const resp = el('select', { class: 'celula-input', 'aria-label': 'Responsável' });
    preencherResponsaveis(resp, d.cliente_id, d.responsavel_id);
    cliente.addEventListener('change', () => {
      const novo = Number(cliente.value);
      // Se o responsável atual não atende o novo cliente, a demanda fica sem responsável
      const mantem = d.responsavel_id && estado.responsaveis.some((r) => r.id === d.responsavel_id && (r.todos || r.clientes.includes(novo)));
      salvar(d, { cliente_id: novo, ...(mantem ? {} : { responsavel_id: null }) });
    });
    resp.addEventListener('change', () => salvar(d, { responsavel_id: resp.value || null }));

    const status = el('select', { class: `celula-input celula-status s-${d.status}`, 'aria-label': 'Status' }, opcoesSelect(STATUS, d.status));
    status.addEventListener('change', () => salvar(d, { status: status.value }));
    const prioridade = el('select', { class: `celula-input celula-prioridade p-${d.prioridade}`, 'aria-label': 'Prioridade' }, opcoesSelect(PRIORIDADES, d.prioridade));
    prioridade.addEventListener('change', () => salvar(d, { prioridade: prioridade.value }));

    const prazo = el('input', { type: 'date', class: 'celula-input', value: d.prazo || '', 'aria-label': 'Prazo' });
    prazo.addEventListener('change', () => salvar(d, { prazo: prazo.value || null }));
    const situacao = el('small', {
      class: `prazo-situacao${d.vencida ? ' vencido' : ''}`,
      text: descreverPrazo(d.prazo, dados.hoje, d.status === 'concluida'),
    });

    tr.append(
      celula('Nº', el('button', { type: 'button', class: 'link-id', text: `#${d.id}`, title: 'Abrir demanda', onClick: () => abrir(d.id) }), 'col-id'),
      celula('Título', el('div', { class: 'titulo-wrap' }, titulo, el('small', { class: 'celula-sub', text: d.cliente_nome })), 'col-titulo'),
      celula('Cliente', cliente, 'col-cliente'),
      celula('Responsável', resp, 'col-responsavel'),
      celula('Status', status, 'col-status'),
      celula('Prioridade', prioridade, 'col-prioridade'),
      celula('Prazo', el('div', { class: 'prazo-wrap' }, prazo, situacao), 'col-prazo'),
    );

    for (const col of estado.colunas) {
      const controle = controleColuna(col, d.campos[col.id], { class: 'celula-input', 'aria-label': col.nome });
      if (controle.tagName === 'INPUT' && controle.type === 'text') {
        controle.addEventListener('keydown', (e) => { if (e.key === 'Enter') controle.blur(); });
      }
      controle.addEventListener('change', () => salvar(d, { campos: { [col.id]: controle.value } }));
      tr.append(celula(col.nome, controle, 'col-extra'));
    }

    tr.append(celula('Ações', el('div', { class: 'acoes-linha' },
      el('button', { type: 'button', class: 'botao-icone', title: 'Abrir e editar todos os campos', 'aria-label': `Abrir demanda ${d.id}`, onClick: () => abrir(d.id) }, icone('abrir', 17)),
      el('button', { type: 'button', class: 'botao-icone perigo', title: 'Excluir demanda', 'aria-label': `Excluir demanda ${d.id}`, onClick: () => excluir(d) }, icone('lixeira', 17))),
    'col-acoes'));
    return tr;
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

  async function salvar(d, alteracao) {
    const tr = tabelaArea.querySelector(`tr[data-id="${d.id}"]`);
    if (tr) tr.classList.add('salvando');
    try {
      const r = await patch(`/api/demandas/${d.id}`, alteracao);
      const i = dados.demandas.findIndex((x) => x.id === d.id);
      if (i >= 0) dados.demandas[i] = r.demanda;
      const nova = linha(r.demanda);
      nova.classList.add('salvo');
      if (tr) tr.replaceWith(nova);
      sucesso('Alteração salva.');
      atualizarIndicadores();
    } catch (e) {
      erro(e.campos ? Object.values(e.campos).join(' ') : e.message);
      if (tr) tr.replaceWith(linha(d)); // desfaz a alteração na tela
    }
  }

  async function atualizarIndicadores() {
    try {
      const r = await get(`/api/demandas${consulta(filtros)}`);
      dados.indicadores = r.indicadores;
      renderIndicadores();
    } catch { /* indicadores serão atualizados no próximo carregamento */ }
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
      el('table', { class: 'tabela tabela-demandas' }, cabecalho(), tbody)));
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
