// Comunicação com o servidor e cache de dados de apoio (clientes, responsáveis e colunas).

export class ErroApi extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
  }
}

let aoExpirarSessao = () => {};
export function definirAoExpirarSessao(fn) {
  aoExpirarSessao = fn;
}

export async function api(metodo, url, corpo) {
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'gestao-demandas',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  let dados = null;
  try {
    dados = await res.json();
  } catch { /* resposta sem corpo JSON */ }
  if (!res.ok) {
    const e = new ErroApi(res.status, (dados && dados.erro) || `Erro ${res.status} ao processar a solicitação.`, dados && dados.campos);
    if (res.status === 401 && !url.startsWith('/api/auth/')) aoExpirarSessao(e);
    throw e;
  }
  return dados;
}

export const get = (url) => api('GET', url);
export const post = (url, corpo) => api('POST', url, corpo ?? {});
export const put = (url, corpo) => api('PUT', url, corpo);
export const patch = (url, corpo) => api('PATCH', url, corpo);
export const del = (url) => api('DELETE', url);

export function consulta(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------- Estado compartilhado ----------

export const estado = {
  usuario: null,
  clientes: [],
  responsaveis: [],
  colunas: [],
  colunasClientes: [],
  colunasPrecos: [],
  layout: { demanda: [], cliente: [], preco: [] },
};

export const ehAdmin = () => estado.usuario && estado.usuario.papel === 'admin';

export async function carregarApoio() {
  const [clientes, responsaveis, colunas, colunasClientes, colunasPrecos, layout] = await Promise.all([
    get('/api/clientes'),
    get('/api/usuarios/opcoes'),
    get('/api/colunas'),
    get('/api/colunas?entidade=cliente'),
    get('/api/colunas?entidade=preco'),
    get('/api/layout'),
  ]);
  estado.clientes = clientes;
  estado.responsaveis = responsaveis;
  estado.colunas = colunas;
  estado.colunasClientes = colunasClientes;
  estado.colunasPrecos = colunasPrecos;
  estado.layout = layout;
}

export async function recarregarClientes() {
  const [clientes, responsaveis] = await Promise.all([get('/api/clientes'), get('/api/usuarios/opcoes')]);
  estado.clientes = clientes;
  estado.responsaveis = responsaveis;
}

const CHAVE_COLUNAS = { demanda: 'colunas', cliente: 'colunasClientes', preco: 'colunasPrecos' };

/** Colunas personalizadas da tela informada ('demanda', 'cliente' ou 'preco'), a partir do cache. */
export const colunasDe = (entidade) => estado[CHAVE_COLUNAS[entidade] || 'colunas'];

export async function recarregarLayout() {
  estado.layout = await get('/api/layout');
}

/** Recarrega as colunas personalizadas de uma tela e o layout (que inclui essas colunas). */
export async function recarregarColunas(entidade = 'demanda') {
  const [colunas] = await Promise.all([
    get(`/api/colunas${entidade === 'demanda' ? '' : `?entidade=${entidade}`}`),
    recarregarLayout(),
  ]);
  estado[CHAVE_COLUNAS[entidade] || 'colunas'] = colunas;
}

// ---------- Layout e regras dos campos ----------

/** Colunas da tabela da tela, na ordem configurada, apenas as visíveis. */
export const colunasTabela = (entidade) => (estado.layout[entidade] || []).filter((i) => i.tabela && i.visivel);

/** Indica se o campo (chave do layout) é obrigatório no formulário. */
export const obrigatorio = (entidade, chave) => Boolean((estado.layout[entidade] || []).find((i) => i.chave === chave)?.obrigatorio);

/** Colunas personalizadas da tela na ordem do layout (para os formulários). */
export function colunasOrdenadas(entidade) {
  const ordem = new Map((estado.layout[entidade] || []).map((i, n) => [i.chave, n]));
  return [...colunasDe(entidade)].sort((a, b) => (ordem.get(`extra_${a.id}`) ?? 1e6) - (ordem.get(`extra_${b.id}`) ?? 1e6));
}

/** Responsáveis que podem atender o cliente informado. */
export function responsaveisDoCliente(clienteId) {
  const id = Number(clienteId);
  return estado.responsaveis.filter((r) => r.todos || (id && r.clientes.includes(id)));
}
