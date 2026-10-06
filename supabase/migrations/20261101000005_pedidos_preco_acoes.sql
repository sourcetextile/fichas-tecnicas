-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0004 — ações sobre um pedido
--
-- Toda a escrita passa por estas funções. O cliente nunca faz UPDATE
-- direto ao estado de um pedido: grava a transição e o estado é sempre
-- RECALCULADO a partir do histórico (função _reconciliar). É isso que
-- torna o desfazer trivial e impede que a tabela e o histórico
-- divirjam.
--
-- Todas correm com os direitos de quem chama, por isso o RLS vale na
-- mesma — não são security definer.
-- =====================================================================

-- Detalhe da transição: resultado do fecho, motivo, se saltou malhas.
-- É o que permite reconstituir o estado só a partir do histórico.
alter table pedidos_preco_sourcetextile_transicoes
  add column if not exists detalhe jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Recalcula a linha do pedido a partir das transições não anuladas.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_reconciliar(p_pedido uuid)
returns void
language plpgsql
set search_path = public
as $fn$
declare
  v_ultima  pedidos_preco_sourcetextile_transicoes%rowtype;
  v_ronda   int;
  v_malhas  boolean;
begin
  select * into v_ultima
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null
   order by ocorrido_em desc, created_at desc
   limit 1;

  if not found then
    raise exception 'O pedido % ficaria sem nenhuma transição.', p_pedido;
  end if;

  select max(ronda) into v_ronda
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null;

  -- Precisa de malhas nesta ronda? O que foi dito na receção da ronda,
  -- a menos que alguém tenha carregado em "saltar malhas" depois.
  select coalesce((t.detalhe ->> 'precisa_malhas')::boolean, true) into v_malhas
    from pedidos_preco_sourcetextile_transicoes t
   where t.pedido_id = p_pedido and t.ronda = v_ronda
     and t.estado_origem is null and t.anulada_em is null;

  if exists (select 1 from pedidos_preco_sourcetextile_transicoes t
              where t.pedido_id = p_pedido and t.ronda = v_ronda
                and t.anulada_em is null and t.detalhe ->> 'acao' = 'saltar_malhas') then
    v_malhas := false;
  end if;

  update pedidos_preco_sourcetextile_pedidos p set
    estado           = v_ultima.estado_destino,
    ronda_atual      = v_ronda,
    precisa_malhas   = coalesce(v_malhas, true),
    resultado        = case when v_ultima.estado_destino = 'fechado'
                            then v_ultima.detalhe ->> 'resultado' end,
    motivo_id        = case when v_ultima.estado_destino = 'fechado'
                            then nullif(v_ultima.detalhe ->> 'motivo_id', '')::uuid end,
    motivo_descricao = case when v_ultima.estado_destino = 'fechado'
                            then nullif(v_ultima.detalhe ->> 'motivo_descricao', '') end
  where p.id = p_pedido;
end;
$fn$;

-- Grava uma transição e reconcilia. Uso interno das funções abaixo.
create or replace function pedidos_preco_sourcetextile_registar(
  p_pedido      uuid,
  p_destino     text,
  p_origem_acao text default 'app',
  p_detalhe     jsonb default '{}'::jsonb,
  p_ocorrido_em timestamptz default null,
  p_por         text default null
)
returns uuid
language plpgsql
set search_path = public
as $fn$
declare
  v_estado_atual text;
  v_ronda        int;
  v_id           uuid;
