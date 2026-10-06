-- =====================================================================
-- Fichas de decoração - Sourcetextile
-- Tabela, auditoria, RLS, bucket privado das imagens e as suas políticas.
--
-- Fica VAZIA. Não mexe em nada da Ficha técnica.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Quem tem acesso. A lista de domínios vive AQUI (para as fichas e para as
-- imagens), em pedidos_preco_sourcetextile_acesso() (para os Pedidos de
-- preço) e em js/config.js (para a interface). Têm de dizer o mesmo.
-- ---------------------------------------------------------------------
create or replace function ficha_tecnica_sourcetextile_deco_acesso()
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'email') ilike '%@kaizen.com'
    or (auth.jwt() ->> 'email') ilike '%@sourcetextile.pt',
    false);
$$;

-- ---------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------
create table if not exists public.ficha_tecnica_sourcetextile_deco_fichas (
  id                 uuid primary key default gen_random_uuid(),
  ref_nosso_modelo   text not null,
  ref_modelo_cliente text,
  ofs                text,
  estampado          boolean not null default false,
  bordado            boolean not null default false,
  codigo             text,
  fornecedor         text,
  tamanhos           jsonb not null default '[]'::jsonb,
  posicoes           jsonb not null default '[]'::jsonb,
  colocacao_tipo     text check (colocacao_tipo in ('Frente', 'Verso')),
  colocacao_texto    text,
  colocacao_partes   text,
  comentarios        jsonb not null default '{}'::jsonb,
  paleta             jsonb not null default '{}'::jsonb,
  croqui             jsonb not null default '{}'::jsonb,
  layout_impressao   text not null default 'classico'
                       check (layout_impressao in ('classico', 'renovado')),
  estado             text not null default 'rascunho'
                       check (estado in ('rascunho', 'enviada', 'confirmada')),
  fases              jsonb not null default '{}'::jsonb,
  fase_ativa         text not null default 'SMS',
  ficha_mp           text,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_deco_fichas_ref_modelo on public.ficha_tecnica_sourcetextile_deco_fichas (ref_nosso_modelo);
create index if not exists idx_deco_fichas_created_at on public.ficha_tecnica_sourcetextile_deco_fichas (created_at desc);
create index if not exists idx_deco_fichas_estado     on public.ficha_tecnica_sourcetextile_deco_fichas (estado);

-- Quem criou e quem mexeu pela última vez, sem o cliente ter de o enviar.
create or replace function public.ficha_tecnica_sourcetextile_deco_fichas_set_audit()
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

drop trigger if exists trg_deco_fichas_set_audit on public.ficha_tecnica_sourcetextile_deco_fichas;
create trigger trg_deco_fichas_set_audit
  before insert or update on public.ficha_tecnica_sourcetextile_deco_fichas
  for each row execute function public.ficha_tecnica_sourcetextile_deco_fichas_set_audit();

-- ---------------------------------------------------------------------
-- RLS: só quem tem acesso lê e escreve.
-- ---------------------------------------------------------------------
alter table public.ficha_tecnica_sourcetextile_deco_fichas enable row level security;

drop policy if exists deco_fichas_select on public.ficha_tecnica_sourcetextile_deco_fichas;
drop policy if exists deco_fichas_insert on public.ficha_tecnica_sourcetextile_deco_fichas;
drop policy if exists deco_fichas_update on public.ficha_tecnica_sourcetextile_deco_fichas;
drop policy if exists deco_fichas_delete on public.ficha_tecnica_sourcetextile_deco_fichas;

create policy deco_fichas_select on public.ficha_tecnica_sourcetextile_deco_fichas
  for select using (public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_fichas_insert on public.ficha_tecnica_sourcetextile_deco_fichas
  for insert with check (public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_fichas_update on public.ficha_tecnica_sourcetextile_deco_fichas
  for update using (public.ficha_tecnica_sourcetextile_deco_acesso())
  with check (public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_fichas_delete on public.ficha_tecnica_sourcetextile_deco_fichas
  for delete using (public.ficha_tecnica_sourcetextile_deco_acesso());

-- ---------------------------------------------------------------------
-- Imagens (croqui e paleta): um bucket PRIVADO. As políticas filtram sempre
-- primeiro pelo bucket, porque storage.objects é uma tabela só, partilhada
-- por todas as aplicações do projeto.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ficha-tecnica-sourcetextile-deco', 'ficha-tecnica-sourcetextile-deco', false)
on conflict (id) do nothing;

drop policy if exists deco_storage_select on storage.objects;
drop policy if exists deco_storage_insert on storage.objects;
drop policy if exists deco_storage_update on storage.objects;
drop policy if exists deco_storage_delete on storage.objects;

create policy deco_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'ficha-tecnica-sourcetextile-deco' and public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ficha-tecnica-sourcetextile-deco' and public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'ficha-tecnica-sourcetextile-deco' and public.ficha_tecnica_sourcetextile_deco_acesso())
  with check (bucket_id = 'ficha-tecnica-sourcetextile-deco' and public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ficha-tecnica-sourcetextile-deco' and public.ficha_tecnica_sourcetextile_deco_acesso());
