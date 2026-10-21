-- =====================================================================
-- Fichas de decoração - campo "Cliente"
--
-- Uma coluna nova na tabela das fichas. Fica vazia nas fichas que já
-- existem. Corre-se UMA VEZ no editor de SQL do Supabase, ANTES de publicar
-- a versão da aplicação que a usa (senão guardar uma ficha dá erro).
-- Pode correr-se outra vez sem estragar nada.
-- =====================================================================
alter table public.ficha_tecnica_sourcetextile_deco_fichas
  add column if not exists cliente text;

-- Confirma: deve listar a coluna.
select column_name from information_schema.columns
 where table_schema = 'public'
   and table_name = 'ficha_tecnica_sourcetextile_deco_fichas'
   and column_name = 'cliente';