begin
  select estado, ronda_atual into v_estado_atual, v_ronda
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido;
  if not found then
    raise exception 'Pedido % não existe.', p_pedido;
  end if;

  insert into pedidos_preco_sourcetextile_transicoes
    (pedido_id, ronda, estado_origem, estado_destino, ocorrido_em, utilizador_email, origem, detalhe)
  values
    (p_pedido, coalesce((p_detalhe ->> 'ronda')::int, v_ronda),
     v_estado_atual, p_destino, coalesce(p_ocorrido_em, now()),
     coalesce(p_por, auth.jwt() ->> 'email'), p_origem_acao, p_detalhe - 'ronda')
  returning id into v_id;

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Criar pedido — o cliente pode vir por id ou por nome (criado na hora).
-- A data de receção, se for hoje, fica com a hora atual; se for uma data
-- anterior, fica ao início do expediente desse dia.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_criar_pedido(
  p_cliente_nome   text,
  p_ref_cliente    text,
  p_gp_email       text,
  p_data_rececao   date default null,
  p_precisa_malhas boolean default true,
  p_cliente_id     uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $fn$
declare
  v_cliente uuid := p_cliente_id;
  v_pedido  uuid;
  v_data    date := coalesce(p_data_rececao, (now() at time zone 'Europe/Lisbon')::date);
  v_quando  timestamptz;
  v_estado  text := case when p_precisa_malhas then 'malhas' else 'orcamentacao' end;
begin
  if coalesce(trim(p_ref_cliente), '') = '' then
    raise exception 'A referência do cliente é obrigatória.';
  end if;

  if v_cliente is null then
    if coalesce(trim(p_cliente_nome), '') = '' then
      raise exception 'O cliente é obrigatório.';
    end if;
    select id into v_cliente from pedidos_preco_sourcetextile_clientes
     where lower(trim(nome)) = lower(trim(p_cliente_nome));
    if v_cliente is null then
      insert into pedidos_preco_sourcetextile_clientes (nome)
      values (trim(p_cliente_nome)) returning id into v_cliente;
    end if;
  end if;

  if exists (select 1 from pedidos_preco_sourcetextile_pedidos
              where cliente_id = v_cliente
                and upper(trim(ref_cliente)) = upper(trim(p_ref_cliente))) then
    raise exception 'Já existe um pedido deste cliente com a referência %.', trim(p_ref_cliente)
      using errcode = 'unique_violation';
  end if;

  v_quando := case
    when v_data = (now() at time zone 'Europe/Lisbon')::date then now()
    else (v_data + (select h_ini from pedidos_preco_sourcetextile_horario()))
           at time zone 'Europe/Lisbon'
  end;

  insert into pedidos_preco_sourcetextile_pedidos
    (cliente_id, ref_cliente, gp_email, precisa_malhas, estado)
  values (v_cliente, trim(p_ref_cliente), lower(trim(p_gp_email)), p_precisa_malhas, v_estado)
  returning id into v_pedido;

  insert into pedidos_preco_sourcetextile_transicoes
    (pedido_id, ronda, estado_origem, estado_destino, ocorrido_em, utilizador_email, origem, detalhe)
  values (v_pedido, 1, null, v_estado, v_quando, auth.jwt() ->> 'email', 'app',
          jsonb_build_object('precisa_malhas', p_precisa_malhas));

  return v_pedido;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Mover entre colunas abertas — arrastar e os botões do cartão acabam
-- os dois aqui.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_mover(
  p_pedido  uuid,
  p_destino text,
  p_origem  text default 'kanban'
)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  if p_destino not in ('malhas', 'orcamentacao', 'aguarda_cliente') then
    raise exception 'Destino inválido: %. Para fechar usa a função de fecho.', p_destino;
  end if;
  perform pedidos_preco_sourcetextile_registar(p_pedido, p_destino, p_origem);
end;
$fn$;

-- Saltar a consulta de malhas, a qualquer momento.
create or replace function pedidos_preco_sourcetextile_saltar_malhas(p_pedido uuid)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  perform pedidos_preco_sourcetextile_registar(
    p_pedido, 'orcamentacao', 'botao', '{"acao": "saltar_malhas"}'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Fechar — converteu, converteu com negociação, ou não converteu (que
-- obriga a motivo).
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_fechar(
  p_pedido           uuid,
  p_resultado        text,
  p_motivo_id        uuid default null,
  p_motivo_descricao text default null
)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  if p_resultado not in ('converteu', 'converteu_negociacao', 'nao_converteu') then
    raise exception 'Resultado inválido: %.', p_resultado;
  end if;
  if p_resultado = 'nao_converteu' and p_motivo_id is null then
    raise exception 'Não converteu obriga a escolher um motivo.';
  end if;

  perform pedidos_preco_sourcetextile_registar(
    p_pedido, 'fechado', 'botao',
    jsonb_build_object(
      'resultado', p_resultado,
      'motivo_id', coalesce(p_motivo_id::text, ''),
      'motivo_descricao', coalesce(p_motivo_descricao, '')));
end;
$fn$;

-- ---------------------------------------------------------------------
-- Cliente pediu negociação — volta ao início numa ronda nova. O
-- histórico da ronda anterior fica intacto.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_nova_ronda(
  p_pedido         uuid,
  p_precisa_malhas boolean default true
)
returns int
language plpgsql
set search_path = public
as $fn$
declare
  v_ronda  int;
  v_estado text := case when p_precisa_malhas then 'malhas' else 'orcamentacao' end;
begin
  select ronda_atual + 1 into v_ronda
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido;
  if v_ronda is null then
    raise exception 'Pedido % não existe.', p_pedido;
  end if;

  insert into pedidos_preco_sourcetextile_transicoes
    (pedido_id, ronda, estado_origem, estado_destino, ocorrido_em, utilizador_email, origem, detalhe)
  values (p_pedido, v_ronda, null, v_estado, now(), auth.jwt() ->> 'email', 'botao',
          jsonb_build_object('precisa_malhas', p_precisa_malhas, 'acao', 'negociacao'));

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
  return v_ronda;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Desfazer o último movimento — anula a transição, nunca a apaga, e o
-- próprio desfazer fica visível na linha temporal.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_desfazer(p_pedido uuid)
returns void
language plpgsql
set search_path = public
as $fn$
declare
  v_id uuid;
  v_n  int;
begin
  select count(*) into v_n from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null;
  if v_n <= 1 then
    raise exception 'Não há movimentos para desfazer neste pedido.';
  end if;

  select id into v_id from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null
   order by ocorrido_em desc, created_at desc limit 1;

  update pedidos_preco_sourcetextile_transicoes
     set anulada_em = now(), anulada_por = auth.jwt() ->> 'email'
   where id = v_id;

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Corrigir a data de uma transição — para quando se esquecem de mover o
-- cartão. Fica registado quem corrigiu, quando, e o valor antigo.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_corrigir_data(
  p_transicao uuid,
  p_novo      timestamptz
)
returns void
language plpgsql
set search_path = public
as $fn$
declare
  v_antigo timestamptz;
  v_pedido uuid;
begin
  select ocorrido_em, pedido_id into v_antigo, v_pedido
    from pedidos_preco_sourcetextile_transicoes where id = p_transicao;
  if not found then
    raise exception 'Transição % não existe.', p_transicao;
  end if;
  if p_novo is null then
    raise exception 'A data corrigida não pode ficar vazia.';
  end if;
  if p_novo = v_antigo then
    return;
  end if;

  insert into pedidos_preco_sourcetextile_correcoes
    (transicao_id, valor_antigo, valor_novo, corrigido_por)
  values (p_transicao, v_antigo, p_novo, auth.jwt() ->> 'email');

  update pedidos_preco_sourcetextile_transicoes
     set ocorrido_em = p_novo where id = p_transicao;

  perform pedidos_preco_sourcetextile_reconciliar(v_pedido);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Linha temporal de um pedido, para o cartão aberto.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_historico(p_pedido uuid)
returns table (
  id               uuid,
  ronda            int,
  estado_origem    text,
  estado_destino   text,
  ocorrido_em      timestamptz,
  utilizador_email text,
  origem           text,
  detalhe          jsonb,
  anulada_em       timestamptz,
  anulada_por      text,
  dias_uteis       numeric,
  n_correcoes      bigint
)
language sql stable
set search_path = public
as $fn$
  select t.id, t.ronda, t.estado_origem, t.estado_destino, t.ocorrido_em,
         t.utilizador_email, t.origem, t.detalhe, t.anulada_em, t.anulada_por,
         pedidos_preco_sourcetextile_dias_uteis(
           lag(t.ocorrido_em) over (order by t.ocorrido_em, t.created_at),
           t.ocorrido_em) as dias_uteis,
         (select count(*) from pedidos_preco_sourcetextile_correcoes c
           where c.transicao_id = t.id) as n_correcoes
    from pedidos_preco_sourcetextile_transicoes t
   where t.pedido_id = p_pedido
   order by t.ocorrido_em, t.created_at;
$fn$;
