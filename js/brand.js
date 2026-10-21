// Logótipo da Sourcetextile no cabeçalho da aplicação, visível em todos os
// separadores (o cabeçalho é comum). Reaproveita o SVG do deco-logo.js, o
// mesmo da folha impressa das Fichas de decoração; tem de carregar depois dele.
(function () {
  const caixa = document.getElementById('appLogo');
  if (caixa && typeof DECO_LOGO_SVG === 'string') caixa.innerHTML = DECO_LOGO_SVG;
})();
