// =====================================================================
// Configuração dependente do ambiente.
//
// É O ÚNICO FICHEIRO A MUDAR quando a aplicação passar da infraestrutura
// Kaizen para o Supabase do cliente. Ver MIGRACAO.md, que lista este
// ficheiro e a função SQL pedidos_preco_sourcetextile_acesso() como os
// dois sítios onde a lista de acessos existe (um para a interface, outro
// para o RLS — têm de dizer o mesmo).
//
// Script clássico de propósito: corre antes dos módulos, por isso
// window.AppConfig já existe quando o auth.js arranca.
// =====================================================================
window.AppConfig = {
  supabaseUrl: 'https://ismjsqvbnbamxefdpunc.supabase.co',

  // Chave publicável (anon). Nunca pôr aqui a service-role key: este
  // ficheiro vai inteiro para o browser.
  publishableKey: 'sb_publishable_M1n5cKnz0SYUSitGIMvk9Q_e7XagBe8',

  // Quem entra na aplicação. Domínios inteiros ou emails completos.
  acessos: ['sourcetextile.pt', 'kaizen.com'],

  tabelas: {
    fichas: 'ficha_tecnica_sourcetextile_fichas',
    deco: 'ficha_tecnica_sourcetextile_deco_fichas',
    // Partes acrescentadas pelas pessoas à lista da Colocação.
    partes: 'ficha_tecnica_sourcetextile_deco_partes',
    // Todas as tabelas e funções dos Pedidos de Preço começam por isto.
    pedidos: 'pedidos_preco_sourcetextile_'
  },

  // Valores iniciais do envio de email. O que vale no dia a dia é o que
  // estiver nas Configurações da aplicação (tabela ..._config, chave
  // 'email_envio'), que as GP podem editar; isto é só o arranque de um
  // ambiente novo.
  email: {
    modo: 'desligado',      // desligado | teste | producao
    emailTeste: '',
    remetente: ''
  }
};

// Um email tem acesso? Mesma regra que o RLS aplica do lado da base de
// dados — se mudares aqui, muda lá também.
window.AppConfig.temAcesso = function (email) {
  email = (email || '').toLowerCase().trim();
  if (!email) return false;
  return window.AppConfig.acessos.some(entrada =>
    entrada.includes('@') ? entrada.toLowerCase() === email
                          : email.endsWith('@' + entrada.toLowerCase()));
};
