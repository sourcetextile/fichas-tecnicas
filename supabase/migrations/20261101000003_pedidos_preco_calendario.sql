-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0002 — calendário, dias úteis e leitura do quadro
--
-- TUDO o que conta tempo nesta aplicação passa por aqui: o kanban, o
-- dashboard e os alertas chamam as mesmas funções. Se o horário ou o
-- calendário mudarem, mudam num sítio só.
--
-- Dia útil: segunda a sexta, das 08:20 às 17:20 (9 horas), hora de
-- Lisboa. O horário é configurável (chave 'horario').
-- =====================================================================

-- ---------------------------------------------------------------------
-- Domingo de Páscoa (algoritmo gregoriano anónimo / Meeus). É daqui que
-- saem os feriados móveis, para não ser preciso semear tabelas todos os
-- anos nem manter listas à mão.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_pascoa(p_ano int)
returns date
language plpgsql immutable
set search_path = public
as $fn$
declare
  a int; b int; c int; d int; e int; f int; g int;
  h int; i int; k int; l int; m int; mes int; dia int;
begin
  if p_ano is null then return null; end if;
  a := p_ano % 19;
  b := p_ano / 100;
  c := p_ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Feriados nacionais de Portugal: 10 fixos + 2 móveis.
-- O Carnaval NÃO está aqui porque não é feriado nacional obrigatório —
-- quando a empresa fecha, entra como encerramento nas configurações.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_feriados_nacionais(p_ano int)
returns table (data date, nome text)
language sql immutable
set search_path = public
as $fn$
  select * from (values
    (make_date(p_ano,  1,  1), 'Ano Novo'),
    (pedidos_preco_sourcetextile_pascoa(p_ano) - 2, 'Sexta-feira Santa'),
    (make_date(p_ano,  4, 25), 'Dia da Liberdade'),
    (make_date(p_ano,  5,  1), 'Dia do Trabalhador'),
    (pedidos_preco_sourcetextile_pascoa(p_ano) + 60, 'Corpo de Deus'),
    (make_date(p_ano,  6, 10), 'Dia de Portugal'),
    (make_date(p_ano,  8, 15), 'Assunção de Nossa Senhora'),
    (make_date(p_ano, 10,  5), 'Implantação da República'),
    (make_date(p_ano, 11,  1), 'Todos os Santos'),
    (make_date(p_ano, 12,  1), 'Restauração da Independência'),
    (make_date(p_ano, 12,  8), 'Imaculada Conceição'),
    (make_date(p_ano, 12, 25), 'Natal')
  ) as t(data, nome)
  order by 1;
$fn$;

-- ---------------------------------------------------------------------
-- É dia útil? Fim de semana, feriado nacional ou encerramento = não.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_e_dia_util(p_data date)
returns boolean
language sql stable
set search_path = public
as $fn$
  select p_data is not null
     and extract(isodow from p_data) < 6
     and not exists (
           select 1 from pedidos_preco_sourcetextile_feriados_nacionais(extract(year from p_data)::int) f
            where f.data = p_data)
     and not exists (
           select 1 from pedidos_preco_sourcetextile_encerramentos e
            where e.data = p_data and e.ativo);
$fn$;

-- ---------------------------------------------------------------------
-- Horário de expediente, com valores por defeito se a configuração
-- ainda não existir.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_horario()
returns table (h_ini time, h_fim time)
language sql stable
set search_path = public
as $fn$
  select
    coalesce((pedidos_preco_sourcetextile_cfg('horario') ->> 'inicio')::time, time '08:20'),
    coalesce((pedidos_preco_sourcetextile_cfg('horario') ->> 'fim')::time,    time '17:20');
$fn$;

-- ---------------------------------------------------------------------
-- Horas de expediente entre dois instantes. Percorre os dias do
-- intervalo e soma, em cada dia útil, a sobreposição com a janela de
-- trabalho desse dia. A conversão para hora de Lisboa é feita dia a dia,
-- por isso as mudanças de hora não desalinham nada.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_horas_uteis(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns numeric
language sql stable
set search_path = public
as $fn$
  select case when p_inicio is null or p_fim is null then null else (
    with lim as (
      select least(p_inicio, p_fim) as ini, greatest(p_inicio, p_fim) as fim
    ),
    h as (select * from pedidos_preco_sourcetextile_horario()),
    dias as (
      select generate_series(
               ((select ini from lim) at time zone 'Europe/Lisbon')::date,
               ((select fim from lim) at time zone 'Europe/Lisbon')::date,
               interval '1 day')::date as d
    )
    select round(coalesce(sum(
        greatest(0, extract(epoch from (
            least(lim.fim,  (dias.d + h.h_fim) at time zone 'Europe/Lisbon')
          - greatest(lim.ini, (dias.d + h.h_ini) at time zone 'Europe/Lisbon')
        )) / 3600.0)
      ), 0)::numeric, 4)
    from dias cross join h cross join lim
    where pedidos_preco_sourcetextile_e_dia_util(dias.d)
  ) end;
$fn$;

-- ---------------------------------------------------------------------
-- A função que toda a aplicação usa: dias úteis com 1 casa decimal.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_dias_uteis(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns numeric
language sql stable
set search_path = public
as $fn$
  select case when p_inicio is null or p_fim is null then null else
    round(
      pedidos_preco_sourcetextile_horas_uteis(p_inicio, p_fim)
      / nullif((select extract(epoch from (h_fim - h_ini)) / 3600.0
                  from pedidos_preco_sourcetextile_horario()), 0)
    , 1)
  end;
$fn$;

-- ---------------------------------------------------------------------
-- Semáforo — verde < 85% do objetivo, amarelo até 100%, vermelho acima.
-- O limiar é configurável. A cor nunca anda sozinha na interface.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_semaforo(
  p_valor    numeric,
  p_objetivo numeric
)
returns text
language sql stable
set search_path = public
as $fn$
  select case
    when p_valor is null or p_objetivo is null or p_objetivo <= 0 then null
    when p_valor > p_objetivo then 'vermelho'
    when p_valor >= p_objetivo * coalesce(
           (pedidos_preco_sourcetextile_cfg('limiar_amarelo') ->> 'valor')::numeric, 0.85)
      then 'amarelo'
    else 'verde'
  end;
$fn$;

-- Objetivo em dias úteis de uma coluna do quadro.
create or replace function pedidos_preco_sourcetextile_objetivo(p_estado text)
returns numeric
language sql stable
set search_path = public
as $fn$
  select coalesce(
    (pedidos_preco_sourcetextile_cfg('objetivos') ->> p_estado)::numeric,
    case p_estado when 'malhas' then 2 when 'orcamentacao' then 1
                  when 'aguarda_cliente' then 5 else null end);
$fn$;

-- ---------------------------------------------------------------------
-- O quadro — uma chamada só devolve tudo o que os cartões mostram, já
-- com os dias úteis e o semáforo calculados pelas funções acima.
-- Corre com os direitos de quem chama, por isso o RLS continua a valer.
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
    select distinct on (pedido_id)
           pedido_id, estado_destino, ocorrido_em
      from pedidos_preco_sourcetextile_transicoes
     where anulada_em is null
     order by pedido_id, ocorrido_em desc, created_at desc
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
