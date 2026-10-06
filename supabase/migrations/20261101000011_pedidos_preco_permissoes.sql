-- =====================================================================
-- Pedidos de Preço - Sourcetextile
-- 0010 - permissões por perfil
--
-- Quem pode fazer o quê, decidido NA BASE DE DADOS (a interface só esconde
-- o que não se pode fazer; nunca é ela que protege):
--
--   gp                (utilizadores.papel = 'gp')
--       Só mexe nos pedidos em que é a GP responsável. Cria pedidos só em
--       seu nome. Pode ler tudo.
--   aprovisionamento  (utilizadores.papel = 'aprovisionamento')
--       Só faz UMA coisa: passar um pedido (de qualquer pessoa) de
--       Aprov. Malhas para Orçamentação. Não volta atrás, não fecha,
--       não edita, não apaga, não cria. Pode ler tudo.
--   admin             (config 'admins': domínios e/ou emails)
--       Faz tudo (a consultoria, a implementação, a demonstração).
--   leitura           (qualquer outro email do domínio permitido)
--       Só lê.
--
-- Quem é gp ou aprovisionamento define-se na tabela utilizadores (dados,
-- não código): mudar de pessoa ou de cliente é mudar linhas, não funções.
--
-- Técnica: cada função de escrita passa a chamar-se _nucleo_<nome> e deixa
-- de ser chamável de fora; o nome antigo passa a ser um invólucro que
-- verifica a permissão e só depois chama o núcleo. Assim a interface e os
-- testes continuam a chamar as mesmas funções de sempre.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Quem é quem
-- ---------------------------------------------------------------------
insert into pedidos_preco_sourcetextile_config (chave, valor)
values ('admins', '{"dominios": ["kaizen.com"], "emails": []}'::jsonb)
on conflict (chave) do nothing;

create or replace function pedidos_preco_sourcetextile_papel_atual()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_papel text;
  v_cfg   jsonb;
begin
  if v_email = '' then return 'leitura'; end if;

  select papel into v_papel
    from pedidos_preco_sourcetextile_utilizadores
   where lower(trim(email)) = v_email and ativo
   limit 1;
  if v_papel is not null then return v_papel; end if;

  v_cfg := pedidos_preco_sourcetextile_cfg('admins');
  if exists (select 1 from jsonb_array_elements_text(coalesce(v_cfg -> 'emails', '[]'::jsonb)) e
              where lower(e) = v_email)
     or exists (select 1 from jsonb_array_elements_text(coalesce(v_cfg -> 'dominios', '[]'::jsonb)) d
                 where v_email like '%@' || lower(d)) then
    return 'admin';
  end if;
  return 'leitura';
end;
$fn$;

-- A interface pergunta-o uma vez, para saber o que mostrar.
create or replace function pedidos_preco_sourcetextile_meu_papel()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select pedidos_preco_sourcetextile_papel_atual();
$fn$;

