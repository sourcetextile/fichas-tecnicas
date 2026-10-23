// Nome a mostrar para quem finalizou ou atualizou uma ficha ("por ...").
// As gestoras entram com as caixas partilhadas (comercial1@, ...): aqui
// traduzem-se para o nome da pessoa. Qualquer outro email mostra a parte antes
// do @, com os pontos e sublinhados trocados por espaços, como antes.
const DecoNomes = (() => {
  const GESTORAS = {
    comercial1: 'Sónia Marques',
    comercial2: 'Sandrine Moreira',
    comercial4: 'Paula Pinto'
  };

  function deEmail(email) {
    const local = String(email || '').split('@')[0].trim();
    const nome = GESTORAS[local.toLowerCase()];
    return nome || local.replace(/[._]/g, ' ');
  }

  return { deEmail };
})();
