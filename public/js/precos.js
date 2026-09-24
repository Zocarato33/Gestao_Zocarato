import {
  el, icone, limpar, campo, abrirModal, confirmar, sucesso, erro, ocupado, limparErros, tratarErroFormulario,
  debounce, vazio, dataBr, numeroBr, moedaBr, diasAte, opcoesSelect,
} from './ui.js';
import {
  get, post, put, del, estado, consulta, colunasTabela, obrigatorio, colunasOrdenadas,
} from './api.js';
import { controleColuna } from './demandaForm.js';
import { abrirGerenciadorColunas } from './colunas.js';

// Títulos curtos das colunas padrão na tabela
const CABECALHOS = {
  cliente: { rotulo: 'Cliente' },
  numero_contrato: { rotulo: 'Nº do contrato' },
  valor_ticket: { rotulo: 'Valor do ticket', num: true },
  inicio_contrato: { rotulo: 'Início' },
  vencimento_contrato: { rotulo: 'Vencimento' },
  atendimento: { rotulo: 'Atendimento aplicado' },
};

/** Valor de uma coluna personalizada formatado para leitura. */
function valorLegivel(col, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (col.tipo === 'numero') return numeroBr(valor);
  if (col.tipo === 'data') return dataBr(valor);
  return String(valor);
}

