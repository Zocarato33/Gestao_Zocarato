import {
  el, campo, opcoesSelect, abrirModal, confirmar, sucesso, erro, ocupado, limparErros,
  tratarErroFormulario, dataHoraBr, STATUS, PRIORIDADES,
} from './ui.js';
import {
  get, post, put, del, estado, responsaveisDoCliente, obrigatorio, colunasOrdenadas,
} from './api.js';

/** Converte o valor salvo para exibição no controle. */
export function valorParaControle(coluna, valor) {
  if (valor === null || valor === undefined) return '';
  if (coluna.tipo === 'numero') return String(valor).replace('.', ',');
  return String(valor);
}

/** Cria o controle adequado ao tipo da coluna personalizada. */
export function controleColuna(coluna, valor, atributos = {}) {
  const v = valorParaControle(coluna, valor);
  switch (coluna.tipo) {
    case 'numero':
      return el('input', { type: 'text', inputmode: 'decimal', value: v, maxlength: 20, placeholder: '0,00', ...atributos });
    case 'data':
      return el('input', { type: 'date', value: v, ...atributos });
    case 'lista': {
      const opcoes = coluna.opcoes.map((o) => [o, o]);
      // Mantém visível um valor legado que não esteja mais na lista
      if (v && !coluna.opcoes.includes(v)) opcoes.push([v, `${v} (removida)`]);
      return el('select', atributos, opcoesSelect(opcoes, v, 'Selecione'));
    }
    default:
      return el('input', { type: 'text', value: v, maxlength: 1000, ...atributos });
  }
}

export function preencherResponsaveis(select, clienteId, selecionado) {
  const lista = responsaveisDoCliente(clienteId).map((r) => [r.id, r.nome]);
  // Mantém o responsável atual visível mesmo que tenha perdido o acesso
  if (selecionado && !lista.some(([id]) => String(id) === String(selecionado))) {
    const r = estado.responsaveis.find((x) => String(x.id) === String(selecionado));
    lista.push([selecionado, `${r ? r.nome : 'Usuário'} (sem acesso)`]);
  }
  select.replaceChildren(...opcoesSelect(lista, selecionado, 'Sem responsável'));
}

/**
 * Abre o formulário de demanda.
 * @param {object} opcoes { id?: number, clienteId?: number, aoSalvar?: fn }
 */
