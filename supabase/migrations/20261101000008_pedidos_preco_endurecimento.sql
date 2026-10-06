-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0007 — a escrita só passa por funções, e as regras estão na base de dados
--
-- PORQUÊ (auditoria da Fase 2)
-- O código do cliente dizia "toda a escrita passa por funções SQL", mas
-- nada o impunha: as funções eram SECURITY INVOKER e as tabelas de
-- histórico tinham políticas de INSERT/UPDATE/DELETE abertas a qualquer
-- utilizador do domínio. Foi provado com um teste, a falar como um
-- browser (papel authenticated, chave pública):
--   * uma data de transição alterava-se com UPDATE direto, sem deixar
--     registo na auditoria e sem respeitar os limites da sequência;
--   * um pedido apagava-se com DELETE direto e, por cascata, levava atrás
--     todo o histórico.
-- Ambas contradizem "a tabela de transições é imutável" e "o histórico
-- NUNCA é apagado".
--
-- CORREÇÃO
--  1. As funções que escrevem passam a SECURITY DEFINER, com a guarda de
--     acesso (domínio) à cabeça. São a única porta de escrita.
--  2. As políticas e os privilégios de escrita nas tabelas de histórico
--     desaparecem: só há leitura.
--  3. As regras de estado que só existiam na interface passam a existir
--     aqui: não se fecha um pedido fechado, não se salta malhas fora de
--     Aprov. Malhas, não se pede negociação fora de Aguarda Cliente, não
--     há datas no futuro, carregar duas vezes no mesmo botão é inofensivo.
--  4. O quadro deixa de calcular (e de devolver) o que ninguém vê.
--  5. Duas funções novas, mínimas, que fecham buracos que a ausência de
--     escrita direta abriria: corrigir os dados de um pedido e apagar um
--     pedido criado por engano que ainda não teve nenhum movimento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Guarda de acesso. Dentro de uma função SECURITY DEFINER o RLS já não
-- protege nada (corre como dono), por isso o domínio verifica-se aqui.
-- auth.jwt() continua a ver o token de quem chamou.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_exigir_acesso()
returns void
language plpgsql stable
set search_path = public
as $fn$
begin
  if not pedidos_preco_sourcetextile_acesso() then
    raise exception 'Sem acesso a esta aplicação.' using errcode = '42501';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Criar pedido
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
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hoje    date := (now() at time zone 'Europe/Lisbon')::date;
  v_malhas  boolean := coalesce(p_precisa_malhas, true);
  v_estado  text;
  v_cliente uuid := p_cliente_id;
  v_pedido  uuid;
  v_data    date;
  v_quando  timestamptz;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  v_estado := case when v_malhas then 'malhas' else 'orcamentacao' end;
  v_data   := coalesce(p_data_rececao, v_hoje);

  if coalesce(trim(p_ref_cliente), '') = '' then
    raise exception 'A referência do cliente é obrigatória.';
  end if;
  if coalesce(trim(p_gp_email), '') = '' then
    raise exception 'Escolhe a GP responsável.';
  end if;
  if v_data > v_hoje then
    raise exception 'A data de receção não pode ser no futuro.';
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
  elsif not exists (select 1 from pedidos_preco_sourcetextile_clientes where id = v_cliente) then
    raise exception 'Esse cliente não existe.';
  end if;

  if exists (select 1 from pedidos_preco_sourcetextile_pedidos
              where cliente_id = v_cliente
                and upper(trim(ref_cliente)) = upper(trim(p_ref_cliente))) then
    raise exception 'Já existe um pedido deste cliente com a referência %.', trim(p_ref_cliente)
      using errcode = 'unique_violation';
  end if;

  v_quando := case
    when v_data = v_hoje then now()
    else (v_data + (select h_ini from pedidos_preco_sourcetextile_horario()))
           at time zone 'Europe/Lisbon'
  end;

  insert into pedidos_preco_sourcetextile_pedidos
    (cliente_id, ref_cliente, gp_email, precisa_malhas, estado)
  values (v_cliente, trim(p_ref_cliente), lower(trim(p_gp_email)), v_malhas, v_estado)
  returning id into v_pedido;

  insert into pedidos_preco_sourcetextile_transicoes
    (pedido_id, ronda, estado_origem, estado_destino, ocorrido_em, utilizador_email, origem, detalhe)
  values (v_pedido, 1, null, v_estado, v_quando, auth.jwt() ->> 'email', 'app',
          jsonb_build_object('precisa_malhas', v_malhas));

  return v_pedido;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Mover entre colunas abertas. Idempotente: se o pedido já lá está
