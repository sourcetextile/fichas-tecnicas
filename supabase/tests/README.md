# Testes da base de dados

`testes_pedidos_preco.sql` verifica as regras dos Pedidos de preço contra a base de dados a sério:
calendário e dias úteis, ciclo de vida de um pedido, permissões por perfil, segurança (ninguém escreve
nas tabelas de histórico senão pelas funções), indicadores e os três emails de aviso.

Como correr: cola o ficheiro inteiro, de uma só vez, no editor de SQL do Supabase de **desenvolvimento**.
A última linha de resultado é `RESUMO total / passou`; se houver falhas, aparecem a seguir, uma por linha.

Corre depois de `supabase db push` e do seed `seed/utilizadores.sql`. Apaga o que cria.
