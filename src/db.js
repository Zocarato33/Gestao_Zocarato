'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gestao.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const SCHEMA_VERSAO = 1;

function migrar() {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  if (versao >= SCHEMA_VERSAO) return;

  transacao(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        senha_hash TEXT NOT NULL,
        papel TEXT NOT NULL DEFAULT 'usuario' CHECK (papel IN ('admin', 'usuario')),
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessoes (
        token_hash TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expira_em INTEGER NOT NULL,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);

      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        documento TEXT,
        email TEXT,
        telefone TEXT,
        observacoes TEXT,
        criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS usuario_clientes (
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        PRIMARY KEY (usuario_id, cliente_id)
      );
      CREATE INDEX IF NOT EXISTS idx_uc_cliente ON usuario_clientes(cliente_id);

      CREATE TABLE IF NOT EXISTS demandas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_demandas_cliente ON demandas(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_demandas_responsavel ON demandas(responsavel_id);
      CREATE INDEX IF NOT EXISTS idx_demandas_status ON demandas(status);
      CREATE INDEX IF NOT EXISTS idx_demandas_prazo ON demandas(prazo);

      CREATE TABLE IF NOT EXISTS colunas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
        tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'numero', 'data', 'lista')),
        opcoes TEXT,
        ordem INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS valores_colunas (
        demanda_id INTEGER NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
        coluna_id INTEGER NOT NULL REFERENCES colunas(id) ON DELETE CASCADE,
        valor TEXT,
        PRIMARY KEY (demanda_id, coluna_id)
      );
      CREATE INDEX IF NOT EXISTS idx_valores_coluna ON valores_colunas(coluna_id);
    `);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSAO}`);
  });
}

/**
 * Executa a função dentro de uma transação. Reverte tudo em caso de erro.
 */
function transacao(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

migrar();

// Limpeza periódica de sessões expiradas
function limparSessoes() {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
}
limparSessoes();
setInterval(limparSessoes, 60 * 60 * 1000).unref();

module.exports = { db, transacao, DB_PATH };