-- (porque a Paula e a GP carregaram no mesmo botão ao mesmo tempo), o
-- segundo pedido não faz nada em vez de gravar um movimento a mais.
-- A origem 'link' fica reservada à ação do email, para ninguém a poder
-- forjar a partir do browser.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_mover(
  p_pedido  uuid,
  p_destino text,
  p_origem  text default 'kanban'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_estado text;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  if p_destino not in ('malhas', 'orcamentacao', 'aguarda_cliente') then
    raise exception 'Destino inválido: %. Para fechar usa a função de fecho.', p_destino;
  end if;
  if p_origem not in ('kanban', 'botao') then
    p_origem := 'kanban';
  end if;

  select estado into v_estado
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;
  if v_estado = 'fechado' then
    raise exception 'Este pedido está fechado. Para o reabrir, usa Desfazer.';
  end if;
  if v_estado = p_destino then
    return;
  end if;

  perform pedidos_preco_sourcetextile_registar(p_pedido, p_destino, p_origem);
end;
$fn$;

-- Saltar a consulta de malhas — só faz sentido enquanto ela está pendente.
create or replace function pedidos_preco_sourcetextile_saltar_malhas(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_estado text;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  select estado into v_estado
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;
  if v_estado <> 'malhas' then
    raise exception 'Só se pode saltar malhas enquanto o pedido está em Aprov. Malhas.';
  end if;

  perform pedidos_preco_sourcetextile_registar(
    p_pedido, 'orcamentacao', 'botao', '{"acao": "saltar_malhas"}'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Fechar. Não se exige que esteja em Aguarda Cliente: um cliente pode
-- cancelar antes de haver preço, e o universo da conversão já exclui à
-- partida os pedidos sem preço enviado (é assim que o enunciado o define).
-- A interface só oferece o fecho em Aguarda Cliente.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_fechar(
  p_pedido           uuid,
  p_resultado        text,
  p_motivo_id        uuid default null,
  p_motivo_descricao text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_estado text;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  if p_resultado not in ('converteu', 'converteu_negociacao', 'nao_converteu') then
    raise exception 'Resultado inválido: %.', p_resultado;
  end if;
  if p_resultado = 'nao_converteu' and p_motivo_id is null then
    raise exception 'Não converteu obriga a escolher um motivo.';
  end if;
  if p_motivo_id is not null
     and not exists (select 1 from pedidos_preco_sourcetextile_motivos where id = p_motivo_id) then
    raise exception 'Esse motivo não existe.';
  end if;

  select estado into v_estado
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;
  if v_estado = 'fechado' then
    raise exception 'Este pedido já está fechado.';
  end if;

  perform pedidos_preco_sourcetextile_registar(
    p_pedido, 'fechado', 'botao',
    jsonb_build_object(
      'resultado', p_resultado,
      -- o motivo só existe para "não converteu"; nos outros fica em branco
      'motivo_id', case when p_resultado = 'nao_converteu' then coalesce(p_motivo_id::text, '') else '' end,
      'motivo_descricao', case when p_resultado = 'nao_converteu' then coalesce(p_motivo_descricao, '') else '' end));
end;
$fn$;

-- ---------------------------------------------------------------------
-- Cliente pediu negociação — só a partir de Aguarda Cliente.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_nova_ronda(
  p_pedido         uuid,
  p_precisa_malhas boolean default true
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_estado text;
  v_ronda  int;
  v_malhas boolean := coalesce(p_precisa_malhas, true);
  v_dest   text;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  select estado, ronda_atual + 1 into v_estado, v_ronda
    from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;
  if v_estado <> 'aguarda_cliente' then
    raise exception 'Só se pode pedir negociação quando o pedido está em Aguarda Cliente.';
  end if;

  v_dest := case when v_malhas then 'malhas' else 'orcamentacao' end;

  insert into pedidos_preco_sourcetextile_transicoes
    (pedido_id, ronda, estado_origem, estado_destino, ocorrido_em, utilizador_email, origem, detalhe)
  values (p_pedido, v_ronda, null, v_dest, now(), auth.jwt() ->> 'email', 'botao',
          jsonb_build_object('precisa_malhas', v_malhas, 'acao', 'negociacao'));

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
  return v_ronda;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Desfazer o último movimento
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_desfazer(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
  v_n  int;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  perform 1 from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;

  select count(*) into v_n from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null;
  if v_n <= 1 then
    raise exception 'Não há movimentos para desfazer neste pedido.';
  end if;

  select id into v_id from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p_pedido and anulada_em is null
   order by seq desc limit 1;

  update pedidos_preco_sourcetextile_transicoes
     set anulada_em = now(), anulada_por = auth.jwt() ->> 'email'
   where id = v_id;

  perform pedidos_preco_sourcetextile_reconciliar(p_pedido);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Corrigir a data de uma transição. Agora também recusa datas futuras,
-- que a comparação com a transição vizinha não apanhava na última.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_corrigir_data(
  p_transicao uuid,
  p_novo      timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_antigo  timestamptz;
  v_pedido  uuid;
  v_seq     bigint;
  v_anulada timestamptz;
  v_min     timestamptz;
  v_max     timestamptz;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  select ocorrido_em, pedido_id, seq, anulada_em
    into v_antigo, v_pedido, v_seq, v_anulada
    from pedidos_preco_sourcetextile_transicoes where id = p_transicao;
  if not found then
    raise exception 'Este passo já não existe.';
  end if;

  perform 1 from pedidos_preco_sourcetextile_pedidos where id = v_pedido for update;

  if v_anulada is not null then
    raise exception 'Este passo foi desfeito; não há data para corrigir.';
  end if;
  if p_novo is null then
    raise exception 'A data corrigida não pode ficar vazia.';
  end if;
  if p_novo > now() + interval '5 minutes' then
    raise exception 'A data corrigida não pode ser no futuro.';
  end if;
  if p_novo = v_antigo then
    return;
  end if;

  select max(ocorrido_em) into v_min
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = v_pedido and anulada_em is null and seq < v_seq;
  select min(ocorrido_em) into v_max
    from pedidos_preco_sourcetextile_transicoes
   where pedido_id = v_pedido and anulada_em is null and seq > v_seq;

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

-- ---------------------------------------------------------------------
-- NOVO — corrigir os dados de um pedido (cliente, referência, GP).
--
-- Sem escrita direta, um engano ao escrever a referência ficava para
-- sempre. Não toca no histórico nem nas datas: só nos rótulos do pedido.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_editar_pedido(
  p_pedido       uuid,
  p_cliente_nome text,
  p_cliente_id   uuid,
  p_ref_cliente  text,
  p_gp_email     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cliente uuid := p_cliente_id;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  if coalesce(trim(p_ref_cliente), '') = '' then
    raise exception 'A referência do cliente é obrigatória.';
  end if;
  if coalesce(trim(p_gp_email), '') = '' then
    raise exception 'Escolhe a GP responsável.';
  end if;

  perform 1 from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
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
              where id <> p_pedido and cliente_id = v_cliente
                and upper(trim(ref_cliente)) = upper(trim(p_ref_cliente))) then
    raise exception 'Já existe outro pedido deste cliente com a referência %.', trim(p_ref_cliente)
      using errcode = 'unique_violation';
  end if;

  update pedidos_preco_sourcetextile_pedidos
     set cliente_id = v_cliente,
         ref_cliente = trim(p_ref_cliente),
         gp_email = lower(trim(p_gp_email))
   where id = p_pedido;
end;
$fn$;

-- ---------------------------------------------------------------------
-- NOVO — apagar um pedido criado por engano.
--
-- Só é possível se o pedido nunca teve um único movimento (nem sequer um
-- desfeito) e nunca teve uma data corrigida: nesse caso não há histórico
-- a perder, só a própria criação. Qualquer outro pedido é permanente.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_apagar_pedido(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();

  perform 1 from pedidos_preco_sourcetextile_pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Este pedido já não existe.';
  end if;

  if (select count(*) from pedidos_preco_sourcetextile_transicoes where pedido_id = p_pedido) > 1
     or exists (select 1 from pedidos_preco_sourcetextile_correcoes c
                  join pedidos_preco_sourcetextile_transicoes t on t.id = c.transicao_id
                 where t.pedido_id = p_pedido) then
    raise exception 'Este pedido já teve movimentos, por isso não pode ser apagado. O histórico é sempre guardado.';
  end if;

  delete from pedidos_preco_sourcetextile_pedidos where id = p_pedido;
end;
$fn$;

-- ---------------------------------------------------------------------
-- O quadro: só o que se vê. Os fechados vêm apenas se pedidos, e só os
-- dos últimos N dias; e não se calcula "há quantos dias úteis está fechado",
-- que ninguém usa e custava um percurso por cada pedido antigo.
-- ---------------------------------------------------------------------
drop function if exists pedidos_preco_sourcetextile_quadro();

create or replace function pedidos_preco_sourcetextile_quadro(p_fechados_dias int default 0)
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
     order by pedido_id, seq desc
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
           case when p.estado = 'fechado' then null
                else pedidos_preco_sourcetextile_dias_uteis(t.ocorrido_em, now()) end as dias_etapa,
           pedidos_preco_sourcetextile_objetivo(p.estado) as objetivo
      from pedidos_preco_sourcetextile_pedidos p
      join pedidos_preco_sourcetextile_clientes c on c.id = p.cliente_id
      left join pedidos_preco_sourcetextile_utilizadores u
             on lower(trim(u.email)) = lower(trim(p.gp_email))
      left join pedidos_preco_sourcetextile_motivos m on m.id = p.motivo_id
      left join ultima t on t.pedido_id = p.id
      left join rececao r on r.pedido_id = p.id
     where p.estado <> 'fechado'
        or (coalesce(p_fechados_dias, 0) > 0
            and t.ocorrido_em >= now() - make_interval(days => p_fechados_dias))
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

-- ---------------------------------------------------------------------
-- Fechar as portas. Só há leitura nas tabelas de histórico; as
-- políticas de escrita saem e os privilégios também (um erro claro de
-- "permission denied" em vez de um UPDATE que silenciosamente não faz nada).
-- ---------------------------------------------------------------------
drop policy if exists pedidos_preco_sourcetextile_pedidos_insert     on pedidos_preco_sourcetextile_pedidos;
drop policy if exists pedidos_preco_sourcetextile_pedidos_update     on pedidos_preco_sourcetextile_pedidos;
drop policy if exists pedidos_preco_sourcetextile_pedidos_delete     on pedidos_preco_sourcetextile_pedidos;
drop policy if exists pedidos_preco_sourcetextile_transicoes_insert  on pedidos_preco_sourcetextile_transicoes;
drop policy if exists pedidos_preco_sourcetextile_transicoes_update  on pedidos_preco_sourcetextile_transicoes;
drop policy if exists pedidos_preco_sourcetextile_correcoes_insert   on pedidos_preco_sourcetextile_correcoes;

revoke insert, update, delete, truncate
  on pedidos_preco_sourcetextile_pedidos,
     pedidos_preco_sourcetextile_transicoes,
     pedidos_preco_sourcetextile_correcoes
  from anon, authenticated;

-- As duas funções internas não são para chamar de fora.
revoke execute on function pedidos_preco_sourcetextile_registar(uuid, text, text, jsonb, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_reconciliar(uuid)
  from public, anon, authenticated;

-- As de escrita são só para quem tem sessão (e, lá dentro, domínio).
revoke execute on function pedidos_preco_sourcetextile_criar_pedido(text, text, text, date, boolean, uuid) from public, anon;
revoke execute on function pedidos_preco_sourcetextile_mover(uuid, text, text)                              from public, anon;
revoke execute on function pedidos_preco_sourcetextile_saltar_malhas(uuid)                                   from public, anon;
revoke execute on function pedidos_preco_sourcetextile_fechar(uuid, text, uuid, text)                        from public, anon;
revoke execute on function pedidos_preco_sourcetextile_nova_ronda(uuid, boolean)                             from public, anon;
revoke execute on function pedidos_preco_sourcetextile_desfazer(uuid)                                        from public, anon;
revoke execute on function pedidos_preco_sourcetextile_corrigir_data(uuid, timestamptz)                      from public, anon;
revoke execute on function pedidos_preco_sourcetextile_editar_pedido(uuid, text, uuid, text, text)           from public, anon;
revoke execute on function pedidos_preco_sourcetextile_apagar_pedido(uuid)                                   from public, anon;
