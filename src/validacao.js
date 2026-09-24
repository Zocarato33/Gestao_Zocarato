'use strict';

const STATUS = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando cliente',
  concluida: 'Concluída',
};

const PRIORIDADES = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

const TIPOS_COLUNA = {
  texto: 'Texto',
  numero: 'Número',
  data: 'Data',
  lista: 'Lista de opções',
};

class ErroHttp extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
  }
}

class ErroValidacao extends ErroHttp {
  constructor(campos, mensagem = 'Revise os campos destacados.') {
    super(422, mensagem, campos);
  }
}

const naoEncontrado = (o = 'Registro') => new ErroHttp(404, `${o} não encontrado.`);
const proibido = () => new ErroHttp(403, 'Você não tem permissão para esta ação.');

/** Data de hoje (AAAA-MM-DD) no fuso configurado. */
function hoje() {
  const tz = process.env.APP_TZ || 'America/Sao_Paulo';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function somarDias(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** Monta o padrão "contém" do LIKE tratando %, _ e \ como texto literal (usar com ESCAPE). */
function termoLike(texto) {
  return `%${String(texto).replace(/[\\%_]/g, '\\$&')}%`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validador simples que acumula erros por campo.
 */
class Validador {
  constructor(dados) {
    this.dados = dados && typeof dados === 'object' ? dados : {};
    this.erros = {};
    this.saida = {};
  }

  presente(campo) {
    return Object.prototype.hasOwnProperty.call(this.dados, campo);
  }

  texto(campo, rotulo, { obrigatorio = false, max = 255, min = 0 } = {}) {
    let v = this.dados[campo];
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string') v = String(v);
    v = v.trim();
    if (!v) {
      if (obrigatorio) this.erros[campo] = `Informe ${rotulo}.`;
      this.saida[campo] = null;
      return this;
    }
    if (v.length < min) this.erros[campo] = `${cap(rotulo)} deve ter ao menos ${min} caracteres.`;
    else if (v.length > max) this.erros[campo] = `${cap(rotulo)} deve ter no máximo ${max} caracteres.`;
    this.saida[campo] = v;
    return this;
  }

  email(campo, rotulo, { obrigatorio = false } = {}) {
    this.texto(campo, rotulo, { obrigatorio, max: 160 });
    const v = this.saida[campo];
    if (v && !this.erros[campo] && !EMAIL_RE.test(v)) this.erros[campo] = 'Informe um e-mail válido.';
    if (v) this.saida[campo] = v.toLowerCase();
    return this;
  }

  enumeracao(campo, rotulo, opcoes, { obrigatorio = true, padrao } = {}) {
    let v = this.dados[campo];
    if ((v === undefined || v === null || v === '') && padrao !== undefined) v = padrao;
    if (v === undefined || v === null || v === '') {
      if (obrigatorio) this.erros[campo] = `Selecione ${rotulo}.`;
      this.saida[campo] = null;
      return this;
    }
    if (!Object.prototype.hasOwnProperty.call(opcoes, v)) this.erros[campo] = `${cap(rotulo)} inválido.`;
    this.saida[campo] = v;
    return this;
  }

  data(campo, rotulo, { obrigatorio = false } = {}) {
    const v = this.dados[campo];
    if (v === undefined || v === null || v === '') {
      if (obrigatorio) this.erros[campo] = `Informe ${rotulo}.`;
      this.saida[campo] = null;
      return this;
    }
    if (!dataValida(v)) this.erros[campo] = `${cap(rotulo)} deve ser uma data válida.`;
    this.saida[campo] = v;
    return this;
  }

  id(campo, rotulo, { obrigatorio = false } = {}) {
    const v = this.dados[campo];
    if (v === undefined || v === null || v === '') {
      if (obrigatorio) this.erros[campo] = `Selecione ${rotulo}.`;
      this.saida[campo] = null;
      return this;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) this.erros[campo] = `${cap(rotulo)} inválido.`;
    this.saida[campo] = n;
    return this;
  }

  erro(campo, mensagem) {
    this.erros[campo] = mensagem;
    return this;
  }

  verificar() {
    if (Object.keys(this.erros).length) throw new ErroValidacao(this.erros);
    return this.saida;
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function idParam(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, 'Identificador inválido.');
  return n;
}

/**
 * Normaliza e valida o valor de uma coluna personalizada conforme seu tipo.
 * Retorna { valor } ou { erro }.
 */
function validarValorColuna(coluna, bruto) {
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') return { valor: null };
  const v = String(bruto).trim();
  switch (coluna.tipo) {
    case 'texto':
      if (v.length > 1000) return { erro: 'Máximo de 1000 caracteres.' };
      return { valor: v };
    case 'numero': {
      const normalizado = v.replace(/\s/g, '').replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return { erro: 'Informe um número válido.' };
      const n = Number(normalizado);
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) return { erro: 'Número fora do intervalo permitido.' };
      return { valor: String(n) };
    }
    case 'data':
      if (!dataValida(v)) return { erro: 'Informe uma data válida.' };
      return { valor: v };
    case 'lista': {
      const opcoes = coluna.opcoes || [];
      if (!opcoes.includes(v)) return { erro: 'Selecione uma opção da lista.' };
      return { valor: v };
    }
    default:
      return { erro: 'Tipo de coluna desconhecido.' };
  }
}

module.exports = {
  STATUS, PRIORIDADES, TIPOS_COLUNA,
  ErroHttp, ErroValidacao, naoEncontrado, proibido,
  Validador, idParam, hoje, somarDias, dataValida, termoLike, validarValorColuna,
};
