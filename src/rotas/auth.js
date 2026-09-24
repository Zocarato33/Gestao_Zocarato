'use strict';

const express = require('express');
const { db, transacao } = require('../db');
const {
  gerarHashSenha, conferirSenha, HASH_FICTICIO, validarForcaSenha,
  criarSessao, encerrarSessao, exigirLogin,
  verificarBloqueio, registrarFalha, limparFalhas,
} = require('../auth');
const { Validador, ErroHttp, ErroValidacao } = require('../validacao');

const r = express.Router();

const totalUsuarios = async () => (await db.get('SELECT COUNT(*) AS n FROM usuarios')).n;

r.get('/status', async (req, res) => {
  res.json({ precisaConfigurar: (await totalUsuarios()) === 0, usuario: req.usuario });
});

// Primeiro acesso: cria o administrador inicial. Só funciona com o banco vazio.
r.post('/configurar', async (req, res) => {
  if ((await totalUsuarios()) > 0) throw new ErroHttp(409, 'O sistema já foi configurado. Entre com sua conta.');
  const v = new Validador(req.body)
    .texto('nome', 'o nome', { obrigatorio: true, max: 120 })
    .email('email', 'o e-mail', { obrigatorio: true });
  const erroSenha = validarForcaSenha(req.body.senha);
  if (erroSenha) v.erro('senha', erroSenha);
  const d = v.verificar();
  const hash = gerarHashSenha(req.body.senha);
  // A trava garante que duas requisições simultâneas não criem dois administradores iniciais
  const id = await transacao(async (t) => {
    await t.exec('LOCK TABLE usuarios IN EXCLUSIVE MODE');
    if ((await t.get('SELECT COUNT(*) AS n FROM usuarios')).n > 0) {
      throw new ErroHttp(409, 'O sistema já foi configurado. Entre com sua conta.');
    }
    const novo = await t.get(`INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin') RETURNING id`,
      [d.nome, d.email, hash]);
    await criarSessao(res, novo.id, t);
    return novo.id;
  });
  res.status(201).json({
    mensagem: 'Administrador criado. Bem-vindo!',
    usuario: { id, nome: d.nome, email: d.email, papel: 'admin' },
  });
});

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  if (!email || !senha) {
    throw new ErroValidacao({
      ...(email ? {} : { email: 'Informe o e-mail.' }),
      ...(senha ? {} : { senha: 'Informe a senha.' }),
    });
  }
  await verificarBloqueio(req, email);
  const u = await db.get('SELECT id, nome, email, papel, ativo, senha_hash FROM usuarios WHERE lower(email) = ?', [email]);
  const confere = conferirSenha(senha, u ? u.senha_hash : HASH_FICTICIO);
  if (!u || !confere) {
    await registrarFalha(req, email);
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  if (!u.ativo) throw new ErroHttp(403, 'Sua conta está desativada. Procure um administrador.');
  await limparFalhas(req, email);
  await criarSessao(res, u.id);
  res.json({
    mensagem: `Olá, ${u.nome.split(' ')[0]}!`,
    usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel },
  });
});

r.post('/logout', async (req, res) => {
  await encerrarSessao(req, res);
  res.json({ mensagem: 'Você saiu do sistema.' });
});

r.post('/senha', exigirLogin, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  const u = await db.get('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!senhaAtual || !conferirSenha(String(senhaAtual), u.senha_hash)) {
    throw new ErroValidacao({ senhaAtual: 'Senha atual incorreta.' });
  }
  const erro = validarForcaSenha(novaSenha);
  if (erro) throw new ErroValidacao({ novaSenha: erro });
  const hash = gerarHashSenha(novaSenha);
  // Encerra as outras sessões do usuário e mantém a atual
  await transacao(async (t) => {
    await t.exec('UPDATE usuarios SET senha_hash = ?, atualizado_em = now() WHERE id = ?', [hash, req.usuario.id]);
    await t.exec('DELETE FROM sessoes WHERE usuario_id = ?', [req.usuario.id]);
    await criarSessao(res, req.usuario.id, t);
  });
  res.json({ mensagem: 'Senha alterada com sucesso.' });
});

module.exports = r;
