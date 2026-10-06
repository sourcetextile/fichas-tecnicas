-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0008 — indicadores do dashboard
--
-- Uma linha por pedido, com os factos de que os indicadores precisam,
-- calculados SEMPRE a partir da tabela de transições (só as não anuladas)
-- e com a mesma função de dias úteis do quadro. As médias, as taxas e os
-- semáforos agregam-se depois (js/pedidos/pedidos-kpi.js, com testes).
--
-- Tempo de resposta = tempo interno (Aprov. Malhas + Orçamentação) de todas
-- as rondas, sem o tempo em que o pedido esteve com o cliente. Só existe
-- quando TODAS as rondas já tiveram preço enviado.
-- Tempo em malhas exclui as malhas saltadas ("não aplicável").
-- =====================================================================
create or replace function pedidos_preco_sourcetextile_kpis(
  p_desde date default null,
  p_ate   date default null
)
returns table (
  id uuid, cliente_id uuid, cliente_nome text, ref_cliente text,
  gp_email text, gp_nome text, estado text, responsavel text,
  ronda_atual int, precisa_malhas boolean,
  recebido_em timestamptz, etapa_desde timestamptz,
  dias_etapa numeric, objetivo numeric, semaforo text, sem_resposta boolean,
  resultado text, motivo text, motivo_descricao text, fechado_em timestamptz,
  preco_enviado boolean, rondas int, malhas_na boolean,
  tempo_resposta numeric, tempo_malhas numeric, tempo_orcamentacao numeric,
  ciclo_total numeric
)
language sql stable
set search_path = public
as $fn$
  with hpd as (
    select extract(epoch from (h_fim - h_ini)) / 3600.0 as h
      from pedidos_preco_sourcetextile_horario()
  ),
  q as (select * from pedidos_preco_sourcetextile_quadro(36500)),
  v as (
    select t.*,
           lag(t.ocorrido_em)    over w as prev_em,
           lag(t.estado_destino) over w as prev_estado
      from pedidos_preco_sourcetextile_transicoes t
     where t.anulada_em is null
    window w as (partition by t.pedido_id order by t.seq)
  ),
  est as (
    select pedido_id,
      sum(pedidos_preco_sourcetextile_horas_uteis(prev_em, ocorrido_em))
        filter (where prev_estado = 'malhas'
                  and coalesce(detalhe ->> 'acao', '') <> 'saltar_malhas') as h_malhas,
      sum(pedidos_preco_sourcetextile_horas_uteis(prev_em, ocorrido_em))
        filter (where prev_estado = 'orcamentacao') as h_orc,
      sum(pedidos_preco_sourcetextile_horas_uteis(prev_em, ocorrido_em))
        filter (where prev_estado in ('malhas', 'orcamentacao')) as h_interno,
      count(distinct ronda) filter (where estado_destino = 'aguarda_cliente') as rondas_com_preco
    from v
    group by pedido_id
  )
  select q.id, q.cliente_id, q.cliente_nome, q.ref_cliente, q.gp_email, q.gp_nome,
         q.estado, q.responsavel, q.ronda_atual, q.precisa_malhas,
         q.recebido_em, q.etapa_desde, q.dias_etapa, q.objetivo, q.semaforo,
         q.sem_resposta, q.resultado, q.motivo, q.motivo_descricao, q.fechado_em,
         coalesce(e.rondas_com_preco, 0) > 0 as preco_enviado,
         q.ronda_atual as rondas,
         coalesce((select not coalesce((t.detalhe ->> 'precisa_malhas')::boolean, true)
                     from pedidos_preco_sourcetextile_transicoes t
                    where t.pedido_id = q.id and t.estado_origem is null
                      and t.ronda = 1 and t.anulada_em is null limit 1), false) as malhas_na,
         case when coalesce(e.rondas_com_preco, 0) = q.ronda_atual
              then round(e.h_interno / (select h from hpd), 2) end as tempo_resposta,
         round(e.h_malhas / (select h from hpd), 2) as tempo_malhas,
         round(e.h_orc / (select h from hpd), 2) as tempo_orcamentacao,
         case when q.estado = 'fechado'
              then round(pedidos_preco_sourcetextile_horas_uteis(q.recebido_em, q.fechado_em)
                         / (select h from hpd), 2) end as ciclo_total
    from q
    left join est e on e.pedido_id = q.id
   where (p_desde is null or (q.recebido_em at time zone 'Europe/Lisbon')::date >= p_desde)
     and (p_ate   is null or (q.recebido_em at time zone 'Europe/Lisbon')::date <= p_ate);
$fn$;

revoke execute on function pedidos_preco_sourcetextile_kpis(date, date) from public, anon;
