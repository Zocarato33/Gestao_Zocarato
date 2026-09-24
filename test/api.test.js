'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Os testes rodam num schema temporário do PostgreSQL, apagado ao final (os dados reais não são afetados)
// Usa TEST_DATABASE_URL de propósito (e não DATABASE_URL) para nunca rodar os testes no banco de produção por engano
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:teste@localhost:5432/gestao';
process.env.DB_SCHEMA = `teste_${crypto.randomBytes(4).toString('hex')}`;

const app = require('../src/server');
const { pool } = require('../src/db');

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

test.after(async () => {
  servidor.close();
  await pool.query(`DROP SCHEMA IF EXISTS ${process.env.DB_SCHEMA} CASCADE`);
  await pool.end();
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

test('responsável que perdeu o acesso não bloqueia a edição da demanda', async () => {
  let r = await admin.req('POST', '/api/clientes', { nome: 'Construtora Delta' });
  ids.delta = r.dados.id;
  r = await admin.req('POST', '/api/usuarios', { nome: 'Carla', email: 'carla@teste.com', senha: 'Senha1234', clienteIds: [ids.delta] });
  ids.carla = r.dados.id;
  r = await admin.req('POST', '/api/demandas', { titulo: 'Due diligence', cliente_id: ids.delta, responsavel_id: ids.carla });
  assert.equal(r.status, 201);
  ids.d3 = r.dados.id;
  r = await admin.req('POST', '/api/demandas', { titulo: 'Notificação', cliente_id: ids.delta });
  ids.d4 = r.dados.id;

  // Carla é desativada: a demanda dela continua editável sem trocar o responsável
  r = await admin.req('PUT', `/api/usuarios/${ids.carla}`, { nome: 'Carla', email: 'carla@teste.com', papel: 'usuario', ativo: false, clienteIds: [ids.delta] });
  assert.equal(r.status, 200);
  r = await admin.req('PATCH', `/api/demandas/${ids.d3}`, { status: 'em_andamento' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.demanda.responsavel_id, ids.carla);
  r = await admin.req('GET', `/api/demandas/${ids.d3}`);
  r = await admin.req('PUT', `/api/demandas/${ids.d3}`, { ...r.dados, prioridade: 'alta' });
  assert.equal(r.status, 200);

  // Mas não pode ser atribuída a outra demanda nem acompanhar a troca de cliente
  r = await admin.req('PATCH', `/api/demandas/${ids.d4}`, { responsavel_id: ids.carla });
  assert.equal(r.status, 422);
  r = await admin.req('PATCH', `/api/demandas/${ids.d3}`, { cliente_id: ids.alfa });
  assert.equal(r.status, 422);
});

test('busca trata % e _ como texto literal', async () => {
  let r = await admin.req('GET', '/api/demandas?busca=%25');
  assert.equal(r.dados.demandas.length, 0);
  r = await admin.req('GET', '/api/demandas?busca=_');
  assert.equal(r.dados.demandas.length, 0);
  r = await admin.req('GET', '/api/clientes?busca=%25');
  assert.equal(r.dados.length, 0);
  r = await admin.req('GET', '/api/demandas?busca=diligence');
  assert.equal(r.dados.demandas.length, 1);
});

test('bloqueio de login após tentativas falhas fica registrado no banco', async () => {
  const c = new Cliente();
  for (let i = 0; i < 8; i++) {
    assert.equal((await c.req('POST', '/api/auth/login', { email: 'alvo@teste.com', senha: 'errada1' })).status, 401);
  }
  const r = await c.req('POST', '/api/auth/login', { email: 'alvo@teste.com', senha: 'errada1' });
  assert.equal(r.status, 429);
  const { rows } = await pool.query('SELECT contagem, bloqueado_ate FROM tentativas_login WHERE chave LIKE $1', ['%|alvo@teste.com']);
  assert.equal(rows[0].contagem, 8);
  assert.ok(rows[0].bloqueado_ate > Date.now());
});

test('datas de criação são devolvidas em ISO 8601', async () => {
  const r = await admin.req('GET', `/api/demandas/${ids.d3}`);
  assert.match(r.dados.criado_em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
});

test('colunas personalizadas de clientes', async () => {
  // Apenas administradores criam; nome é único por tela e pode repetir o de uma coluna de demanda
  assert.equal((await ana.req('POST', '/api/auth/login', { email: 'ana@teste.com', senha: 'NovaSenha99' })).status, 200);
  assert.equal((await ana.req('POST', '/api/colunas', { nome: 'Segmento', tipo: 'texto', entidade: 'cliente' })).status, 403);
  let r = await admin.req('POST', '/api/colunas', { nome: 'Telefone', tipo: 'texto', entidade: 'cliente' });
  assert.equal(r.status, 422, 'nome reservado de cliente');
  r = await admin.req('POST', '/api/colunas', { nome: 'Audiência', tipo: 'data', entidade: 'cliente' });
  assert.equal(r.status, 201, 'mesmo nome de coluna de demanda é permitido em clientes');
  ids.colCliData = r.dados.id;
  r = await admin.req('POST', '/api/colunas', { nome: 'Segmento', tipo: 'lista', opcoes: ['Banco', 'Varejo'], entidade: 'cliente' });
  ids.colCliSeg = r.dados.id;
  r = await admin.req('POST', '/api/colunas', { nome: 'segmento', tipo: 'texto', entidade: 'cliente' });
  assert.equal(r.status, 422, 'nome duplicado na mesma tela');

  // As listas não se misturam
  r = await admin.req('GET', '/api/colunas?entidade=cliente');
  assert.deepEqual(r.dados.map((c) => c.nome), ['Audiência', 'Segmento']);
  r = await admin.req('GET', '/api/colunas');
  assert.ok(r.dados.every((c) => c.entidade === 'demanda'));

  // Validação e gravação dos valores
  r = await admin.req('POST', '/api/clientes', { nome: 'Varejo Ômega', campos: { [ids.colCliSeg]: 'Indústria' } });
  assert.equal(r.status, 422);
  assert.ok(r.dados.campos[`campo_${ids.colCliSeg}`]);
  r = await admin.req('POST', '/api/clientes', { nome: 'Varejo Ômega', campos: { [ids.colCliSeg]: 'Varejo', [ids.colCliData]: '2026-11-03' } });
  assert.equal(r.status, 201);
  ids.omega = r.dados.id;
  r = await admin.req('GET', `/api/clientes/${ids.omega}`);
  assert.deepEqual(r.dados.campos, { [ids.colCliSeg]: 'Varejo', [ids.colCliData]: '2026-11-03' });

  // Edição altera só os campos enviados; valor vazio apaga
  r = await admin.req('PUT', `/api/clientes/${ids.omega}`, { nome: 'Varejo Ômega', campos: { [ids.colCliData]: '' } });
  assert.equal(r.status, 200);
  r = await admin.req('GET', '/api/clientes');
  const omega = r.dados.find((c) => c.id === ids.omega);
  assert.deepEqual(omega.campos, { [ids.colCliSeg]: 'Varejo' });

  // Busca encontra pelo valor da coluna personalizada
  r = await admin.req('GET', '/api/clientes?busca=varejo');
  assert.deepEqual(r.dados.map((c) => c.id), [ids.omega]);

  // Remover opção da lista apaga os valores; excluir a coluna também
  r = await admin.req('PUT', `/api/colunas/${ids.colCliSeg}`, { nome: 'Segmento', opcoes: ['Banco'] });
  assert.match(r.dados.mensagem, /1 valor/);
  r = await admin.req('DELETE', `/api/colunas/${ids.colCliData}`);
  assert.equal(r.status, 200);
  r = await admin.req('GET', '/api/colunas?entidade=cliente');
  assert.deepEqual(r.dados.map((c) => c.nome), ['Segmento']);
});
