-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0009 — alertas, notificações, avisos por email, notas, configuração
--
-- ARQUITETURA
--  * Geração (aqui, na base de dados): um job pg_cron chama, de hora a
--    hora nas manhãs dos dias úteis, gerar_alertas_agendado(). Só corre
--    quando a hora de Lisboa é 8h30 e ainda não correu nesse dia (o
--    pg_cron trabalha em UTC e Portugal muda de hora, por isso o
--    agendamento cobre as duas horas possíveis e é a função que decide).
--  * Os alertas entram numa tabela com chave única (pedido, ronda, tipo):
--    nunca se repetem, mesmo que o job corra duas vezes.
--  * Envio (desacoplado): enviar_alertas() agrupa os pendentes num resumo
--    por pessoa e chama UMA função isolada, enviar_email(), que é a única
--    coisa a mudar quando se escolher o fornecedor. Modo por defeito:
--    desligado (os alertas geram-se e aparecem na app, não sai email).
--  * Os avisos por email são três textos (ver compor_email): Aprovisionamento
--    aos 2 dias úteis em malhas, GP aos 4 dias úteis em malhas e GP aos 5
--    dias úteis em Aguarda Cliente. Os limites vêm da config 'alertas_limites'.
-- =====================================================================

-- Extensões usadas (no Supabase ativam-se assim, ou no painel):
--   pg_cron  - o job das 8h30     pg_net - a chamada ao fornecedor de email
--   supabase_vault - guardar a chave do fornecedor (já vem ativa)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 'app_url' é o endereço da aplicação que vai nos emails; preenche-se no seed.
insert into pedidos_preco_sourcetextile_config (chave, valor) values
  ('app_url', '{"valor": ""}'::jsonb),
  ('alertas_limites',
   '{"malhas_aprovisionamento": 2, "malhas_gp": 4, "cliente_gp": 5}'::jsonb)
on conflict (chave) do nothing;

alter table pedidos_preco_sourcetextile_pedidos add column if not exists nota text;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists pedidos_preco_sourcetextile_alertas (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid not null references pedidos_preco_sourcetextile_pedidos(id) on delete cascade,
  ronda              int not null,
  tipo               text not null check (tipo in ('malhas_2', 'malhas_4', 'cliente_5')),
  dia                date not null,
  destinatario_email text,
  destinatario_nome  text,
  estado_envio       text not null default 'pendente'
                       check (estado_envio in ('pendente', 'enviado', 'erro', 'suprimido')),
  erro_envio         text,
  enviado_em         timestamptz,
  created_at         timestamptz not null default now(),
  constraint pedidos_preco_sourcetextile_alertas_uk unique (pedido_id, ronda, tipo)
);

create table if not exists pedidos_preco_sourcetextile_notificacoes (
  id         uuid primary key default gen_random_uuid(),
  alerta_id  uuid not null references pedidos_preco_sourcetextile_alertas(id) on delete cascade,
  para_email text,
  titulo     text not null,
  criada_em  timestamptz not null default now(),
  lida_em    timestamptz
);

create table if not exists pedidos_preco_sourcetextile_alertas_execucoes (
  dia          date primary key,
  executada_em timestamptz not null default now(),
  criados      int not null default 0
);

create index if not exists pedidos_preco_sourcetextile_alertas_dia_ix
  on pedidos_preco_sourcetextile_alertas (dia);
create index if not exists pedidos_preco_sourcetextile_notificacoes_para_ix
  on pedidos_preco_sourcetextile_notificacoes (lower(para_email)) where lida_em is null;

