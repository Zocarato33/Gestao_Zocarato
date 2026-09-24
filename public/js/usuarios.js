import {
  el, icone, limpar, campo, opcoesSelect, abrirModal, confirmar, sucesso, erro, ocupado, limparErros,
  tratarErroFormulario, vazio,
} from './ui.js';
import { get, post, put, del, estado, recarregarClientes } from './api.js';

const PAPEIS = { usuario: 'Usuário', admin: 'Administrador' };

function abrirFormUsuario(u, aoSalvar) {
  const m = abrirModal({
    titulo: u ? 'Editar usuário' : 'Novo usuário',
    subtitulo: u ? u.email : 'A pessoa usará o e-mail e a senha para entrar.',
    largura: 'grande',
  });
  const nome = el('input', { type: 'text', value: u?.nome || '', maxlength: 120, required: true, autocomplete: 'off' });
  const email = el('input', { type: 'email', value: u?.email || '', maxlength: 160, required: true, autocomplete: 'off' });
  const senha = el('input', { type: 'password', maxlength: 128, autocomplete: 'new-password', placeholder: u ? 'Deixe em branco para manter' : '' });
  const papel = el('select', {}, opcoesSelect(PAPEIS, u?.papel || 'usuario'));
  const ativo = el('input', { type: 'checkbox', checked: u ? u.ativo : true });
  const ehProprio = u && u.id === estado.usuario.id;
  if (ehProprio) { papel.disabled = true; ativo.disabled = true; }

  const selecionados = new Set(u?.clientes || []);
  const filtroCli = el('input', { type: 'search', placeholder: 'Filtrar clientes', 'aria-label': 'Filtrar clientes' });
  const listaCli = el('div', { class: 'lista-checagem' });
  const contador = el('span', { class: 'meta' });
  function renderClientes() {
    const t = filtroCli.value.trim().toLowerCase();
    limpar(listaCli);
    const visiveis = estado.clientes.filter((c) => !t || c.nome.toLowerCase().includes(t));
    if (!estado.clientes.length) listaCli.append(el('p', { class: 'meta', text: 'Nenhum cliente cadastrado ainda.' }));
    for (const c of visiveis) {
      const cb = el('input', { type: 'checkbox', checked: selecionados.has(c.id) });
      cb.addEventListener('change', () => { if (cb.checked) selecionados.add(c.id); else selecionados.delete(c.id); atualizarContador(); });
      listaCli.append(el('label', { class: 'checagem' }, cb, el('span', { text: c.nome })));
    }
    atualizarContador();
  }
  function atualizarContador() { contador.textContent = `${selecionados.size} selecionado(s)`; }
  filtroCli.addEventListener('input', renderClientes);

  const blocoAcesso = el('fieldset', { class: 'grupo-extra' },
    el('legend', { text: 'Clientes que esta pessoa pode acessar' }),
    el('p', { class: 'meta', text: 'Ela verá apenas esses clientes e as demandas deles. Administradores acessam tudo.' }),
    el('div', { class: 'barra-checagem' }, filtroCli, contador,
      el('button', { type: 'button', class: 'botao botao-texto botao-pequeno', text: 'Marcar todos', onClick: () => { estado.clientes.forEach((c) => selecionados.add(c.id)); renderClientes(); } }),
      el('button', { type: 'button', class: 'botao botao-texto botao-pequeno', text: 'Desmarcar', onClick: () => { selecionados.clear(); renderClientes(); } })),
    listaCli);
  const atualizarBloco = () => { blocoAcesso.hidden = papel.value === 'admin'; };
  papel.addEventListener('change', atualizarBloco);

  const form = el('form', { class: 'formulario', novalidate: true, id: `fu-${Date.now()}` },
    el('div', { class: 'grade grade-2' },
      campo('Nome completo', nome, { nome: 'nome', obrigatorio: true }),
      campo('E-mail', email, { nome: 'email', obrigatorio: true }),
      campo(u ? 'Nova senha' : 'Senha', senha, { nome: 'senha', obrigatorio: !u, ajuda: 'Mínimo de 8 caracteres, com letras e números.' }),
      campo('Perfil', papel, { nome: 'papel', obrigatorio: true, ajuda: ehProprio ? 'Você não pode alterar o próprio perfil.' : undefined }),
      el('label', { class: 'checagem coluna-inteira' }, ativo, el('span', { text: 'Conta ativa (pode entrar no sistema)' }))),
    blocoAcesso);
  const salvar = el('button', { type: 'submit', class: 'botao botao-primario', form: form.id, text: u ? 'Salvar alterações' : 'Cadastrar usuário' });
  m.corpo.append(form);
  m.rodape.append(el('button', { type: 'button', class: 'botao botao-secundario', text: 'Cancelar', onClick: () => m.fechar() }), salvar);
  renderClientes();
  atualizarBloco();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(form);
    const locais = {};
    if (!nome.value.trim()) locais.nome = 'Informe o nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) locais.email = 'Informe um e-mail válido.';
    if ((!u || senha.value) && (senha.value.length < 8 || !/[A-Za-z]/.test(senha.value) || !/\d/.test(senha.value))) {
      locais.senha = 'A senha deve ter ao menos 8 caracteres, com letras e números.';
    }
    if (Object.keys(locais).length) {
      tratarErroFormulario(form, { campos: locais, message: '' });
      return;
    }
    const corpo = {
      nome: nome.value, email: email.value, senha: senha.value || undefined,
      papel: papel.value, ativo: ativo.checked, clienteIds: [...selecionados],
    };
    await ocupado(salvar, async () => {
      try {
        const r = u ? await put(`/api/usuarios/${u.id}`, corpo) : await post('/api/usuarios', corpo);
        sucesso(r.mensagem);
        await recarregarClientes();
        m.fechar();
        aoSalvar();
      } catch (e) {
        tratarErroFormulario(form, e);
      }
    });
  });
  nome.focus();
}

