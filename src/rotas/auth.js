'use strict';

const express = require('express');
const { db } = require('../db');
const {
  gerarHashSenha, conferirSenha, HASH_FICTICIO, validarForcaSenha,
  criarSessao, encerrarSessao, exigirLogin,
  verificarBloqueio, registrarFalha, limparFalhas,
} = require('../auth');
const { Validador, ErroHttp, ErroValidacao } = require('../validacao');

const r = express.Router();

const totalUsuarios = () => db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;

r.get('/status', (req, res) => {
  res.json({ precisaConfigurar: totalUsuarios() === 0, usuario: req.usuario });
});

// Primeiro acesso: cria o administrador inicial. Só funciona com o banco vazio.
r.post('/configurar', (req, res) => {
  if (totalUsuarios() > 0) throw new ErroHttp(409, 'O sistema já foi configurado. Entre com sua conta.');
  const v = new Validador(req.body)
    .texto('nome', 'o nome', { obrigatorio: true, max: 120 })
    .email('email', 'o e-mail', { obrigatorio: true });
  const erroSenha = validarForcaSenha(req.body.senha);
  if (erroSenha) v.erro('senha', erroSenha);
  const d = v.verificar();
  const info = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin')`)
    .run(d.nome, d.email, gerarHashSenha(req.body.senha));
  criarSessao(res, Number(info.lastInsertRowid));
  res.status(201).json({
    mensagem: 'Administrador criado. Bem-vindo!',
    usuario: { id: Number(info.lastInsertRowid), nome: d.nome, email: d.email, papel: 'admin' },
  });
});

r.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  if (!email || !senha) {
    throw new ErroValidacao({
      ...(email ? {} : { email: 'Informe o e-mail.' }),
      ...(senha ? {} : { senha: 'Informe a senha.' }),
    });
  }
  verificarBloqueio(req, email);
  const u = db.prepare('SELECT id, nome, email, papel, ativo, senha_hash FROM usuarios WHERE email = ?').get(email);
  const confere = conferirSenha(senha, u ? u.senha_hash : HASH_FICTICIO);
  if (!u || !confere) {
    registrarFalha(req, email);
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  if (!u.ativo) throw new ErroHttp(403, 'Sua conta está desativada. Procure um administrador.');
  limparFalhas(req, email);
  criarSessao(res, u.id);
  res.json({
    mensagem: `Olá, ${u.nome.split(' ')[0]}!`,
    usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel },
  });
});

r.post('/logout', (req, res) => {
  encerrarSessao(req, res);
  res.json({ mensagem: 'Você saiu do sistema.' });
});

r.post('/senha', exigirLogin, (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!senhaAtual || !conferirSenha(String(senhaAtual), u.senha_hash)) {
    throw new ErroValidacao({ senhaAtual: 'Senha atual incorreta.' });
  }
  const erro = validarForcaSenha(novaSenha);
  if (erro) throw new ErroValidacao({ novaSenha: erro });
  db.prepare(`UPDATE usuarios SET senha_hash = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(gerarHashSenha(novaSenha), req.usuario.id);
  // Encerra as outras sessões do usuário e mantém a atual
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(req.usuario.id);
  criarSessao(res, req.usuario.id);
  res.json({ mensagem: 'Senha alterada com sucesso.' });
});

module.exports = r;
