-- =====================================================================
-- Ideia de preço - Sourcetextile
-- Testes do lado da base de dados
--
-- Como correr: cola o ficheiro inteiro no editor de SQL do Supabase.
-- O resultado é uma linha "RESUMO" (passou / total) e, a seguir, só o que
-- falhou. Só mexe em linhas de teste que ele próprio cria e apaga no fim
-- ("Teste Ideia ..."); os valores verdadeiros das tabelas não mudam.
--
-- Precisa das pessoas do seed dos Pedidos de preço (as GP e a
-- Aprovisionamento em pedidos_preco_sourcetextile_utilizadores).
-- =====================================================================
create temp table if not exists _ti(passo text, obtido text, esperado text);
truncate _ti;
grant all on _ti to authenticated, anon;

do $t$
declare
  gp   text := (select email from pedidos_preco_sourcetextile_utilizadores where papel = 'gp' and ativo order by nome limit 1);
  ap   text := (select email from pedidos_preco_sourcetextile_utilizadores where papel = 'aprovisionamento' and ativo limit 1);
  fora text := 'alguem.de.fora@exemplo-que-nao-entra.com';
  n int;
  l uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
begin

  -- ===== a estrutura e os valores de partida ===========================
  insert into _ti values
    ('perdas: 17 linhas', (select count(*)::text from ideia_preco_sourcetextile_linhas where tabela = 'perdas'), '17'),
    ('margens: 4 linhas', (select count(*)::text from ideia_preco_sourcetextile_linhas where tabela = 'margens'), '4'),
    ('tinturaria: 26 linhas', (select count(*)::text from ideia_preco_sourcetextile_linhas where tabela = 'tinturaria'), '26'),
    ('Ramular tem 2 tipos de malha', (select jsonb_array_length(variantes)::text from ideia_preco_sourcetextile_linhas where tabela = 'perdas' and nome = 'Ramular'), '2'),
    ('Comissão a avaliar', (select coalesce(percentagem::text, 'NULA') from ideia_preco_sourcetextile_linhas where nome = 'Comissão'), 'NULA'),
    ('tabelas do fornecedor', (select string_agg(nome, ',' order by ordem) from ideia_preco_sourcetextile_documentos), 'Lavagens,Tingimento'),
    ('Tingimento destaca o máximo em 3 secções',
     (select count(*)::text from ideia_preco_sourcetextile_documentos x, jsonb_array_elements(x.secoes) s
       where x.nome = 'Tingimento' and (s ->> 'maximo')::boolean), '3'),
    ('bucket dos PDFs é privado e só aceita PDF',
     (select (not public and allowed_mime_types = array['application/pdf'])::text from storage.buckets where id = 'ideia-preco-sourcetextile-documentos'), 'true');

  -- linhas de teste (criadas como dono da base de dados, sem RLS)
  insert into ideia_preco_sourcetextile_linhas (id, tabela, nome, preco) values (l, 'tinturaria', 'Teste Ideia linha', 1);
  insert into ideia_preco_sourcetextile_documentos (id, ordem, nome) values (d, 99, 'Teste Ideia documento');

  -- ===== GP: edita ======================================================
  perform set_config('request.jwt.claims', json_build_object('email', gp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _ti values ('GP pode editar', ideia_preco_sourcetextile_pode_editar()::text, 'true');
  update ideia_preco_sourcetextile_linhas set preco = 2 where id = l;
  get diagnostics n = row_count;
  insert into _ti values ('GP altera uma linha', n::text, '1');
  update ideia_preco_sourcetextile_documentos set validade_meses = 6 where id = d;
  get diagnostics n = row_count;
  insert into _ti values ('GP altera uma tabela do fornecedor', n::text, '1');
  begin
    insert into ideia_preco_sourcetextile_linhas (tabela, nome, preco) values ('tinturaria', 'teste ideia LINHA ', 1);
    insert into _ti values ('nome repetido na mesma tabela', 'aceitou', 'recusa');
  exception when others then insert into _ti values ('nome repetido na mesma tabela', 'recusa', 'recusa'); end;
  begin
    insert into ideia_preco_sourcetextile_linhas (tabela, nome, percentagem) values ('perdas', 'Teste Ideia 150', 150);
    insert into _ti values ('percentagem acima de 100', 'aceitou', 'recusa');
  exception when others then insert into _ti values ('percentagem acima de 100', 'recusa', 'recusa'); end;
  begin
    insert into ideia_preco_sourcetextile_linhas (tabela, nome, preco) values ('tinturaria', 'Teste Ideia negativo', -1);
    insert into _ti values ('preço negativo', 'aceitou', 'recusa');
  exception when others then insert into _ti values ('preço negativo', 'recusa', 'recusa'); end;
  begin
    insert into ideia_preco_sourcetextile_linhas (tabela, nome) values ('outra', 'Teste Ideia X');
    insert into _ti values ('tabela que não existe', 'aceitou', 'recusa');
  exception when others then insert into _ti values ('tabela que não existe', 'recusa', 'recusa'); end;
  reset role;
  insert into _ti values ('fica registado quem mudou',
    (select updated_by from ideia_preco_sourcetextile_linhas where id = l), gp);

  -- ===== Aprovisionamento: só lê ========================================
  perform set_config('request.jwt.claims', json_build_object('email', ap, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _ti values ('Aprovisionamento não edita', ideia_preco_sourcetextile_pode_editar()::text, 'false');
  insert into _ti values ('Aprovisionamento lê', (select (count(*) > 0)::text from ideia_preco_sourcetextile_linhas), 'true');
  update ideia_preco_sourcetextile_linhas set preco = 9 where id = l;
  get diagnostics n = row_count;
  insert into _ti values ('Aprovisionamento não altera (RLS)', n::text, '0');
  delete from ideia_preco_sourcetextile_documentos where id = d;
  get diagnostics n = row_count;
  insert into _ti values ('Aprovisionamento não apaga (RLS)', n::text, '0');
  begin
    insert into ideia_preco_sourcetextile_linhas (tabela, nome, preco) values ('tinturaria', 'Teste Ideia intrusa', 1);
    insert into _ti values ('Aprovisionamento não acrescenta', 'aceitou', 'recusa');
  exception when others then insert into _ti values ('Aprovisionamento não acrescenta', 'recusa', 'recusa'); end;
  reset role;

  -- ===== quem não tem acesso não vê nada ================================
  perform set_config('request.jwt.claims', json_build_object('email', fora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _ti values ('fora do domínio não lê', (select count(*)::text from ideia_preco_sourcetextile_linhas), '0');
  insert into _ti values ('fora do domínio não lê tabelas do fornecedor', (select count(*)::text from ideia_preco_sourcetextile_documentos), '0');
  reset role;
  set local role anon;
  begin
    insert into _ti values ('sem sessão não lê', (select count(*)::text from ideia_preco_sourcetextile_linhas), '0');
  exception when others then insert into _ti values ('sem sessão não lê', '0', '0'); end;
  reset role;

  -- ===== limpeza ========================================================
  perform set_config('request.jwt.claims', '{}', true);
  delete from ideia_preco_sourcetextile_linhas where nome like 'Teste Ideia%';
  delete from ideia_preco_sourcetextile_documentos where nome like 'Teste Ideia%';
end $t$;

select passo, esperado, obtido from (
  select 0 as k, 'RESUMO' as passo,
         (select count(*) from _ti)::text as esperado,
         (select count(*) from _ti where obtido is not distinct from esperado)::text as obtido
  union all
  select 1, passo, esperado, coalesce(obtido, 'NULO') from _ti where obtido is distinct from esperado
) r order by k;