do $$
declare t text;
begin
  foreach t in array array['alertas', 'notificacoes', 'alertas_execucoes'] loop
    execute format('alter table pedidos_preco_sourcetextile_%1$s enable row level security', t);
    execute format('drop policy if exists pedidos_preco_sourcetextile_%1$s_select on pedidos_preco_sourcetextile_%1$s', t);
    execute format('create policy pedidos_preco_sourcetextile_%1$s_select on pedidos_preco_sourcetextile_%1$s
                      for select using (pedidos_preco_sourcetextile_acesso())', t);
    execute format('revoke insert, update, delete, truncate on pedidos_preco_sourcetextile_%1$s from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Geração. p_pedido restringe a um pedido (usado pelos testes, para nunca
-- tocarem em pedidos reais); sem ele, avalia todos.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_gerar_alertas(p_pedido uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_dia    date := (now() at time zone 'Europe/Lisbon')::date;
  v_n      int := 0;
  r        record;
  v_tipo   text;
  v_email  text;
  v_nome   text;
  v_id     uuid;
  v_titulo text;
  v_lim    jsonb := coalesce(pedidos_preco_sourcetextile_cfg('alertas_limites'), '{}'::jsonb);
  v_l_aprov numeric := coalesce((v_lim ->> 'malhas_aprovisionamento')::numeric, 2);
  v_l_gp    numeric := coalesce((v_lim ->> 'malhas_gp')::numeric, 4);
  v_l_cli   numeric := coalesce((v_lim ->> 'cliente_gp')::numeric, 5);
  v_aprov_email text;
  v_aprov_nome  text;
begin
  select email, nome into v_aprov_email, v_aprov_nome
    from pedidos_preco_sourcetextile_utilizadores
   where papel = 'aprovisionamento' and ativo
   order by created_at limit 1;

  for r in
    select q.id, q.ronda_atual, q.estado, q.dias_etapa, q.gp_email, q.gp_nome,
           q.cliente_nome, q.ref_cliente
      from pedidos_preco_sourcetextile_quadro(0) q
     where q.estado in ('malhas', 'aguarda_cliente')
       and (p_pedido is null or q.id = p_pedido)
  loop
    for v_tipo in
      select t from unnest(array[
        case when r.estado = 'malhas' and r.dias_etapa >= v_l_aprov then 'malhas_2' end,
        case when r.estado = 'malhas' and r.dias_etapa >= v_l_gp then 'malhas_4' end,
        case when r.estado = 'aguarda_cliente' and r.dias_etapa >= v_l_cli then 'cliente_5' end
      ]) as t where t is not null
    loop
      if v_tipo = 'malhas_2' then
        v_email := v_aprov_email; v_nome := v_aprov_nome;
        v_titulo := 'Preço de malhas por dar: ' || r.cliente_nome || ' ' || r.ref_cliente;
      elsif v_tipo = 'malhas_4' then
        v_email := r.gp_email; v_nome := r.gp_nome;
        v_titulo := 'Malhas sem resposta: ' || r.cliente_nome || ' ' || r.ref_cliente;
      else
        v_email := r.gp_email; v_nome := r.gp_nome;
        v_titulo := 'Cliente sem resposta: ' || r.cliente_nome || ' ' || r.ref_cliente;
      end if;

      insert into pedidos_preco_sourcetextile_alertas
        (pedido_id, ronda, tipo, dia, destinatario_email, destinatario_nome)
      values (r.id, r.ronda_atual, v_tipo, v_dia, v_email, v_nome)
      on conflict (pedido_id, ronda, tipo) do nothing
      returning id into v_id;

      if v_id is not null then
        insert into pedidos_preco_sourcetextile_notificacoes (alerta_id, para_email, titulo)
        values (v_id, v_email, v_titulo);
        v_n := v_n + 1;
        v_id := null;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Quando é que o job deve mesmo correr: 8h30 (Lisboa), dia útil, e ainda
-- não correu nesse dia.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_deve_correr(p_agora timestamptz default now())
returns boolean
language sql stable
set search_path = public
as $fn$
  select pedidos_preco_sourcetextile_e_dia_util((p_agora at time zone 'Europe/Lisbon')::date)
     and extract(hour from (p_agora at time zone 'Europe/Lisbon')) = 8
     and extract(minute from (p_agora at time zone 'Europe/Lisbon')) >= 30
     and not exists (select 1 from pedidos_preco_sourcetextile_alertas_execucoes e
                      where e.dia = (p_agora at time zone 'Europe/Lisbon')::date);
$fn$;

-- ---------------------------------------------------------------------
-- Envio. A ÚNICA função que fala com o mundo exterior. Os segredos estão no
-- supabase_vault (pedidos_preco_email_url, pedidos_preco_email_chave). Sem
-- eles devolve um erro legível e os alertas ficam marcados como "erro".
-- Devolve null se o pedido foi aceite pelo fornecedor.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_enviar_email(
  p_para text, p_assunto text, p_corpo text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_url   text;
  v_chave text;
begin
  select decrypted_secret into v_url   from vault.decrypted_secrets where name = 'pedidos_preco_email_url';
  select decrypted_secret into v_chave from vault.decrypted_secrets where name = 'pedidos_preco_email_chave';
  if v_url is null or v_chave is null then
    return 'Fornecedor de email ainda não configurado.';
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_chave),
    body    := jsonb_build_object('to', p_para, 'subject', p_assunto, 'text', p_corpo));
  return null;
exception when others then
  return 'Falha ao contactar o fornecedor: ' || sqlerrm;
end;
$fn$;

-- ---------------------------------------------------------------------
-- O texto dos três avisos por email. Um email por pessoa, por tipo e por
-- dia, só quando há pedidos. Os limites (2, 4 e 5 dias úteis) vêm da
-- configuração 'alertas_limites'; nos emails escreve-se "dias úteis" por
-- extenso (na aplicação nunca se escreve a unidade).
--   malhas_2   Aprovisionamento: pedidos em Aprov. Malhas há N dias úteis
--   malhas_4   GP: os seus pedidos ainda sem preço de malhas
--   cliente_5  GP: os seus pedidos sem resposta do cliente
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_compor_email(
  p_tipo text, p_nome text, p_alertas uuid[]
)
returns table (assunto text, corpo text)
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_lim     jsonb := coalesce(pedidos_preco_sourcetextile_cfg('alertas_limites'), '{}'::jsonb);
  v_n_aprov int := coalesce((v_lim ->> 'malhas_aprovisionamento')::int, 2);
  v_n_gp    int := coalesce((v_lim ->> 'malhas_gp')::int, 4);
  v_n_cli   int := coalesce((v_lim ->> 'cliente_gp')::int, 5);
  v_url     text := coalesce(pedidos_preco_sourcetextile_cfg('app_url') ->> 'valor', '');
  v_primeiro text := split_part(trim(coalesce(p_nome, '')), ' ', 1);
  v_ola     text;
  v_linhas  text := '';
  v_n       int := coalesce(array_length(p_alertas, 1), 0);
  v_varios  boolean := coalesce(array_length(p_alertas, 1), 0) > 1;
  r         record;
  v_dias    text;
begin
  v_ola := case when p_tipo = 'malhas_2' or v_primeiro = '' then 'Bom dia,'
                else 'Bom dia, ' || v_primeiro || ',' end;

  for r in
    select c.nome as cliente, p.ref_cliente, u.nome as gp_nome, q.dias_etapa,
           (select max(t.ocorrido_em) from pedidos_preco_sourcetextile_transicoes t
             where t.pedido_id = p.id and t.estado_destino = 'aguarda_cliente' and t.anulada_em is null) as preco_enviado
      from pedidos_preco_sourcetextile_alertas al
      join pedidos_preco_sourcetextile_pedidos p on p.id = al.pedido_id
      join pedidos_preco_sourcetextile_clientes c on c.id = p.cliente_id
      left join pedidos_preco_sourcetextile_utilizadores u on lower(trim(u.email)) = lower(trim(p.gp_email))
      left join pedidos_preco_sourcetextile_quadro(0) q on q.id = p.id
     where al.id = any (p_alertas)
     order by al.created_at
  loop
    v_dias := replace(to_char(round(coalesce(r.dias_etapa, 0)::numeric, 1), 'FM990.0'), '.', ',');
    v_linhas := v_linhas || E'\n• ' || r.cliente || ' · ' || r.ref_cliente
      || case p_tipo
           when 'malhas_2'  then coalesce(' · GP ' || r.gp_nome, '')
           when 'cliente_5' then ' · preço enviado a '
                                 || to_char(r.preco_enviado at time zone 'Europe/Lisbon', 'DD/MM/YYYY')
           else '' end
      || ' · há ' || v_dias || ' dias úteis';
  end loop;

  if p_tipo = 'malhas_2' then
    return query select
      'Pedidos de preço: ' || v_n || ' à espera do preço de malhas',
      v_ola || E'\n\n'
      || 'Estes pedidos estão em Aprov. Malhas há ' || v_n_aprov
      || ' dias úteis ou mais e ainda não têm o preço de malhas:' || E'\n'
      || v_linhas || E'\n\n'
      || 'Quando enviares o preço, passa cada pedido para Orçamentação na aplicação:' || E'\n'
      || v_url || E'\n\n'
      || 'Obrigado.';
  elsif p_tipo = 'malhas_4' then
    return query select
      'Pedidos de preço: malhas sem resposta há ' || v_n_gp || ' dias úteis',
      v_ola || E'\n\n'
      || case when v_varios then 'Estes pedidos teus continuam' else 'Este pedido teu continua' end
      || ' em Aprov. Malhas há ' || v_n_gp || ' dias úteis ou mais, sem preço de malhas (o objetivo são '
      || v_n_aprov || '):' || E'\n'
      || v_linhas || E'\n\n'
      || 'Já foi avisada a Aprovisionamento aos ' || v_n_aprov
      || ' dias. Talvez valha a pena falares com ela diretamente.' || E'\n\n'
      || case when v_varios then 'Ver os pedidos: ' else 'Ver o pedido: ' end || v_url;
  else
    return query select
      'Pedidos de preço: ' || v_n || case when v_n = 1 then ' cliente sem resposta' else ' clientes sem resposta' end,
      v_ola || E'\n\n'
      || 'Estes pedidos teus estão em Aguarda Cliente há ' || v_n_cli
      || ' dias úteis ou mais, sem resposta do cliente:' || E'\n'
      || v_linhas || E'\n\n'
      || 'O que podes fazer:' || E'\n'
      || '– Contactar o cliente. Na aplicação, "Preparar email ao cliente" já traz o texto escrito.' || E'\n'
      || '– Quando houver resposta, registar o resultado (Converteu, Não converteu ou Pediu negociação).' || E'\n\n'
      || 'Ver os pedidos: ' || v_url;
  end if;
end;
$fn$;

-- Um email por pessoa, por tipo de aviso e por dia (ver compor_email).
create or replace function pedidos_preco_sourcetextile_enviar_alertas(p_pedido uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg    jsonb := coalesce(pedidos_preco_sourcetextile_cfg('email_envio'), '{}'::jsonb);
  v_modo   text := coalesce(v_cfg ->> 'modo', 'desligado');
  v_teste  text := coalesce(v_cfg ->> 'email_teste', '');
  g        record;
  e        record;
  v_n      int := 0;
  v_dest   text;
  v_erro   text;
begin
  if v_modo = 'desligado' then
    update pedidos_preco_sourcetextile_alertas al
       set estado_envio = 'suprimido'
     where al.estado_envio = 'pendente' and (p_pedido is null or al.pedido_id = p_pedido);
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  for g in
    select coalesce(al.destinatario_email, '') as para, al.tipo, max(al.destinatario_nome) as nome,
           array_agg(al.id order by al.created_at) as ids
      from pedidos_preco_sourcetextile_alertas al
     where al.estado_envio = 'pendente' and (p_pedido is null or al.pedido_id = p_pedido)
     group by coalesce(al.destinatario_email, ''), al.tipo
  loop
    v_dest := case when v_modo = 'teste' then v_teste else g.para end;
    if coalesce(v_dest, '') = '' then
      update pedidos_preco_sourcetextile_alertas set estado_envio = 'erro',
             erro_envio = 'Sem destinatário (falta o email).' where id = any (g.ids);
      continue;
    end if;

    select * into e from pedidos_preco_sourcetextile_compor_email(g.tipo, g.nome, g.ids);
    v_erro := pedidos_preco_sourcetextile_enviar_email(v_dest, e.assunto, e.corpo);
    if v_erro is null then
      update pedidos_preco_sourcetextile_alertas set estado_envio = 'enviado', enviado_em = now(),
             erro_envio = null where id = any (g.ids);
      v_n := v_n + array_length(g.ids, 1);
    else
      update pedidos_preco_sourcetextile_alertas set estado_envio = 'erro', erro_envio = v_erro
       where id = any (g.ids);
    end if;
  end loop;
  return v_n;
end;
$fn$;

create or replace function pedidos_preco_sourcetextile_gerar_alertas_agendado(p_agora timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_n int; v_dia date := (p_agora at time zone 'Europe/Lisbon')::date;
begin
  if not pedidos_preco_sourcetextile_deve_correr(p_agora) then return 0; end if;
  insert into pedidos_preco_sourcetextile_alertas_execucoes (dia) values (v_dia)
  on conflict (dia) do nothing;
  v_n := pedidos_preco_sourcetextile_gerar_alertas();
  update pedidos_preco_sourcetextile_alertas_execucoes set criados = v_n where dia = v_dia;
  perform pedidos_preco_sourcetextile_enviar_alertas();
  return v_n;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Painel "Alertas de hoje" e sino
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_alertas_hoje()
returns table (
  id uuid, pedido_id uuid, tipo text, ronda int, destinatario_email text, destinatario_nome text,
  estado_envio text, erro_envio text, cliente_nome text, ref_cliente text, gp_nome text,
  minha boolean, lida boolean
)
language sql stable
set search_path = public
as $fn$
  select a.id, a.pedido_id, a.tipo, a.ronda, a.destinatario_email, a.destinatario_nome,
         a.estado_envio, a.erro_envio, c.nome, p.ref_cliente, u.nome,
         lower(coalesce(a.destinatario_email, '')) = lower(coalesce(auth.jwt() ->> 'email', '#')),
         coalesce((select bool_and(n.lida_em is not null)
                     from pedidos_preco_sourcetextile_notificacoes n where n.alerta_id = a.id), true)
    from pedidos_preco_sourcetextile_alertas a
    join pedidos_preco_sourcetextile_pedidos p on p.id = a.pedido_id
    join pedidos_preco_sourcetextile_clientes c on c.id = p.cliente_id
    left join pedidos_preco_sourcetextile_utilizadores u
           on lower(trim(u.email)) = lower(trim(p.gp_email))
   where a.dia = (now() at time zone 'Europe/Lisbon')::date
   order by a.created_at desc;
$fn$;

create or replace function pedidos_preco_sourcetextile_marcar_lidas()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();
  update pedidos_preco_sourcetextile_notificacoes
     set lida_em = now()
   where lida_em is null and lower(para_email) = lower(auth.jwt() ->> 'email');
end;
$fn$;

-- ---------------------------------------------------------------------
-- Notas de um pedido, e a única configuração editável pela interface: os
-- templates de email.
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_obter_nota(p_pedido uuid)
returns text language sql stable set search_path = public as $fn$
  select nota from pedidos_preco_sourcetextile_pedidos where id = p_pedido;
$fn$;

create or replace function pedidos_preco_sourcetextile_guardar_nota(p_pedido uuid, p_nota text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();
  update pedidos_preco_sourcetextile_pedidos
     set nota = nullif(trim(coalesce(p_nota, '')), '') where id = p_pedido;
  if not found then raise exception 'Este pedido já não existe.'; end if;
end;
$fn$;

create or replace function pedidos_preco_sourcetextile_guardar_template(p_assunto text, p_corpo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();
  if coalesce(trim(p_assunto), '') = '' or coalesce(trim(p_corpo), '') = '' then
    raise exception 'O assunto e o texto do email não podem ficar em branco.';
  end if;
  insert into pedidos_preco_sourcetextile_config (chave, valor)
  values ('email_template', jsonb_build_object('assunto', p_assunto, 'corpo', p_corpo))
  on conflict (chave) do update set valor = excluded.valor;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Permissões: o que é interno não se chama de fora; o que é da app só com
-- sessão. Nada nesta migração serve sem login.
-- ---------------------------------------------------------------------
revoke execute on function pedidos_preco_sourcetextile_gerar_alertas(uuid) from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_gerar_alertas_agendado(timestamptz) from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_enviar_alertas(uuid) from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_enviar_email(text, text, text) from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_compor_email(text, text, uuid[]) from public, anon, authenticated;
revoke execute on function pedidos_preco_sourcetextile_marcar_lidas() from public, anon;
revoke execute on function pedidos_preco_sourcetextile_guardar_nota(uuid, text) from public, anon;
revoke execute on function pedidos_preco_sourcetextile_guardar_template(text, text) from public, anon;

-- ---------------------------------------------------------------------
-- O job. De hora a hora, minuto 30, das 6h às 9h UTC nos dias úteis: cobre
-- as 8h30 de Lisboa no verão (7h30 UTC) e no inverno (8h30 UTC).
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'pedidos_preco_sourcetextile_alertas';
select cron.schedule('pedidos_preco_sourcetextile_alertas', '30 6-9 * * 1-5',
  $job$select public.pedidos_preco_sourcetextile_gerar_alertas_agendado()$job$);
