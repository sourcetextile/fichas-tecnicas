-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0001 — tabelas base, auditoria e RLS
--
-- Prefixo de todos os objetos: pedidos_preco_sourcetextile_
-- (único nesta base de dados partilhada; ver MIGRACAO.md antes de o mudar)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Acesso — a lista de emails vive AQUI e em pedidos-config.js, e em mais
-- lado nenhum. Mudar de cliente é mudar esta função e esse ficheiro.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_acesso()
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'email') ilike '%@kaizen.com'
    or (auth.jwt() ->> 'email') ilike '%@sourcetextile.pt',
    false);
$$;

-- Quem criou e quem mexeu pela última vez, sem o cliente ter de o enviar.
create or replace function pedidos_preco_sourcetextile_set_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.jwt() ->> 'email';
  end if;
  new.updated_by := auth.jwt() ->> 'email';
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Clientes — começa vazia; cresce a partir do modal de novo pedido.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_clientes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) > 0),
  ativo      boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Sonae" e "sonae " são o mesmo cliente.
create unique index if not exists pedidos_preco_sourcetextile_clientes_nome_uk
  on pedidos_preco_sourcetextile_clientes (lower(trim(nome)));

-- ---------------------------------------------------------------------
-- Utilizadores — 2 GP + 1 Resp. de Aprovisionamento de Malhas.
-- O email pode ficar em branco enquanto não for conhecido: a pessoa já
-- aparece nas listas, só não recebe alertas.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_utilizadores (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) > 0),
  email      text,
  papel      text not null check (papel in ('gp', 'aprovisionamento')),
  ativo      boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pedidos_preco_sourcetextile_utilizadores_email_uk
  on pedidos_preco_sourcetextile_utilizadores (lower(trim(email)))
  where email is not null and trim(email) <> '';

-- ---------------------------------------------------------------------
-- Motivos de não conversão — editáveis nas configurações.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_motivos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) > 0),
  ordem      int not null default 0,
  pede_texto boolean not null default false,   -- só "Outro"
  ativo      boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pedidos_preco_sourcetextile_motivos_nome_uk
  on pedidos_preco_sourcetextile_motivos (lower(trim(nome)));

