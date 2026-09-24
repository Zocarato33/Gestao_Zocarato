// Utilitários de interface. Todo conteúdo vindo do servidor é inserido como texto, nunca como HTML.

export const STATUS = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando cliente',
  concluida: 'Concluída',
};

export const PRIORIDADES = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const TIPOS_COLUNA = {
  texto: 'Texto',
  numero: 'Número',
  data: 'Data',
  lista: 'Lista de opções',
};

const ICONES = {
  mais: '<path d="M12 5v14M5 12h14"/>',
  lixeira: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  lapis: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  filtro: '<path d="M4 5h16l-6 8v5l-4 2v-7L4 5z"/>',
  colunas: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15M15 4.5v15"/>',
  demandas: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5"/>',
  usuarios: '<path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>',
  conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  voltar: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  ordenar: '<path d="M8 10l4-4 4 4M8 14l4 4 4-4"/>',
  alerta: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>',
  preco: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  layout: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M9 9v11.5"/><path d="M13 13h4M13 16.5h4"/>',
  cima: '<path d="M6 15l6-6 6 6"/>',
  baixo: '<path d="M6 9l6 6 6-6"/>',
};

export function icone(nome, tamanho = 18) {
  const span = document.createElement('span');
  span.className = 'icone';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome] || ''}</svg>`;
  return span;
}

/**
 * Cria um elemento. Atributos especiais: class, text, on<Evento>, dataset, e propriedades
 * como value, checked, disabled, selected.
 */
export function el(tag, atributos = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'required', 'multiple', 'readOnly'].includes(k)) n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export function limpar(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

export function opcoesSelect(mapa, selecionado, vazio) {
  const lista = [];
  if (vazio !== undefined) lista.push(el('option', { value: '', text: vazio }));
  const entradas = Array.isArray(mapa) ? mapa : Object.entries(mapa);
  for (const [valor, rotulo] of entradas) {
    lista.push(el('option', { value: String(valor), text: rotulo, selected: String(valor) === String(selecionado ?? '') }));
  }
  return lista;
}

// ---------- Formatação ----------

export function dataBr(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Converte a data e hora do servidor (ISO 8601 em UTC) para data e hora locais. */
export function dataHoraBr(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Formata um valor em reais: 1500.5 vira "R$ 1.500,50". */
export function moedaBr(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(valor);
}

export function numeroBr(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 10 }) : String(valor);
}

export function diasAte(iso, hojeIso) {
  const a = new Date(`${iso}T12:00:00Z`);
  const b = new Date(`${hojeIso}T12:00:00Z`);
  return Math.round((a - b) / 86400000);
}

export function descreverPrazo(prazo, hojeIso, concluida) {
  if (!prazo) return 'Sem prazo';
  if (concluida) return dataBr(prazo);
  const dias = diasAte(prazo, hojeIso);
  if (dias < 0) return `Venceu há ${-dias} dia${dias === -1 ? '' : 's'}`;
  if (dias === 0) return 'Vence hoje';
  if (dias === 1) return 'Vence amanhã';
  return `Em ${dias} dias`;
}

export function chipStatus(status) {
  return el('span', { class: `chip chip-status s-${status}`, text: STATUS[status] || status });
}

export function chipPrioridade(p) {
  return el('span', { class: `chip chip-prioridade p-${p}`, text: PRIORIDADES[p] || p });
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Mensagens ----------

export function toast(mensagem, tipo = 'sucesso', duracao = 4200) {
  const area = document.getElementById('toasts');
  const t = el('div', { class: `toast toast-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' },
    el('span', { class: 'toast-texto', text: mensagem }),
    el('button', { class: 'toast-fechar', type: 'button', 'aria-label': 'Fechar mensagem', onClick: () => sair() }, icone('fechar', 16)));
  area.append(t);
  // Mantém no máximo 3 mensagens visíveis
  while (area.children.length > 3) area.firstElementChild.remove();
  let saiu = false;
  function sair() {
    if (saiu) return;
    saiu = true;
    t.classList.add('saindo');
    setTimeout(() => t.remove(), 200);
  }
  setTimeout(sair, tipo === 'erro' ? duracao + 2500 : duracao);
}

export const sucesso = (m) => toast(m, 'sucesso');
export const erro = (m) => toast(m, 'erro');

// ---------- Modais ----------

/**
 * Abre um modal. Retorna { dialog, corpo, rodape, fechar }.
 * onFechar é chamado sempre que o modal for fechado.
 */
