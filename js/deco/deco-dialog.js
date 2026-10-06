// Caixas de diálogo da secção — confirmações e escolhas — com o aspeto da
// app, em vez das janelas do browser (window.confirm / window.prompt), que
// destoam e não dizem o que está em causa.
//
// Devolvem sempre uma promessa: null/false quando se cancela, o valor da
// opção escolhida quando se confirma.
const DecoDialog = (() => {
  let aberta = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // opcoes: [{ etiqueta, valor, destaque, perigo }]
  function escolher(config) {
    if (aberta) aberta();

    return new Promise(resolve => {
      const overlay = el('div', 'deco-copy-overlay');
      const dialog = el('div', 'deco-copy-dialog deco-fase-dialog');
      overlay.appendChild(dialog);

      dialog.appendChild(el('h2', null, config.titulo || 'Confirmar'));
      if (config.mensagem) dialog.appendChild(el('p', 'deco-help', config.mensagem));

      let terminado = false;
      const onKey = event => {
        if (event.key === 'Escape') fechar(null);
      };
      const fechar = valor => {
        if (terminado) return;
        terminado = true;
        aberta = null;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(valor);
      };
      aberta = () => fechar(null);

      const opcoes = el('div', 'deco-fase-dialog__opcoes');
      (config.opcoes || []).forEach(opcao => {
        const button = el('button', opcao.destaque ? 'primary' : 'secondary', opcao.etiqueta);
        button.type = 'button';
        if (opcao.perigo) button.classList.add('deco-dialog__perigo');
        button.addEventListener('click', () => fechar(opcao.valor));
        opcoes.appendChild(button);
      });
      dialog.appendChild(opcoes);

      const acoes = el('div', 'deco-copy-actions');
      const cancelar = el('button', 'secondary', config.cancelar || 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', () => fechar(null));
      acoes.appendChild(cancelar);
      dialog.appendChild(acoes);

      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) fechar(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      (opcoes.querySelector('button') || cancelar).focus();
    });
  }

  // Pergunta um texto curto — o equivalente ao window.prompt, com o aspeto da
  // app. Devolve null se cancelar, a string escrita se confirmar.
  function pedirTexto(config) {
    if (aberta) aberta();

    return new Promise(resolve => {
      const overlay = el('div', 'deco-copy-overlay');
      const dialog = el('div', 'deco-copy-dialog deco-fase-dialog');
      overlay.appendChild(dialog);

      dialog.appendChild(el('h2', null, config.titulo || 'Escrever'));
      if (config.mensagem) dialog.appendChild(el('p', 'deco-help', config.mensagem));

      const label = el('label', 'input-label deco-dialog__campo', config.etiqueta || '');
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      if (config.placeholder) input.placeholder = config.placeholder;
      input.value = config.valor || '';
      label.appendChild(input);
      dialog.appendChild(label);

      let terminado = false;
      const onKey = event => {
        if (event.key === 'Escape') fechar(null);
      };
      const fechar = valor => {
        if (terminado) return;
        terminado = true;
        aberta = null;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(valor);
      };
      aberta = () => fechar(null);

      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        fechar(input.value);
      });

      const acoes = el('div', 'deco-copy-actions');
      const cancelar = el('button', 'secondary', config.cancelar || 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', () => fechar(null));
      const confirmar = el('button', 'primary', config.confirmar || 'Aplicar');
      confirmar.type = 'button';
      confirmar.addEventListener('click', () => fechar(input.value));
      acoes.appendChild(cancelar);
      acoes.appendChild(confirmar);
      dialog.appendChild(acoes);

      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) fechar(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      input.focus();
      input.select();
    });
  }

  async function confirmar(config) {
    const valor = await escolher({
      titulo: config.titulo,
      mensagem: config.mensagem,
      cancelar: config.cancelar,
      opcoes: [{
        etiqueta: config.confirmar || 'Confirmar',
        valor: true,
        destaque: true,
        perigo: !!config.perigo
      }]
    });
    return valor === true;
  }

  return { confirmar, escolher, pedirTexto };
})();
