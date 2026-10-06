-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- Testes do lado da base de dados
--
-- Como correr: cola o ficheiro inteiro numa janela de SQL do Supabase
-- (ou envia-o de uma só vez, numa única chamada).
--
-- Fala como uma pessoa com sessão: define o token do teste no início
-- (as funções de escrita exigem domínio) e desliga-o no fim da transação.
-- Limpa sempre o que cria (clientes "Cliente Teste" e "Cliente Prova"),
-- por isso pode correr-se com dados reais na base.
--
-- Cobre os cenários 1, 2, 4, 5 e 6 do enunciado, as regressões dos bugs
-- apanhados no desenvolvimento, e as PROVAS DE SEGURANÇA: a partir do
-- papel `authenticated` (o do browser) não se consegue escrever nas
-- tabelas de histórico por nenhum caminho que não seja uma função.
-- =====================================================================

-- >>> ANTES DE CORRER: este ficheiro cria e apaga dados de teste (clientes
-- "Cliente Teste", "Cliente Prova", "Cliente KPI", "Cliente Alerta" e
-- "Cliente Perm"). Corre-o numa base de dados de desenvolvimento, depois do
-- seed de utilizadores.sql. Durante o teste dá-se perfil de administração a
-- testes@sourcetextile.pt e repõe-se a configuração no fim.
create temp table if not exists _admins_original(valor jsonb);
truncate _admins_original;
insert into _admins_original select valor from pedidos_preco_sourcetextile_config where chave = 'admins';
update pedidos_preco_sourcetextile_config
   set valor = '{"dominios": [], "emails": ["testes@sourcetextile.pt"]}'::jsonb where chave = 'admins';

select set_config('request.jwt.claims',
                  '{"email":"testes@sourcetextile.pt","role":"authenticated"}', true);

create temp table if not exists _testes(
  ord bigint default (extract(epoch from clock_timestamp()) * 1000000)::bigint,
  passo text, obtido text, esperado text);
truncate _testes;
grant all on _testes to authenticated;
grant all on _testes to anon;

-- ---------------------------------------------------------------------
-- Parte 1 — calendário e dias úteis
-- ---------------------------------------------------------------------
insert into _testes(passo, obtido, esperado) values
  ('pascoa 2024', pedidos_preco_sourcetextile_pascoa(2024)::text, '2024-03-31'),
  ('pascoa 2025', pedidos_preco_sourcetextile_pascoa(2025)::text, '2025-04-20'),
  ('pascoa 2026', pedidos_preco_sourcetextile_pascoa(2026)::text, '2026-04-05'),
  ('pascoa 2027', pedidos_preco_sourcetextile_pascoa(2027)::text, '2027-03-28'),
  ('sexta-feira santa 2026',
     (select data::text from pedidos_preco_sourcetextile_feriados_nacionais(2026) where nome = 'Sexta-feira Santa'),
     '2026-04-03'),
  ('corpo de deus 2026',
     (select data::text from pedidos_preco_sourcetextile_feriados_nacionais(2026) where nome = 'Corpo de Deus'),
     '2026-06-04'),
  ('12 feriados nacionais',
     (select count(*)::text from pedidos_preco_sourcetextile_feriados_nacionais(2026)), '12'),
  ('sabado nao e dia util',       pedidos_preco_sourcetextile_e_dia_util(date '2026-01-17')::text, 'false'),
  ('domingo nao e dia util',      pedidos_preco_sourcetextile_e_dia_util(date '2026-01-18')::text, 'false'),
  ('quarta e dia util',           pedidos_preco_sourcetextile_e_dia_util(date '2026-01-21')::text, 'true'),
  ('natal nao e dia util',        pedidos_preco_sourcetextile_e_dia_util(date '2026-12-25')::text, 'false'),
  ('sexta-feira santa nao e dia util', pedidos_preco_sourcetextile_e_dia_util(date '2026-04-03')::text, 'false'),
  -- CENÁRIO 1 DO ENUNCIADO
  ('CENARIO 1: sexta 17h -> terca 10h',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-16 17:00 Europe/Lisbon',
       timestamptz '2026-01-20 10:00 Europe/Lisbon')::text, '1.2'),
  ('mesmo instante da zero',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-21 10:00 Europe/Lisbon',
       timestamptz '2026-01-21 10:00 Europe/Lisbon')::text, '0.0'),
  ('so fim de semana da zero',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-17 09:00 Europe/Lisbon',
       timestamptz '2026-01-18 18:00 Europe/Lisbon')::text, '0.0'),
  ('um dia util completo',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-21 08:20 Europe/Lisbon',
       timestamptz '2026-01-21 17:20 Europe/Lisbon')::text, '1.0'),
  ('fora de horas nao conta',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-21 18:00 Europe/Lisbon',
       timestamptz '2026-01-21 19:00 Europe/Lisbon')::text, '0.0'),
  ('atravessa o natal',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-12-24 16:00 Europe/Lisbon',
       timestamptz '2026-12-28 09:20 Europe/Lisbon')::text, '0.3'),
  ('atravessa a mudanca de hora',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-03-27 16:00 Europe/Lisbon',
       timestamptz '2026-03-30 09:20 Europe/Lisbon')::text, '0.3'),
  ('semana inteira',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2026-01-19 08:20 Europe/Lisbon',
       timestamptz '2026-01-23 17:20 Europe/Lisbon')::text, '5.0'),
  ('nulo devolve nulo',
     coalesce(pedidos_preco_sourcetextile_dias_uteis(null, now())::text, 'NULO'), 'NULO'),
  ('semaforo abaixo de 85%',    pedidos_preco_sourcetextile_semaforo(0.8, 1), 'verde'),
  ('semaforo entre 85 e 100%',  pedidos_preco_sourcetextile_semaforo(0.9, 1), 'amarelo'),
  ('semaforo acima do objetivo', pedidos_preco_sourcetextile_semaforo(1.1, 1), 'vermelho');

-- ---------------------------------------------------------------------
-- Parte 1b — encerramentos configuráveis (feriado municipal, férias coletivas)
-- Usa uma terça-feira de 2031, longe de qualquer encerramento real, e apaga
-- o que cria. Se a data já estiver ocupada, salta o teste em vez de tocar
-- em dados que não são seus.
-- ---------------------------------------------------------------------
do $t$
declare
  d date := date '2031-02-04';
  ja_existia boolean;