-- ---------------------------------------------------------------------
-- A regra
-- ---------------------------------------------------------------------
create or replace function pedidos_preco_sourcetextile_autorizar(
  p_accao   text,
  p_pedido  uuid default null,
  p_destino text default null,
  p_gp      text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_papel  text;
  v_email  text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_estado text;
  v_gp     text;
begin
  perform pedidos_preco_sourcetextile_exigir_acesso();
  v_papel := pedidos_preco_sourcetextile_papel_atual();

  if v_papel = 'admin' then return; end if;
  if v_papel = 'leitura' then
    raise exception 'Só tens acesso de leitura nesta aplicação.';
  end if;

  if p_pedido is not null then
    select estado, lower(trim(gp_email)) into v_estado, v_gp
      from pedidos_preco_sourcetextile_pedidos where id = p_pedido;
  end if;

  if v_papel = 'aprovisionamento' then
    -- Passar de Aprov. Malhas para Orçamentação. Repetir o gesto num pedido
    -- que já lá está é inofensivo (a função de movimento ignora-o).
    if p_accao = 'mover' and p_destino = 'orcamentacao'
       and v_estado in ('malhas', 'orcamentacao') then
      return;
    end if;
    raise exception 'A Aprovisionamento só pode passar pedidos de Aprov. Malhas para Orçamentação.';
  end if;

  -- gp
  if p_accao = 'criar' then
    if lower(trim(coalesce(p_gp, ''))) <> v_email then
      raise exception 'Só podes criar pedidos em teu nome.';
    end if;
    return;
  end if;
  if p_accao = 'guardar_template' then return; end if;

  if p_pedido is null or v_estado is null then return; end if;   -- a função verdadeira recusa
  if v_gp is distinct from v_email then
    raise exception 'Só podes mexer nos pedidos que criaste.';
  end if;
  if p_accao = 'editar' and lower(trim(coalesce(p_gp, ''))) <> v_email then
    raise exception 'Não podes passar o pedido para outra GP.';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Núcleo + invólucro de cada função de escrita
-- ---------------------------------------------------------------------
alter function pedidos_preco_sourcetextile_criar_pedido(text, text, text, date, boolean, uuid)
  rename to pedidos_preco_sourcetextile_nucleo_criar_pedido;
alter function pedidos_preco_sourcetextile_mover(uuid, text, text)
  rename to pedidos_preco_sourcetextile_nucleo_mover;
alter function pedidos_preco_sourcetextile_saltar_malhas(uuid)
  rename to pedidos_preco_sourcetextile_nucleo_saltar_malhas;
alter function pedidos_preco_sourcetextile_fechar(uuid, text, uuid, text)
  rename to pedidos_preco_sourcetextile_nucleo_fechar;
alter function pedidos_preco_sourcetextile_nova_ronda(uuid, boolean)
  rename to pedidos_preco_sourcetextile_nucleo_nova_ronda;
alter function pedidos_preco_sourcetextile_desfazer(uuid)
  rename to pedidos_preco_sourcetextile_nucleo_desfazer;
alter function pedidos_preco_sourcetextile_corrigir_data(uuid, timestamptz)
  rename to pedidos_preco_sourcetextile_nucleo_corrigir_data;
alter function pedidos_preco_sourcetextile_editar_pedido(uuid, text, uuid, text, text)
  rename to pedidos_preco_sourcetextile_nucleo_editar_pedido;
alter function pedidos_preco_sourcetextile_apagar_pedido(uuid)
  rename to pedidos_preco_sourcetextile_nucleo_apagar_pedido;
alter function pedidos_preco_sourcetextile_guardar_nota(uuid, text)
  rename to pedidos_preco_sourcetextile_nucleo_guardar_nota;
alter function pedidos_preco_sourcetextile_guardar_template(text, text)
  rename to pedidos_preco_sourcetextile_nucleo_guardar_template;

create function pedidos_preco_sourcetextile_criar_pedido(
  p_cliente_nome text, p_ref_cliente text, p_gp_email text,
  p_data_rececao date default null, p_precisa_malhas boolean default true, p_cliente_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('criar', null, null, p_gp_email);
  return pedidos_preco_sourcetextile_nucleo_criar_pedido(
    p_cliente_nome, p_ref_cliente, p_gp_email, p_data_rececao, p_precisa_malhas, p_cliente_id);
end $fn$;

create function pedidos_preco_sourcetextile_mover(
  p_pedido uuid, p_destino text, p_origem text default 'kanban')
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('mover', p_pedido, p_destino);
  perform pedidos_preco_sourcetextile_nucleo_mover(p_pedido, p_destino, p_origem);
end $fn$;

create function pedidos_preco_sourcetextile_saltar_malhas(p_pedido uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('saltar_malhas', p_pedido);
  perform pedidos_preco_sourcetextile_nucleo_saltar_malhas(p_pedido);
end $fn$;

create function pedidos_preco_sourcetextile_fechar(
  p_pedido uuid, p_resultado text, p_motivo_id uuid default null, p_motivo_descricao text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('fechar', p_pedido);
  perform pedidos_preco_sourcetextile_nucleo_fechar(p_pedido, p_resultado, p_motivo_id, p_motivo_descricao);
end $fn$;

create function pedidos_preco_sourcetextile_nova_ronda(p_pedido uuid, p_precisa_malhas boolean default true)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('nova_ronda', p_pedido);
  return pedidos_preco_sourcetextile_nucleo_nova_ronda(p_pedido, p_precisa_malhas);
end $fn$;

create function pedidos_preco_sourcetextile_desfazer(p_pedido uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('desfazer', p_pedido);
  perform pedidos_preco_sourcetextile_nucleo_desfazer(p_pedido);
end $fn$;

create function pedidos_preco_sourcetextile_corrigir_data(p_transicao uuid, p_novo timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('corrigir_data',
    (select pedido_id from pedidos_preco_sourcetextile_transicoes where id = p_transicao));
  perform pedidos_preco_sourcetextile_nucleo_corrigir_data(p_transicao, p_novo);
end $fn$;

create function pedidos_preco_sourcetextile_editar_pedido(
  p_pedido uuid, p_cliente_nome text, p_cliente_id uuid, p_ref_cliente text, p_gp_email text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('editar', p_pedido, null, p_gp_email);
  perform pedidos_preco_sourcetextile_nucleo_editar_pedido(
    p_pedido, p_cliente_nome, p_cliente_id, p_ref_cliente, p_gp_email);
end $fn$;

create function pedidos_preco_sourcetextile_apagar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('apagar', p_pedido);
  perform pedidos_preco_sourcetextile_nucleo_apagar_pedido(p_pedido);
end $fn$;

create function pedidos_preco_sourcetextile_guardar_nota(p_pedido uuid, p_nota text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('nota', p_pedido);
  perform pedidos_preco_sourcetextile_nucleo_guardar_nota(p_pedido, p_nota);
end $fn$;

create function pedidos_preco_sourcetextile_guardar_template(p_assunto text, p_corpo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform pedidos_preco_sourcetextile_autorizar('guardar_template');
  perform pedidos_preco_sourcetextile_nucleo_guardar_template(p_assunto, p_corpo);
end $fn$;

-- ---------------------------------------------------------------------
-- Privilégios: os núcleos e a regra não se chamam de fora.
-- ---------------------------------------------------------------------
revoke execute on function
  pedidos_preco_sourcetextile_nucleo_criar_pedido(text, text, text, date, boolean, uuid),
  pedidos_preco_sourcetextile_nucleo_mover(uuid, text, text),
  pedidos_preco_sourcetextile_nucleo_saltar_malhas(uuid),
  pedidos_preco_sourcetextile_nucleo_fechar(uuid, text, uuid, text),
  pedidos_preco_sourcetextile_nucleo_nova_ronda(uuid, boolean),
  pedidos_preco_sourcetextile_nucleo_desfazer(uuid),
  pedidos_preco_sourcetextile_nucleo_corrigir_data(uuid, timestamptz),
  pedidos_preco_sourcetextile_nucleo_editar_pedido(uuid, text, uuid, text, text),
  pedidos_preco_sourcetextile_nucleo_apagar_pedido(uuid),
  pedidos_preco_sourcetextile_nucleo_guardar_nota(uuid, text),
  pedidos_preco_sourcetextile_nucleo_guardar_template(text, text),
  pedidos_preco_sourcetextile_autorizar(text, uuid, text, text),
  pedidos_preco_sourcetextile_papel_atual()
  from public, anon, authenticated;

revoke execute on function
  pedidos_preco_sourcetextile_criar_pedido(text, text, text, date, boolean, uuid),
  pedidos_preco_sourcetextile_mover(uuid, text, text),
  pedidos_preco_sourcetextile_saltar_malhas(uuid),
  pedidos_preco_sourcetextile_fechar(uuid, text, uuid, text),
  pedidos_preco_sourcetextile_nova_ronda(uuid, boolean),
  pedidos_preco_sourcetextile_desfazer(uuid),
  pedidos_preco_sourcetextile_corrigir_data(uuid, timestamptz),
  pedidos_preco_sourcetextile_editar_pedido(uuid, text, uuid, text, text),
  pedidos_preco_sourcetextile_apagar_pedido(uuid),
  pedidos_preco_sourcetextile_guardar_nota(uuid, text),
  pedidos_preco_sourcetextile_guardar_template(text, text),
  pedidos_preco_sourcetextile_meu_papel()
  from public, anon;

grant execute on function
  pedidos_preco_sourcetextile_criar_pedido(text, text, text, date, boolean, uuid),
  pedidos_preco_sourcetextile_mover(uuid, text, text),
  pedidos_preco_sourcetextile_saltar_malhas(uuid),
  pedidos_preco_sourcetextile_fechar(uuid, text, uuid, text),
  pedidos_preco_sourcetextile_nova_ronda(uuid, boolean),
  pedidos_preco_sourcetextile_desfazer(uuid),
  pedidos_preco_sourcetextile_corrigir_data(uuid, timestamptz),
  pedidos_preco_sourcetextile_editar_pedido(uuid, text, uuid, text, text),
  pedidos_preco_sourcetextile_apagar_pedido(uuid),
  pedidos_preco_sourcetextile_guardar_nota(uuid, text),
  pedidos_preco_sourcetextile_guardar_template(text, text),
  pedidos_preco_sourcetextile_meu_papel()
  to authenticated;
