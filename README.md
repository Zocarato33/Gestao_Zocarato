# Gestão de Clientes e Demandas

Sistema web para cadastrar clientes, registrar demandas e acompanhar prazos, com autenticação, controle de acesso por cliente, colunas personalizadas e tabela editável. Funciona em computador e celular.

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação e execução](#2-instalação-e-execução)
3. [Configuração](#3-configuração)
4. [Banco de dados](#4-banco-de-dados)
5. [Primeiro acesso](#5-primeiro-acesso)
6. [Perfis e controle de acesso](#6-perfis-e-controle-de-acesso)
7. [Como usar](#7-como-usar)
8. [Execução com Docker](#8-execução-com-docker)
9. [Colocando em produção](#9-colocando-em-produção)
10. [Testes automatizados](#10-testes-automatizados)
11. [Estrutura do projeto](#11-estrutura-do-projeto)
12. [API](#12-api)
13. [Solução de problemas](#13-solução-de-problemas)

---

## 1. Requisitos

| Item | Versão |
|---|---|
| Node.js | 22.13 ou superior (recomendado: versão LTS mais recente) |
| npm | Instalado junto com o Node.js |
| Sistema operacional | Windows, macOS ou Linux |
| Navegador | Chrome, Edge, Firefox ou Safari atualizados |

O banco de dados é o SQLite embutido no próprio Node.js. Não é preciso instalar nenhum servidor de banco nem compilar módulos nativos.

Para conferir a versão do Node.js instalada:

```bash
node --version
```

Se estiver abaixo de 22.13, baixe a versão LTS em https://nodejs.org.

## 2. Instalação e execução

```bash
# 1. Entre na pasta do projeto
cd gestao-demandas

# 2. Instale as dependências
npm install

# 3. Crie o arquivo de configuração a partir do modelo
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env

# 4. Inicie o sistema
npm start
```

Abra **http://localhost:3000** no navegador.

Para desenvolvimento, `npm run dev` reinicia o servidor automaticamente a cada alteração nos arquivos.

Para acessar pelo celular na mesma rede, use o endereço IP do computador, por exemplo `http://192.168.0.10:3000`. Pode ser necessário liberar a porta no firewall.

## 3. Configuração

As configurações ficam no arquivo `.env` na raiz do projeto. Todas são opcionais.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP do servidor |
| `DB_PATH` | `./data/gestao.db` | Caminho do arquivo do banco de dados |
| `APP_TZ` | `America/Sao_Paulo` | Fuso horário usado para calcular prazos vencidos |
| `SESSAO_HORAS` | `12` | Tempo de inatividade até a sessão expirar |
| `COOKIE_SECURE` | `false` | Use `true` quando o sistema estiver atrás de HTTPS |
| `TRUST_PROXY` | `false` | Use `true` se houver proxy reverso (Nginx, Caddy, IIS) |

## 4. Banco de dados

### Criação

O banco é criado **automaticamente** na primeira execução, no caminho definido em `DB_PATH`. As tabelas e índices também são criados automaticamente. Não há script manual a rodar.

### Tabelas

| Tabela | Conteúdo |
|---|---|
| `usuarios` | Contas de acesso, perfil (administrador ou usuário) e situação |
| `sessoes` | Sessões ativas (apenas o hash do token é guardado) |
| `clientes` | Cadastro de clientes |
| `usuario_clientes` | Quais clientes cada usuário comum pode acessar |
| `demandas` | Demandas com todos os campos padrão |
| `colunas` | Definição das colunas personalizadas (nome, tipo e opções) |
| `valores_colunas` | Valores das colunas personalizadas em cada demanda |

Regras de integridade aplicadas pelo próprio banco:

- Excluir um cliente exclui as demandas dele.
- Excluir uma coluna personalizada exclui os valores dela.
- Excluir um usuário deixa as demandas dele sem responsável.

### Backup

O banco inteiro fica em um único arquivo. Para backup com o sistema em uso, prefira o comando do SQLite, que gera uma cópia consistente:

```bash
sqlite3 data/gestao.db ".backup 'backup-2026-09-24.db'"
```

Com o sistema parado, basta copiar o arquivo `data/gestao.db` (e os arquivos `-wal` e `-shm`, se existirem).

Para restaurar, pare o sistema, substitua o arquivo e inicie novamente.

## 5. Primeiro acesso

Ao abrir o sistema com o banco vazio, aparece a tela **Primeiro acesso**. Preencha nome, e-mail e senha para criar o administrador. Essa tela deixa de existir assim que o primeiro usuário é criado.

Alternativa pela linha de comando (útil em servidores ou para recuperar acesso):

```bash
npm run criar-admin
```

O script pergunta nome, e-mail e senha. Se o e-mail já existir, a conta é reativada, promovida a administrador e recebe a nova senha.

Regras de senha: mínimo de 8 caracteres, com letras e números.

## 6. Perfis e controle de acesso

| Ação | Administrador | Usuário |
|---|---|---|
| Ver clientes e demandas | Todos | Apenas dos clientes liberados para ele |
| Cadastrar, editar e excluir clientes | Sim | Sim, nos clientes a que tem acesso |
| Cadastrar, editar e excluir demandas | Sim | Sim, nos clientes a que tem acesso |
| Criar, renomear e excluir colunas personalizadas | Sim | Não (preenche os valores normalmente) |
| Gerenciar usuários e liberar clientes | Sim | Não |

Detalhes importantes:

- Quando um usuário comum cadastra um cliente, ele recebe acesso a esse cliente automaticamente.
- O responsável por uma demanda precisa ter acesso ao cliente dela. A lista de responsáveis mostra apenas quem pode atender o cliente escolhido.
- Toda verificação é feita no servidor. Mesmo digitando o endereço de um cliente ou demanda sem permissão, o sistema responde como "não encontrado".
- Desativar um usuário encerra imediatamente as sessões dele.
- O sistema impede remover o último administrador ativo e impede que um administrador rebaixe, desative ou exclua a própria conta.

A gestão de colunas é restrita a administradores porque excluir uma coluna apaga os dados dela em todas as demandas.

## 7. Como usar

### Tela de demandas (inicial)

- **Indicadores**: totais, em aberto, concluídas e vencidas. Clicar em um indicador filtra a tabela. Os números respeitam a busca e os filtros de cliente, responsável e prioridade.
- **Pesquisa**: procura em título, descrição, observações, nome do cliente, valores das colunas personalizadas e número da demanda (por exemplo, `#12`).
- **Filtros**: cliente, responsável (inclui "sem responsável"), status (inclui "em aberto"), prioridade e prazo (vencidas, vencem hoje, próximos 7 dias, sem prazo ou período específico). Os filtros ficam guardados no navegador.
- **Ordenação**: clique no nome da coluna. Clique de novo para inverter e uma terceira vez para voltar à ordem padrão (pendências primeiro, por prazo).
- **Edição direta**: altere título, cliente, responsável, status, prioridade, prazo ou colunas personalizadas na própria tabela. Cada alteração é salva ao sair do campo ou pressionar Enter. Em caso de erro, o valor anterior é restaurado e a mensagem explica o motivo.
- **Prazos vencidos**: a linha recebe fundo e faixa vermelhos, e o prazo mostra há quantos dias venceu. Demandas concluídas nunca aparecem como vencidas.
- **Abrir demanda**: o ícone de abrir (ou o número) mostra o formulário completo com descrição, observações e histórico de criação e alteração.

### Colunas personalizadas (administrador)

- Botão **Colunas** na tela de demandas: lista as colunas, permite criar novas e renomear ou excluir existentes.
- Tipos: **texto**, **número** (aceita vírgula decimal, como `1500,50`), **data** e **lista de opções** (uma opção por linha).
- O menu de três pontos no cabeçalho de cada coluna personalizada também permite renomear ou excluir.
- Ao excluir, o sistema pede confirmação e informa quantas demandas têm valor preenchido que será apagado.
- O tipo não pode ser alterado depois da criação. Nas listas, é possível editar as opções; valores de opções removidas são apagados e o sistema informa quantos.

### Clientes

- Lista com busca e contagem de demandas totais, em aberto e vencidas de cada cliente.
- Ao abrir um cliente: dados cadastrais, resumo por status e lista das demandas com status, prioridade, prazo e responsável. É possível criar uma demanda já vinculada ao cliente.
- CPF ou CNPJ é opcional, mas se preenchido precisa ter 11 ou 14 dígitos.

### Usuários (administrador)

- Cadastro com nome, e-mail, senha, perfil e situação (ativo ou desativado).
- Para usuários comuns, marque os clientes que a pessoa poderá acessar.
- Na edição, deixe a senha em branco para mantê-la.

### Minha conta

Clique no seu nome (ou nas iniciais, no celular) para alterar a senha. As outras sessões abertas são encerradas.

## 8. Execução com Docker

```bash
docker compose up -d --build
```

O sistema fica disponível em http://localhost:3000 e o banco é guardado no volume `dados`, preservado entre reinicializações e atualizações.

Criar administrador pelo terminal dentro do contêiner:

```bash
docker compose exec gestao-demandas node --disable-warning=ExperimentalWarning scripts/criar-admin.js
```

Backup do banco a partir do contêiner:

```bash
docker compose cp gestao-demandas:/app/data/gestao.db ./backup.db
```

## 9. Colocando em produção

1. **Use HTTPS.** Coloque o sistema atrás de um proxy reverso (Nginx, Caddy, IIS ou o balanceador da sua nuvem) com certificado válido, e configure `COOKIE_SECURE=true` e `TRUST_PROXY=true`.
2. **Mantenha o processo ativo.** Use Docker (`restart: unless-stopped` já está configurado), systemd, PM2 ou o serviço equivalente do seu servidor.
3. **Agende backups** do arquivo do banco.
4. **Restrinja o acesso à pasta `data/`**, que contém o banco.

Exemplo mínimo de Nginx:

```nginx
server {
    listen 443 ssl;
    server_name demandas.suaempresa.com.br;
    # ssl_certificate e ssl_certificate_key aqui

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Capacidade: o SQLite atende bem equipes de dezenas de usuários simultâneos e dezenas de milhares de demandas. Para volumes muito maiores ou vários servidores em paralelo, o próximo passo seria migrar para PostgreSQL.

### Medidas de segurança implementadas

- Senhas armazenadas com scrypt e sal individual; comparação em tempo constante.
- Sessão em cookie `HttpOnly` e `SameSite=Strict`; no banco fica apenas o hash do token.
- Bloqueio temporário após 8 tentativas de login falhas em 15 minutos.
- Proteção contra CSRF por cabeçalho obrigatório nas operações que alteram dados.
- Política de segurança de conteúdo (CSP) que só permite scripts do próprio sistema.
- Todo texto vindo do banco é exibido como texto puro, o que impede injeção de HTML.
- Consultas SQL sempre parametrizadas.
- Validação de todos os campos no navegador e novamente no servidor.

## 10. Testes automatizados

```bash
npm test
```

Os testes usam um banco temporário (o banco real não é afetado) e cobrem: primeiro acesso, login, isolamento de dados entre usuários, validações, colunas personalizadas, filtros, indicadores, exclusões em cascata e regras de administração.

## 11. Estrutura do projeto

```
gestao-demandas/
├── src/
│   ├── server.js           Servidor, segurança e tratamento de erros
│   ├── db.js               Conexão e criação do banco
│   ├── auth.js             Senhas, sessões e controle de acesso
│   ├── validacao.js        Regras de validação e constantes
│   └── rotas/              auth, usuarios, clientes, demandas, colunas
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/                 app, api, ui, painel, demandaForm, colunas, clientes, usuarios
├── scripts/criar-admin.js
├── test/api.test.js
├── data/                   Banco de dados (criado automaticamente)
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

## 12. API

Todas as rotas ficam em `/api`, exigem sessão (exceto as de autenticação) e respondem em JSON. Requisições que alteram dados precisam do cabeçalho `X-Requested-With: gestao-demandas`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/auth/status` | Usuário logado e se o sistema precisa de configuração inicial |
| POST | `/api/auth/configurar` | Cria o primeiro administrador |
| POST | `/api/auth/login` | Entrar |
| POST | `/api/auth/logout` | Sair |
| POST | `/api/auth/senha` | Alterar a própria senha |
| GET, POST | `/api/clientes` | Listar (`?busca=`) e cadastrar |
| GET, PUT, DELETE | `/api/clientes/:id` | Consultar com demandas, editar e excluir |
| GET, POST | `/api/demandas` | Listar com filtros e indicadores; criar |
| GET, PUT, PATCH, DELETE | `/api/demandas/:id` | Consultar, editar completo, editar parcial e excluir |
| GET, POST | `/api/colunas` | Listar e criar (criar exige administrador) |
| PUT, DELETE | `/api/colunas/:id` | Renomear e excluir (administrador) |
| GET | `/api/usuarios/opcoes` | Pessoas que podem ser responsáveis |
| GET, POST | `/api/usuarios` | Listar e cadastrar (administrador) |
| PUT, DELETE | `/api/usuarios/:id` | Editar e excluir (administrador) |

Filtros de `GET /api/demandas`: `busca`, `cliente`, `responsavel` (id ou `nenhum`), `status` (`pendente`, `em_andamento`, `aguardando_cliente`, `concluida` ou `abertas`), `prioridade` (`baixa`, `normal`, `alta`, `urgente`), `prazo` (`vencidas`, `hoje`, `semana`, `sem_prazo`, `periodo` com `de` e `ate`), `ordenar` e `direcao`.

Erros de validação retornam status 422 com o formato `{ "erro": "mensagem", "campos": { "campo": "motivo" } }`.

## 13. Solução de problemas

**"No such built-in module: node:sqlite"**
A versão do Node.js é antiga. Instale a 22.13 ou superior.

**A porta 3000 já está em uso**
Altere `PORT` no arquivo `.env`.

**Esqueci a senha do administrador**
Rode `npm run criar-admin` com o mesmo e-mail e informe uma nova senha.

**Não consigo entrar: "Muitas tentativas de acesso"**
Aguarde 15 minutos ou reinicie o servidor.

**Os prazos aparecem como vencidos um dia antes ou depois**
Confira a variável `APP_TZ`.

**A fonte da interface não carrega sem internet**
A fonte Plus Jakarta Sans vem do Google Fonts. Sem internet, o sistema usa automaticamente uma fonte do sistema operacional, sem perda de funcionalidade.