/** Converte o número salvo para o formato digitado no campo: 1500.5 vira "1.500,50". */
function valorParaCampo(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Situação do contrato conforme o vencimento. */
function situacaoContrato(vencimento, hoje) {
  if (!vencimento || !hoje) return null;
  const dias = diasAte(vencimento, hoje);
  if (dias < 0) return { texto: `Vencido há ${-dias} dia${dias === -1 ? '' : 's'}`, classe: 'vencido' };
  if (dias === 0) return { texto: 'Vence hoje', classe: 'vencido' };
  if (dias <= 30) return { texto: `Vence em ${dias} dia${dias === 1 ? '' : 's'}`, classe: 'atencao' };
  return { texto: 'Vigente', classe: '' };
}

export function abrirFormPreco(preco, aoSalvar, sugestoesAtendimento = []) {
  const m = abrirModal({
    titulo: preco ? 'Editar registro' : 'Novo registro na tabela de preços',
    subtitulo: preco ? preco.cliente_nome : 'Os campos com * são obrigatórios.',
  });
  const cliente = el('select', { required: true },
    opcoesSelect(estado.clientes.map((c) => [c.id, c.nome]), preco?.cliente_id || '', 'Selecione o cliente'));
  const numero = el('input', { type: 'text', value: preco?.numero_contrato || '', maxlength: 60, autocomplete: 'off' });
  const valor = el('input', { type: 'text', inputmode: 'decimal', value: valorParaCampo(preco?.valor_ticket), maxlength: 20, placeholder: '0,00' });
  valor.addEventListener('blur', () => {
    const t = valor.value.replace(/R\$|\s/g, '');
    if (!t) return;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    if (Number.isFinite(n)) valor.value = valorParaCampo(n);
  });
  const inicio = el('input', { type: 'date', value: preco?.inicio_contrato || '' });
  const vencimento = el('input', { type: 'date', value: preco?.vencimento_contrato || '' });
  const idLista = `atend-${Date.now()}`;
  const atendimento = el('input', { type: 'text', value: preco?.atendimento || '', maxlength: 200, list: idLista, autocomplete: 'off' });
  const listaAtendimentos = el('datalist', { id: idLista }, sugestoesAtendimento.map((s) => el('option', { value: s })));

  // Campos adicionais (colunas personalizadas da tabela de preços)
  let extras = [];
  const grupoExtra = el('fieldset', { class: 'grupo-extra' });
  function renderExtras() {
    const digitados = new Map(extras.map(({ col, controle }) => [col.id, controle.value]));
    const valores = preco?.campos || {};
    extras = colunasOrdenadas('preco').map((col) => ({
      col,
      controle: controleColuna(col, digitados.has(col.id) ? digitados.get(col.id) : valores[col.id]),
    }));
    limpar(grupoExtra).append(...[
      el('legend', { text: 'Campos adicionais' }),
      extras.length
        ? el('div', { class: 'grade grade-2' },
          extras.map(({ col, controle }) => campo(col.nome, controle, {
            nome: `campo_${col.id}`, obrigatorio: obrigatorio('preco', `extra_${col.id}`),
          })))
        : el('p', { class: 'meta', text: 'Nenhum campo adicional ainda. Crie colunas para registrar outras informações dos contratos.' }),
      el('div', { class: 'acoes-extra' },
        el('button', {
          type: 'button', class: 'botao botao-secundario botao-pequeno',
          onClick: () => abrirGerenciadorColunas(renderExtras, 'preco'),
        }, icone('colunas', 16), extras.length ? 'Gerenciar colunas' : 'Nova coluna')),
    ]);
  }
  renderExtras();

  const obrig = (chave) => obrigatorio('preco', chave);
  const form = el('form', { class: 'formulario', novalidate: true, id: `fpreco-${Date.now()}` },
    el('div', { class: 'grade grade-2' },
      campo('Cliente', cliente, { nome: 'cliente_id', obrigatorio: true, classe: 'coluna-inteira' }),
      campo('Nº do contrato', numero, { nome: 'numero_contrato', obrigatorio: obrig('numero_contrato') }),
      campo('Valor do ticket (R$)', valor, { nome: 'valor_ticket', obrigatorio: obrig('valor_ticket') }),
      campo('Início do contrato', inicio, { nome: 'inicio_contrato', obrigatorio: obrig('inicio_contrato') }),
      campo('Vencimento do contrato', vencimento, { nome: 'vencimento_contrato', obrigatorio: obrig('vencimento_contrato') }),
      campo('Atendimento aplicado', atendimento, {
        nome: 'atendimento', classe: 'coluna-inteira', obrigatorio: obrig('atendimento'),
        ajuda: 'Por exemplo: consultivo, contencioso, gestão de contratos.',
      }),
      listaAtendimentos),
    grupoExtra);
  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', form: form.id, text: preco ? 'Salvar alterações' : 'Incluir registro' });
  m.corpo.append(form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() }), salvar);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    if (!cliente.value) {
      tratarErroFormulario(form, { campos: { cliente_id: 'Selecione o cliente.' }, message: '' });
      return;
    }
    if (inicio.value && vencimento.value && vencimento.value < inicio.value) {
      tratarErroFormulario(form, { campos: { vencimento_contrato: 'O vencimento não pode ser anterior ao início do contrato.' }, message: '' });
      return;
    }
    const corpo = {
      cliente_id: Number(cliente.value),
      numero_contrato: numero.value,
      valor_ticket: valor.value,
      inicio_contrato: inicio.value,
      vencimento_contrato: vencimento.value,
      atendimento: atendimento.value,
      campos: Object.fromEntries(extras.map(({ col, controle }) => [col.id, controle.value])),
    };
    await ocupado(salvar, async () => {
      try {
        const r = preco ? await put(`/api/precos/${preco.id}`, corpo) : await post('/api/precos', corpo);
        sucesso(r.mensagem);
        m.fechar();
        if (aoSalvar) aoSalvar();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  (preco ? numero : cliente).focus();
}

async function excluirPreco(p) {
  const ok = await confirmar({
    titulo: 'Excluir registro?',
    mensagem: `O registro${p.numero_contrato ? ` do contrato ${p.numero_contrato}` : ''} de "${p.cliente_nome}" será excluído da tabela de preços.`,
    detalhe: 'Esta ação não pode ser desfeita.',
  });
  if (!ok) return false;
  try {
    const r = await del(`/api/precos/${p.id}`);
    sucesso(r.mensagem);
    return true;
  } catch (e) {
    erro(e.message);
    return false;
  }
}

export function renderPrecos(raiz) {
  const filtros = { busca: '', cliente: '' };
  let dados = { hoje: '', precos: [] };
  const busca = el('input', { type: 'search', class: 'busca-input', placeholder: 'Buscar por cliente, nº do contrato, atendimento ou campos adicionais', 'aria-label': 'Buscar na tabela de preços' });
  const selCliente = el('select', { 'aria-label': 'Filtrar por cliente' },
    opcoesSelect(estado.clientes.map((c) => [c.id, c.nome]), '', 'Todos os clientes'));
  const area = el('div', { class: 'tabela-area' });
  const contagem = el('p', { class: 'contagem' });

  const sugestoes = () => [...new Set(dados.precos.map((p) => p.atendimento).filter(Boolean))].sort();
  const novo = () => abrirFormPreco(null, carregar, sugestoes());

  limpar(raiz).append(
    el('header', { class: 'cabecalho-pagina' },
      el('div', {}, el('h1', { text: 'Tabela de Preços' }),
        el('p', { class: 'cabecalho-texto', text: 'Valores de ticket e vigência dos contratos de cada cliente.' })),
      el('div', { class: 'cabecalho-acoes' },
        el('button', { type: 'button', class: 'botao botao-secundario', onClick: () => abrirGerenciadorColunas(() => carregar(), 'preco') },
          icone('colunas', 18), el('span', { text: 'Colunas' })),
        el('button', { type: 'button', class: 'botao botao-primario', onClick: novo }, icone('mais', 18), el('span', { text: 'Novo registro' })))),
    el('section', { class: 'barra-filtros' },
      el('div', { class: 'busca' }, icone('busca', 18), busca),
      el('div', { class: 'filtros filtros-fixos' }, el('label', { class: 'filtro' }, el('span', { class: 'filtro-rotulo', text: 'Cliente' }), selCliente))),
    contagem, area);

  busca.addEventListener('input', debounce(() => { filtros.busca = busca.value.trim(); carregar(); }, 300));
  selCliente.addEventListener('change', () => { filtros.cliente = selCliente.value; carregar(); });

  function celulaPadrao(chave, p) {
    switch (chave) {
      case 'cliente':
        return el('td', { class: 'col-nome', dataset: { rotulo: 'Cliente' } },
          el('a', { href: `#/clientes/${p.cliente_id}`, class: 'link-forte', text: p.cliente_nome }));
      case 'numero_contrato':
        return el('td', { dataset: { rotulo: 'Nº do contrato' }, text: p.numero_contrato || '' });
      case 'valor_ticket':
        return el('td', { class: 'num', dataset: { rotulo: 'Valor do ticket' }, text: moedaBr(p.valor_ticket) });
      case 'inicio_contrato':
        return el('td', { dataset: { rotulo: 'Início' }, text: dataBr(p.inicio_contrato) });
      case 'vencimento_contrato': {
        const s = situacaoContrato(p.vencimento_contrato, dados.hoje);
        return el('td', { dataset: { rotulo: 'Vencimento' } },
          el('span', { text: dataBr(p.vencimento_contrato) }),
          s ? el('small', { class: `prazo-situacao ${s.classe}`, text: s.texto }) : null);
      }
      case 'atendimento':
        return el('td', { dataset: { rotulo: 'Atendimento aplicado' }, text: p.atendimento || '' });
      default:
        return null;
    }
  }

  function renderTabela() {
    limpar(area);
    const n = dados.precos.length;
    const total = dados.precos.reduce((s, p) => s + (Number(p.valor_ticket) || 0), 0);
    contagem.textContent = n ? `${n} registro${n === 1 ? '' : 's'}, soma dos tickets: ${moedaBr(total)}` : '';
    if (!n) {
      const filtrando = filtros.busca || filtros.cliente;
      area.append(filtrando
        ? vazio('Nenhum registro encontrado.', 'Ajuste a busca ou o filtro de cliente.')
        : vazio('A tabela de preços está vazia.',
          estado.clientes.length ? 'Inclua o primeiro contrato com o valor do ticket e a vigência.' : 'Cadastre um cliente antes de incluir preços.',
          estado.clientes.length
            ? el('button', { type: 'button', class: 'botao botao-primario', text: 'Novo registro', onClick: novo })
            : el('a', { class: 'botao botao-primario', href: '#/clientes', text: 'Ir para clientes' })));
      return;
    }
    const cols = colunasTabela('preco').map((item) => (item.origem === 'personalizado'
      ? { chave: item.chave, rotulo: item.rotulo, col: estado.colunasPrecos.find((x) => x.id === item.coluna.id) || item.coluna }
      : { chave: item.chave, ...(CABECALHOS[item.chave] || { rotulo: item.rotulo }) }));
    const tbody = el('tbody', {}, dados.precos.map((p) => {
      const s = situacaoContrato(p.vencimento_contrato, dados.hoje);
      return el('tr', { class: s && s.classe === 'vencido' ? 'vencida' : '' },
        cols.map((k) => (k.col
          ? el('td', { class: `col-extra${k.col.tipo === 'numero' ? ' num' : ''}`, dataset: { rotulo: k.rotulo }, text: valorLegivel(k.col, p.campos?.[k.col.id]) })
          : celulaPadrao(k.chave, p))),
        el('td', { class: 'col-acoes', dataset: { rotulo: 'Ações' } },
          el('div', { class: 'acoes-linha' },
            el('button', { type: 'button', class: 'botao-icone', 'aria-label': `Editar registro de ${p.cliente_nome}`, title: 'Editar',
              onClick: () => abrirFormPreco(p, carregar, sugestoes()) }, icone('lapis', 17)),
            el('button', { type: 'button', class: 'botao-icone perigo', 'aria-label': `Excluir registro de ${p.cliente_nome}`, title: 'Excluir',
              onClick: async () => { if (await excluirPreco(p)) carregar(); } }, icone('lixeira', 17)))));
    }));
    area.append(el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela tabela-precos' },
      el('thead', {}, el('tr', {},
        cols.map((k) => el('th', { scope: 'col', class: k.col ? `col-extra${k.col.tipo === 'numero' ? ' num' : ''}` : (k.num ? 'num' : ''), text: k.rotulo })),
        el('th', { scope: 'col', class: 'col-acoes' }, el('span', { class: 'sr', text: 'Ações' })))),
      tbody)));
  }

  async function carregar() {
    area.classList.add('carregando');
    try {
      dados = await get(`/api/precos${consulta(filtros)}`);
      renderTabela();
    } catch (e) {
      limpar(area).append(vazio('Não foi possível carregar a tabela de preços.', e.message));
    } finally {
      area.classList.remove('carregando');
    }
  }
  carregar();
}
