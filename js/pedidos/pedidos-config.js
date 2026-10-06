// Configurações: por agora só o texto do email ao cliente.
//
// É de propósito a única coisa editável. Os objetivos, o horário e os
// motivos mexem nos indicadores e ficam onde as alterações são versionadas
// (migrations); o texto de um email não estraga nada e muda com frequência.
const PedidosConfig = (() => {
  const U = PedidosUtil;
  const el = U.el;
  const VARIAVEIS = [
    ['{{cliente}}', 'nome do cliente'],
    ['{{referencia}}', 'referência do cliente'],
    ['{{data_envio}}', 'data em que o preço foi enviado'],
    ['{{gp}}', 'nome da gestora de produto']
  ];

  let raiz = null;

  async function abrir() {
    raiz = document.getElementById('pedidosConfig');
    if (!raiz) return;
    raiz.innerHTML = '';

    let modelo = PedidosAlertas.MODELO_ORIGINAL;
    try {
      const config = await PedidosStorage.config();
      if (config.email_template && config.email_template.corpo) modelo = config.email_template;
    } catch (erro) { /* mostra o original */ }

    const caixa = el('section', 'pp-config');
    caixa.appendChild(el('h3', null, 'Email ao cliente'));
    caixa.appendChild(el('p', 'pp-config__ajuda',
      'Este é o texto de partida do email que se prepara a partir de um pedido sem resposta. '
      + 'Antes de abrir no Outlook ainda se pode mexer nele.'));

    const lista = el('div', 'pp-config__vars');
    VARIAVEIS.forEach(([nome, desc]) => {
      const v = el('span', 'pp-config__var');
      v.appendChild(el('code', null, nome));
      v.appendChild(document.createTextNode(' ' + desc));
      lista.appendChild(v);
    });
    caixa.appendChild(lista);

    const assunto = el('input', 'pp-email__assunto');
    assunto.type = 'text';
    assunto.id = 'ppCfgAssunto';
    assunto.value = modelo.assunto;
    const corpo = el('textarea', 'pp-email__corpo');
    corpo.id = 'ppCfgCorpo';
    corpo.rows = 12;
    corpo.value = modelo.corpo;
    const l1 = el('label', 'pp-email__rotulo', 'Assunto');
    l1.htmlFor = 'ppCfgAssunto';
    const l2 = el('label', 'pp-email__rotulo', 'Texto');
    l2.htmlFor = 'ppCfgCorpo';
    caixa.appendChild(l1);
    caixa.appendChild(assunto);
    caixa.appendChild(l2);
    caixa.appendChild(corpo);

    const erro = el('p', 'pp-erro hidden');
    erro.setAttribute('role', 'alert');
    caixa.appendChild(erro);

    const botoes = el('div', 'pp-email__botoes');
    const repor = el('button', 'secondary', 'Repor original');
    repor.type = 'button';
    repor.addEventListener('click', () => {
      assunto.value = PedidosAlertas.MODELO_ORIGINAL.assunto;
      corpo.value = PedidosAlertas.MODELO_ORIGINAL.corpo;
    });
    const guardar = el('button', 'primary', 'Guardar');
    guardar.type = 'button';
    guardar.addEventListener('click', async () => {
      erro.classList.add('hidden');
      if (!assunto.value.trim() || !corpo.value.trim()) {
        erro.textContent = 'O assunto e o texto não podem ficar vazios.';
        erro.classList.remove('hidden');
        return;
      }
      guardar.disabled = true;
      try {
        await PedidosStorage.guardarTemplate(assunto.value.trim(), corpo.value);
        PedidosToast.ok('Texto do email guardado.');
      } catch (falha) {
        erro.textContent = falha.message;
        erro.classList.remove('hidden');
      }
      guardar.disabled = false;
    });
    botoes.appendChild(repor);
    botoes.appendChild(guardar);
    caixa.appendChild(botoes);
    raiz.appendChild(caixa);
  }

  return { abrir };
})();
