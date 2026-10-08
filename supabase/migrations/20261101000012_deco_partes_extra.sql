-- =====================================================================
-- Fichas de decoração - partes acrescentadas pelas pessoas
--
-- A lista "Partes" da Colocação vem de fábrica no HTML (Frente, Costas, ...).
-- Quando falta uma, qualquer pessoa com acesso pode acrescentá-la, e passa a
-- aparecer na lista de todos. Esta tabela guarda só essas acrescentadas.
--
-- Corre-se UMA VEZ no editor de SQL do Supabase. Não mexe em nada existente.
-- =====================================================================
create table if not exists public.ficha_tecnica_sourcetextile_deco_partes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) between 1 and 80),
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- Sem duplicados, ignorando maiúsculas e espaços nas pontas.
create unique index if not exists deco_partes_nome_unico
  on public.ficha_tecnica_sourcetextile_deco_partes (lower(trim(nome)));

alter table public.ficha_tecnica_sourcetextile_deco_partes enable row level security;

drop policy if exists deco_partes_select on public.ficha_tecnica_sourcetextile_deco_partes;
drop policy if exists deco_partes_insert on public.ficha_tecnica_sourcetextile_deco_partes;

create policy deco_partes_select on public.ficha_tecnica_sourcetextile_deco_partes
  for select using (public.ficha_tecnica_sourcetextile_deco_acesso());
create policy deco_partes_insert on public.ficha_tecnica_sourcetextile_deco_partes
  for insert with check (public.ficha_tecnica_sourcetextile_deco_acesso());

-- Confirma:
select count(*) as partes_acrescentadas from public.ficha_tecnica_sourcetextile_deco_partes;
