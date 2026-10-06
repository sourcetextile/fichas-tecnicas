-- =====================================================================
-- Pedidos de preço - pessoas, perfis e endereço da aplicação
--
-- Corre-se UMA VEZ, depois de `supabase db push`, no editor de SQL do
-- Supabase. Pode correr-se outra vez sem estragar nada.
--
-- Quem é o quê:
--   gp                 só mexe nos pedidos em que é a GP responsável
--   aprovisionamento   só passa pedidos de Aprov. Malhas para Orçamentação
--   admins (config)    fazem tudo; qualquer outro email com acesso só lê
-- =====================================================================

-- A migração inicial cria a Aprovisionamento sem email; aqui fica preenchido.
-- Tem de vir ANTES do insert: o email é único, por isso inserir primeiro
-- uma Paula com email e depois preencher o email da que já existe falharia
-- com "duplicate key".
update pedidos_preco_sourcetextile_utilizadores
   set email = 'planeamento.amostras@sourcetextile.pt'
 where papel = 'aprovisionamento' and (email is null or trim(email) = '');

-- As duas gestoras de produto e a responsável de Aprovisionamento de Malhas.
-- (Quem já existe com o mesmo email fica como está.)
insert into pedidos_preco_sourcetextile_utilizadores (nome, email, papel) values
  ('Sónia Marques', 'comercial1@sourcetextile.pt',          'gp'),
  ('Sandrina',      'comercial2@sourcetextile.pt',          'gp'),
  ('Paula',         'planeamento.amostras@sourcetextile.pt', 'aprovisionamento')
on conflict do nothing;

-- Quem administra (pode tudo). Emails completos e/ou domínios.
update pedidos_preco_sourcetextile_config
   set valor = '{"dominios": [], "emails": ["gestao.operacoes@sourcetextile.pt"]}'::jsonb
 where chave = 'admins';

-- O endereço onde a aplicação está publicada (vai nos emails).
update pedidos_preco_sourcetextile_config
   set valor = '{"valor": "https://sourcetextile.github.io/fichas-tecnicas/"}'::jsonb
 where chave = 'app_url';

-- Os limites dos avisos por email (em dias úteis) estão em 'alertas_limites'
-- (já vêm 2, 4 e 5). Para os mudar:
--   update pedidos_preco_sourcetextile_config
--      set valor = '{"malhas_aprovisionamento": 2, "malhas_gp": 4, "cliente_gp": 5}'::jsonb
--    where chave = 'alertas_limites';

-- Confirma que ficou tudo:
select papel, nome, email from pedidos_preco_sourcetextile_utilizadores order by papel, nome;
select chave, valor from pedidos_preco_sourcetextile_config where chave in ('admins', 'app_url', 'alertas_limites');
