-- =====================================================================
-- Pedidos de Preço — Sourcetextile
-- 0003 — configuração inicial, motivos e utilizadores
--
-- Tudo com ON CONFLICT DO NOTHING: voltar a correr a migration não
-- desfaz nada do que as GP tenham entretanto editado nas configurações.
-- =====================================================================

insert into pedidos_preco_sourcetextile_config (chave, valor) values
  ('horario',            '{"inicio": "08:20", "fim": "17:20"}'::jsonb),
  ('objetivos',          '{"malhas": 2, "orcamentacao": 1, "aguarda_cliente": 5}'::jsonb),
  ('limiar_amarelo',     '{"valor": 0.85}'::jsonb),
  -- Sem objetivo de conversão por defeito: só há semáforo se for definido.
  ('objetivo_conversao', '{"valor": null}'::jsonb),
  -- Objetivo do lead time de resposta de preço. Sem consulta de malhas
  -- passa a 1 d.u.; com negociação é 3 x nº de rondas.
  ('lt_resposta',        '{"objetivo": 3, "objetivo_sem_malhas": 1}'::jsonb),
  ('email_envio',        '{"modo": "desligado", "email_teste": "", "remetente": ""}'::jsonb),
  ('email_template',     jsonb_build_object(
     'assunto', 'Proposta de preço {{referencia}} - {{cliente}}',
     'corpo', concat_ws(E'\n',
       'Bom dia,',
       '',
       'No dia {{data_envio}} enviámos a proposta de preço para a referência {{referencia}}.',
       '',
       'Gostaríamos de saber se há alguma questão que possamos esclarecer e se já é possível contar com a vossa decisão.',
       '',
       'Ficamos ao dispor.',
       '',
       'Com os melhores cumprimentos,',
       '{{gp}}')))
on conflict (chave) do nothing;

insert into pedidos_preco_sourcetextile_motivos (nome, ordem, pede_texto) values
  ('Preço',                     1, false),
  ('Prazo de entrega',          2, false),
  ('Quantidade mínima',         3, false),
  ('Amostra/qualidade',         4, false),
  ('Escolheu outro fornecedor', 5, false),
  ('Projeto cancelado',         6, false),
  ('Outro',                     7, true)
on conflict do nothing;

-- A Paula ainda não tem email conhecido: aparece nas listas e pode ser
-- responsável, mas os alertas dela ficam sem destinatário até ser
-- preenchido nas configurações.
insert into pedidos_preco_sourcetextile_utilizadores (nome, email, papel) values
  ('Sónia Marques', 'comercial1@sourcetextile.pt', 'gp'),
  ('Sandrina',      'comercial2@sourcetextile.pt', 'gp'),
  ('Paula',          null,                         'aprovisionamento')
on conflict do nothing;
