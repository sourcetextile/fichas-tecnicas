-- =====================================================================
-- Ideia de preço - Sourcetextile
-- Instalação completa da secção, numa só migração.
--
-- É a junção, pela mesma ordem e sem alterações, das três migrações com que
-- a secção foi construída e testada (0012, 0013 e 0014 do projeto original):
--   1. tabelas de referência: perdas por operação e margens (com valores);
--   2. preço por operação de tinturaria, e as tabelas de fornecedor
--      (Lavagens e Tingimento da Green Dye), com um bucket privado para os
--      PDFs originais;
--   3. destaque do preço mais caro de cada linha no Tingimento.
--
-- NÃO MEXE em nenhuma tabela, função ou política das outras secções. Usa três
-- funções que os Pedidos de preço já criaram (quem tem acesso, o perfil de
-- quem está ligado e a auditoria); se não existirem, pára já, sem fazer nada.
-- Pode correr-se mais de uma vez: não repõe valores que já tenham sido editados.
-- =====================================================================
do $verifica$
begin
  if to_regprocedure('public.pedidos_preco_sourcetextile_acesso()') is null
     or to_regprocedure('public.pedidos_preco_sourcetextile_papel_atual()') is null
     or to_regprocedure('public.pedidos_preco_sourcetextile_set_audit()') is null then
    raise exception 'A Ideia de preço precisa dos Pedidos de preço instalados (faltam as funções pedidos_preco_sourcetextile_acesso, _papel_atual ou _set_audit).';
  end if;
end
$verifica$;


-- ######################################################################
-- Parte 1 de 3 (originalmente 0012_ideia_preco_tabelas.sql)
-- ######################################################################
-- =====================================================================
-- Ideia de preço - Sourcetextile
-- 0012 - as tabelas de referência (perdas por operação e margens)
--
-- Prefixo de todos os objetos: ideia_preco_sourcetextile_
--
-- Uma só tabela de linhas, com a coluna `tabela` a dizer a que tabela de
-- referência pertence cada linha. As próximas tabelas (há mais duas por
-- definir) entram acrescentando um valor ao check de `tabela`, sem tabela
-- nova nem código novo de leitura e escrita.
--
-- Uma linha tem uma percentagem OU variantes (ex.: Ramular - Jersey 5%,
-- Outros 3%). Sem nenhuma das duas, a percentagem está "a avaliar"
-- (ex.: Comissão).
--
-- Quem lê: quem tem acesso à aplicação. Quem edita: administração e GP
-- (o mesmo perfil dos Pedidos de preço, migration 0010). A escrita é direta
-- na tabela, protegida por RLS: aqui não há histórico a proteger, só
-- valores de referência, e cada linha guarda quem a mudou e quando.
-- =====================================================================

