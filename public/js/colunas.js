import {
  el, campo, opcoesSelect, abrirModal, confirmar, sucesso, erro, ocupado, limparErros,
  tratarErroFormulario, icone, limpar, TIPOS_COLUNA,
} from './ui.js';
import { post, put, del, colunasDe, recarregarColunas } from './api.js';

// Textos que mudam conforme a tela a que a coluna pertence
const TEXTOS = {
  demanda: { plural: 'demandas', item: 'demanda(s)', subtitulo: 'Crie campos próprios para registrar informações em cada demanda.' },
  cliente: { plural: 'clientes', item: 'cliente(s)', subtitulo: 'Crie campos próprios para registrar informações em cada cliente.' },
};
const textos = (entidade) => TEXTOS[entidade] || TEXTOS.demanda;

/** Confirma e exclui uma coluna. Retorna true se excluiu. */
export async function excluirColuna(col) {
  const t = textos(col.entidade);
  const ok = await confirmar({
    titulo: `Excluir a coluna "${col.nome}"?`,
    mensagem: `A coluna será removida da tabela e dos formulários de todos os ${t.plural}.`,
    detalhe: col.preenchidos
      ? `Os dados desta coluna serão removidos: ${col.preenchidos} ${t.item} têm valor preenchido. Esta ação não pode ser desfeita.`
      : 'Os dados desta coluna serão removidos. Esta ação não pode ser desfeita.',
    botao: 'Excluir coluna e dados',
  });
  if (!ok) return false;
  try {
    const r = await del(`/api/colunas/${col.id}`);
    sucesso(r.mensagem);
    await recarregarColunas(col.entidade);
    return true;
  } catch (e) {
    erro(e.message);
    return false;
  }
}