export function renderUsuarios(raiz) {
  const area = el('div', { class: 'tabela-area' });
  limpar(raiz).append(
    el('header', { class: 'cabecalho-pagina' },
      el('div', {}, el('h1', { text: 'Usuários e acessos' }), el('p', { class: 'cabecalho-texto', text: 'Defina quem entra no sistema e quais clientes cada pessoa enxerga.' })),
      el('div', { class: 'cabecalho-acoes' },
        el('button', { type: 'button', class: 'botao botao-primario', onClick: () => abrirFormUsuario(null, carregar) }, icone('mais', 18), el('span', { text: 'Novo usuário' })))),
    area);

  async function carregar() {
    area.classList.add('carregando');
    try {
      const lista = await get('/api/usuarios');
      const nomes = new Map(estado.clientes.map((c) => [c.id, c.nome]));
      limpar(area);
      if (!lista.length) { area.append(vazio('Nenhum usuário.', '')); return; }
      const linhaUsuario = (u) => el('tr', {},
        el('td', { dataset: { rotulo: 'Nome' } }, el('strong', { text: u.nome }), el('small', { class: 'celula-sub', text: u.email })),
        el('td', { dataset: { rotulo: 'Perfil' }, text: PAPEIS[u.papel] }),
        el('td', {
          dataset: { rotulo: 'Acesso' }, class: 'celula-quebra',
          text: u.papel === 'admin' ? 'Todos os clientes' : (u.clientes.map((id) => nomes.get(id)).filter(Boolean).join(', ') || 'Nenhum cliente'),
        }),
        el('td', { class: 'num', dataset: { rotulo: 'Em aberto' }, text: String(u.demandas_abertas) }),
        el('td', { dataset: { rotulo: 'Situação' } },
          el('span', { class: `chip ${u.ativo ? 'chip-ativo' : 'chip-inativo'}`, text: u.ativo ? 'Ativo' : 'Desativado' })),
        el('td', { class: 'col-acoes', dataset: { rotulo: 'Ações' } },
          el('div', { class: 'acoes-linha' },
            el('button', { type: 'button', class: 'botao-icone', title: 'Editar', 'aria-label': `Editar ${u.nome}`, onClick: () => abrirFormUsuario(u, carregar) }, icone('lapis', 17)),
            u.id !== estado.usuario.id
              ? el('button', { type: 'button', class: 'botao-icone perigo', title: 'Excluir', 'aria-label': `Excluir ${u.nome}`, onClick: () => excluir(u) }, icone('lixeira', 17))
              : null)));
      const thead = el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'Nome' }), el('th', { scope: 'col', text: 'Perfil' }),
        el('th', { scope: 'col', text: 'Acesso a clientes' }), el('th', { scope: 'col', class: 'num', text: 'Demandas em aberto' }),
        el('th', { scope: 'col', text: 'Situação' }), el('th', { scope: 'col', class: 'col-acoes' }, el('span', { class: 'sr', text: 'Ações' }))));
      area.append(el('div', { class: 'tabela-rolagem' },
        el('table', { class: 'tabela tabela-usuarios' }, thead, el('tbody', {}, lista.map(linhaUsuario)))));
    } catch (e) {
      limpar(area).append(vazio('Não foi possível carregar os usuários.', e.message));
    } finally {
      area.classList.remove('carregando');
    }
  }

  async function excluir(u) {
    const ok = await confirmar({
      titulo: 'Excluir usuário?',
      mensagem: `${u.nome} perderá o acesso ao sistema imediatamente.`,
      detalhe: u.demandas_abertas
        ? `${u.demandas_abertas} demanda(s) em aberto ficarão sem responsável. Para apenas bloquear o acesso, prefira desativar a conta.`
        : 'Para apenas bloquear o acesso, prefira desativar a conta. Esta ação não pode ser desfeita.',
      botao: 'Excluir usuário',
    });
    if (!ok) return;
    try {
      const r = await del(`/api/usuarios/${u.id}`);
      sucesso(r.mensagem);
      await recarregarClientes();
      carregar();
    } catch (e) {
      erro(e.message);
    }
  }

  carregar();
}
