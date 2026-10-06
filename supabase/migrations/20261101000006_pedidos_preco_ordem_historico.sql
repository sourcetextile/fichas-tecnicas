-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0005 — a ordem do histórico deixa de depender da data corrigida
--
-- PORQUÊ: o estado do pedido era lido da transição com `ocorrido_em`
-- mais recente. Bastava corrigir uma data para trás (que é exatamente o
-- caso de uso: "esqueci-me de mover o cartão na terça") para outra
-- transição passar a ser a última e o pedido saltar sozinho para um
-- estado anterior, sem ninguém dar por isso.
--
-- CORREÇÃO, em duas partes:
--   1. a ORDEM dos acontecimentos é a ordem por que foram registados
--      (`created_at`, que nunca muda). O `ocorrido_em` passa a servir só
--      para medir durações, que é para o que existe;
--   2. corrigir uma data só é aceite se ela continuar entre a transição
--      anterior e a seguinte. Uma correção que baralhasse a sequência é
--      recusada com uma mensagem que diz entre que valores tem de ficar.
-- =====================================================================

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
   order by created_at desc, id desc          -- ordem de registo, não a data corrigida
   limit 1;

  if not found then
    raise exception 'O pedido % ficaria sem nenhuma transição.', p_pedido;
  end if;

  select max(ronda) into v_ronda
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null;

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

-- ---------------------------------------------------------------------
-- Correção de data, agora com limites.
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
  v_antigo   timestamptz;
  v_pedido   uuid;
  v_criada   timestamptz;
  v_anulada  timestamptz;
  v_min      timestamptz;
  v_max      timestamptz;