begin
  select exists (select 1 from pedidos_preco_sourcetextile_encerramentos where data = d) into ja_existia;
  if ja_existia then
    insert into _testes(passo, obtido, esperado)
      values ('encerramento: data de teste ja ocupada (saltado)', 'saltado', 'saltado');
    return;
  end if;

  insert into pedidos_preco_sourcetextile_encerramentos (data, descricao) values (d, 'Encerramento de teste');

  insert into _testes(passo, obtido, esperado) values
    ('encerramento: o dia fechado nao e dia util',
     pedidos_preco_sourcetextile_e_dia_util(d)::text, 'false'),
    ('encerramento: o dia antes continua util',
     pedidos_preco_sourcetextile_e_dia_util(d - 1)::text, 'true'),
    -- seg 17:00 -> qua 10:00: 20 min na segunda + 0 na terça (fechada) + 1h40 na quarta = 2h = 0,2 d.u.
    ('encerramento: nao conta para os dias uteis',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2031-02-03 17:00 Europe/Lisbon',
       timestamptz '2031-02-05 10:00 Europe/Lisbon')::text, '0.2');

  update pedidos_preco_sourcetextile_encerramentos set ativo = false where data = d;
  insert into _testes(passo, obtido, esperado) values
    ('encerramento desativado: o dia volta a ser util',
     pedidos_preco_sourcetextile_e_dia_util(d)::text, 'true'),
    -- sem o encerramento: 20 min + 9 h + 1h40 = 11 h = 1,2 d.u.
    ('encerramento desativado: volta a contar',
     pedidos_preco_sourcetextile_dias_uteis(
       timestamptz '2031-02-03 17:00 Europe/Lisbon',
       timestamptz '2031-02-05 10:00 Europe/Lisbon')::text, '1.2');

  delete from pedidos_preco_sourcetextile_encerramentos where data = d;
end $t$;

