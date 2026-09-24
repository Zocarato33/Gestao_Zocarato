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
};

export const ehAdmin = () => estado.usuario && estado.usuario.papel === 'admin';

export async function carregarApoio() {
  const [clientes, responsaveis, colunas] = await Promise.all([
    get('/api/clientes'),
    get('/api/usuarios/opcoes'),
    get('/api/colunas'),
  ]);
  estado.clientes = clientes;
  estado.responsaveis = responsaveis;
  estado.colunas = colunas;
}

export async function recarregarClientes() {
  const [clientes, responsaveis] = await Promise.all([get('/api/clientes'), get('/api/usuarios/opcoes')]);
  estado.clientes = clientes;
  estado.responsaveis = responsaveis;
}

export async function recarregarColunas() {
  estado.colunas = await get('/api/colunas');
}

/** Responsáveis que podem atender o cliente informado. */
export function responsaveisDoCliente(clienteId) {
  const id = Number(clienteId);
  return estado.responsaveis.filter((r) => r.todos || (id && r.clientes.includes(id)));
}
