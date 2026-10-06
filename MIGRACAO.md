> **Nota para este repositório:** aqui não há pasta `app/` (o `app/js/config.js` e o `app/css/` deste texto são `js/config.js` e `css/`), não há Supabase CLI ligado (as migrações correm-se uma a uma, por ordem, no editor de SQL do painel do Supabase) e o resultado publica-se com `node build-hosted.js` e a cópia de `dist-hosted/index.html` para `docs/index.html` (GitHub Pages).

# Instalação das Fichas de decoração e dos Pedidos de preço

Este pacote acrescenta duas secções à aplicação que já existe (a Ficha técnica fica exatamente como está):

- **Fichas de decoração**: a ficha de cada decoração de um modelo, com croqui anotado e impressão A4.
- **Pedidos de preço**: quadro dos pedidos de preço por etapa, dashboard de indicadores, avisos por email e
  perfis de acesso.

As duas começam **vazias**. Não há dados para importar.

## O que vem no pacote

| Pasta | O que é |
|---|---|
| `supabase/migrations/` | 11 migrações, já pela ordem certa (a das Fichas de decoração é a primeira) |
| `supabase/seed/utilizadores.sql` | as pessoas, os perfis, o endereço da aplicação e os administradores |
| `supabase/tests/` | testes da base de dados (para uma base de desenvolvimento) |
| `app/` | o código novo (`js/deco`, `js/pedidos`, `css/deco.css`, `css/pedidos.css`) |
| `alteracoes-a-ficheiros-existentes/` | o que mudar nos 4 ficheiros que já existem, com os blocos prontos a colar |
| `opcional-testes-interface/` | testes Playwright dos Pedidos de preço (opcional) |

## Pré-requisitos

- Um projeto Supabase com a Ficha técnica já a funcionar (login por email, ver `js/auth.js`).
- As extensões **`pg_cron`**, **`pg_net`** e **`supabase_vault`**. A migração dos avisos tenta ativar as duas
  primeiras (`create extension if not exists`); se o projeto não deixar, ativam-se em *Database → Extensions*.
  O Vault vem ativo por defeito.
- O Supabase CLI ligado ao projeto (`supabase link`), ou o editor de SQL do painel.

## Passos, por ordem

### 1. Migrações
Copia `supabase/migrations/*.sql` para a pasta `supabase/migrations/` do repositório e corre `supabase db push`.
Os nomes têm data de 2026-11-01 para ficarem depois das migrações que já existem; se já houver migrações com
data posterior, renomeia estas para uma data a seguir.

Cria: a tabela das Fichas de decoração e o bucket privado `ficha-tecnica-sourcetextile-deco` (com políticas),
e as tabelas, funções e o job das 8h30 dos Pedidos de preço (`pedidos_preco_sourcetextile_alertas`, via `pg_cron`).
Todas as tabelas têm RLS ligada. Os nomes começam por `ficha_tecnica_sourcetextile_` e `pedidos_preco_sourcetextile_`
e **não devem ser mudados**: o código e as funções referem-se a eles.

### 2. Pessoas, perfis e endereço
Edita e corre `supabase/seed/utilizadores.sql` no editor de SQL. Tem duas linhas marcadas `PREENCHER`:
o email de quem administra e o endereço onde a aplicação vai estar publicada.

| Perfil | Quem | O que pode |
|---|---|---|
| `gp` | comercial1@ e comercial2@sourcetextile.pt | só mexe nos pedidos em que é a GP responsável; só cria pedidos em seu nome; lê tudo |
| `aprovisionamento` | planeamento.amostras@sourcetextile.pt | só passa pedidos de Aprov. Malhas para Orçamentação (de qualquer GP); não volta atrás |
| administração | os emails/domínios em `admins` | tudo |
| leitura | qualquer outro email com acesso | só lê |

Estas regras estão **na base de dados**; a interface só esconde o que não se pode usar.
Mudar uma pessoa é mudar uma linha na tabela `pedidos_preco_sourcetextile_utilizadores`.

### 3. Quem entra (três sítios que têm de dizer o mesmo)
1. `app/js/config.js`, chave `acessos`: domínios e/ou emails (a interface mostra o login ou recusa).
2. A função `ficha_tecnica_sourcetextile_deco_acesso()` (primeira migração): protege as Fichas de decoração e as imagens.
3. A função `pedidos_preco_sourcetextile_acesso()` (segunda migração): protege os Pedidos de preço.

Por omissão as duas funções aceitam `@kaizen.com` e `@sourcetextile.pt`. Se só deve entrar a Sourcetextile,
tira `kaizen.com` das duas (e do `config.js`) com um `create or replace function` numa nova migração.