export function abrirModal({ titulo, subtitulo, largura = 'media', onFechar } = {}) {
  const corpo = el('div', { class: 'modal-corpo' });
  const rodape = el('div', { class: 'modal-rodape' });
  const idTitulo = `mt-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = el('dialog', { class: `modal modal-${largura}`, 'aria-labelledby': idTitulo },
    el('div', { class: 'modal-cabecalho' },
      el('div', {},
        el('h2', { id: idTitulo, class: 'modal-titulo', text: titulo }),
        subtitulo ? el('p', { class: 'modal-subtitulo', text: subtitulo }) : null),
      el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar', onClick: () => fechar() }, icone('fechar'))),
    corpo, rodape);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onFechar) onFechar();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) fechar();
  });
  dialog.showModal();
  function fechar() {
    if (dialog.open) dialog.close();
  }
  return { dialog, corpo, rodape, fechar };
}

/**
 * Pede confirmação. Retorna Promise<boolean>.
 */
export function confirmar({ titulo, mensagem, detalhe, botao = 'Excluir', perigo = true }) {
  return new Promise((resolver) => {
    let resposta = false;
    const m = abrirModal({ titulo, largura: 'pequena', onFechar: () => resolver(resposta) });
    m.dialog.setAttribute('role', 'alertdialog');
    m.corpo.append(
      el('p', { class: 'confirmar-texto', text: mensagem }),
      detalhe ? el('p', { class: 'confirmar-detalhe' }, icone('alerta', 16), el('span', { text: detalhe })) : null,
    );
    const cancelar = el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() });
    const ok = el('button', {
      type: 'button',
      class: `botao ${perigo ? 'botao-perigo' : 'botao-primario'}`,
      text: botao,
      onClick: () => { resposta = true; m.fechar(); },
    });
    m.rodape.append(cancelar, ok);
    cancelar.focus();
  });
}

// ---------- Formulários ----------

/**
 * Campo de formulário com rótulo e área de erro. `nome` também identifica o erro vindo da API.
 */
export function campo(rotulo, controle, { nome, ajuda, obrigatorio, classe } = {}) {
  const id = controle.id || `c-${nome || Math.random().toString(36).slice(2, 8)}`;
  controle.id = id;
  if (nome && !controle.name) controle.name = nome;
  const erroId = `${id}-erro`;
  controle.setAttribute('aria-describedby', erroId);
  return el('div', { class: `campo ${classe || ''}`, dataset: { campo: nome || '' } },
    el('label', { for: id }, rotulo, obrigatorio ? el('span', { class: 'obrigatorio', 'aria-hidden': 'true', text: ' *' }) : null),
    controle,
    ajuda ? el('small', { class: 'campo-ajuda', text: ajuda }) : null,
    el('small', { class: 'campo-erro', id: erroId, 'aria-live': 'polite' }));
}

export function limparErros(form) {
  form.querySelectorAll('.campo.com-erro').forEach((c) => {
    c.classList.remove('com-erro');
    c.querySelector('.campo-erro').textContent = '';
    c.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  });
}

export function mostrarErros(form, campos = {}) {
  limparErros(form);
  let primeiro = null;
  for (const [nome, msg] of Object.entries(campos)) {
    const c = form.querySelector(`.campo[data-campo="${CSS.escape(nome)}"]`);
    if (!c) continue;
    c.classList.add('com-erro');
    c.querySelector('.campo-erro').textContent = msg;
    const controle = c.querySelector('input, select, textarea');
    if (controle) {
      controle.setAttribute('aria-invalid', 'true');
      primeiro = primeiro || controle;
    }
  }
  if (primeiro) primeiro.focus();
  return !!primeiro;
}

/** Marca um botão como ocupado enquanto a promessa não termina. */
export async function ocupado(botao, fn) {
  const texto = botao.textContent;
  botao.disabled = true;
  botao.classList.add('ocupado');
  try {
    return await fn();
  } finally {
    botao.disabled = false;
    botao.classList.remove('ocupado');
    if (botao.textContent !== texto && !botao.querySelector('.icone')) botao.textContent = texto;
  }
}

/** Trata erro de API em formulário: mostra erros por campo e mensagem geral. */
export function tratarErroFormulario(form, e) {
  if (e.campos && mostrarErros(form, e.campos)) {
    const outros = Object.keys(e.campos).filter((k) => !form.querySelector(`.campo[data-campo="${CSS.escape(k)}"]`));
    erro(outros.length ? Object.values(e.campos).join(' ') : e.message);
  } else {
    erro(e.message);
  }
}

export function vazio(titulo, texto, acao) {
  return el('div', { class: 'vazio' },
    el('p', { class: 'vazio-titulo', text: titulo }),
    texto ? el('p', { class: 'vazio-texto', text: texto }) : null,
    acao || null);
}

export function guardar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch { /* armazenamento indisponível */ }
}

export function recuperar(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v ? JSON.parse(v) : padrao;
  } catch {
    return padrao;
  }
}
