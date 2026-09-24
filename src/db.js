'use strict';

const { Pool, types } = require('pg');

// COUNT e SUM retornam bigint/numeric, que o driver entrega como texto; aqui viram número
types.setTypeParser(20, (v) => Number.parseInt(v, 10));
types.setTypeParser(1700, (v) => Number.parseFloat(v));

// POSTGRES_URL é o nome usado por algumas integrações (por exemplo, Neon na Vercel)
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
  throw new Error('Defina a variável DATABASE_URL com a conexão do PostgreSQL (veja o arquivo .env.example).');
}

const local = /@(localhost|127\.0\.0\.1|postgres|db)(:\d+)?\//.test(DATABASE_URL);
const SCHEMA = process.env.DB_SCHEMA && /^[a-z_][a-z0-9_]*$/.test(process.env.DB_SCHEMA) ? process.env.DB_SCHEMA : null;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: local || /sslmode=disable/.test(DATABASE_URL) ? false : { rejectUnauthorized: true },
  max: Number(process.env.DB_POOL_MAX) || 5,
  idleTimeoutMillis: 10_000,
});
if (SCHEMA) pool.on('connect', (c) => c.query(`SET search_path TO ${SCHEMA}`));

/** Converte os marcadores "?" para o formato $1, $2... do PostgreSQL. */
function converter(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function executor(alvo) {
  const query = (sql, params = []) => alvo.query(converter(sql), params);
  return {
    /** Executa e retorna o resultado completo (rows, rowCount). */
    exec: query,
    /** Retorna todas as linhas. */
    all: async (sql, params) => (await query(sql, params)).rows,
    /** Retorna a primeira linha ou undefined. */
    get: async (sql, params) => (await query(sql, params)).rows[0],
  };
}

const db = executor(pool);

/**
 * Executa a função dentro de uma transação, com uma conexão exclusiva. Reverte tudo em caso de erro.
 * A função recebe um executor com a mesma interface de `db`.
 */
async function transacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(executor(cliente));
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL DEFAULT 'usuario' CHECK (papel IN ('admin', 'usuario')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (lower(email));

  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em BIGINT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);

  CREATE TABLE IF NOT EXISTS tentativas_login (
    chave TEXT PRIMARY KEY,
    contagem INTEGER NOT NULL,
    inicio BIGINT NOT NULL,
    bloqueado_ate BIGINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    documento TEXT,
    email TEXT,
    telefone TEXT,
    observacoes TEXT,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS usuario_clientes (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, cliente_id)
  );
  CREATE INDEX IF NOT EXISTS idx_uc_cliente ON usuario_clientes(cliente_id);

  CREATE TABLE IF NOT EXISTS demandas (
    id SERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    descricao TEXT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pendente'
      CHECK (status IN ('pendente', 'em_andamento', 'aguardando_cliente', 'concluida')),
    prioridade TEXT NOT NULL DEFAULT 'normal'
      CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente')),
    prazo TEXT,
    observacoes TEXT,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_demandas_cliente ON demandas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_demandas_responsavel ON demandas(responsavel_id);
  CREATE INDEX IF NOT EXISTS idx_demandas_status ON demandas(status);
  CREATE INDEX IF NOT EXISTS idx_demandas_prazo ON demandas(prazo);

  CREATE TABLE IF NOT EXISTS colunas (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'numero', 'data', 'lista')),
    opcoes TEXT,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Colunas personalizadas servem a demandas ou a clientes; o nome é único dentro de cada uma
  ALTER TABLE colunas ADD COLUMN IF NOT EXISTS entidade TEXT NOT NULL DEFAULT 'demanda'
    CHECK (entidade IN ('demanda', 'cliente'));
  DROP INDEX IF EXISTS idx_colunas_nome;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_colunas_entidade_nome ON colunas (entidade, lower(nome));

  CREATE TABLE IF NOT EXISTS valores_colunas (
    demanda_id INTEGER NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
    coluna_id INTEGER NOT NULL REFERENCES colunas(id) ON DELETE CASCADE,
    valor TEXT,
    PRIMARY KEY (demanda_id, coluna_id)
  );
  CREATE INDEX IF NOT EXISTS idx_valores_coluna ON valores_colunas(coluna_id);

  CREATE TABLE IF NOT EXISTS valores_colunas_clientes (
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    coluna_id INTEGER NOT NULL REFERENCES colunas(id) ON DELETE CASCADE,
    valor TEXT,
    PRIMARY KEY (cliente_id, coluna_id)
  );
  CREATE INDEX IF NOT EXISTS idx_valores_clientes_coluna ON valores_colunas_clientes(coluna_id);
`;

let preparo = null;

/**
 * Cria as tabelas na primeira execução. Idempotente e protegido por trava, pois várias
 * instâncias (por exemplo, funções serverless) podem iniciar ao mesmo tempo.
 */
function prontoParaUso() {
  if (!preparo) {
    preparo = transacao(async (t) => {
      if (SCHEMA) await t.exec(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
      await t.exec('SELECT pg_advisory_xact_lock(4127001)');
      await t.exec(SCHEMA_SQL);
      await t.exec('DELETE FROM sessoes WHERE expira_em < ?', [Date.now()]);
    }).catch((erro) => {
      preparo = null;
      throw erro;
    });
  }
  return preparo;
}

function descricaoBanco() {
  try {
    const u = new URL(DATABASE_URL);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return 'PostgreSQL';
  }
}

module.exports = { db, transacao, prontoParaUso, pool, descricaoBanco };