export async function abrirFormDemanda({ id, clienteId, aoSalvar } = {}) {
  let demanda = null;
  if (id) {
    try {
      demanda = await get(`/api/demandas/${id}`);
    } catch (e) {
      erro(e.message);
      return;
    }
  }
  if (!estado.clientes.length) {
    erro('Cadastre um cliente antes de criar demandas.');
    return;
  }

  const d = demanda || {
    titulo: '', descricao: '', cliente_id: clienteId || (estado.clientes.length === 1 ? estado.clientes[0].id : ''),
    responsavel_id: estado.usuario.id, status: 'pendente', prioridade: 'normal', prazo: '', observacoes: '', campos: {},
  };

  let alterado = false;
  const m = abrirModal({
    titulo: demanda ? `Demanda #${demanda.id}` : 'Nova demanda',
    subtitulo: demanda ? demanda.cliente_nome : 'Preencha os dados e salve para registrar.',
    largura: 'grande',
    onFechar: () => { if (alterado && aoSalvar) aoSalvar(); },
  });

  const titulo = el('input', { type: 'text', value: d.titulo, maxlength: 200, required: true, autocomplete: 'off' });
  const cliente = el('select', { required: true },
    opcoesSelect(estado.clientes.map((c) => [c.id, c.nome]), d.cliente_id, 'Selecione o cliente'));
  const responsavel = el('select');
  preencherResponsaveis(responsavel, d.cliente_id, d.responsavel_id);
  cliente.addEventListener('change', () => preencherResponsaveis(responsavel, cliente.value, responsavel.value));
  const status = el('select', {}, opcoesSelect(STATUS, d.status));
  const prioridade = el('select', {}, opcoesSelect(PRIORIDADES, d.prioridade));
  const prazo = el('input', { type: 'date', value: d.prazo || '' });
  const descricao = el('textarea', { rows: 4, maxlength: 5000, text: d.descricao || '' });
  const observacoes = el('textarea', { rows: 3, maxlength: 5000, text: d.observacoes || '' });

  const controlesExtras = colunasOrdenadas('demanda').map((col) => ({
    col,
    controle: controleColuna(col, d.campos[col.id]),
  }));

  const form = el('form', { class: 'formulario', novalidate: true },
    el('div', { class: 'grade grade-2' },
      campo('Título', titulo, { nome: 'titulo', obrigatorio: true, classe: 'coluna-inteira' }),
      campo('Cliente', cliente, { nome: 'cliente_id', obrigatorio: true }),
      campo('Responsável', responsavel, {
        nome: 'responsavel_id', ajuda: 'Somente pessoas com acesso ao cliente.', obrigatorio: obrigatorio('demanda', 'responsavel'),
      }),
      campo('Status', status, { nome: 'status', obrigatorio: true }),
      campo('Prioridade', prioridade, { nome: 'prioridade', obrigatorio: true }),
      campo('Prazo', prazo, { nome: 'prazo', obrigatorio: obrigatorio('demanda', 'prazo') }),
      campo('Descrição', descricao, { nome: 'descricao', classe: 'coluna-inteira', obrigatorio: obrigatorio('demanda', 'descricao') }),
      campo('Observações', observacoes, { nome: 'observacoes', classe: 'coluna-inteira', obrigatorio: obrigatorio('demanda', 'observacoes') })),
    controlesExtras.length
      ? el('fieldset', { class: 'grupo-extra' },
        el('legend', { text: 'Campos adicionais' }),
        el('div', { class: 'grade grade-2' },
          controlesExtras.map(({ col, controle }) => campo(col.nome, controle, {
            nome: `campo_${col.id}`, obrigatorio: obrigatorio('demanda', `extra_${col.id}`),
          }))))
      : null,
    demanda
      ? el('p', { class: 'meta' },
        `Criada em ${dataHoraBr(demanda.criado_em)}${demanda.criado_por_nome ? ` por ${demanda.criado_por_nome}` : ''}. `,
        `Última alteração em ${dataHoraBr(demanda.atualizado_em)}.`)
      : null);
  m.corpo.append(form);

  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', text: demanda ? 'Salvar alterações' : 'Criar demanda' });
  salvar.setAttribute('form', form.id = `f-${Date.now()}`);
  const cancelar = el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() });
  const excluir = demanda
    ? el('button', {
      type: 'button',
      class: 'botao botao-texto-perigo empurrar-esquerda',
      text: 'Excluir demanda',
      onClick: async () => {
        const ok = await confirmar({
          titulo: 'Excluir demanda?',
          mensagem: `A demanda "${demanda.titulo}" será excluída permanentemente.`,
          detalhe: 'Esta ação não pode ser desfeita.',
        });
        if (!ok) return;
        try {
          const r = await del(`/api/demandas/${demanda.id}`);
          sucesso(r.mensagem);
          alterado = true;
          m.fechar();
        } catch (e) {
          erro(e.message);
        }
      },
    })
    : null;
  m.rodape.append(excluir, cancelar, salvar);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    // Validação no navegador antes de enviar
    const errosLocais = {};
    if (titulo.value.trim().length < 3) errosLocais.titulo = 'Informe um título com ao menos 3 caracteres.';
    if (!cliente.value) errosLocais.cliente_id = 'Selecione o cliente.';
    if (prazo.value && !/^\d{4}-\d{2}-\d{2}$/.test(prazo.value)) errosLocais.prazo = 'Informe uma data válida.';
    for (const { col, controle } of controlesExtras) {
      const v = controle.value.trim();
      if (col.tipo === 'numero' && v && !/^-?\d+([.,]\d+)?$/.test(v.replace(/\s/g, ''))) {
        errosLocais[`campo_${col.id}`] = `${col.nome}: informe um número válido (ex.: 1500,50).`;
      }
    }
    if (Object.keys(errosLocais).length) {
      tratarErroFormulario(form, { campos: errosLocais, message: 'Revise os campos destacados.' });
      return;
    }
    const corpo = {
      titulo: titulo.value,
      cliente_id: cliente.value,
      responsavel_id: responsavel.value,
      status: status.value,
      prioridade: prioridade.value,
      prazo: prazo.value,
      descricao: descricao.value,
      observacoes: observacoes.value,
      campos: Object.fromEntries(controlesExtras.map(({ col, controle }) => [col.id, controle.value])),
    };
    await ocupado(salvar, async () => {
      try {
        const r = demanda ? await put(`/api/demandas/${demanda.id}`, corpo) : await post('/api/demandas', corpo);
        sucesso(r.mensagem);
        alterado = true;
        m.fechar();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });

  titulo.focus();
}