### 4. Interface
Aplica `alteracoes-a-ficheiros-existentes/ALTERACOES.md` (4 ficheiros) e copia a pasta `app/`.
Em `js/config.js` põe o endereço do projeto e a chave **publicável** (nunca a service-role).

### 5. Avisos por email (opcional, mas é o que faz os alertas chegarem às pessoas)
Sem isto tudo funciona: os alertas aparecem no sino da aplicação, mas não sai nenhum email.

1. Escolhe um fornecedor que aceite um pedido HTTP com `Authorization: Bearer <chave>`.
2. Guarda os dois segredos no Vault (uma vez, no editor de SQL):
   ```sql
   select vault.create_secret('https://URL-DO-FORNECEDOR', 'pedidos_preco_email_url');
   select vault.create_secret('A-CHAVE-DO-FORNECEDOR',     'pedidos_preco_email_chave');
   ```
3. A função `pedidos_preco_sourcetextile_enviar_email` envia `POST` com o corpo
   `{"to": "...", "subject": "...", "text": "..."}`. É a **única** função que fala com o exterior. Se o fornecedor
   pedir outro formato (por exemplo, um campo `from`), é ela que se altera.
4. O modo de envio está em `pedidos_preco_sourcetextile_config`, chave `email_envio`:
   `desligado` (por omissão; os alertas aparecem só na aplicação), `teste` (todos os emails vão para um só endereço)
   e `producao` (cada pessoa recebe o seu):
   ```sql
   update pedidos_preco_sourcetextile_config
      set valor = '{"modo": "teste", "email_teste": "alguem@sourcetextile.pt", "remetente": ""}'::jsonb
    where chave = 'email_envio';
   ```
   Recomenda-se uma semana em `teste` antes de passar a `producao`.

**Os três avisos** (um email por pessoa, por tipo e por dia, às 8h30 de Lisboa, só quando há pedidos):

| Para | Quando | Assunto |
|---|---|---|
| Aprovisionamento | pedido em Aprov. Malhas há 2 dias úteis ou mais | Pedidos de preço: N à espera do preço de malhas |
| GP do pedido | continua em Aprov. Malhas há 4 dias úteis ou mais | Pedidos de preço: malhas sem resposta há 4 dias úteis |
| GP do pedido | em Aguarda Cliente há 5 dias úteis ou mais | Pedidos de preço: N clientes sem resposta |

Os limites (2, 4 e 5) estão na configuração `alertas_limites`. Os textos estão na função
`pedidos_preco_sourcetextile_compor_email`.

### 6. Testes
- **Base de dados**: corre `supabase/tests/testes_pedidos_preco.sql` numa base de **desenvolvimento** (ver
  `supabase/tests/README.md`). A última linha de resultado diz quantos testes passaram.
- **Interface** (opcional): `opcional-testes-interface/LEIA-ME.md`.

### 7. Verificação final (checklist)
- [ ] `supabase db push` correu sem erros e as 11 migrações aparecem como aplicadas.
- [ ] `seed/utilizadores.sql` correu e os dois `PREENCHER` foram substituídos.
- [ ] `config.js` tem o endereço e a chave publicável do cliente, e **não** a service-role.
- [ ] Os três sítios dos acessos dizem o mesmo (ponto 3).
- [ ] Entrar como GP (comercial1@): só consegue mexer nos seus pedidos (os de outra GP aparecem sem botões e sem arrastar).
- [ ] Entrar como Aprovisionamento: não vê "Novo pedido" nem "Desfazer"; só passa de Aprov. Malhas para Orçamentação.
- [ ] Criar um pedido de teste, passá-lo por todas as etapas e apagá-lo (só se apaga enquanto não teve movimentos).
- [ ] Criar uma ficha de decoração com imagem e imprimi-la (testa o bucket).
- [ ] O job existe: `select jobname, schedule from cron.job where jobname = 'pedidos_preco_sourcetextile_alertas';`
- [ ] Modo `teste`: um alerta gera um email no endereço de teste, com o texto aprovado.
- [ ] A Ficha técnica continua igual (abrir, criar e guardar uma ficha).

## Se algo correr mal
- **Login funciona mas o separador "Pedidos de preço" diz "só leitura"**: o email ainda não está em
  `pedidos_preco_sourcetextile_utilizadores` nem em `admins`.
- **"Fornecedor de email ainda não configurado"** no painel de alertas: faltam os segredos do Vault (passo 5).
- **Imagens das fichas de decoração não carregam**: falta o bucket ou as políticas (primeira migração) ou o
  email não passa em `ficha_tecnica_sourcetextile_deco_acesso()`.
- **Os separadores não aparecem**: o `auth.js` não revela `#appTabs` (ver `ALTERACOES.md`, ponto 2).
