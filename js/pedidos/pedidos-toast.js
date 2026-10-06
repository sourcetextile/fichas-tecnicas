// Avisos curtos no fundo do ecrã, com "Desfazer" quando a ação se desfaz.
//
// Substituem as janelas de confirmação a seguir a cada ação: a pessoa age
// à primeira, sem perguntas, e tem alguns segundos para se arrepender com
// um clique. Rebenta menos o ritmo do que perguntar "tens a certeza?" a
// quem só quer mover um cartão.
const PedidosToast = (() => {
  let temporizador = null;
  let duracaoAtual = 0;

  const anfitriao = () => document.getElementById('pedidosToasts');

  function limpar() {
    clearTimeout(temporizador);
    const host = anfitriao();
    if (host) host.innerHTML = '';
  }

  function agendar(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(limpar, ms);
  }

  function mostrar({ texto, tipo, acao, duracao }) {
    const host = anfitriao();
    if (!host) return;
    limpar();

    const erro = tipo === 'erro';
    duracaoAtual = duracao || (erro ? 9000 : 8000);

    const aviso = document.createElement('div');
    aviso.className = 'pp-toast' + (erro ? ' is-erro' : '');

    const corpo = document.createElement('span');
    corpo.className = 'pp-toast__texto';
    corpo.textContent = texto;
    aviso.appendChild(corpo);

    if (acao) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'pp-toast__acao';
      botao.textContent = acao.rotulo;
      botao.addEventListener('click', () => {
        limpar();
        acao.fn();
      });
      aviso.appendChild(botao);
    }

    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'pp-toast__fechar';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.textContent = '✕';
    fechar.addEventListener('click', limpar);
    aviso.appendChild(fechar);

    // Enquanto o rato está em cima o aviso não desaparece: quem está a
    // ler a mensagem, ou a ir buscar o botão, não o perde a meio.
    aviso.addEventListener('mouseenter', () => clearTimeout(temporizador));
    aviso.addEventListener('mouseleave', () => agendar(duracaoAtual));

    host.appendChild(aviso);
    agendar(duracaoAtual);
  }

  return {
    mostrar,
    limpar,
    ok: (texto, acao) => mostrar({ texto, acao }),
    erro: texto => mostrar({ texto, tipo: 'erro' })
  };
})();