create table if not exists ideia_preco_sourcetextile_linhas (
  id           uuid primary key default gen_random_uuid(),
  tabela       text not null check (tabela in ('perdas', 'margens')),
  ordem        int  not null default 0,
  nome         text not null check (length(trim(nome)) > 0),
  percentagem  numeric(6, 2) check (percentagem is null or (percentagem >= 0 and percentagem <= 100)),
  variantes    jsonb not null default '[]'::jsonb check (jsonb_typeof(variantes) = 'array'),
  observacoes  text,
  created_by   text,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- "Tingir" e "tingir " são a mesma operação.
create unique index if not exists ideia_preco_sourcetextile_linhas_nome_uk
  on ideia_preco_sourcetextile_linhas (tabela, lower(trim(nome)));

drop trigger if exists ideia_preco_sourcetextile_linhas_audit on ideia_preco_sourcetextile_linhas;
create trigger ideia_preco_sourcetextile_linhas_audit
  before insert or update on ideia_preco_sourcetextile_linhas
  for each row execute function pedidos_preco_sourcetextile_set_audit();

-- ---------------------------------------------------------------------
-- Quem edita
-- ---------------------------------------------------------------------
create or replace function ideia_preco_sourcetextile_pode_editar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select pedidos_preco_sourcetextile_acesso()
     and pedidos_preco_sourcetextile_papel_atual() in ('admin', 'gp');
$fn$;

revoke execute on function ideia_preco_sourcetextile_pode_editar() from public, anon;
grant execute on function ideia_preco_sourcetextile_pode_editar() to authenticated;

alter table ideia_preco_sourcetextile_linhas enable row level security;

drop policy if exists ideia_preco_sourcetextile_linhas_select on ideia_preco_sourcetextile_linhas;
drop policy if exists ideia_preco_sourcetextile_linhas_insert on ideia_preco_sourcetextile_linhas;
drop policy if exists ideia_preco_sourcetextile_linhas_update on ideia_preco_sourcetextile_linhas;
drop policy if exists ideia_preco_sourcetextile_linhas_delete on ideia_preco_sourcetextile_linhas;

create policy ideia_preco_sourcetextile_linhas_select on ideia_preco_sourcetextile_linhas
  for select using (pedidos_preco_sourcetextile_acesso());
create policy ideia_preco_sourcetextile_linhas_insert on ideia_preco_sourcetextile_linhas
  for insert with check (ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_sourcetextile_linhas_update on ideia_preco_sourcetextile_linhas
  for update using (ideia_preco_sourcetextile_pode_editar())
  with check (ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_sourcetextile_linhas_delete on ideia_preco_sourcetextile_linhas
  for delete using (ideia_preco_sourcetextile_pode_editar());

revoke truncate on ideia_preco_sourcetextile_linhas from anon, authenticated;
revoke all on ideia_preco_sourcetextile_linhas from anon;

-- ---------------------------------------------------------------------
-- Valores de partida. Só entram se a tabela ainda não tiver linhas, para
-- voltar a correr a migração não repor o que entretanto foi editado.
-- ---------------------------------------------------------------------
insert into ideia_preco_sourcetextile_linhas (tabela, ordem, nome, percentagem, variantes, observacoes)
select 'perdas', v.ordem, v.nome, v.percentagem, v.variantes::jsonb, v.observacoes
  from (values
    ( 1, 'Termofixar',       2::numeric, '[]', 'Malhas com licra ou poliéster'),
    ( 2, 'Relaxar',          2,  '[]', null),
    ( 3, 'Tingir',           3,  '[]', null),
    ( 4, 'Desencolar',       3,  '[]', null),
    ( 5, 'Meio Branco',      3,  '[]', null),
    ( 6, 'Anti pilling',     4,  '[]', null),
    ( 7, 'Ramular',          null, '[{"nome": "Jersey", "percentagem": 5}, {"nome": "Outros", "percentagem": 3}]', null),
    ( 8, 'Cardar 1x',        2,  '[]', null),
    ( 9, 'Cardar 2x',        4,  '[]', null),
    (10, 'Esmeril Carbono',  2,  '[]', null),
    (11, 'Limpar argola',    2,  '[]', null),
    (12, 'Laminar 1 face',   8,  '[]', null),
    (13, 'Laminar 2 face',   14, '[]', null),
    (14, 'Estampar a metro', 8,  '[]', null),
    (15, 'Sublimação',       2,  '[]', null),
    (16, 'Gazar',            3,  '[]', null),
    (17, 'Sanforizar',       2,  '[]', null)
  ) as v(ordem, nome, percentagem, variantes, observacoes)
 where not exists (select 1 from ideia_preco_sourcetextile_linhas where tabela = 'perdas');

insert into ideia_preco_sourcetextile_linhas (tabela, ordem, nome, percentagem, observacoes)
select 'margens', v.ordem, v.nome, v.percentagem, v.observacoes
  from (values
    (1, 'Transporte C Pagamento', 3::numeric, null),
    (2, 'Margem MP e Ace',        15, null),
    (3, 'Margem',                 22, null),
    (4, 'Comissão',               null, null)
  ) as v(ordem, nome, percentagem, observacoes)
 where not exists (select 1 from ideia_preco_sourcetextile_linhas where tabela = 'margens');

-- ######################################################################
-- Parte 2 de 3 (originalmente 0013_ideia_preco_tinturaria_e_fornecedores.sql)
-- ######################################################################
-- =====================================================================
-- Ideia de preço - Sourcetextile
-- 0013 - preço por operação de tinturaria, e as tabelas de fornecedor
--
-- 1. As perdas e a tinturaria passam a estar sempre por ordem alfabética
--    (a ordem é decidida na interface; a coluna `ordem` continua a servir
--    as margens, que se ordenam à mão).
-- 2. Nova tabela de referência 'tinturaria': operação e preço (€).
-- 3. Tabelas de fornecedor (Lavagens e Tingimento, da Green Dye): cada uma é
--    um documento com secções. Uma secção é uma grelha (linhas x colunas de
--    preços, ex.: por peso da peça ou por cor) ou uma lista (custo e texto).
--    Ficam digitalizadas para se poderem procurar e consultar depressa, e o
--    PDF original pode anexar-se a cada uma (bucket privado).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 e 2. Tinturaria
-- ---------------------------------------------------------------------
alter table ideia_preco_sourcetextile_linhas
  add column if not exists preco numeric(10, 3) check (preco is null or preco >= 0);

alter table ideia_preco_sourcetextile_linhas
  drop constraint if exists ideia_preco_sourcetextile_linhas_tabela_check;
alter table ideia_preco_sourcetextile_linhas
  add constraint ideia_preco_sourcetextile_linhas_tabela_check
  check (tabela in ('perdas', 'margens', 'tinturaria'));

insert into ideia_preco_sourcetextile_linhas (tabela, ordem, nome, preco)
select 'tinturaria', v.ordem, v.nome, v.preco
  from (values
    ( 1, 'Termofixar', 0.65),
    ( 2, 'Desencolar', 1.2),
    ( 3, 'Meio Branco', 1.4),
    ( 4, 'Relaxar', 0.55),
    ( 5, 'Antipilling', 0.8),
    ( 6, 'Esmeril Carbono', 0.8),
    ( 7, 'Cardar', 0.3),
    ( 8, 'Limpar argola', 0.65),
    ( 9, 'Laminar', 0.65),
    (10, 'Laminar 2 faces', 1.3),
    (11, 'Sanforizar', 0.6),
    (12, 'Cardar 2x', 0.6),
    (13, 'Ramular', 0.65),
    (14, 'Ramular malhas finas', 1.3),
    (15, 'Ramular c/ silicone', 0.95),
    (16, 'Ramular c/ elastómero', 1.3),
    (17, 'Tingir 100% CO', 3.8),
    (18, 'Tingir 100% CV', 4.15),
    (19, 'Tingir 100% CMD', 4.15),
    (20, 'Tingir 100% LI', 4.15),
    (21, 'Tingir 100% PES', 3.3),
    (22, 'Tingir 100% PA', 4.15),
    (23, 'Tingir PES/CO', 4.45),
    (24, 'Tingir PES/CV', 4.9),
    (25, 'Tingir PA/CO', 4.6),
    (26, 'Tingir PA/CV', 4.8)
  ) as v(ordem, nome, preco)
 where not exists (select 1 from ideia_preco_sourcetextile_linhas where tabela = 'tinturaria');

-- ---------------------------------------------------------------------
-- 3. Tabelas de fornecedor
-- ---------------------------------------------------------------------
create table if not exists ideia_preco_sourcetextile_documentos (
  id              uuid primary key default gen_random_uuid(),
  ordem           int  not null default 0,
  nome            text not null check (length(trim(nome)) > 0),
  fornecedor      text,
  data_tabela     date,
  validade_meses  int check (validade_meses is null or validade_meses between 1 and 60),
  secoes          jsonb not null default '[]'::jsonb check (jsonb_typeof(secoes) = 'array'),
  notas           jsonb not null default '[]'::jsonb check (jsonb_typeof(notas) = 'array'),
  pdf_path        text,
  pdf_nome        text,
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists ideia_preco_sourcetextile_documentos_audit on ideia_preco_sourcetextile_documentos;
create trigger ideia_preco_sourcetextile_documentos_audit
  before insert or update on ideia_preco_sourcetextile_documentos
  for each row execute function pedidos_preco_sourcetextile_set_audit();

alter table ideia_preco_sourcetextile_documentos enable row level security;

drop policy if exists ideia_preco_sourcetextile_documentos_select on ideia_preco_sourcetextile_documentos;
drop policy if exists ideia_preco_sourcetextile_documentos_insert on ideia_preco_sourcetextile_documentos;
drop policy if exists ideia_preco_sourcetextile_documentos_update on ideia_preco_sourcetextile_documentos;
drop policy if exists ideia_preco_sourcetextile_documentos_delete on ideia_preco_sourcetextile_documentos;

create policy ideia_preco_sourcetextile_documentos_select on ideia_preco_sourcetextile_documentos
  for select using (pedidos_preco_sourcetextile_acesso());
create policy ideia_preco_sourcetextile_documentos_insert on ideia_preco_sourcetextile_documentos
  for insert with check (ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_sourcetextile_documentos_update on ideia_preco_sourcetextile_documentos
  for update using (ideia_preco_sourcetextile_pode_editar())
  with check (ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_sourcetextile_documentos_delete on ideia_preco_sourcetextile_documentos
  for delete using (ideia_preco_sourcetextile_pode_editar());

revoke truncate on ideia_preco_sourcetextile_documentos from anon, authenticated;
revoke all on ideia_preco_sourcetextile_documentos from anon;

insert into ideia_preco_sourcetextile_documentos (ordem, nome, fornecedor, data_tabela, validade_meses, secoes, notas)
select v.ordem, v.nome, v.fornecedor, v.data_tabela, v.validade_meses, v.secoes, v.notas
  from (values
    (1, 'Lavagens', 'Green Dye', date '2026-01-01', 6,
     $j$[{"titulo": "Lavagem", "tipo": "grelha", "unidade": "peça", "colunas": ["Até 100 g", "101 a 200 g", "201 a 300 g", "301 a 500 g", "501 a 750 g", "751 a 1000 g", "1001 a 1300 g", "1301 a 1500 g", "1501 a 2000 g"], "linhas": [{"nome": "LAVAGEM NORMAL", "valores": [0.18, 0.2, 0.25, 0.27, 0.35, 0.4, 0.5, 0.55, 0.6]}, {"nome": "LAV. AMAC. SILICONE", "valores": [0.25, 0.27, 0.3, 0.35, 0.4, 0.5, 0.55, 0.6, 0.7]}, {"nome": "LAV. SILI. PERMANENTE", "valores": [0.35, 0.4, 0.5, 0.6, 0.68, 0.74, 0.81, 0.88, 0.95]}, {"nome": "SECAGEM", "valores": [0.05, 0.07, 0.1, 0.15, 0.2, 0.27, 0.35, 0.4, 0.5]}, {"nome": "LIMPEZA NORMAL", "valores": [0.27, 0.34, 0.36, 0.4, 0.5, 0.55, 0.6, 0.7, 0.75]}, {"nome": "LIMPEZA C/ FIXADOR", "valores": [0.35, 0.38, 0.4, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25]}, {"nome": "LIMPEZA C/ DISPERSANTE", "valores": [0.6, 0.7, 0.75, 0.8, 0.9, 1.1, 1.25, 1.35, 1.5]}, {"nome": "LAVAGEM CORROSÃO", "valores": [0.4, 0.45, 0.5, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3]}, {"nome": "STONE WASH", "valores": [0.4, 0.5, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25, 1.35]}, {"nome": "STONE WASH FORTE", "valores": [0.5, 0.55, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.45]}, {"nome": "STONE WASH ESPECIAL", "valores": [0.75, 0.8, 0.9, 1.0, 1.15, 1.3, 1.45, 1.55, 1.7]}, {"nome": "ST WASH ESP. C/ RESINA", "valores": [0.88, 0.95, 1.0, 1.1, 1.25, 1.35, 1.5, 1.65, 1.75]}, {"nome": "VAPORIZAR", "valores": [0.07, 0.09, 0.12, 0.16, 0.2, 0.22, 0.25, 0.27, 0.3]}, {"nome": "STONE QUIMICO", "valores": [0.4, 0.5, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25, 1.35]}, {"nome": "LAVAGEM ENZIMÁTICA", "valores": [0.35, 0.4, 0.45, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25]}, {"nome": "LAV. ENZIMÁTICA FORTE", "valores": [0.4, 0.5, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25, 1.35]}, {"nome": "LAVAGEM ANTI-ÓLEO", "valores": [0.5, 0.55, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.45]}, {"nome": "LAVAGEM ANTI-PILLING", "valores": [0.4, 0.5, 0.55, 0.7, 0.8, 0.95, 1.1, 1.25, 1.35]}, {"nome": "LAVAGEM A SECO", "valores": [0.6, 0.7, 0.75, 0.9, 1.0, 1.15, 1.3, 1.45, 1.55]}, {"nome": "LAVAGEM DEVORÉ", "valores": [1.45, 1.5, 1.55, 1.7, 1.85, 1.95, 2.1, 2.25, 2.35]}, {"nome": "LAV DEVORÉ MAREADO", "valores": [1.5, 1.55, 1.65, 1.85, 1.95, 2.1, 2.25, 2.35, 2.5]}, {"nome": "LAV FADE OUT FORTE", "valores": [1.1, 1.15, 1.25, 1.45, 1.55, 1.7, 1.85, 1.95, 2.1]}, {"nome": "LAV FADE OUT MAREADO", "valores": [1.5, 1.55, 1.65, 1.85, 1.95, 2.1, 2.25, 2.35, 2.5]}, {"nome": "LAVAGEM VINTAGE", "valores": [0.35, 0.38, 0.4, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3]}, {"nome": "LAV QUINTA & SANTOS", "valores": [1.0, 1.1, 1.15, 1.25, 1.3, 1.35, 1.45, 1.5, 1.55]}, {"nome": "LAVAGEM TOQUE SECO", "valores": [1.35, 1.45, 1.5, 1.55, 1.7, 1.8, 1.9, 1.95, 2.05]}, {"nome": "LAVAGEM REPELENTE", "valores": [1.05, 1.1, 1.15, 1.35, 1.5, 1.65, 1.75, 1.9, 2.05]}, {"nome": "CRINKLE", "valores": [1.1, 1.15, 1.25, 1.45, 1.55, 1.7, 1.85, 1.95, 2.1]}]}, {"titulo": "Acabamentos de lavagens", "tipo": "grelha", "unidade": "peça", "colunas": ["Até 100 g", "101 a 200 g", "201 a 300 g", "301 a 500 g", "501 a 750 g", "751 a 1000 g", "1001 a 1300 g", "1301 a 1500 g", "1501 a 2000 g"], "linhas": [{"nome": "CHEIRINHO", "valores": [0.07, 0.08, 0.11, 0.14, 0.16, 0.2, 0.27, 0.34, 0.41]}, {"nome": "RESINA", "valores": [0.27, 0.34, 0.38, 0.47, 0.54, 0.61, 0.68, 0.74, 0.81]}, {"nome": "SILICONE", "valores": [0.07, 0.08, 0.11, 0.14, 0.16, 0.2, 0.27, 0.34, 0.41]}, {"nome": "TIRAR TELA", "valores": [0.04, 0.05, 0.07, 0.08, 0.09, 0.11, 0.12, 0.14, 0.15]}]}, {"titulo": "Outros custos", "tipo": "lista", "linhas": [{"nome": "Custo de amostras (até 50 unidades)", "texto": "Acréscimo de 30% sobre o valor desta tabela"}, {"nome": "Custo adicional de amostras de lavagens (até 5 un)", "texto": "10,00 € por entrega/tipo"}]}]$j$::jsonb,
     $j$["Tabela válida por 6 meses.", "Os preços desta tabela são válidos para as certificações RCS, OCS, GRS, OEKOTEX e GOTS."]$j$::jsonb),
    (2, 'Tingimento', 'Green Dye', date '2026-01-01', 6,
     $j$[{"titulo": "Tingimento", "tipo": "grelha", "unidade": "kg", "colunas": ["Branco", "Cores claras", "Cores médias", "Cores escuras", "Preto"], "linhas": [{"nome": "REACTIVO", "valores": [3.05, 3.3, 3.7, 4.05, 4.05]}, {"nome": "CO/SEDA", "valores": [3.9, 4.15, 4.5, 4.9, 4.9]}, {"nome": "CO/CASHEMIRA", "valores": [4.3, 4.55, 4.95, 5.3, 5.3]}, {"nome": "DIRECTO", "valores": [null, 3.3, 3.7, 4.2, 4.2]}, {"nome": "SULFUROSO", "valores": [null, 4.4, 4.65, 5.05, 5.05]}, {"nome": "2 FIBRAS", "valores": [5.3, 7.45, 7.9, 7.95, 7.95]}, {"nome": "POLIAMIDA", "valores": [3.45, 3.65, 4.05, 4.25, 4.25]}, {"nome": "RETRODYE", "valores": [null, 6.05, 6.45, 6.95, 6.95]}, {"nome": "PIGMENTOS", "valores": [null, 5.75, 6.3, 6.8, 6.8]}, {"nome": "LINHO", "valores": [3.05, 3.3, 3.7, 4.05, 4.05]}, {"nome": "POLIESTER", "valores": [null, 4.9, 5.25, 5.75, 5.75]}, {"nome": "VEGETAL", "valores": [null, 5.9, 5.9, 5.9, 5.9]}]}, {"titulo": "Fluorescente", "tipo": "grelha", "unidade": "kg", "colunas": ["Rosa", "Amarelo/verde", "Laranja", "Azul"], "linhas": [{"nome": "ALGODÃO", "valores": [10.65, 9.4, 10.65, 9.4]}, {"nome": "POLIAMIDA", "valores": [8.15, 8.15, 8.15, 6.9]}, {"nome": "VEGETAL", "valores": [10.65, 9.4, 10.65, 9.4]}, {"nome": "POLIESTER", "valores": [8.15, 8.15, 8.15, 6.9]}]}, {"titulo": "Naturais", "tipo": "grelha", "unidade": "kg", "colunas": ["Branco", "Cores claras", "Cores médias", "Cores escuras", "Preto"], "linhas": [{"nome": "NANO", "valores": [null, 6.25, 6.9, 7.75, 7.75]}, {"nome": "MINERAIS", "valores": [null, null, 7.5, null, null]}, {"nome": "VEGETAIS", "valores": [null, 7.75, 8.5, 9.0, null]}, {"nome": "ORGANICO", "valores": [null, null, 6.25, 6.75, null]}]}, {"titulo": "Acabamentos", "tipo": "grelha", "unidade": "kg", "colunas": ["Preço"], "linhas": [{"nome": "ACABAMENTO SILICONE", "valores": [0.3]}, {"nome": "ACABAMENTO ANTIPILLING", "valores": [0.45]}, {"nome": "ACABAMENTO TIRAR TELA", "valores": [0.45]}, {"nome": "ACABAMENTO STONE WASH", "valores": [0.45]}, {"nome": "ACABAMENTO STONE WASH ESPECIAL", "valores": [1.0]}, {"nome": "ACABAMENTO SILICONE PERMANENTE", "valores": [0.65]}]}, {"titulo": "Acabamentos de lavagem", "tipo": "grelha", "unidade": "peça", "colunas": ["Até 100 g", "101 a 200 g", "201 a 300 g", "301 a 500 g", "501 a 750 g", "751 a 1000 g", "1001 a 1300 g", "1301 a 1500 g", "1501 a 2000 g", "2001 a 2500 g"], "linhas": [{"nome": "LAV FADE OUT", "valores": [1.1, 1.15, 1.25, 1.45, 1.55, 1.7, 1.85, 1.95, 2.1, 2.25]}, {"nome": "LAV FADE OUT MAREADO", "valores": [1.5, 1.55, 1.65, 1.85, 1.95, 2.1, 2.25, 2.35, 2.5, 2.65]}, {"nome": "SKY WASH", "valores": [1.0, 1.1, 1.15, 1.25, 1.45, 1.55, 1.7, 1.8, 1.95, 2.05]}, {"nome": "OLD DYE", "valores": [0.95, 1.0, 1.1, 1.2, 1.35, 1.45, 1.55, 1.7, 1.8, 1.95]}, {"nome": "MOFO", "valores": [0.9, 1.0, 1.15, 1.35, 1.45, 1.55, 1.7, 1.8, 1.95, 2.05]}]}, {"titulo": "Preparação", "tipo": "grelha", "unidade": "kg", "colunas": ["Preço"], "linhas": [{"nome": "1/2 BRANQUEAÇÃO", "valores": [1.0]}, {"nome": "DESCARREGAR COR", "valores": [1.0]}, {"nome": "FERVURA", "valores": [1.0]}]}, {"titulo": "Outros custos", "tipo": "lista", "linhas": [{"nome": "Custo de amostras (até 15 kg)", "texto": "Acréscimo de 30% sobre o valor desta tabela"}, {"nome": "Custo adicional de tingimento de amostras (até 5 kg)", "texto": "25,00 € por cor/entrega"}, {"nome": "Abertura de lab dip", "texto": "15,00 € por cor"}]}]$j$::jsonb,
     $j$["Tabela válida por 6 meses.", "Todas as cores consideradas especiais estão sujeitas a orçamento.", "Para encomendas e quantidades excecionais, preço sujeito a orçamento.", "Os preços desta tabela são válidos para as certificações RCS, OCS, GRS, OEKOTEX e GOTS."]$j$::jsonb)
  ) as v(ordem, nome, fornecedor, data_tabela, validade_meses, secoes, notas)
 where not exists (select 1 from ideia_preco_sourcetextile_documentos);

-- ---------------------------------------------------------------------
-- O PDF original de cada tabela: um bucket PRIVADO, só PDFs até 20 MB.
-- Lê quem tem acesso; carrega, troca e apaga quem pode editar.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ideia-preco-sourcetextile-documentos', 'ideia-preco-sourcetextile-documentos', false,
        20971520, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists ideia_preco_documentos_select on storage.objects;
drop policy if exists ideia_preco_documentos_insert on storage.objects;
drop policy if exists ideia_preco_documentos_update on storage.objects;
drop policy if exists ideia_preco_documentos_delete on storage.objects;

create policy ideia_preco_documentos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'ideia-preco-sourcetextile-documentos' and public.pedidos_preco_sourcetextile_acesso());
create policy ideia_preco_documentos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ideia-preco-sourcetextile-documentos' and public.ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_documentos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'ideia-preco-sourcetextile-documentos' and public.ideia_preco_sourcetextile_pode_editar())
  with check (bucket_id = 'ideia-preco-sourcetextile-documentos' and public.ideia_preco_sourcetextile_pode_editar());
create policy ideia_preco_documentos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ideia-preco-sourcetextile-documentos' and public.ideia_preco_sourcetextile_pode_editar());

-- ######################################################################
-- Parte 3 de 3 (originalmente 0014_ideia_preco_destaque_maximo.sql)
-- ######################################################################
-- =====================================================================
-- Ideia de preço - Sourcetextile
-- 0014 - destacar o preço mais caro de cada linha
--
-- Uma secção do tipo grelha pode ter "maximo": true; nesse caso a
-- visualização põe a negrito, em cada linha, o preço mais alto. Fica como
-- um dado da secção (e não como uma regra escrita no código para uma tabela
-- com um certo nome) para se poder ligar e desligar na edição.
--
-- Liga-se nas grelhas da tabela Tingimento com mais de uma coluna de
-- preços, exceto em "Acabamentos de lavagem" (como foi pedido).
-- =====================================================================
update ideia_preco_sourcetextile_documentos d
   set secoes = (
     select jsonb_agg(
              case
                when s ->> 'tipo' = 'grelha'
                 and s ->> 'titulo' <> 'Acabamentos de lavagem'
                 and jsonb_array_length(coalesce(s -> 'colunas', '[]'::jsonb)) > 1
                then s || '{"maximo": true}'::jsonb
                else s
              end
              order by x.ord)
       from jsonb_array_elements(d.secoes) with ordinality as x(s, ord))
 where d.nome = 'Tingimento';
