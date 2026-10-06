// Alertas de hoje: o sino, o painel e o email para o cliente.
//
// Os alertas são gerados na base de dados (pg_cron, ver migration 0009). Aqui
// só se lêem: o sino mostra quantos são para a pessoa que está ligada e ainda
// não viu, o painel lista todos os de hoje e os cartões a que dizem respeito
// ficam com uma marca discreta no quadro.
//
// O email ao cliente é preparado, não enviado: a pessoa abre-o no Outlook ou
// copia o texto. O assunto e o corpo vêm do modelo em Configurações.
const PedidosAlertas = (() => {
  const U = PedidosUtil;
  const el = U.el;

  const MODELO_ORIGINAL = {
    assunto: 'Proposta de preço {{referencia}} - {{cliente}}',
    corpo: [
      'Bom dia,',
      '',
      'No dia {{data_envio}} enviámos a proposta de preço para a referência {{referencia}}.',
      '',
      'Gostaríamos de saber se há alguma questão que possamos esclarecer e se já é possível contar com a vossa decisão.',
      '',
      'Ficamos ao dispor.',
      '',
      'Com os melhores cumprimentos,',
      '{{gp}}'
    ].join('\n')
  };

  const TITULO = {
    malhas_2: 'Preço de malhas por enviar',
    malhas_4: 'Malhas ainda sem preço',
    cliente_5: 'Cliente sem resposta'
  };
  const ENVIO = {
    pendente: 'Email por enviar',
    enviado: 'Email enviado',
    erro: 'Falhou o email',
    suprimido: 'Email desligado'
  };

  let alertas = [];
  let painel = null;
  let sino = null;
  let numero = null;
  let idsMeus = new Set();

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------
  async function carregar() {
    try {
      alertas = (await PedidosStorage.alertasHoje()) || [];
    } catch (erro) {
      alertas = [];
    }
    idsMeus = new Set(alertas.filter(a => a.minha).map(a => a.pedido_id));
    pintarSino();
    if (painel && !painel.classList.contains('hidden')) desenharPainel();
    return alertas;
  }

  const porLer = () => alertas.filter(a => a.minha && !a.lida).length;
  const temAlerta = pedidoId => idsMeus.has(pedidoId);

  function pintarSino() {
    if (!sino) return;
    const n = porLer();
    numero.textContent = String(n);
    numero.classList.toggle('hidden', n === 0);
    sino.title = n ? n + ' alerta' + (n > 1 ? 's' : '') + ' por ver' : 'Alertas de hoje';
    sino.setAttribute('aria-label', sino.title);
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------
  function abrirPedido(a) {
    const cartao = PedidosKanban.cartaoPorId(a.pedido_id);
    if (!cartao) {
      PedidosToast.erro('Este pedido já não está no quadro.');
      return;
    }
    PedidosDrawer.abrir(cartao);
  }

  function linhaAlerta(a) {
    const linha = el('div', 'pp-alerta' + (a.minha && !a.lida ? ' is-nova' : ''));
    linha.dataset.id = a.id;

    const texto = el('button', 'pp-alerta__texto');
    texto.type = 'button';
    texto.appendChild(el('b', null, TITULO[a.tipo] || a.tipo));
    texto.appendChild(el('span', null, a.cliente_nome + ' · ' + a.ref_cliente));
    texto.appendChild(el('small', null,
      'Para ' + (a.destinatario_nome || a.destinatario_email || 'sem email')
      + (a.minha ? ' (tu)' : '')));
    texto.addEventListener('click', () => { fechar(); abrirPedido(a); });
    linha.appendChild(texto);

    const lado = el('div', 'pp-alerta__lado');
    const envio = el('span', 'pp-etiqueta is-envio-' + a.estado_envio, ENVIO[a.estado_envio] || a.estado_envio);
    if (a.erro_envio) envio.title = a.erro_envio;
    lado.appendChild(envio);

    if (a.tipo === 'cliente_5' && U.pode(PedidosKanban.cartaoPorId(a.pedido_id), 'mexer')) {
      const b = el('button', 'pp-mini', 'Preparar email');
      b.type = 'button';
      b.addEventListener('click', () => {
        const c = PedidosKanban.cartaoPorId(a.pedido_id);
        if (c) { fechar(); prepararEmail(c); }
        else PedidosToast.erro('Este pedido já não está no quadro.');
      });
      lado.appendChild(b);
    }
    linha.appendChild(lado);
    return linha;
  }

  function desenharPainel() {
    painel.innerHTML = '';
    const cab = el('header', 'pp-alertas__cab');
    cab.appendChild(el('h3', null, 'Alertas de hoje'));
    const x = el('button', 'pp-icone', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Fechar');
    x.addEventListener('click', fechar);
    cab.appendChild(x);
    painel.appendChild(cab);

    if (!alertas.length) {
      painel.appendChild(el('p', 'pp-alertas__vazio', 'Sem alertas hoje.'));
      return;
    }
    const minhas = alertas.filter(a => a.minha);
    const outras = alertas.filter(a => !a.minha);
    const grupo = (titulo, lista) => {
      if (!lista.length) return;
      painel.appendChild(el('h4', 'pp-alertas__grupo', titulo));
      lista.forEach(a => painel.appendChild(linhaAlerta(a)));
    };
    grupo('Para ti', minhas);
    grupo(minhas.length ? 'Para as outras pessoas' : 'Hoje', outras);
  }

  async function abrir() {
    if (!painel) return;
    painel.classList.remove('hidden');
    sino.setAttribute('aria-expanded', 'true');
    await carregar();
    desenharPainel();
    // Abrir o painel conta como ver: o número do sino volta a zero.
    if (porLer() > 0) {
      try {
        await PedidosStorage.marcarLidas();
        alertas.forEach(a => { if (a.minha) a.lida = true; });
        pintarSino();
      } catch (erro) { /* fica por ler; volta a tentar na próxima vez */ }
    }
  }

  function fechar() {
    if (!painel) return;
    painel.classList.add('hidden');
    sino.setAttribute('aria-expanded', 'false');
  }

  function alternar() {
    if (painel.classList.contains('hidden')) abrir(); else fechar();
  }

  // -------------------------------------------------------------------
  // Email ao cliente
  // -------------------------------------------------------------------
  function preencher(modelo, valores) {
    return String(modelo || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (todo, chave) =>
      (valores[chave] !== undefined ? valores[chave] : todo));
  }

  async function dataDoEnvio(cartao) {
    try {
      const passos = await PedidosStorage.historico(cartao.id);
      const envios = passos.filter(p => !p.anulada_em && p.estado_destino === 'aguarda_cliente');
      if (envios.length) return envios[envios.length - 1].ocorrido_em;
    } catch (erro) { /* usa a data em que a etapa começou */ }
    return cartao.etapa_desde;
  }

  async function prepararEmail(cartao) {
    let modelo = MODELO_ORIGINAL;
    try {
      const config = await PedidosStorage.config();
      if (config.email_template && config.email_template.corpo) modelo = config.email_template;
    } catch (erro) { /* fica o modelo original */ }

    const quando = await dataDoEnvio(cartao);
    const valores = {
      cliente: cartao.cliente_nome,
      referencia: cartao.ref_cliente,
      data_envio: quando ? new Date(quando).toLocaleDateString('pt-PT') : '',
      gp: cartao.gp_nome || ''
    };

    const { dialog, fechar: fecharJanela } = PedidosModal.moldura(
      'Email ao cliente',
      'Revê o texto e abre-o no Outlook. O endereço do cliente escolhes tu.',
      { largo: true });

    const assunto = el('input', 'pp-email__assunto');
    assunto.type = 'text';
    assunto.value = preencher(modelo.assunto, valores);
    assunto.setAttribute('aria-label', 'Assunto');
    const corpo = el('textarea', 'pp-email__corpo');
    corpo.rows = 12;
    corpo.value = preencher(modelo.corpo, valores);
    corpo.setAttribute('aria-label', 'Texto do email');

    dialog.appendChild(el('label', 'pp-email__rotulo', 'Assunto'));
    dialog.appendChild(assunto);
    dialog.appendChild(el('label', 'pp-email__rotulo', 'Texto'));
    dialog.appendChild(corpo);

    const botoes = el('div', 'pp-email__botoes');
    const cancelar = el('button', 'secondary', 'Fechar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', fecharJanela);

    const copiar = el('button', 'secondary', 'Copiar');
    copiar.type = 'button';
    copiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(assunto.value + '\n\n' + corpo.value);
        PedidosToast.ok('Copiado.');
      } catch (erro) {
        corpo.select();
        PedidosToast.erro('Não foi possível copiar. O texto ficou selecionado: Ctrl+C.');
      }
    });

    const outlook = el('a', 'pp-botao-link primary', 'Abrir no Outlook');
    const atualizarLink = () => {
      outlook.href = 'mailto:?subject=' + encodeURIComponent(assunto.value)
        + '&body=' + encodeURIComponent(corpo.value);
    };
    atualizarLink();
    assunto.addEventListener('input', atualizarLink);
    corpo.addEventListener('input', atualizarLink);

    botoes.appendChild(cancelar);
    botoes.appendChild(copiar);
    botoes.appendChild(outlook);
    dialog.appendChild(botoes);
    corpo.focus();
  }

  // -------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------
  function iniciar() {
    sino = document.getElementById('pedidosSino');
    numero = document.getElementById('pedidosSinoNumero');
    painel = document.getElementById('pedidosAlertas');
    if (!sino || !painel) return;
    sino.addEventListener('click', event => { event.stopPropagation(); alternar(); });
    painel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => fechar());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !painel.classList.contains('hidden')) fechar();
    });
    carregar();
  }

  return { iniciar, carregar, temAlerta, prepararEmail, MODELO_ORIGINAL, preencher };
})();
