import {
  el, icone, limpar, campo, abrirModal, confirmar, sucesso, erro, ocupado, limparErros,
  tratarErroFormulario, debounce, vazio, chipStatus, chipPrioridade, descreverPrazo, dataBr, dataHoraBr, STATUS,
} from './ui.js';
import { get, post, put, del, estado, recarregarClientes, ehAdmin } from './api.js';
import { abrirFormDemanda } from './demandaForm.js';

function mascaraDocumento(v) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function mascaraTelefone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

export function abrirFormCliente(cliente, aoSalvar) {
  const m = abrirModal({
    titulo: cliente ? 'Editar cliente' : 'Novo cliente',
    subtitulo: cliente ? cliente.nome : 'Os campos com * são obrigatórios.',
  });
  const nome = el('input', { type: 'text', value: cliente?.nome || '', maxlength: 150, required: true, autocomplete: 'organization' });
  const documento = el('input', { type: 'text', inputmode: 'numeric', value: cliente?.documento || '', maxlength: 18, placeholder: '000.000.000-00 ou 00.000.000/0000-00' });
  const email = el('input', { type: 'email', value: cliente?.email || '', maxlength: 160, autocomplete: 'email' });
  const telefone = el('input', { type: 'tel', value: cliente?.telefone || '', maxlength: 15, placeholder: '(11) 99999-9999', autocomplete: 'tel' });
  const observacoes = el('textarea', { rows: 3, maxlength: 2000, text: cliente?.observacoes || '' });
  documento.addEventListener('input', () => { documento.value = mascaraDocumento(documento.value); });
  telefone.addEventListener('input', () => { telefone.value = mascaraTelefone(telefone.value); });

  const form = el('form', { class: 'formulario', novalidate: true, id: `fcli-${Date.now()}` },
    el('div', { class: 'grade grade-2' },
      campo('Nome ou razão social', nome, { nome: 'nome', obrigatorio: true, classe: 'coluna-inteira' }),
      campo('CPF ou CNPJ', documento, { nome: 'documento' }),
      campo('Telefone', telefone, { nome: 'telefone' }),
      campo('E-mail', email, { nome: 'email', classe: 'coluna-inteira' }),
      campo('Observações', observacoes, { nome: 'observacoes', classe: 'coluna-inteira' })));
  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', form: form.id, text: cliente ? 'Salvar alterações' : 'Cadastrar cliente' });
  m.corpo.append(form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() }), salvar);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    const locais = {};
    if (nome.value.trim().length < 2) locais.nome = 'Informe o nome do cliente (mínimo de 2 caracteres).';
    const digitos = documento.value.replace(/\D/g, '');
    if (digitos && digitos.length !== 11 && digitos.length !== 14) locais.documento = 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).';
    if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) locais.email = 'Informe um e-mail válido.';
    if (Object.keys(locais).length) {
      tratarErroFormulario(form, { campos: locais, message: '' });
      return;
    }
    const corpo = {
      nome: nome.value, documento: documento.value, email: email.value, telefone: telefone.value, observacoes: observacoes.value,
    };
    await ocupado(salvar, async () => {
      try {
        const r = cliente ? await put(`/api/clientes/${cliente.id}`, corpo) : await post('/api/clientes', corpo);
        sucesso(r.mensagem);
        await recarregarClientes();
        m.fechar();
        if (aoSalvar) aoSalvar(r.id || cliente.id);
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  nome.focus();
}

export async function excluirCliente(cliente, total) {
  const ok = await confirmar({
    titulo: 'Excluir cliente?',
    mensagem: `O cliente "${cliente.nome}" será excluído permanentemente.`,
    detalhe: total
      ? `As ${total} demanda(s) vinculada(s) a este cliente também serão excluídas. Esta ação não pode ser desfeita.`
      : 'Esta ação não pode ser desfeita.',
    botao: total ? 'Excluir cliente e demandas' : 'Excluir cliente',
  });
  if (!ok) return false;
  try {
    const r = await del(`/api/clientes/${cliente.id}`);
    sucesso(r.mensagem);
    await recarregarClientes();
    return true;
  } catch (e) {
    erro(e.message);
    return false;
  }
}

// ---------- Lista ----------

export function renderClientes(raiz) {
  let termo = '';
  const busca = el('input', { type: 'search', class: 'busca-input', placeholder: 'Buscar por nome, documento, e-mail ou telefone', 'aria-label': 'Buscar clientes' });
  const area = el('div', { class: 'tabela-area' });
  const contagem = el('p', { class: 'contagem' });

  limpar(raiz).append(
    el('header', { class: 'cabecalho-pagina' },
      el('div', {}, el('h1', { text: 'Clientes' }), el('p', { class: 'cabecalho-texto', text: 'Abra um cliente para ver as demandas vinculadas.' })),
      el('div', { class: 'cabecalho-acoes' },
        el('button', { type: 'button', class: 'botao botao-primario', onClick: () => abrirFormCliente(null, (id) => { location.hash = `#/clientes/${id}`; }) },
          icone('mais', 18), el('span', { text: 'Novo cliente' })))),
    el('section', { class: 'barra-filtros' }, el('div', { class: 'busca' }, icone('busca', 18), busca)),
    contagem, area);

  busca.addEventListener('input', debounce(() => { termo = busca.value.trim(); carregar(); }, 300));

  async function carregar() {
    area.classList.add('carregando');
    try {
      const lista = await get(`/api/clientes${termo ? `?busca=${encodeURIComponent(termo)}` : ''}`);
      limpar(area);
      contagem.textContent = lista.length === 1 ? '1 cliente' : `${lista.length} clientes`;
      if (!lista.length) {
        area.append(termo
          ? vazio('Nenhum cliente encontrado.', 'Tente outro termo de busca.')
          : vazio('Nenhum cliente cadastrado.', ehAdmin() ? 'Cadastre o primeiro cliente para registrar demandas.' : 'Cadastre um cliente ou peça acesso a um administrador.',
            el('button', { type: 'button', class: 'botao botao-primario', text: 'Cadastrar cliente', onClick: () => abrirFormCliente(null, carregar) })));
        return;
      }
      const tbody = el('tbody', {}, lista.map((c) => {
        const tr = el('tr', { class: 'linha-clicavel' },
          el('td', { class: 'col-nome', dataset: { rotulo: 'Cliente' } },
            el('a', { href: `#/clientes/${c.id}`, class: 'link-forte', text: c.nome }),
            c.documento ? el('small', { class: 'celula-sub', text: c.documento }) : null),
          el('td', { dataset: { rotulo: 'Contato' } },
            el('span', { text: c.email || '' }), c.telefone ? el('small', { class: 'celula-sub', text: c.telefone }) : null,
            !c.email && !c.telefone ? el('span', { class: 'meta', text: 'Sem contato' }) : null),
          el('td', { class: 'num', dataset: { rotulo: 'Demandas' }, text: String(c.total) }),
          el('td', { class: 'num', dataset: { rotulo: 'Em aberto' }, text: String(c.abertas) }),
          el('td', { class: `num${c.vencidas ? ' texto-vencido' : ''}`, dataset: { rotulo: 'Vencidas' }, text: String(c.vencidas) }),
          el('td', { class: 'col-acoes', dataset: { rotulo: 'Ações' } },
            el('div', { class: 'acoes-linha' },
              el('button', { type: 'button', class: 'botao-icone', 'aria-label': `Editar ${c.nome}`, title: 'Editar', onClick: async (e) => {
                e.stopPropagation();
                try { abrirFormCliente(await get(`/api/clientes/${c.id}`), carregar); } catch (x) { erro(x.message); }
              } }, icone('lapis', 17)),
              el('button', { type: 'button', class: 'botao-icone perigo', 'aria-label': `Excluir ${c.nome}`, title: 'Excluir', onClick: async (e) => {
                e.stopPropagation();
                if (await excluirCliente(c, c.total)) carregar();
              } }, icone('lixeira', 17)))));
        tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) location.hash = `#/clientes/${c.id}`; });
        return tr;
      }));
      area.append(el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela tabela-clientes' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: 'Cliente' }), el('th', { scope: 'col', text: 'Contato' }),
          el('th', { scope: 'col', class: 'num', text: 'Demandas' }), el('th', { scope: 'col', class: 'num', text: 'Em aberto' }),
          el('th', { scope: 'col', class: 'num', text: 'Vencidas' }), el('th', { scope: 'col', class: 'col-acoes' }, el('span', { class: 'sr', text: 'Ações' })))),
        tbody)));
    } catch (e) {
      limpar(area).append(vazio('Não foi possível carregar os clientes.', e.message));
    } finally {
      area.classList.remove('carregando');
    }
  }
  carregar();
}

