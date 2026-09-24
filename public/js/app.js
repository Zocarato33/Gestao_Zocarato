import {
  el, icone, limpar, campo, abrirModal, sucesso, erro, ocupado, limparErros, tratarErroFormulario,
} from './ui.js';
import { get, post, estado, ehAdmin, carregarApoio, definirAoExpirarSessao } from './api.js';
import { renderPainel } from './painel.js';
import { renderClientes, renderCliente } from './clientes.js';
import { renderUsuarios } from './usuarios.js';
import { renderPrecos } from './precos.js';
import { renderLayoutCampos } from './layoutCampos.js';

const NOME_SISTEMA = 'Gestor Legal Oper';

const app = document.getElementById('app');

function marca(clara = false) {
  return el('div', { class: `marca${clara ? ' marca-clara' : ''}` },
    el('span', { class: 'marca-simbolo', 'aria-hidden': 'true' }, el('span'), el('span')),
    el('span', { class: 'marca-nome' }, el('strong', { text: 'Gestor' }), el('span', { text: 'Legal Oper' })));
}

// ---------- Acesso ----------

function telaAcesso({ titulo, texto, campos, botao, aoEnviar }) {
  const form = el('form', { class: 'formulario', novalidate: true });
  const enviar = el('button', { type: 'submit', class: 'botao botao-primario botao-largo', text: botao });
  form.append(...campos, enviar);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    await ocupado(enviar, async () => {
      try {
        await aoEnviar(form);
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  limpar(app).append(el('main', { class: 'acesso' },
    el('div', { class: 'acesso-lateral', 'aria-hidden': 'true' },
      el('div', { class: 'cartoes-deco' }, el('span'), el('span'), el('span'))),
    el('section', { class: 'acesso-cartao' },
      marca(),
      el('h1', { text: titulo }),
      texto ? el('p', { class: 'acesso-texto', text: texto }) : null,
      form)));
  form.querySelector('input')?.focus();
}

function telaLogin() {
  const email = el('input', { type: 'email', autocomplete: 'username', required: true });
  const senha = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  telaAcesso({
    titulo: 'Entrar',
    texto: 'Use o e-mail e a senha cadastrados pelo administrador.',
    campos: [campo('E-mail', email, { nome: 'email' }), campo('Senha', senha, { nome: 'senha' })],
    botao: 'Entrar',
    aoEnviar: async () => {
      const r = await post('/api/auth/login', { email: email.value, senha: senha.value });
      estado.usuario = r.usuario;
      sucesso(r.mensagem);
      await iniciarSistema();
    },
  });
}

function telaConfiguracao() {
  const nome = el('input', { type: 'text', autocomplete: 'name', maxlength: 120 });
  const email = el('input', { type: 'email', autocomplete: 'username', maxlength: 160 });
  const senha = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const confirmacao = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  telaAcesso({
    titulo: 'Primeiro acesso',
    texto: 'Crie a conta de administrador. Depois você poderá cadastrar clientes e convidar a equipe.',
    campos: [
      campo('Nome completo', nome, { nome: 'nome', obrigatorio: true }),
      campo('E-mail', email, { nome: 'email', obrigatorio: true }),
      campo('Senha', senha, { nome: 'senha', obrigatorio: true, ajuda: 'Mínimo de 8 caracteres, com letras e números.' }),
      campo('Confirme a senha', confirmacao, { nome: 'confirmacao', obrigatorio: true }),
    ],
    botao: 'Criar administrador',
    aoEnviar: async (form) => {
      if (senha.value !== confirmacao.value) {
        tratarErroFormulario(form, { campos: { confirmacao: 'As senhas não conferem.' }, message: '' });
        return;
      }
      const r = await post('/api/auth/configurar', { nome: nome.value, email: email.value, senha: senha.value });
      estado.usuario = r.usuario;
      sucesso(r.mensagem);
      await iniciarSistema();
    },
  });
}

function abrirMinhaConta() {
  const m = abrirModal({ titulo: 'Minha conta', subtitulo: `${estado.usuario.nome}, ${estado.usuario.email}`, largura: 'pequena' });
  const atual = el('input', { type: 'password', autocomplete: 'current-password' });
  const nova = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const conf = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const form = el('form', { class: 'formulario', novalidate: true, id: 'form-senha' },
    el('h3', { class: 'subtitulo-secao', text: 'Alterar senha' }),
    campo('Senha atual', atual, { nome: 'senhaAtual', obrigatorio: true }),
    campo('Nova senha', nova, { nome: 'novaSenha', obrigatorio: true, ajuda: 'Mínimo de 8 caracteres, com letras e números. Outras sessões abertas serão encerradas.' }),
    campo('Confirme a nova senha', conf, { nome: 'confirmacao', obrigatorio: true }));
  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', form: 'form-senha', text: 'Alterar senha' });
  m.corpo.append(form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() }), salvar);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    if (nova.value !== conf.value) {
      tratarErroFormulario(form, { campos: { confirmacao: 'As senhas não conferem.' }, message: '' });
      return;
    }
    await ocupado(salvar, async () => {
      try {
        const r = await post('/api/auth/senha', { senhaAtual: atual.value, novaSenha: nova.value });
        sucesso(r.mensagem);
        m.fechar();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  atual.focus();
}

async function sair() {
  try {
    const r = await post('/api/auth/logout');
    sucesso(r.mensagem);
  } catch { /* segue para a tela de login */ }
  estado.usuario = null;
  telaLogin();
}

// ---------- Estrutura e rotas ----------

let conteudo = null;
let navLinks = [];

function montarLayout() {
  const itens = [
    { rota: 'demandas', rotulo: 'Demandas', icone: 'demandas' },
    { rota: 'clientes', rotulo: 'Clientes', icone: 'clientes' },
    ...(ehAdmin() ? [
      { rota: 'precos', rotulo: 'Tabela de Preços', curto: 'Preços', icone: 'preco' },
      { rota: 'layout', rotulo: 'Layout | Regras Campos', curto: 'Layout', icone: 'layout' },
      { rota: 'usuarios', rotulo: 'Usuários', icone: 'usuarios' },
    ] : []),
  ];
  navLinks = itens.map((i) => el('a', { href: `#/${i.rota}`, class: 'nav-link', dataset: { rota: i.rota }, 'aria-label': i.curto ? i.rotulo : undefined },
    icone(i.icone, 20), el('span', { class: i.curto ? 'nav-rotulo' : '', text: i.rotulo }),
    i.curto ? el('span', { class: 'nav-rotulo-curto', 'aria-hidden': 'true', text: i.curto }) : null));
  conteudo = el('main', { class: 'conteudo', id: 'conteudo', tabindex: '-1' });
  const iniciais = estado.usuario.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  limpar(app).append(el('div', { class: 'layout' },
    el('button', { type: 'button', class: 'pular', text: 'Pular para o conteúdo', onClick: () => conteudo.focus() }),
    el('aside', { class: 'lateral' },
      marca(true),
      el('nav', { class: 'nav', 'aria-label': 'Principal' }, navLinks),
      el('div', { class: 'lateral-usuario' },
        el('button', { type: 'button', class: 'usuario-botao', onClick: abrirMinhaConta, title: 'Minha conta' },
          el('span', { class: 'avatar', text: iniciais, 'aria-hidden': 'true' }),
          el('span', { class: 'usuario-textos' },
            el('strong', { text: estado.usuario.nome }),
            el('small', { text: ehAdmin() ? 'Administrador' : 'Usuário' }))),
        el('button', { type: 'button', class: 'botao-icone claro', title: 'Sair', 'aria-label': 'Sair do sistema', onClick: sair }, icone('sair', 20)))),
    conteudo));
}

function rotear() {
  if (!estado.usuario || !conteudo) return;
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const rota = partes[0] || 'demandas';
  navLinks.forEach((a) => {
    const ativo = a.dataset.rota === rota;
    a.classList.toggle('ativo', ativo);
    if (ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  window.scrollTo(0, 0);
  if (rota === 'clientes' && partes[1]) {
    renderCliente(conteudo, Number(partes[1]));
    document.title = `Cliente | ${NOME_SISTEMA}`;
  } else if (rota === 'clientes') {
    renderClientes(conteudo);
    document.title = `Clientes | ${NOME_SISTEMA}`;
  } else if (rota === 'precos' && ehAdmin()) {
    renderPrecos(conteudo);
    document.title = `Tabela de Preços | ${NOME_SISTEMA}`;
  } else if (rota === 'layout' && ehAdmin()) {
    renderLayoutCampos(conteudo);
    document.title = `Layout | Regras Campos | ${NOME_SISTEMA}`;
  } else if (rota === 'usuarios' && ehAdmin()) {
    renderUsuarios(conteudo);
    document.title = `Usuários | ${NOME_SISTEMA}`;
  } else {
    if (rota !== 'demandas') { history.replaceState(null, '', '#/demandas'); rotear(); return; }
    renderPainel(conteudo);
    document.title = `Demandas | ${NOME_SISTEMA}`;
  }
}

async function iniciarSistema() {
  try {
    await carregarApoio();
  } catch (e) {
    erro(e.message);
    return;
  }
  montarLayout();
  rotear();
}

definirAoExpirarSessao((e) => {
  if (!estado.usuario) return;
  estado.usuario = null;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  erro(e.message);
  telaLogin();
});

window.addEventListener('hashchange', rotear);

(async function iniciar() {
  try {
    const s = await get('/api/auth/status');
    if (s.precisaConfigurar) return telaConfiguracao();
    if (!s.usuario) return telaLogin();
    estado.usuario = s.usuario;
    await iniciarSistema();
  } catch (e) {
    limpar(app).append(el('div', { class: 'carregando-inicial' },
      el('p', { text: e.message }),
      el('button', { type: 'button', class: 'botao botao-primario', text: 'Tentar novamente', onClick: () => location.reload() })));
  }
}());