-- ---------------------------------------------------------------------
-- Encerramentos — feriados municipais, férias coletivas, pontes.
-- Os feriados nacionais NÃO vivem aqui: são calculados (ver 0002), para
-- não ser preciso semear tabela nenhuma todos os anos.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_encerramentos (
  data       date primary key,
  descricao  text not null default '',
  ativo      boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configuração — uma linha por chave, valor em jsonb.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_config (
  chave      text primary key,
  valor      jsonb not null,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function pedidos_preco_sourcetextile_cfg(p_chave text)
returns jsonb
language sql stable
set search_path = public
as $$
  select valor from pedidos_preco_sourcetextile_config where chave = p_chave;
$$;

-- ---------------------------------------------------------------------
-- Pedidos — 1 pedido = 1 cliente + 1 referência de cliente.
-- Não há data de receção guardada aqui: o instante de receção é a
-- primeira transição (estado_origem null), e é de lá que saem todos os
-- KPIs. Ver a vista pedidos_preco_sourcetextile_v_pedidos.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_pedidos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references pedidos_preco_sourcetextile_clientes(id),
  ref_cliente      text not null check (length(trim(ref_cliente)) > 0),
  gp_email         text not null,
  precisa_malhas   boolean not null default true,
  ronda_atual      int not null default 1 check (ronda_atual >= 1),
  estado           text not null default 'malhas'
                     check (estado in ('malhas', 'orcamentacao', 'aguarda_cliente', 'fechado')),
  resultado        text check (resultado in ('converteu', 'converteu_negociacao', 'nao_converteu')),
  motivo_id        uuid references pedidos_preco_sourcetextile_motivos(id),
  motivo_descricao text,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- fechado tem sempre resultado; aberto nunca tem
  constraint pedidos_preco_sourcetextile_pedidos_fecho_ck
    check ((estado = 'fechado') = (resultado is not null))
);

-- "Não deveria haver refs iguais" — travado na base de dados, ignorando
-- maiúsculas e espaços, por cliente.
create unique index if not exists pedidos_preco_sourcetextile_pedidos_ref_uk
  on pedidos_preco_sourcetextile_pedidos (cliente_id, upper(trim(ref_cliente)));

create index if not exists pedidos_preco_sourcetextile_pedidos_estado_ix
  on pedidos_preco_sourcetextile_pedidos (estado);

-- ---------------------------------------------------------------------
-- Transições — o registo de tudo o que aconteceu. Append-only: nada é
-- apagado. Desfazer marca `anulada_em`, não remove a linha.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_transicoes (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid not null references pedidos_preco_sourcetextile_pedidos(id) on delete cascade,
  ronda             int not null check (ronda >= 1),
  estado_origem     text,      -- null = receção do pedido
  estado_destino    text not null,
  ocorrido_em       timestamptz not null,
  utilizador_email  text,
  origem            text not null default 'app'
                      check (origem in ('app', 'kanban', 'botao', 'link', 'desfazer', 'seed')),
  anulada_em        timestamptz,
  anulada_por       text,
  created_at        timestamptz not null default now()
);

create index if not exists pedidos_preco_sourcetextile_transicoes_pedido_ix
  on pedidos_preco_sourcetextile_transicoes (pedido_id, ocorrido_em);

-- Só pode haver uma receção por ronda.
create unique index if not exists pedidos_preco_sourcetextile_transicoes_rececao_uk
  on pedidos_preco_sourcetextile_transicoes (pedido_id, ronda)
  where estado_origem is null;

-- ---------------------------------------------------------------------
-- Correções — quem corrigiu uma data, quando, e qual era o valor antigo.
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_correcoes (
  id            uuid primary key default gen_random_uuid(),
  transicao_id  uuid not null references pedidos_preco_sourcetextile_transicoes(id) on delete cascade,
  valor_antigo  timestamptz not null,
  valor_novo    timestamptz not null,
  corrigido_por text,
  corrigido_em  timestamptz not null default now()
);

create index if not exists pedidos_preco_sourcetextile_correcoes_transicao_ix
  on pedidos_preco_sourcetextile_correcoes (transicao_id);

-- ---------------------------------------------------------------------
-- Auditoria em todas as tabelas que a têm
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clientes', 'utilizadores', 'motivos', 'encerramentos', 'config', 'pedidos'
  ] loop
    execute format(
      'drop trigger if exists pedidos_preco_sourcetextile_%1$s_audit on pedidos_preco_sourcetextile_%1$s', t);
    execute format(
      'create trigger pedidos_preco_sourcetextile_%1$s_audit
         before insert or update on pedidos_preco_sourcetextile_%1$s
         for each row execute function pedidos_preco_sourcetextile_set_audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS — a mesma condição de domínio do resto da app, em todas as tabelas.
-- As transições e as correções não têm UPDATE nem DELETE: são o registo.
-- (A correção de uma data passa por uma função própria, na fase seguinte.)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clientes', 'utilizadores', 'motivos', 'encerramentos', 'config', 'pedidos'
  ] loop
    execute format('alter table pedidos_preco_sourcetextile_%1$s enable row level security', t);
    execute format('drop policy if exists pedidos_preco_sourcetextile_%1$s_select on pedidos_preco_sourcetextile_%1$s', t);
    execute format('drop policy if exists pedidos_preco_sourcetextile_%1$s_insert on pedidos_preco_sourcetextile_%1$s', t);
    execute format('drop policy if exists pedidos_preco_sourcetextile_%1$s_update on pedidos_preco_sourcetextile_%1$s', t);
    execute format('drop policy if exists pedidos_preco_sourcetextile_%1$s_delete on pedidos_preco_sourcetextile_%1$s', t);
    execute format('create policy pedidos_preco_sourcetextile_%1$s_select on pedidos_preco_sourcetextile_%1$s
                      for select using (pedidos_preco_sourcetextile_acesso())', t);
    execute format('create policy pedidos_preco_sourcetextile_%1$s_insert on pedidos_preco_sourcetextile_%1$s
                      for insert with check (pedidos_preco_sourcetextile_acesso())', t);
    execute format('create policy pedidos_preco_sourcetextile_%1$s_update on pedidos_preco_sourcetextile_%1$s
                      for update using (pedidos_preco_sourcetextile_acesso())
                      with check (pedidos_preco_sourcetextile_acesso())', t);
    execute format('create policy pedidos_preco_sourcetextile_%1$s_delete on pedidos_preco_sourcetextile_%1$s
                      for delete using (pedidos_preco_sourcetextile_acesso())', t);
  end loop;
end $$;

alter table pedidos_preco_sourcetextile_transicoes enable row level security;
drop policy if exists pedidos_preco_sourcetextile_transicoes_select on pedidos_preco_sourcetextile_transicoes;
drop policy if exists pedidos_preco_sourcetextile_transicoes_insert on pedidos_preco_sourcetextile_transicoes;
drop policy if exists pedidos_preco_sourcetextile_transicoes_update on pedidos_preco_sourcetextile_transicoes;
create policy pedidos_preco_sourcetextile_transicoes_select on pedidos_preco_sourcetextile_transicoes
  for select using (pedidos_preco_sourcetextile_acesso());
create policy pedidos_preco_sourcetextile_transicoes_insert on pedidos_preco_sourcetextile_transicoes
  for insert with check (pedidos_preco_sourcetextile_acesso());
-- Só o desfazer e a correção tocam numa linha existente, e ambos passam
-- por aqui; apagar não é possível de todo (não há política de delete).
create policy pedidos_preco_sourcetextile_transicoes_update on pedidos_preco_sourcetextile_transicoes
  for update using (pedidos_preco_sourcetextile_acesso())
  with check (pedidos_preco_sourcetextile_acesso());

alter table pedidos_preco_sourcetextile_correcoes enable row level security;
drop policy if exists pedidos_preco_sourcetextile_correcoes_select on pedidos_preco_sourcetextile_correcoes;
drop policy if exists pedidos_preco_sourcetextile_correcoes_insert on pedidos_preco_sourcetextile_correcoes;
create policy pedidos_preco_sourcetextile_correcoes_select on pedidos_preco_sourcetextile_correcoes
  for select using (pedidos_preco_sourcetextile_acesso());
create policy pedidos_preco_sourcetextile_correcoes_insert on pedidos_preco_sourcetextile_correcoes
  for insert with check (pedidos_preco_sourcetextile_acesso());