// ---------- Detalhe ----------

export async function renderCliente(raiz, id) {
  limpar(raiz).append(el('p', { class: 'carregando-texto', text: 'Carregando cliente...' }));
  let c;
  try {
    c = await get(`/api/clientes/${id}`);
  } catch (e) {
    limpar(raiz).append(vazio('Cliente não encontrado.', e.status === 404 ? 'Ele pode ter sido excluído ou você não tem acesso a ele.' : e.message,
      el('a', { class: 'botao botao-secundario', href: '#/clientes', text: 'Voltar para clientes' })));
    return;
  }
  const recarregar = () => renderCliente(raiz, id);
  const { hoje } = c;

  const contagem = Object.fromEntries(Object.keys(STATUS).map((s) => [s, 0]));
  let vencidas = 0;
  for (const d of c.demandas) {
    contagem[d.status] += 1;
    if (d.vencida) vencidas += 1;
  }

  const dados = el('dl', { class: 'dados-cliente' },
    ...[['CPF/CNPJ', c.documento], ['E-mail', c.email], ['Telefone', c.telefone], ['Cadastrado em', dataHoraBr(c.criado_em)]]
      .map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v || 'Não informado' }))),
    c.observacoes ? el('div', { class: 'coluna-inteira' }, el('dt', { text: 'Observações' }), el('dd', { class: 'pre', text: c.observacoes })) : null,
    c.usuariosComAcesso ? el('div', { class: 'coluna-inteira' }, el('dt', { text: 'Usuários com acesso (além dos administradores)' }),
      el('dd', { text: c.usuariosComAcesso.length ? c.usuariosComAcesso.map((u) => u.nome).join(', ') : 'Nenhum' })) : null);

  const resumo = el('div', { class: 'resumo-status' },
    ...Object.entries(STATUS).map(([k, rotulo]) => el('div', { class: `resumo-item s-${k}` },
      el('strong', { text: String(contagem[k]) }), el('span', { text: rotulo }))),
    el('div', { class: `resumo-item r-vencidas${vencidas ? ' alerta' : ''}` }, el('strong', { text: String(vencidas) }), el('span', { text: 'Vencidas' })));

  const listaDemandas = c.demandas.length
    ? el('ul', { class: 'lista-demandas' }, c.demandas.map((d) => el('li', {},
      el('button', {
        type: 'button', class: `demanda-item${d.vencida ? ' vencida' : ''}`,
        onClick: () => abrirFormDemanda({ id: d.id, aoSalvar: recarregar }),
      },
      el('span', { class: 'demanda-item-titulo' }, el('span', { class: 'meta', text: `#${d.id}` }), ' ', d.titulo),
      el('span', { class: 'demanda-item-meta' },
        chipStatus(d.status), chipPrioridade(d.prioridade),
        el('span', { class: `prazo-situacao${d.vencida ? ' vencido' : ''}`, text: !d.prazo ? 'Sem prazo' : d.status === 'concluida' ? `Prazo ${dataBr(d.prazo)}` : `${dataBr(d.prazo)}, ${descreverPrazo(d.prazo, hoje, false).toLowerCase()}` }),
        el('span', { class: 'meta', text: d.responsavel_nome || 'Sem responsável' }))))))
    : vazio('Este cliente ainda não tem demandas.', 'Crie a primeira demanda vinculada a ele.');

  limpar(raiz).append(
    el('a', { href: '#/clientes', class: 'voltar' }, icone('voltar', 16), 'Clientes'),
    el('header', { class: 'cabecalho-pagina' },
      el('div', {}, el('h1', { text: c.nome }), el('p', { class: 'cabecalho-texto', text: `${c.demandas.length} demanda(s) vinculada(s)` })),
      el('div', { class: 'cabecalho-acoes' },
        el('button', { type: 'button', class: 'botao botao-secundario', onClick: () => abrirFormCliente(c, recarregar) }, icone('lapis', 17), el('span', { text: 'Editar' })),
        el('button', { type: 'button', class: 'botao botao-texto-perigo', onClick: async () => {
          if (await excluirCliente(c, c.demandas.length)) location.hash = '#/clientes';
        } }, icone('lixeira', 17), el('span', { text: 'Excluir' })),
        el('button', { type: 'button', class: 'botao botao-primario', onClick: () => abrirFormDemanda({ clienteId: c.id, aoSalvar: recarregar }) },
          icone('mais', 18), el('span', { text: 'Nova demanda' })))),
    el('div', { class: 'detalhe-grade' },
      el('section', { class: 'painel-cartao' }, el('h2', { class: 'subtitulo-secao', text: 'Dados do cliente' }), dados),
      el('section', { class: 'painel-cartao' },
        el('h2', { class: 'subtitulo-secao', text: 'Demandas e status' }), resumo, listaDemandas)));
  // Garante que o cliente esteja no cache usado pelos formulários
  if (!estado.clientes.some((x) => x.id === c.id)) recarregarClientes().catch(() => {});
}
