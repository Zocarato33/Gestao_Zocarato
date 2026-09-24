'use strict';

/**
 * Cria um administrador ou redefine a senha de um usuário existente.
 * Uso interativo:   npm run criar-admin
 * Uso direto:       npm run criar-admin -- "Nome Completo" email@empresa.com SenhaForte123
 */
const readline = require('node:readline/promises');
const { db } = require('../src/db');
const { gerarHashSenha, validarForcaSenha } = require('../src/auth');

async function main() {
  let [nome, email, senha] = process.argv.slice(2);
  if (!nome || !email || !senha) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    nome = nome || (await rl.question('Nome completo: ')).trim();
    email = email || (await rl.question('E-mail: ')).trim();
    senha = senha || (await rl.question('Senha (mínimo 8 caracteres, com letras e números): ')).trim();
    rl.close();
  }
  email = String(email).toLowerCase();
  if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error('Nome ou e-mail inválido.');
    process.exit(1);
  }
  const erro = validarForcaSenha(senha);
  if (erro) {
    console.error(erro);
    process.exit(1);
  }
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) {
    db.prepare(`UPDATE usuarios SET nome = ?, senha_hash = ?, papel = 'admin', ativo = 1,
      atualizado_em = datetime('now') WHERE id = ?`).run(nome, gerarHashSenha(senha), existente.id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(existente.id);
    console.log(`Usuário ${email} atualizado: agora é administrador ativo com a nova senha.`);
  } else {
    db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin')`)
      .run(nome, email, gerarHashSenha(senha));
    console.log(`Administrador ${email} criado com sucesso.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