/** Formulário para renomear (e ajustar opções de lista) de uma coluna. */
export function abrirEdicaoColuna(col, aoMudar) {
  const m = abrirModal({ titulo: 'Renomear coluna', subtitulo: `Tipo: ${TIPOS_COLUNA[col.tipo]}`, largura: 'pequena' });
  const nome = el('input', { type: 'text', value: col.nome, maxlength: 40, required: true });
  const opcoes = col.tipo === 'lista'
    ? el('textarea', { rows: 5, text: col.opcoes.join('\n') })
    : null;
  const form = el('form', { class: 'formulario', novalidate: true },
    campo('Nome da coluna', nome, { nome: 'nome', obrigatorio: true }),
    opcoes ? campo('Opções da lista', opcoes, {
      nome: 'opcoes', obrigatorio: true, ajuda: 'Uma opção por linha. Valores de opções removidas serão apagados.',
    }) : null,
    el('p', { class: 'meta', text: 'O tipo do campo não pode ser alterado depois de criado.' }));
  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', text: 'Salvar' });
  form.id = `fc-${col.id}`;
  salvar.setAttribute('form', form.id);
  m.corpo.append(form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() }), salvar);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    if (!nome.value.trim()) {
      tratarErroFormulario(form, { campos: { nome: 'Informe o nome da coluna.' }, message: '' });
      return;
    }
    await ocupado(salvar, async () => {
      try {
        const corpo = { nome: nome.value };
        if (opcoes) corpo.opcoes = opcoes.value.split('\n');
        const r = await put(`/api/colunas/${col.id}`, corpo);
        sucesso(r.mensagem);
        await recarregarColunas(col.entidade);
        m.fechar();
        if (aoMudar) aoMudar();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  nome.select();
}

/**
 * Modal com a lista de colunas e o formulário para adicionar novas.
 * @param {Function} aoMudar chamada ao fechar, se alguma coluna foi criada, renomeada ou excluída
 * @param {'demanda'|'cliente'} entidade tela a que as colunas pertencem
 */
export function abrirGerenciadorColunas(aoMudar, entidade = 'demanda') {
  let mudou = false;
  const m = abrirModal({
    titulo: entidade === 'cliente' ? 'Colunas de clientes' : 'Colunas da tabela',
    subtitulo: textos(entidade).subtitulo,
    largura: 'media',
    onFechar: () => { if (mudou && aoMudar) aoMudar(); },
  });

  const lista = el('ul', { class: 'lista-colunas' });

  function renderLista() {
    limpar(lista);
    const colunas = colunasDe(entidade);
    if (!colunas.length) {
      lista.append(el('li', { class: 'lista-colunas-vazia', text: 'Nenhuma coluna personalizada ainda.' }));
      return;
    }
    for (const col of colunas) {
      lista.append(el('li', { class: 'coluna-item' },
        el('div', { class: 'coluna-info' },
          el('strong', { text: col.nome }),
          el('span', {
            class: 'meta',
            text: `${TIPOS_COLUNA[col.tipo]}${col.tipo === 'lista' ? ` (${col.opcoes.length} opções)` : ''}, ${col.preenchidos} preenchida(s)`,
          })),
        el('div', { class: 'coluna-acoes' },
          el('button', {
            type: 'button', class: 'botao botao-secundario botao-pequeno',
            onClick: () => abrirEdicaoColuna(col, () => { mudou = true; renderLista(); }),
          }, icone('lapis', 16), 'Renomear'),
          el('button', {
            type: 'button', class: 'botao botao-texto-perigo botao-pequeno',
            onClick: async () => {
              if (await excluirColuna(col)) { mudou = true; renderLista(); }
            },
          }, icone('lixeira', 16), 'Excluir'))));
    }
  }

  const nome = el('input', {
    type: 'text', maxlength: 40, required: true, placeholder: entidade === 'cliente' ? 'Ex.: Segmento' : 'Ex.: Valor da causa',
  });
  const tipo = el('select', {}, opcoesSelect(TIPOS_COLUNA, 'texto'));
  const opcoes = el('textarea', { rows: 4, placeholder: 'Uma opção por linha' });
  const campoOpcoes = campo('Opções da lista', opcoes, { nome: 'opcoes', obrigatorio: true, ajuda: 'Uma opção por linha.' });
  campoOpcoes.hidden = true;
  tipo.addEventListener('change', () => { campoOpcoes.hidden = tipo.value !== 'lista'; });

  const adicionar = el('button', { type: 'submit', class: 'botao botao-primario' }, icone('mais', 16), 'Adicionar coluna');
  const form = el('form', { class: 'formulario form-nova-coluna', novalidate: true },
    el('h3', { class: 'subtitulo-secao', text: 'Nova coluna' }),
    el('div', { class: 'grade grade-2' },
      campo('Nome', nome, { nome: 'nome', obrigatorio: true }),
      campo('Tipo do campo', tipo, { nome: 'tipo', obrigatorio: true }),
      el('div', { class: 'coluna-inteira' }, campoOpcoes)),
    el('div', { class: 'acoes-form' }, adicionar));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    const locais = {};
    if (!nome.value.trim()) locais.nome = 'Informe o nome da coluna.';
    if (tipo.value === 'lista' && !opcoes.value.trim()) locais.opcoes = 'Informe ao menos uma opção.';
    if (Object.keys(locais).length) {
      tratarErroFormulario(form, { campos: locais, message: '' });
      return;
    }
    await ocupado(adicionar, async () => {
      try {
        const r = await post('/api/colunas', {
          nome: nome.value, tipo: tipo.value, entidade, opcoes: tipo.value === 'lista' ? opcoes.value.split('\n') : undefined,
        });
        sucesso(r.mensagem);
        await recarregarColunas(entidade);
        mudou = true;
        form.reset();
        campoOpcoes.hidden = true;
        renderLista();
        nome.focus();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });

  renderLista();
  m.corpo.append(lista, form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Concluir', onClick: () => m.fechar() }));
  nome.focus();
}
