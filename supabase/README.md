> **Nota para este pacote:** as migrações chamam-se `20261101000001_...` a `20261101000011_...` (a primeira é a das Fichas de decoração; as outras dez são as 0001 a 0010 descritas abaixo, pela mesma ordem).

# Base de dados dos Pedidos de Preço

Tudo o que a aplicação precisa da base de dados vive aqui, em ficheiros. Nada
foi criado à mão fora destas migrations, para o ambiente poder ser reposto
noutro Supabase (ver `MIGRACAO.md`, que fecha a Fase 5).

## Migrations (`migrations/`)

Aplicam-se por ordem. Prefixo de todos os objetos: `pedidos_preco_sourcetextile_`.

| # | O que faz |
|---|---|
| 0001 | Tabelas, auditoria (`created_by`/`updated_by`) e RLS |
| 0002 | Calendário: Páscoa, feriados nacionais, dias úteis, semáforo e o quadro |
| 0003 | Configuração inicial, motivos de não conversão e as GP |
| 0004 | Ações sobre um pedido (criar, mover, fechar, negociar, desfazer, corrigir data) |
| 0005 | A ordem do histórico deixa de depender das datas corrigidas |
| 0006 | A ordem passa a ser uma sequência (`now()` é o instante da transação) |
| 0007 | Endurecimento: a escrita só passa por funções, regras de estado na base de dados |
| 0008 | Indicadores: `kpis(desde, ate)`, uma linha por pedido com os tempos por etapa |
| 0009 | Alertas: geração diária (pg_cron), notificações, os três avisos por email, nota, modelo de email |
| 0010 | Permissões por perfil (gp, aprovisionamento, admin, leitura): invólucros `autorizar` sobre as funções `_nucleo_*` |
| 0011 | Só na base da Kaizen: retira a ligação de um clique e passa aos três avisos por email (as 0009 e 0010 atuais já nascem assim) |

A 0005 e a 0006 corrigem bugs reais apanhados pelos testes, e a 0007 fecha um
buraco de segurança apanhado na revisão; ficam separadas, e não reescritas, para
o histórico do que aconteceu ser legível.

## Regra de ouro

**Só há leitura (`SELECT`) nas tabelas `pedidos`, `transicoes` e `correcoes`.**
Toda a escrita passa por funções `SECURITY DEFINER` que verificam o domínio de
quem chama. É isso que faz o histórico ser imutável: não é uma convenção da
interface, é o que a base de dados deixa fazer.

Duas funções são internas (`registar`, `reconciliar`) e não se chamam de fora.

## Testes (`tests/testes_pedidos_preco.sql`)

Cola o ficheiro inteiro numa janela de SQL e corre-o de uma vez. Devolve uma linha
de resumo (`total / passou`) e, a seguir, só o que falhou. Limpa tudo o que cria,
por isso pode correr-se com dados reais na base.

Cobre o cálculo de dias úteis (fins de semana, feriados móveis, encerramentos,
mudança de hora), os cenários 1, 2, 4, 5 e 6 do enunciado, as regressões dos
bugs que já houve, e as provas de segurança: a falar como o browser (papel
`authenticated`, chave pública) nenhuma escrita direta nas tabelas de histórico
passa.

Os testes da interface estão em `../tests/pedidos.spec.js` (Playwright).