-- ---------------------------------------------------------------------
-- Parte 2 — ciclo de vida de um pedido
-- ---------------------------------------------------------------------
do $t$
declare p uuid; p2 uuid; v_txt text; t1 uuid; t2 uuid; t3 uuid; v_n int;
begin
  p := pedidos_preco_sourcetextile_criar_pedido('Cliente Teste', 'T-100', 'comercial1@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(p, 'orcamentacao');
  perform pedidos_preco_sourcetextile_mover(p, 'aguarda_cliente');

  -- REGRESSÃO (0006): created_at é o instante da TRANSAÇÃO, não do insert.
  select string_agg(estado_destino, '>' order by seq) into v_txt
    from pedidos_preco_sourcetextile_transicoes where pedido_id = p;
  insert into _testes(passo, obtido, esperado)
    values ('REGRESSAO: ordem dentro da mesma transacao', v_txt,
            'malhas>orcamentacao>aguarda_cliente');
  select estado into v_txt from pedidos_preco_sourcetextile_pedidos where id = p;
  insert into _testes(passo, obtido, esperado)
    values ('REGRESSAO: estado certo na mesma transacao', v_txt, 'aguarda_cliente');

  select id into t1 from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_origem is null;
  select id into t2 from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_destino = 'orcamentacao';
  select id into t3 from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_destino = 'aguarda_cliente';

  -- CENÁRIO 6 — corrigir datas
  perform pedidos_preco_sourcetextile_corrigir_data(t1, now() - interval '30 days');
  perform pedidos_preco_sourcetextile_corrigir_data(t2, now() - interval '25 days');
  perform pedidos_preco_sourcetextile_corrigir_data(t3, now() - interval '18 days');
  select estado into v_txt from pedidos_preco_sourcetextile_pedidos where id = p;
  -- REGRESSÃO (0005): corrigir uma data para trás mudava o estado.
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 6 / REGRESSAO: corrigir nao mexe no estado', v_txt, 'aguarda_cliente');
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_correcoes c
    join pedidos_preco_sourcetextile_transicoes t on t.id = c.transicao_id where t.pedido_id = p;
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 6: correcoes auditadas', v_txt, '3');

  begin
    perform pedidos_preco_sourcetextile_corrigir_data(t3, now() - interval '60 days');
    insert into _testes(passo, obtido, esperado) values ('correcao fora de ordem', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('correcao fora de ordem', 'recusa', 'recusa');
  end;

  begin
    perform pedidos_preco_sourcetextile_corrigir_data(t3, now() + interval '3 days');
    insert into _testes(passo, obtido, esperado) values ('correcao para o futuro', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('correcao para o futuro', 'recusa', 'recusa');
  end;

  -- CENÁRIO 4 — cliente sem resposta
  select (q.dias_etapa >= 5)::text || '/' || q.semaforo || '/' || q.sem_resposta::text
    into v_txt from pedidos_preco_sourcetextile_quadro() q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 4: etiqueta Sem resposta', v_txt, 'true/vermelho/true');

  perform pedidos_preco_sourcetextile_fechar(p, 'converteu');
  select q.estado || '/' || q.sem_resposta::text || '/' || q.resultado
    into v_txt from pedidos_preco_sourcetextile_quadro(90) q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 4: fechar como converteu sai de Sem resposta', v_txt,
            'fechado/false/converteu');

  -- um pedido fechado não se fecha outra vez, nem se move
  begin
    perform pedidos_preco_sourcetextile_fechar(p, 'converteu');
    insert into _testes(passo, obtido, esperado) values ('fechar um fechado', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('fechar um fechado', 'recusa', 'recusa');
  end;
  begin
    perform pedidos_preco_sourcetextile_mover(p, 'malhas');
    insert into _testes(passo, obtido, esperado) values ('mover um fechado', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('mover um fechado', 'recusa', 'recusa');
  end;

  -- Desfazer
  perform pedidos_preco_sourcetextile_desfazer(p);
  select q.estado || '/' || coalesce(q.resultado, 'SEM') into v_txt
    from pedidos_preco_sourcetextile_quadro() q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('desfazer o fecho limpa o resultado', v_txt, 'aguarda_cliente/SEM');

  -- CENÁRIO 5 — negociação
  perform pedidos_preco_sourcetextile_nova_ronda(p, true);
  select estado || '/r' || ronda_atual into v_txt
    from pedidos_preco_sourcetextile_pedidos where id = p;
  insert into _testes(passo, obtido, esperado) values ('CENARIO 5: passa a ronda 2', v_txt, 'malhas/r2');
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and ronda = 1 and anulada_em is null;
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 5: historico da ronda 1 intacto', v_txt, '3');

  -- pedir negociação só faz sentido em Aguarda Cliente
  begin
    perform pedidos_preco_sourcetextile_nova_ronda(p, true);
    insert into _testes(passo, obtido, esperado) values ('negociacao fora de Aguarda Cliente', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('negociacao fora de Aguarda Cliente', 'recusa', 'recusa');
  end;

  -- CENÁRIO 2 — saltar malhas
  p2 := pedidos_preco_sourcetextile_criar_pedido(
          'Cliente Teste', 'T-200', 'comercial2@sourcetextile.pt', null, false);
  select q.estado || '/m' || q.precisa_malhas::text || '/obj' || q.objetivo::text || '/' || q.responsavel
    into v_txt from pedidos_preco_sourcetextile_quadro() q where q.id = p2;
  insert into _testes(passo, obtido, esperado)
    values ('CENARIO 2: nasce em Orcamentacao com objetivo 1', v_txt,
            'orcamentacao/mfalse/obj1/GP');

  -- saltar malhas só enquanto está em Aprov. Malhas
  begin
    perform pedidos_preco_sourcetextile_saltar_malhas(p2);
    insert into _testes(passo, obtido, esperado) values ('saltar malhas fora de Aprov. Malhas', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('saltar malhas fora de Aprov. Malhas', 'recusa', 'recusa');
  end;

  -- carregar duas vezes no mesmo botão é inofensivo
  perform pedidos_preco_sourcetextile_mover(p2, 'aguarda_cliente');
  perform pedidos_preco_sourcetextile_mover(p2, 'aguarda_cliente');
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p2 and estado_destino = 'aguarda_cliente';
  insert into _testes(passo, obtido, esperado)
    values ('mover duas vezes para o mesmo sitio grava um movimento so', v_txt, '1');

  -- o primeiro desfazer tira o movimento; o segundo já só teria a receção
  perform pedidos_preco_sourcetextile_desfazer(p2);
  select estado into v_txt from pedidos_preco_sourcetextile_pedidos where id = p2;
  insert into _testes(passo, obtido, esperado)
    values ('desfazer o movimento volta a Orcamentacao', v_txt, 'orcamentacao');
  begin
    perform pedidos_preco_sourcetextile_desfazer(p2);
    insert into _testes(passo, obtido, esperado) values ('desfazer a rececao', 'deixou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('desfazer a rececao', 'recusa', 'recusa');
  end;

  begin
    perform pedidos_preco_sourcetextile_criar_pedido(
      'cliente teste ', ' t-200 ', 'comercial1@sourcetextile.pt');
    insert into _testes(passo, obtido, esperado) values ('referencia repetida', 'deixou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('referencia repetida', 'recusa', 'recusa');
  end;

  -- validações à entrada
  begin
    perform pedidos_preco_sourcetextile_criar_pedido(
      'Cliente Teste', 'T-FUT', 'comercial1@sourcetextile.pt', current_date + 2);
    insert into _testes(passo, obtido, esperado) values ('receber no futuro', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('receber no futuro', 'recusa', 'recusa');
  end;
  begin
    perform pedidos_preco_sourcetextile_criar_pedido('Cliente Teste', 'T-SEMGP', '');
    insert into _testes(passo, obtido, esperado) values ('criar sem GP', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('criar sem GP', 'recusa', 'recusa');
  end;

  select count(*)::text into v_txt from pedidos_preco_sourcetextile_historico(p);
  insert into _testes(passo, obtido, esperado)
    values ('historico guarda ate o que foi desfeito', v_txt, '5');
end $t$;

-- ---------------------------------------------------------------------
-- Parte 3 — o quadro: só o que se vê
-- ---------------------------------------------------------------------
do $t$
declare v_txt text; p uuid;
begin
  p := pedidos_preco_sourcetextile_criar_pedido('Cliente Teste', 'T-Q1', 'comercial1@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(p, 'orcamentacao');
  perform pedidos_preco_sourcetextile_mover(p, 'aguarda_cliente');
  perform pedidos_preco_sourcetextile_fechar(p, 'converteu');

  select count(*)::text into v_txt from pedidos_preco_sourcetextile_quadro() q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('quadro por defeito nao traz fechados', v_txt, '0');
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_quadro(30) q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('quadro(30) traz os fechados recentes', v_txt, '1');
  select coalesce(q.dias_etapa::text, 'NULO') || '/' || coalesce(q.semaforo, 'NULO')
    into v_txt from pedidos_preco_sourcetextile_quadro(30) q where q.id = p;
  insert into _testes(passo, obtido, esperado)
    values ('fechado nao tem tempo nem semaforo', v_txt, 'NULO/NULO');
end $t$;

-- ---------------------------------------------------------------------
-- Parte 4 — corrigir e apagar
-- ---------------------------------------------------------------------
do $t$
declare v_txt text; virgem uuid; mexido uuid; outro uuid;
begin
  virgem := pedidos_preco_sourcetextile_criar_pedido('Cliente Teste', 'T-VIRGEM', 'comercial1@sourcetextile.pt');
  mexido := pedidos_preco_sourcetextile_criar_pedido('Cliente Teste', 'T-MEXIDO', 'comercial1@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(mexido, 'orcamentacao');
  perform pedidos_preco_sourcetextile_desfazer(mexido);

  -- corrigir a referência e a GP
  perform pedidos_preco_sourcetextile_editar_pedido(
    mexido, 'Cliente Teste', null, 'T-MEXIDO-OK', 'comercial2@sourcetextile.pt');
  select ref_cliente || '/' || gp_email into v_txt
    from pedidos_preco_sourcetextile_pedidos where id = mexido;
  insert into _testes(passo, obtido, esperado)
    values ('editar: referencia e GP', v_txt, 'T-MEXIDO-OK/comercial2@sourcetextile.pt');

  -- a referência corrigida continua a não poder repetir-se
  begin
    perform pedidos_preco_sourcetextile_editar_pedido(
      virgem, 'Cliente Teste', null, 't-mexido-ok', 'comercial1@sourcetextile.pt');
    insert into _testes(passo, obtido, esperado) values ('editar para uma referencia repetida', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('editar para uma referencia repetida', 'recusa', 'recusa');
  end;

  -- editar não mexe no histórico
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_transicoes where pedido_id = mexido;
  insert into _testes(passo, obtido, esperado)
    values ('editar nao altera o historico', v_txt, '2');

  -- apagar: pedido que nunca teve um movimento
  perform pedidos_preco_sourcetextile_apagar_pedido(virgem);
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_pedidos where id = virgem;
  insert into _testes(passo, obtido, esperado) values ('apagar um pedido virgem', v_txt, '0');

  -- apagar: pedido com historico (mesmo que o movimento tenha sido desfeito)
  begin
    perform pedidos_preco_sourcetextile_apagar_pedido(mexido);
    insert into _testes(passo, obtido, esperado) values ('apagar um pedido com historico', 'apagou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('apagar um pedido com historico', 'recusa', 'recusa');
  end;
  select count(*)::text into v_txt from pedidos_preco_sourcetextile_transicoes where pedido_id = mexido;
  insert into _testes(passo, obtido, esperado)
    values ('o historico sobreviveu a tentativa de apagar', v_txt, '2');
end $t$;

-- ---------------------------------------------------------------------
-- Parte 5 — SEGURANÇA. A falar como o browser: papel `authenticated`.
-- ---------------------------------------------------------------------
do $t$
declare p uuid; n int; v_txt text; v_antes timestamptz; v_depois timestamptz;
begin
  p := pedidos_preco_sourcetextile_criar_pedido('Cliente Prova', 'PROVA-1', 'comercial1@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(p, 'orcamentacao');
  select ocorrido_em into v_antes from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_destino = 'orcamentacao';

  set local role authenticated;

  -- escrita direta em cada tabela de historico: tem de falhar
  begin
    update pedidos_preco_sourcetextile_transicoes set ocorrido_em = ocorrido_em - interval '40 days'
     where pedido_id = p;
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: UPDATE direto a uma transicao', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: UPDATE direto a uma transicao', 'bloqueado', 'bloqueado');
  end;
  begin
    delete from pedidos_preco_sourcetextile_pedidos where id = p;
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: DELETE direto a um pedido', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: DELETE direto a um pedido', 'bloqueado', 'bloqueado');
  end;
  begin
    insert into pedidos_preco_sourcetextile_transicoes (pedido_id, ronda, estado_destino, ocorrido_em)
    values (p, 1, 'fechado', now());
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto numa transicao', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto numa transicao', 'bloqueado', 'bloqueado');
  end;
  begin
    update pedidos_preco_sourcetextile_pedidos set estado = 'fechado', resultado = 'converteu' where id = p;
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: UPDATE direto ao estado do pedido', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: UPDATE direto ao estado do pedido', 'bloqueado', 'bloqueado');
  end;
  begin
    insert into pedidos_preco_sourcetextile_correcoes (transicao_id, valor_antigo, valor_novo)
    select id, now(), now() from pedidos_preco_sourcetextile_transicoes where pedido_id = p limit 1;
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto numa correcao', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto numa correcao', 'bloqueado', 'bloqueado');
  end;

  -- as funções internas não se chamam de fora
  begin
    perform pedidos_preco_sourcetextile_registar(p, 'fechado', 'link', '{"resultado":"converteu"}'::jsonb);
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: chamar registar() de fora', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: chamar registar() de fora', 'bloqueado', 'bloqueado');
  end;

  -- a origem "link" não se forja pelo mover()
  reset role;
  set local role authenticated;
  perform pedidos_preco_sourcetextile_mover(p, 'aguarda_cliente', 'link');
  reset role;
  select origem into v_txt from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_destino = 'aguarda_cliente';
  insert into _testes(passo, obtido, esperado)
    values ('SEGURANCA: origem "link" nao se forja', v_txt, 'kanban');

  -- nada disto mexeu nos dados
  select ocorrido_em into v_depois from pedidos_preco_sourcetextile_transicoes
   where pedido_id = p and estado_destino = 'orcamentacao';
  insert into _testes(passo, obtido, esperado)
    values ('SEGURANCA: a data nao mudou', (v_antes = v_depois)::text, 'true');
  select estado into v_txt from pedidos_preco_sourcetextile_pedidos where id = p;
  insert into _testes(passo, obtido, esperado)
    values ('SEGURANCA: o pedido continua a existir e a mexer so pelas funcoes', v_txt, 'aguarda_cliente');
end $t$;

-- alguém de fora do domínio, com sessão, não escreve nem pelas funções
select set_config('request.jwt.claims', '{"email":"intruso@gmail.com","role":"authenticated"}', true);
do $t$
begin
  begin
    perform pedidos_preco_sourcetextile_criar_pedido('Cliente Prova', 'PROVA-INTRUSO', 'x@y.pt');
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: criar pedido fora do dominio', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: criar pedido fora do dominio', 'bloqueado', 'bloqueado');
  end;
  begin
    perform pedidos_preco_sourcetextile_mover(
      (select id from pedidos_preco_sourcetextile_pedidos limit 1), 'malhas');
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: mover fora do dominio', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: mover fora do dominio', 'bloqueado', 'bloqueado');
  end;
end $t$;
select set_config('request.jwt.claims',
                  '{"email":"testes@sourcetextile.pt","role":"authenticated"}', true);

-- ---------------------------------------------------------------------
-- Parte 6 — factos dos indicadores (a agregação está em pedidos-kpi.js)
-- ---------------------------------------------------------------------
do $t$
declare p uuid; p2 uuid; a uuid; b uuid; c uuid; r record;
begin
  p := pedidos_preco_sourcetextile_criar_pedido('Cliente KPI','K-1','comercial1@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(p,'orcamentacao');
  perform pedidos_preco_sourcetextile_mover(p,'aguarda_cliente');
  select id into a from pedidos_preco_sourcetextile_transicoes where pedido_id=p and estado_origem is null;
  select id into b from pedidos_preco_sourcetextile_transicoes where pedido_id=p and estado_destino='orcamentacao';
  select id into c from pedidos_preco_sourcetextile_transicoes where pedido_id=p and estado_destino='aguarda_cliente';
  -- seg 08:20 -> qua 08:20 (2 em malhas) -> qua 17:20 (1 em orçamentação)
  perform pedidos_preco_sourcetextile_corrigir_data(a, timestamptz '2026-01-12 08:20 Europe/Lisbon');
  perform pedidos_preco_sourcetextile_corrigir_data(b, timestamptz '2026-01-14 08:20 Europe/Lisbon');
  perform pedidos_preco_sourcetextile_corrigir_data(c, timestamptz '2026-01-14 17:20 Europe/Lisbon');
  select * into r from pedidos_preco_sourcetextile_kpis() where id = p;
  insert into _testes(passo, obtido, esperado) values
    ('KPI: tempo de resposta', r.tempo_resposta::text, '3.00'),
    ('KPI: tempo em malhas', r.tempo_malhas::text, '2.00'),
    ('KPI: tempo em orcamentacao', r.tempo_orcamentacao::text, '1.00'),
    ('KPI: preco enviado', r.preco_enviado::text, 'true'),
    ('KPI: sem ciclo total enquanto aberto', coalesce(r.ciclo_total::text,'NULO'), 'NULO');
  perform pedidos_preco_sourcetextile_fechar(p,'converteu');
  select * into r from pedidos_preco_sourcetextile_kpis() where id = p;
  insert into _testes(passo, obtido, esperado) values
    ('KPI: ciclo total ao fechar', (r.ciclo_total is not null)::text, 'true');
  perform pedidos_preco_sourcetextile_desfazer(p);
  perform pedidos_preco_sourcetextile_nova_ronda(p, true);
  select * into r from pedidos_preco_sourcetextile_kpis() where id = p;
  insert into _testes(passo, obtido, esperado) values
    ('KPI: ronda 2 sem preco nao tem tempo de resposta', coalesce(r.tempo_resposta::text,'NULO'), 'NULO'),
    ('KPI: duas rondas', r.rondas::text, '2');
  p2 := pedidos_preco_sourcetextile_criar_pedido('Cliente KPI','K-2','comercial1@sourcetextile.pt', null, true);
  perform pedidos_preco_sourcetextile_saltar_malhas(p2);
  select * into r from pedidos_preco_sourcetextile_kpis() where id = p2;
  insert into _testes(passo, obtido, esperado) values
    ('KPI: malhas saltadas nao entram no tempo de malhas', coalesce(r.tempo_malhas::text,'NULO'), 'NULO'),
    ('KPI: periodo futuro nao traz nada',
     (select count(*)::text from pedidos_preco_sourcetextile_kpis(current_date + 5) where id in (p,p2)), '0');
end $t$;

-- ---------------------------------------------------------------------
-- Parte 7 — alertas, envio, ligação de um clique, notas, templates
-- (cenários 3, 4, 8 e 9 do enunciado)
-- ---------------------------------------------------------------------
do $t$
declare
  p uuid; p2 uuid; p3 uuid; p4 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  i int; v_txt text; v_n int; r jsonb;
  cfg_original jsonb; tpl_original jsonb; v_ok boolean;
begin
  select valor into cfg_original from pedidos_preco_sourcetextile_config where chave = 'email_envio';
  select valor into tpl_original from pedidos_preco_sourcetextile_config where chave = 'email_template';

  -- ===== CENARIO 3: malhas sem resposta ==============================
  p := pedidos_preco_sourcetextile_criar_pedido('Cliente Alerta', 'AL-1', 'comercial1@sourcetextile.pt');
  select id into t1 from pedidos_preco_sourcetextile_transicoes where pedido_id = p;

  i := 1;
  while i < 60 and pedidos_preco_sourcetextile_dias_uteis(now() - i * interval '6 hours', now()) < 2.3 loop i := i + 1; end loop;
  perform pedidos_preco_sourcetextile_corrigir_data(t1, now() - i * interval '6 hours');
  v_n := pedidos_preco_sourcetextile_gerar_alertas(p);
  insert into _testes(passo, obtido, esperado) values
    ('CENARIO 3: aos 2 gera 1 alerta', v_n::text, '1'),
    ('CENARIO 3: e e para o Aprovisionamento',
     (select string_agg(tipo || '>' || destinatario_email, ',') from pedidos_preco_sourcetextile_alertas where pedido_id = p),
     'malhas_2>planeamento.amostras@sourcetextile.pt'),
    ('CENARIO 3: com a notificacao na app',
     (select count(*)::text from pedidos_preco_sourcetextile_notificacoes n
        join pedidos_preco_sourcetextile_alertas a on a.id = n.alerta_id where a.pedido_id = p), '1');

  i := 1;
  while i < 80 and pedidos_preco_sourcetextile_dias_uteis(now() - i * interval '6 hours', now()) < 4.3 loop i := i + 1; end loop;
  perform pedidos_preco_sourcetextile_corrigir_data(t1, now() - i * interval '6 hours');
  v_n := pedidos_preco_sourcetextile_gerar_alertas(p);
  insert into _testes(passo, obtido, esperado) values
    ('CENARIO 3: aos 4 gera 1 alerta novo', v_n::text, '1'),
    ('CENARIO 3: para a GP responsavel',
     (select destinatario_email from pedidos_preco_sourcetextile_alertas where pedido_id = p and tipo = 'malhas_4'),
     'comercial1@sourcetextile.pt');
  -- o job a correr duas (ou dez) vezes nao repete nada
  v_n := pedidos_preco_sourcetextile_gerar_alertas(p) + pedidos_preco_sourcetextile_gerar_alertas(p)
       + pedidos_preco_sourcetextile_gerar_alertas(p);
  insert into _testes(passo, obtido, esperado) values
    ('CENARIO 3: correr o job outra vez nao repete alertas', v_n::text, '0'),
    ('CENARIO 3: continuam a ser 2',
     (select count(*)::text from pedidos_preco_sourcetextile_alertas where pedido_id = p), '2');

  -- ===== CENARIO 4: cliente sem resposta ==============================
  p2 := pedidos_preco_sourcetextile_criar_pedido('Cliente Alerta', 'AL-2', 'comercial2@sourcetextile.pt');
  perform pedidos_preco_sourcetextile_mover(p2, 'orcamentacao');
  perform pedidos_preco_sourcetextile_mover(p2, 'aguarda_cliente');
  select id into t1 from pedidos_preco_sourcetextile_transicoes where pedido_id = p2 and estado_origem is null;
  select id into t2 from pedidos_preco_sourcetextile_transicoes where pedido_id = p2 and estado_destino = 'orcamentacao';
  select id into t3 from pedidos_preco_sourcetextile_transicoes where pedido_id = p2 and estado_destino = 'aguarda_cliente';
  i := 1;
  while i < 120 and pedidos_preco_sourcetextile_dias_uteis(now() - i * interval '6 hours', now()) < 5.3 loop i := i + 1; end loop;
  perform pedidos_preco_sourcetextile_corrigir_data(t1, now() - i * interval '6 hours' - interval '3 days');
  perform pedidos_preco_sourcetextile_corrigir_data(t2, now() - i * interval '6 hours' - interval '2 days');
  perform pedidos_preco_sourcetextile_corrigir_data(t3, now() - i * interval '6 hours');
  v_n := pedidos_preco_sourcetextile_gerar_alertas(p2);
  insert into _testes(passo, obtido, esperado) values
    ('CENARIO 4: aos 5 gera o alerta para a GP', v_n::text, '1'),
    ('CENARIO 4: e e "cliente_5" para a GP do pedido',
     (select tipo || '>' || destinatario_email from pedidos_preco_sourcetextile_alertas where pedido_id = p2),
     'cliente_5>comercial2@sourcetextile.pt');

  -- ===== CENARIO 9: envio desligado ===================================
  update pedidos_preco_sourcetextile_config set valor = '{"modo":"desligado","email_teste":"","remetente":""}'::jsonb
   where chave = 'email_envio';
  v_n := pedidos_preco_sourcetextile_enviar_alertas(p) + pedidos_preco_sourcetextile_enviar_alertas(p2);
  insert into _testes(passo, obtido, esperado) values
    ('CENARIO 9: desligado nao envia, marca como suprimido', v_n::text, '3'),
    ('CENARIO 9: os alertas continuam visiveis na app',
     (select count(*)::text from pedidos_preco_sourcetextile_alertas
       where pedido_id in (p, p2) and estado_envio = 'suprimido'), '3');

  -- modo de teste sem fornecedor ligado: erro legivel, nunca "enviado"
  update pedidos_preco_sourcetextile_alertas set estado_envio = 'pendente' where pedido_id = p2;
  update pedidos_preco_sourcetextile_config set valor = '{"modo":"teste","email_teste":"teste@kaizen.com","remetente":""}'::jsonb
   where chave = 'email_envio';
  perform pedidos_preco_sourcetextile_enviar_alertas(p2);
  insert into _testes(passo, obtido, esperado) values
    ('envio em modo teste sem fornecedor: erro claro',
     (select estado_envio || '/' || left(erro_envio, 29) from pedidos_preco_sourcetextile_alertas where pedido_id = p2),
     'erro/Fornecedor de email ainda não');
  update pedidos_preco_sourcetextile_config set valor = cfg_original where chave = 'email_envio';

  -- ===== os três emails ===============================================
  declare
    a_m2 uuid; a_m4 uuid; a_c5 uuid; v_dt text; e record;
  begin
    select id into a_m2 from pedidos_preco_sourcetextile_alertas where pedido_id = p  and tipo = 'malhas_2';
    select id into a_m4 from pedidos_preco_sourcetextile_alertas where pedido_id = p  and tipo = 'malhas_4';
    select id into a_c5 from pedidos_preco_sourcetextile_alertas where pedido_id = p2 and tipo = 'cliente_5';
    v_dt := to_char((select max(ocorrido_em) from pedidos_preco_sourcetextile_transicoes
                      where pedido_id = p2 and estado_destino = 'aguarda_cliente' and anulada_em is null)
                    at time zone 'Europe/Lisbon', 'DD/MM/YYYY');

    -- 1. Aprovisionamento (2 dias úteis em Aprov. Malhas)
    select * into e from pedidos_preco_sourcetextile_compor_email('malhas_2', 'Paula', array[a_m2]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL 1: assunto', e.assunto, 'Pedidos de preço: 1 à espera do preço de malhas'),
      ('EMAIL 1: abre com "Bom dia," sem nome e o texto aprovado',
       (e.corpo like E'Bom dia,\n\nEstes pedidos estão em Aprov. Malhas há 2 dias úteis ou mais e ainda não têm o preço de malhas:\n\n• Cliente Alerta · AL-1 · GP Sónia Marques · há % dias úteis\n\nQuando enviares o preço, passa cada pedido para Orçamentação na aplicação:\n%\n\nObrigado.')::text, 'true'),
      ('EMAIL 1: nao leva link de um clique', (e.corpo not like '%acao=%')::text, 'true'),
      ('EMAIL 1: sem assinatura depois do Obrigado', (e.corpo like E'%Obrigado.')::text, 'true');

    -- 2. GP (4 dias úteis em Aprov. Malhas)
    select * into e from pedidos_preco_sourcetextile_compor_email('malhas_4', 'Sónia Marques', array[a_m4]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL 2: assunto', e.assunto, 'Pedidos de preço: malhas sem resposta há 4 dias úteis'),
      ('EMAIL 2: texto aprovado (um pedido, singular)',
       (e.corpo like E'Bom dia, Sónia,\n\nEste pedido teu continua em Aprov. Malhas há 4 dias úteis ou mais, sem preço de malhas (o objetivo são 2):\n\n• Cliente Alerta · AL-1 · há % dias úteis\n\nJá foi avisada a Aprovisionamento aos 2 dias. Talvez valha a pena falares com ela diretamente.\n\nVer o pedido: %')::text, 'true');
    select * into e from pedidos_preco_sourcetextile_compor_email('malhas_4', 'Sónia Marques', array[a_m4, a_m4]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL 2: com vários pedidos usa o plural',
       (e.corpo like E'%Estes pedidos teus continuam em Aprov. Malhas%Ver os pedidos: %')::text, 'true');

    -- 3. GP (5 dias úteis em Aguarda Cliente)
    select * into e from pedidos_preco_sourcetextile_compor_email('cliente_5', 'Sandrina', array[a_c5]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL 3: assunto (1 cliente)', e.assunto, 'Pedidos de preço: 1 cliente sem resposta'),
      ('EMAIL 3: texto aprovado',
       (e.corpo like E'Bom dia, Sandrina,\n\nEstes pedidos teus estão em Aguarda Cliente há 5 dias úteis ou mais, sem resposta do cliente:\n\n• Cliente Alerta · AL-2 · preço enviado a ' || v_dt || E' · há % dias úteis\n\nO que podes fazer:\n– Contactar o cliente. Na aplicação, "Preparar email ao cliente" já traz o texto escrito.\n– Quando houver resposta, registar o resultado (Converteu, Não converteu ou Pediu negociação).\n\nVer os pedidos: %')::text, 'true');
    select * into e from pedidos_preco_sourcetextile_compor_email('cliente_5', 'Sandrina', array[a_c5, a_c5]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL 3: assunto (2 clientes)', e.assunto, 'Pedidos de preço: 2 clientes sem resposta');

    -- os limites vêm da configuração, não do código
    update pedidos_preco_sourcetextile_config
       set valor = '{"malhas_aprovisionamento": 3, "malhas_gp": 6, "cliente_gp": 7}'::jsonb
     where chave = 'alertas_limites';
    select * into e from pedidos_preco_sourcetextile_compor_email('malhas_4', 'Sónia Marques', array[a_m4]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL: o limite dos 4 dias vem da configuracao', e.assunto, 'Pedidos de preço: malhas sem resposta há 6 dias úteis');
    select * into e from pedidos_preco_sourcetextile_compor_email('cliente_5', 'Sandrina', array[a_c5]);
    insert into _testes(passo, obtido, esperado) values
      ('EMAIL: o limite dos 5 dias vem da configuracao',
       (e.corpo like '%em Aguarda Cliente há 7 dias úteis ou mais%')::text, 'true');
    update pedidos_preco_sourcetextile_config
       set valor = '{"malhas_aprovisionamento": 2, "malhas_gp": 4, "cliente_gp": 5}'::jsonb
     where chave = 'alertas_limites';
  end;


  -- ===== o limite de geração também vem da configuração ================
  declare
    p6 uuid; t6 uuid; k int;
  begin
    p6 := pedidos_preco_sourcetextile_criar_pedido('Cliente Alerta', 'AL-6', 'comercial1@sourcetextile.pt');
    select id into t6 from pedidos_preco_sourcetextile_transicoes where pedido_id = p6;
    k := 1;
    while k < 40 and pedidos_preco_sourcetextile_dias_uteis(now() - k * interval '6 hours', now()) < 1.3 loop k := k + 1; end loop;
    perform pedidos_preco_sourcetextile_corrigir_data(t6, now() - k * interval '6 hours');
    insert into _testes(passo, obtido, esperado) values
      ('LIMITE: com 1,3 dias úteis e limite 2 nao gera', pedidos_preco_sourcetextile_gerar_alertas(p6)::text, '0');
    update pedidos_preco_sourcetextile_config
       set valor = '{"malhas_aprovisionamento": 1, "malhas_gp": 4, "cliente_gp": 5}'::jsonb
     where chave = 'alertas_limites';
    insert into _testes(passo, obtido, esperado) values
      ('LIMITE: com limite 1 passa a gerar', pedidos_preco_sourcetextile_gerar_alertas(p6)::text, '1');
    update pedidos_preco_sourcetextile_config
       set valor = '{"malhas_aprovisionamento": 2, "malhas_gp": 4, "cliente_gp": 5}'::jsonb
     where chave = 'alertas_limites';
  end;

  -- ===== sino e notificacoes ==========================================
  perform set_config('request.jwt.claims', '{"email":"planeamento.amostras@sourcetextile.pt","role":"authenticated"}', true);
  insert into _testes(passo, obtido, esperado) values
    ('sino: o alerta do Aprovisionamento e meu e esta por ler',
     (select (minha and not lida)::text from pedidos_preco_sourcetextile_alertas_hoje()
       where pedido_id = p and tipo = 'malhas_2'), 'true');
  perform pedidos_preco_sourcetextile_marcar_lidas();
  insert into _testes(passo, obtido, esperado) values
    ('sino: depois de abrir o painel ficam lidos',
     (select lida::text from pedidos_preco_sourcetextile_alertas_hoje() where pedido_id = p and tipo = 'malhas_2'), 'true'),
    ('sino: os alertas da GP nao sao meus',
     (select minha::text from pedidos_preco_sourcetextile_alertas_hoje() where pedido_id = p and tipo = 'malhas_4'), 'false');
  perform set_config('request.jwt.claims', '{"email":"testes@sourcetextile.pt","role":"authenticated"}', true);

  -- ===== quando o job deve correr =====================================
  insert into _testes(passo, obtido, esperado) values
    ('job: terca 8h35 de inverno corre', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-01-14 08:35 Europe/Lisbon')::text, 'true'),
    ('job: terca 8h35 de verao corre', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-07-01 08:35 Europe/Lisbon')::text, 'true'),
    ('job: as 7h30 nao corre', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-01-14 07:30 Europe/Lisbon')::text, 'false'),
    ('job: as 9h30 nao corre', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-01-14 09:30 Europe/Lisbon')::text, 'false'),
    ('job: ao sabado nao corre', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-01-11 08:35 Europe/Lisbon')::text, 'false');
  insert into pedidos_preco_sourcetextile_alertas_execucoes (dia) values (date '2031-01-14');
  insert into _testes(passo, obtido, esperado) values
    ('job: nao corre duas vezes no mesmo dia', pedidos_preco_sourcetextile_deve_correr(timestamptz '2031-01-14 08:40 Europe/Lisbon')::text, 'false');
  delete from pedidos_preco_sourcetextile_alertas_execucoes where dia = date '2031-01-14';

  -- ===== notas e templates ============================================
  perform pedidos_preco_sourcetextile_guardar_nota(p, '  cliente pediu amostra ');
  insert into _testes(passo, obtido, esperado) values
    ('nota guardada sem espacos', pedidos_preco_sourcetextile_obter_nota(p), 'cliente pediu amostra');
  perform pedidos_preco_sourcetextile_guardar_nota(p, '   ');
  insert into _testes(passo, obtido, esperado) values
    ('nota em branco apaga', coalesce(pedidos_preco_sourcetextile_obter_nota(p), 'NULA'), 'NULA');

  perform pedidos_preco_sourcetextile_guardar_template('Assunto novo', 'Corpo novo');
  insert into _testes(passo, obtido, esperado) values
    ('template guardado',
     (select valor ->> 'assunto' from pedidos_preco_sourcetextile_config where chave = 'email_template'), 'Assunto novo');
  begin
    perform pedidos_preco_sourcetextile_guardar_template('', 'x');
    insert into _testes(passo, obtido, esperado) values ('template em branco', 'aceitou', 'recusa');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('template em branco', 'recusa', 'recusa');
  end;
  update pedidos_preco_sourcetextile_config set valor = tpl_original where chave = 'email_template';

  -- ===== seguranca dos alertas ========================================
  set local role authenticated;
  begin
    insert into pedidos_preco_sourcetextile_alertas (pedido_id, ronda, tipo, dia) values (p, 9, 'malhas_2', current_date);
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto em alertas', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: INSERT direto em alertas', 'bloqueado', 'bloqueado');
  end;
  reset role;
  set local role anon;
  begin
    perform pedidos_preco_sourcetextile_enviar_email('x@y.pt', 'a', 'b');
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: anon a enviar email', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: anon a enviar email', 'bloqueado', 'bloqueado');
  end;
  begin
    perform pedidos_preco_sourcetextile_gerar_alertas();
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: anon a gerar alertas', 'passou', 'bloqueado');
  exception when others then
    insert into _testes(passo, obtido, esperado) values ('SEGURANCA: anon a gerar alertas', 'bloqueado', 'bloqueado');
  end;
  reset role;
end $t$;

-- ---------------------------------------------------------------------
-- Parte 8 - permissões por perfil (migration 0010)
-- ---------------------------------------------------------------------
do $t$
declare
  adm text := '{"email":"testes@sourcetextile.pt","role":"authenticated"}';
  gp1 text := '{"email":"comercial1@sourcetextile.pt","role":"authenticated"}';
  ap  text := '{"email":"planeamento.amostras@sourcetextile.pt","role":"authenticated"}';
  lei text := '{"email":"alguem.de.fora@sourcetextile.pt","role":"authenticated"}';
  p1 uuid; p2 uuid; p3 uuid; t uuid; tpl_original jsonb;
begin
  select valor into tpl_original from pedidos_preco_sourcetextile_config where chave = 'email_template';

  perform set_config('request.jwt.claims', adm, true);
  p1 := pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-1', 'comercial1@sourcetextile.pt');
  p2 := pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-2', 'comercial2@sourcetextile.pt');
  p3 := pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-3', 'comercial2@sourcetextile.pt');
  select id into t from pedidos_preco_sourcetextile_transicoes where pedido_id = p3;

  insert into _testes(passo, obtido, esperado) values
    ('PERM: papel do admin (email configurado)', pedidos_preco_sourcetextile_meu_papel(), 'admin');

  -- ===== GP =========================================================
  perform set_config('request.jwt.claims', gp1, true);
  insert into _testes(passo, obtido, esperado) values
    ('PERM: papel da GP', pedidos_preco_sourcetextile_meu_papel(), 'gp');

  begin perform pedidos_preco_sourcetextile_mover(p1, 'orcamentacao');
    insert into _testes values (default, 'PERM: GP mexe no seu pedido', 'ok', 'ok');
  exception when others then insert into _testes values (default, 'PERM: GP mexe no seu pedido', sqlerrm, 'ok'); end;

  begin perform pedidos_preco_sourcetextile_mover(p2, 'orcamentacao');
    insert into _testes values (default, 'PERM: GP mexe no pedido de outra GP', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: GP mexe no pedido de outra GP', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_fechar(p2, 'converteu');
    insert into _testes values (default, 'PERM: GP fecha o pedido de outra GP', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: GP fecha o pedido de outra GP', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_corrigir_data(t, now() - interval '1 day');
    insert into _testes values (default, 'PERM: GP corrige data de outra GP', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: GP corrige data de outra GP', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-X', 'comercial2@sourcetextile.pt');
    insert into _testes values (default, 'PERM: GP cria em nome de outra', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: GP cria em nome de outra', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-4', 'comercial1@sourcetextile.pt');
    insert into _testes values (default, 'PERM: GP cria em seu nome', 'ok', 'ok');
  exception when others then insert into _testes values (default, 'PERM: GP cria em seu nome', sqlerrm, 'ok'); end;

  begin perform pedidos_preco_sourcetextile_editar_pedido(p1, 'Cliente Perm', null, 'PM-1', 'comercial2@sourcetextile.pt');
    insert into _testes values (default, 'PERM: GP passa o pedido a outra GP', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: GP passa o pedido a outra GP', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_guardar_template('Assunto GP', 'Corpo GP');
    insert into _testes values (default, 'PERM: GP edita o modelo de email', 'ok', 'ok');
  exception when others then insert into _testes values (default, 'PERM: GP edita o modelo de email', sqlerrm, 'ok'); end;


  -- ===== Aprovisionamento ===========================================
  perform set_config('request.jwt.claims', ap, true);
  insert into _testes(passo, obtido, esperado) values
    ('PERM: papel da Aprovisionamento', pedidos_preco_sourcetextile_meu_papel(), 'aprovisionamento');

  begin perform pedidos_preco_sourcetextile_mover(p2, 'orcamentacao');
    insert into _testes values (default, 'PERM: Aprov. passa malhas->orcamentacao (pedido de outra pessoa)', 'ok', 'ok');
  exception when others then insert into _testes values (default, 'PERM: Aprov. passa malhas->orcamentacao (pedido de outra pessoa)', sqlerrm, 'ok'); end;
  insert into _testes(passo, obtido, esperado) values
    ('PERM: e o pedido mexeu mesmo',
     (select estado from pedidos_preco_sourcetextile_pedidos where id = p2), 'orcamentacao');

  begin perform pedidos_preco_sourcetextile_mover(p2, 'aguarda_cliente');
    insert into _testes values (default, 'PERM: Aprov. passa orcamentacao->aguarda', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. passa orcamentacao->aguarda', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_mover(p2, 'malhas');
    insert into _testes values (default, 'PERM: Aprov. nao volta atras', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. nao volta atras', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_mover(p3, 'aguarda_cliente');
    insert into _testes values (default, 'PERM: Aprov. salta etapas', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. salta etapas', 'recusa', 'recusa'); end;

  begin perform pedidos_preco_sourcetextile_criar_pedido('Cliente Perm', 'PM-5', 'comercial1@sourcetextile.pt');
    insert into _testes values (default, 'PERM: Aprov. cria pedidos', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. cria pedidos', 'recusa', 'recusa'); end;
  begin perform pedidos_preco_sourcetextile_fechar(p2, 'converteu');
    insert into _testes values (default, 'PERM: Aprov. fecha pedidos', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. fecha pedidos', 'recusa', 'recusa'); end;
  begin perform pedidos_preco_sourcetextile_desfazer(p2);
    insert into _testes values (default, 'PERM: Aprov. desfaz', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. desfaz', 'recusa', 'recusa'); end;
  begin perform pedidos_preco_sourcetextile_apagar_pedido(p3);
    insert into _testes values (default, 'PERM: Aprov. apaga', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. apaga', 'recusa', 'recusa'); end;
  begin perform pedidos_preco_sourcetextile_guardar_template('x', 'y');
    insert into _testes values (default, 'PERM: Aprov. edita o modelo de email', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: Aprov. edita o modelo de email', 'recusa', 'recusa'); end;

  -- ===== Quem não é de ninguém só lê =================================
  perform set_config('request.jwt.claims', lei, true);
  insert into _testes(passo, obtido, esperado) values
    ('PERM: papel de um email sem funcao', pedidos_preco_sourcetextile_meu_papel(), 'leitura');
  begin perform pedidos_preco_sourcetextile_mover(p3, 'orcamentacao');
    insert into _testes values (default, 'PERM: leitura mexe', 'passou', 'recusa');
  exception when others then insert into _testes values (default, 'PERM: leitura mexe', 'recusa', 'recusa'); end;
  insert into _testes(passo, obtido, esperado) values
    ('PERM: leitura continua a ler o quadro',
     (select (count(*) > 0)::text from pedidos_preco_sourcetextile_quadro()), 'true');

  -- ===== o núcleo e a regra não se chamam de fora =====================
  perform set_config('request.jwt.claims', gp1, true);
  set local role authenticated;
  begin perform pedidos_preco_sourcetextile_nucleo_mover(p2, 'aguarda_cliente');
    insert into _testes values (default, 'PERM: chamar o nucleo directamente', 'passou', 'bloqueado');
  exception when others then insert into _testes values (default, 'PERM: chamar o nucleo directamente', 'bloqueado', 'bloqueado'); end;
  begin perform pedidos_preco_sourcetextile_autorizar('mover', p2, 'orcamentacao');
    insert into _testes values (default, 'PERM: chamar a regra directamente', 'passou', 'bloqueado');
  exception when others then insert into _testes values (default, 'PERM: chamar a regra directamente', 'bloqueado', 'bloqueado'); end;
  reset role;

  perform set_config('request.jwt.claims', adm, true);
  update pedidos_preco_sourcetextile_config set valor = tpl_original where chave = 'email_template';
end $t$;

-- ---------------------------------------------------------------------
-- Limpeza
-- ---------------------------------------------------------------------
delete from pedidos_preco_sourcetextile_pedidos
 where cliente_id in (select id from pedidos_preco_sourcetextile_clientes
                       where nome in ('Cliente Teste', 'Cliente Prova', 'Cliente KPI', 'Cliente Alerta', 'Cliente Perm'));
delete from pedidos_preco_sourcetextile_clientes where nome in ('Cliente Teste', 'Cliente Prova', 'Cliente KPI', 'Cliente Alerta', 'Cliente Perm');

update pedidos_preco_sourcetextile_config
   set valor = (select valor from _admins_original) where chave = 'admins';

-- ---------------------------------------------------------------------
-- Resultado — uma linha de resumo e, a seguir, só o que falhou
-- ---------------------------------------------------------------------
select passo, esperado, obtido, resultado from (
  select 0 as k, 0::bigint as ord, 'RESUMO' as passo,
         (select count(*) from _testes)::text as esperado,
         (select count(*) from _testes where obtido is not distinct from esperado)::text as obtido,
         'total / passou' as resultado
  union all
  select 1, ord, passo, esperado, obtido, '>>> FALHOU'
    from _testes where obtido is distinct from esperado
) r
order by k, ord;
