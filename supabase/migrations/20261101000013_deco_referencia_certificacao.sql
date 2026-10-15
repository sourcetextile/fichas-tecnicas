-- =====================================================================
-- Fichas de decoração - "Referência da decoração" e "Certificação"
--
-- Duas colunas novas na tabela das fichas. Ficam vazias nas fichas que já
-- existem. Corre-se UMA VEZ no editor de SQL do Supabase, ANTES de publicar
-- a versão da aplicação que as usa (senão guardar uma ficha dá erro).
-- Pode correr-se outra vez sem estragar nada.
-- =====================================================================
alter table public.ficha_tecnica_sourcetextile_deco_fichas
  add column if not exists referencia_decoracao text,
  add column if not exists certificacao text;

alter table public.ficha_tecnica_sourcetextile_deco_fichas
  drop constraint if exists deco_fichas_certificacao_check;
alter table public.ficha_tecnica_sourcetextile_deco_fichas
  add constraint deco_fichas_certificacao_check
  check (certificacao is null or certificacao in ('GOTS', 'OCS', 'OEKO-TEX'));

-- Confirma: deve listar as duas colunas.
select column_name from information_schema.columns
 where table_schema = 'public'
   and table_name = 'ficha_tecnica_sourcetextile_deco_fichas'
   and column_name in ('referencia_decoracao', 'certificacao');
