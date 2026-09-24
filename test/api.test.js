'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Banco temporário isolado para os testes
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-teste-'));
process.env.DB_PATH = path.join(dir, 'teste.db');

const app = require('../src/server');

let servidor;
let base;

class Cliente {
  constructor() { this.cookie = ''; }

  async req(metodo, url, corpo) {
    const res = await fetch(base + url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'gestao-demandas',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const dados = await res.json().catch(() => null);
    return { status: res.status, dados };
  }
}

const admin = new Cliente();
const ana = new Cliente();
const bruno = new Cliente();
const ids = {};

test.before(async () => {
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('primeiro acesso cria o administrador e bloqueia nova configuração', async () => {
  let r = await admin.req('GET', '/api/auth/status');
  assert.equal(r.dados.precisaConfigurar, true);
  r = await admin.req('POST', '/api/auth/configurar', { nome: 'Admin', email: 'admin@teste.com', senha: 'fraca' });
  assert.equal(r.status, 422);
  assert.ok(r.dados.campos.senha);
  r = await admin.req('POST', '/api/auth/configurar', { nome: 'Admin Geral', email: 'admin@teste.com', senha: 'Senha1234' });
  assert.equal(r.status, 201);
  r = await new Cliente().req('POST', '/api/auth/configurar', { nome: 'X', email: 'x@teste.com', senha: 'Senha1234' });
  assert.equal(r.status, 409);
});

test('rotas protegidas exigem login e cabeçalho anti-CSRF', async () => {
  const anon = new Cliente();
  assert.equal((await anon.req('GET', '/api/demandas')).status, 401);
  const res = await fetch(`${base}/api/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin.cookie }, body: '{}',
  });
  assert.equal(res.status, 403);
});

test('administrador cadastra clientes, usuários e permissões', async () => {
  let r = await admin.req('POST', '/api/clientes', { nome: 'A' });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/api/clientes', { nome: 'Banco Alfa', documento: '123', email: 'x' });
  assert.equal(r.status, 422);
  assert.ok(r.dados.campos.documento && r.dados.campos.email);
  r = await admin.req('POST', '/api/clientes', { nome: 'Banco Alfa', documento: '12.345.678/0001-90', email: 'contato@alfa.com' });
  assert.equal(r.status, 201);
  ids.alfa = r.dados.id;
  r = await admin.req('POST', '/api/clientes', { nome: 'Financeira Beta' });
  ids.beta = r.dados.id;

  r = await admin.req('POST', '/api/usuarios', { nome: 'Ana', email: 'ana@teste.com', senha: 'Senha1234', clienteIds: [ids.alfa] });
  assert.equal(r.status, 201);
  ids.ana = r.dados.id;
  r = await admin.req('POST', '/api/usuarios', { nome: 'Bruno', email: 'ANA@teste.com', senha: 'Senha1234' });
  assert.equal(r.status, 422, 'e-mail duplicado deve ser recusado');
  r = await admin.req('POST', '/api/usuarios', { nome: 'Bruno', email: 'bruno@teste.com', senha: 'Senha1234', clienteIds: [ids.beta] });
  ids.bruno = r.dados.id;

  assert.equal((await ana.req('POST', '/api/auth/login', { email: 'ana@teste.com', senha: 'errada' })).status, 401);
  assert.equal((await ana.req('POST', '/api/auth/login', { email: 'ana@teste.com', senha: 'Senha1234' })).status, 200);
  assert.equal((await bruno.req('POST', '/api/auth/login', { email: 'bruno@teste.com', senha: 'Senha1234' })).status, 200);
});

test('usuário comum vê apenas os clientes permitidos', async () => {
  let r = await ana.req('GET', '/api/clientes');
  assert.deepEqual(r.dados.map((c) => c.nome), ['Banco Alfa']);
  assert.equal((await ana.req('GET', `/api/clientes/${ids.beta}`)).status, 404);
  assert.equal((await ana.req('PUT', `/api/clientes/${ids.beta}`, { nome: 'Invadido' })).status, 404);
  assert.equal((await ana.req('GET', '/api/usuarios')).status, 403);
  // Cliente criado pela Ana fica acessível para ela
  r = await ana.req('POST', '/api/clientes', { nome: 'Empresa Gama' });
  ids.gama = r.dados.id;
  r = await ana.req('GET', '/api/clientes');
  assert.equal(r.dados.length, 2);
});

test('colunas personalizadas: apenas admin gerencia e valores são validados', async () => {
  assert.equal((await ana.req('POST', '/api/colunas', { nome: 'Área', tipo: 'texto' })).status, 403);
  let r = await admin.req('POST', '/api/colunas', { nome: 'Status', tipo: 'texto' });
  assert.equal(r.status, 422, 'nome reservado');
  r = await admin.req('POST', '/api/colunas', { nome: 'Área', tipo: 'lista', opcoes: [] });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/api/colunas', { nome: 'Área', tipo: 'lista', opcoes: ['Jurídico', 'Financeiro'] });
  ids.colArea = r.dados.id;
  r = await admin.req('POST', '/api/colunas', { nome: 'Valor', tipo: 'numero' });
  ids.colValor = r.dados.id;
  r = await admin.req('POST', '/api/colunas', { nome: 'Audiência', tipo: 'data' });
  ids.colData = r.dados.id;
  r = await ana.req('GET', '/api/colunas');
  assert.equal(r.dados.length, 3);
});

test('CRUD de demandas com validação, campos personalizados e acesso', async () => {
  let r = await ana.req('POST', '/api/demandas', { titulo: 'x' });
  assert.equal(r.status, 422);
  assert.ok(r.dados.campos.titulo && r.dados.campos.cliente_id);

  r = await ana.req('POST', '/api/demandas', { titulo: 'Contrato Beta', cliente_id: ids.beta });
  assert.equal(r.status, 422, 'cliente sem permissão');

  r = await ana.req('POST', '/api/demandas', {
    titulo: 'Revisar contrato', cliente_id: ids.alfa, responsavel_id: ids.bruno,
  });
  assert.equal(r.status, 422, 'responsável sem acesso ao cliente');

  r = await ana.req('POST', '/api/demandas', {
    titulo: 'Revisar contrato', cliente_id: ids.alfa, responsavel_id: ids.ana,
    status: 'inexistente', prazo: '2024-02-30',
    campos: { [ids.colArea]: 'Marketing', [ids.colValor]: 'abc' },
  });
  assert.equal(r.status, 422);
  assert.ok(r.dados.campos.status && r.dados.campos.prazo);
  assert.ok(r.dados.campos[`campo_${ids.colArea}`] && r.dados.campos[`campo_${ids.colValor}`]);

  r = await ana.req('POST', '/api/demandas', {
    titulo: 'Revisar contrato', cliente_id: ids.alfa, responsavel_id: ids.ana, prioridade: 'alta',
    prazo: '2020-01-10', campos: { [ids.colArea]: 'Jurídico', [ids.colValor]: '1.500,50' },
  });
  assert.equal(r.status, 422, 'número com milhar deve ser recusado');
  r = await ana.req('POST', '/api/demandas', {
    titulo: 'Revisar contrato', cliente_id: ids.alfa, responsavel_id: ids.ana, prioridade: 'alta',
    prazo: '2020-01-10', campos: { [ids.colArea]: 'Jurídico', [ids.colValor]: '1500,50' },
  });
  assert.equal(r.status, 201);
  ids.d1 = r.dados.id;
  assert.equal(r.dados.demanda.campos[ids.colValor], '1500.5');
  assert.equal(r.dados.demanda.vencida, true);

  r = await bruno.req('POST', '/api/demandas', { titulo: 'Parecer Beta', cliente_id: ids.beta, status: 'concluida' });
  ids.d2 = r.dados.id;

  // Isolamento
  assert.equal((await bruno.req('GET', `/api/demandas/${ids.d1}`)).status, 404);
  assert.equal((await bruno.req('DELETE', `/api/demandas/${ids.d1}`)).status, 404);
  r = await bruno.req('GET', '/api/demandas');
  assert.deepEqual(r.dados.demandas.map((d) => d.id), [ids.d2]);
  r = await admin.req('GET', '/api/demandas');
  assert.equal(r.dados.demandas.length, 2);
  assert.deepEqual(r.dados.indicadores, { total: 2, abertas: 1, concluidas: 1, vencidas: 1 });

  // Edição em linha
  r = await ana.req('PATCH', `/api/demandas/${ids.d1}`, { status: 'concluida' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.demanda.vencida, false);
  assert.equal(r.dados.demanda.titulo, 'Revisar contrato');
  r = await ana.req('PATCH', `/api/demandas/${ids.d1}`, { campos: { [ids.colData]: '2026-12-01', [ids.colArea]: '' } });
  assert.equal(r.dados.demanda.campos[ids.colData], '2026-12-01');
  assert.equal(r.dados.demanda.campos[ids.colArea], undefined);
  r = await ana.req('PATCH', `/api/demandas/${ids.d1}`, { cliente_id: ids.beta });
  assert.equal(r.status, 422);
});

test('filtros, busca e indicadores', async () => {
  await admin.req('PATCH', `/api/demandas/${ids.d1}`, { status: 'pendente' });
  let r = await admin.req('GET', '/api/demandas?busca=parecer');
  assert.equal(r.dados.demandas.length, 1);
  r = await admin.req('GET', '/api/demandas?busca=Financeira');
  assert.equal(r.dados.demandas.length, 1, 'busca por nome do cliente');
  r = await admin.req('GET', '/api/demandas?busca=1500');
  assert.equal(r.dados.demandas.length, 1, 'busca em campo personalizado');
  r = await admin.req('GET', '/api/demandas?prazo=vencidas');
  assert.deepEqual(r.dados.demandas.map((d) => d.id), [ids.d1]);
  r = await admin.req('GET', `/api/demandas?cliente=${ids.beta}`);
  assert.equal(r.dados.demandas.length, 1);
  assert.equal(r.dados.indicadores.total, 1);
  r = await admin.req('GET', `/api/demandas?responsavel=${ids.ana}&prioridade=alta&status=abertas`);
  assert.equal(r.dados.demandas.length, 1);
  r = await admin.req('GET', '/api/demandas?responsavel=nenhum');
  assert.equal(r.dados.demandas.length, 1);
  r = await admin.req('GET', '/api/demandas?prazo=periodo&de=2020-01-01&ate=2020-01-31');
  assert.equal(r.dados.demandas.length, 1);
  r = await admin.req('GET', '/api/demandas?prazo=sem_prazo');
  assert.equal(r.dados.demandas.length, 1);
});

test('cliente mostra suas demandas', async () => {
  const r = await ana.req('GET', `/api/clientes/${ids.alfa}`);
  assert.equal(r.status, 200);
  assert.equal(r.dados.demandas.length, 1);
  assert.equal(r.dados.demandas[0].status, 'pendente');
});

test('renomear e excluir coluna remove seus valores', async () => {
  let r = await admin.req('PUT', `/api/colunas/${ids.colArea}`, { nome: 'Área responsável', opcoes: ['Jurídico'] });
  assert.equal(r.status, 200);
  r = await admin.req('PUT', `/api/colunas/${ids.colValor}`, { nome: 'valor causa' });
  assert.equal(r.status, 200);
  r = await admin.req('DELETE', `/api/colunas/${ids.colValor}`);
  assert.equal(r.status, 200);
  r = await admin.req('GET', `/api/demandas/${ids.d1}`);
  assert.equal(r.dados.campos[ids.colValor], undefined);
  r = await admin.req('GET', '/api/colunas');
  assert.deepEqual(r.dados.map((c) => c.nome), ['Área responsável', 'Audiência']);
});

test('regras de usuários e exclusões', async () => {
  let r = await admin.req('PUT', `/api/usuarios/1`, { nome: 'Admin Geral', email: 'admin@teste.com', papel: 'usuario' });
  assert.equal(r.status, 400, 'não pode rebaixar a si mesmo');
  assert.equal((await admin.req('DELETE', '/api/usuarios/1')).status, 400);

  // Desativar encerra a sessão
  r = await admin.req('PUT', `/api/usuarios/${ids.bruno}`, { nome: 'Bruno', email: 'bruno@teste.com', papel: 'usuario', ativo: false, clienteIds: [ids.beta] });
  assert.equal(r.status, 200);
  assert.equal((await bruno.req('GET', '/api/demandas')).status, 401);
  assert.equal((await bruno.req('POST', '/api/auth/login', { email: 'bruno@teste.com', senha: 'Senha1234' })).status, 403);

  // Excluir cliente remove as demandas
  r = await admin.req('DELETE', `/api/clientes/${ids.beta}`);
  assert.match(r.dados.mensagem, /1 demanda/);
  r = await admin.req('GET', '/api/demandas');
  assert.equal(r.dados.demandas.length, 1);

  // Troca de senha
  r = await ana.req('POST', '/api/auth/senha', { senhaAtual: 'errada', novaSenha: 'NovaSenha99' });
  assert.equal(r.status, 422);
  r = await ana.req('POST', '/api/auth/senha', { senhaAtual: 'Senha1234', novaSenha: 'NovaSenha99' });
  assert.equal(r.status, 200);
  assert.equal((await ana.req('GET', '/api/demandas')).status, 200, 'sessão atual continua válida');
  r = await ana.req('POST', '/api/auth/logout');
  assert.equal((await ana.req('GET', '/api/demandas')).status, 401);
});