begin
  select ocorrido_em, pedido_id, created_at, anulada_em
    into v_antigo, v_pedido, v_criada, v_anulada
    from pedidos_preco_sourcetextile_transicoes where id = p_transicao;
  if not found then
    raise exception 'Transição % não existe.', p_transicao;
  end if;
  if v_anulada is not null then
    raise exception 'Esta transição foi desfeita; não há data para corrigir.';
  end if;
  if p_novo is null then
    raise exception 'A data corrigida não pode ficar vazia.';
  end if;
  if p_novo = v_antigo then
    return;
  end if;

  -- Vizinhas na sequência de registo, ignorando as desfeitas.
  select max(ocorrido_em) into v_min
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = v_pedido and anulada_em is null and created_at < v_criada;

  select min(ocorrido_em) into v_max
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = v_pedido and anulada_em is null and created_at > v_criada;

  if v_min is not null and p_novo < v_min then
    raise exception 'A data corrigida não pode ser anterior a % (o passo anterior do pedido).',
      to_char(v_min at time zone 'Europe/Lisbon', 'DD/MM/YYYY HH24:MI');
  end if;
  if v_max is not null and p_novo > v_max then
    raise exception 'A data corrigida não pode ser posterior a % (o passo seguinte do pedido).',
      to_char(v_max at time zone 'Europe/Lisbon', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into pedidos_preco_sourcetextile_correcoes
    (transicao_id, valor_antigo, valor_novo, corrigido_por)
  values (p_transicao, v_antigo, p_novo, auth.jwt() ->> 'email');

  update pedidos_preco_sourcetextile_transicoes
     set ocorrido_em = p_novo where id = p_transicao;

  perform pedidos_preco_sourcetextile_reconciliar(v_pedido);
end;
$fn$;

-- Entre que datas é que uma correção pode ficar — para o modal já abrir
-- com os limites postos no campo, em vez de deixar errar e só depois
-- explicar.
create or replace function pedidos_preco_sourcetextile_limites_correcao(p_transicao uuid)
returns table (minimo timestamptz, maximo timestamptz)
language sql stable
set search_path = public
as $fn$
  select
    (select max(t2.ocorrido_em) from pedidos_preco_sourcetextile_transicoes t2
      where t2.pedido_id = t.pedido_id and t2.anulada_em is null and t2.created_at < t.created_at),
    (select min(t2.ocorrido_em) from pedidos_preco_sourcetextile_transicoes t2
      where t2.pedido_id = t.pedido_id and t2.anulada_em is null and t2.created_at > t.created_at)
  from pedidos_preco_sourcetextile_transicoes t
  where t.id = p_transicao;
$fn$;

-- ---------------------------------------------------------------------
-- Desfazer e histórico seguem a mesma ordem de registo.
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
   order by created_at desc, id desc limit 1;

  update pedidos_preco_sourcetextile_transicoes
     set anulada_em = now(), anulada_por = auth.jwt() ->> 'email'
   where id = v_id;

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
end;
$fn$;

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
         -- Tempo desde o passo anterior VÁLIDO, na ordem de registo. Tem
         -- de ser subconsulta e não lag(): o FILTER que saltava as
         -- transições desfeitas não existe em funções de janela.
         pedidos_preco_sourcetextile_dias_uteis(
           (select max(t2.ocorrido_em) from pedidos_preco_sourcetextile_transicoes t2
             where t2.pedido_id = t.pedido_id and t2.anulada_em is null
               and t2.created_at < t.created_at),
           t.ocorrido_em) as dias_uteis,
         (select count(*) from pedidos_preco_sourcetextile_correcoes c
           where c.transicao_id = t.id) as n_correcoes
    from pedidos_preco_sourcetextile_transicoes t
   where t.pedido_id = p_pedido
   order by t.created_at, t.id;
$fn$;

-- ---------------------------------------------------------------------
-- O quadro lê a última transição pela mesma regra.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_quadro()
returns table (
  id                uuid,
  cliente_id        uuid,
  cliente_nome      text,
  ref_cliente       text,
  gp_email          text,
  gp_nome           text,
  estado            text,
  responsavel       text,
  ronda_atual       int,
  precisa_malhas    boolean,
  recebido_em       timestamptz,
  etapa_desde       timestamptz,
  dias_etapa        numeric,
  objetivo          numeric,
  semaforo          text,
  sem_resposta      boolean,
  resultado         text,
  motivo            text,
  motivo_descricao  text,
  fechado_em        timestamptz
)
language sql stable
set search_path = public
as $fn$
  with ultima as (
    select distinct on (pedido_id) pedido_id, estado_destino, ocorrido_em
      from pedidos_preco_sourcetextile_transicoes
     where anulada_em is null
     order by pedido_id, created_at desc, id desc
  ),
  rececao as (
    select pedido_id, min(ocorrido_em) as recebido_em
      from pedidos_preco_sourcetextile_transicoes
     where estado_origem is null and anulada_em is null
     group by pedido_id
  ),
  base as (
    select p.id, p.cliente_id, c.nome as cliente_nome, p.ref_cliente, p.gp_email,
           u.nome as gp_nome, p.estado, p.ronda_atual, p.precisa_malhas,
           r.recebido_em, t.ocorrido_em as etapa_desde,
           p.resultado, m.nome as motivo, p.motivo_descricao,
           case when p.estado = 'fechado' then t.ocorrido_em end as fechado_em,
           pedidos_preco_sourcetextile_dias_uteis(t.ocorrido_em, now()) as dias_etapa,
           pedidos_preco_sourcetextile_objetivo(p.estado) as objetivo
      from pedidos_preco_sourcetextile_pedidos p
      join pedidos_preco_sourcetextile_clientes c on c.id = p.cliente_id
      left join pedidos_preco_sourcetextile_utilizadores u
             on lower(trim(u.email)) = lower(trim(p.gp_email))
      left join pedidos_preco_sourcetextile_motivos m on m.id = p.motivo_id
      left join ultima t on t.pedido_id = p.id
      left join rececao r on r.pedido_id = p.id
  )
  select b.id, b.cliente_id, b.cliente_nome, b.ref_cliente, b.gp_email, b.gp_nome,
         b.estado,
         case b.estado
           when 'malhas'          then 'Aprovisionamento'
           when 'orcamentacao'    then 'GP'
           when 'aguarda_cliente' then 'Cliente'
           else null
         end as responsavel,
         b.ronda_atual, b.precisa_malhas, b.recebido_em, b.etapa_desde,
         b.dias_etapa, b.objetivo,
         pedidos_preco_sourcetextile_semaforo(b.dias_etapa, b.objetivo) as semaforo,
         (b.estado = 'aguarda_cliente'
           and b.dias_etapa >= pedidos_preco_sourcetextile_objetivo('aguarda_cliente')) as sem_resposta,
         b.resultado, b.motivo, b.motivo_descricao, b.fechado_em
    from base b;
$fn$;
