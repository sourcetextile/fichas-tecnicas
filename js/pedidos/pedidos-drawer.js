// A gaveta de detalhe de um pedido: linha temporal completa, o tempo desta
// etapa e a correção de datas.
//
// É uma gaveta e não um modal de propósito. Um modal tapa o quadro, e quem
// está a olhar para o histórico de um pedido quer, quase sempre, comparar
// com o do vizinho: com a gaveta aberta o quadro continua à vista e
// clicar noutro cartão troca o pedido mostrado. Corrigir uma data faz-se
// no próprio passo, sem abrir uma segunda janela por cima.
const PedidosDrawer = (() => {
  const U = PedidosUtil;
  const el = U.el;

  let raiz = null;
  let fundo = null;
  let cartao = null;        // o pedido aberto, com os dados do quadro
  let historico = [];       // o último histórico carregado
  let assinatura = '';
  let versao = 0;           // descarta respostas antigas se se trocar de pedido a meio
  let focoAnterior = null;
  const nota = { id: null, original: '', ta: null, estado: null };

  const assinar = c => [c.estado, c.ronda_atual, c.etapa_desde, c.gp_email,
    c.ref_cliente, c.cliente_nome, c.resultado].join('|');

  function iniciar() {
    raiz = document.getElementById('pedidosDrawer');
    fundo = document.getElementById('pedidosDrawerFundo');
    if (!raiz || !fundo) return;
    fundo.addEventListener('click', () => fechar());
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !cartao) return;
      // Esc fecha primeiro o que estiver por cima: janela, ou o editor de data.
      if (document.querySelector('.deco-copy-overlay')) return;
      const editor = raiz.querySelector('.pp-editor-data');
      if (editor) { editor.remove(); return; }
      fechar();
    });
  }

  function marcarNoQuadro() {
    document.querySelectorAll('.pp-card').forEach(no =>
      no.classList.toggle('is-aberto', !!cartao && no.dataset.id === cartao.id));
  }

  function abrir(novo, opcoes) {
    if (!raiz) return;
    focoAnterior = document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('pp-card') ? document.activeElement : null;
    guardarNota();
    cartao = novo;
    assinatura = assinar(novo);
    raiz.classList.remove('hidden');
    fundo.classList.remove('hidden');
    document.body.classList.add('pp-gaveta-aberta');
    marcarNoQuadro();
    desenhar().then(() => {
      // Aberta pelo teclado: o foco vai para a gaveta; pelo rato, não se rouba.
      if (opcoes && opcoes.foco) {
        const alvo = raiz.querySelector('[data-foco]');
        if (alvo) alvo.focus();
      }
    });
  }

  function fechar() {
    if (!raiz) return;
    const id = cartao && cartao.id;
    guardarNota();
    cartao = null;
    versao += 1;
    raiz.classList.add('hidden');
    fundo.classList.add('hidden');
    raiz.innerHTML = '';
    document.body.classList.remove('pp-gaveta-aberta');
    marcarNoQuadro();
    if (focoAnterior && id) {
      const volta = document.querySelector(`.pp-card[data-id="${id}"]`);
      if (volta) volta.focus({ preventScroll: true });
    }
    focoAnterior = null;
  }

  // O quadro chama isto a seguir a cada leitura: se o pedido aberto mudou
  // (alguém o moveu noutro computador), a gaveta acompanha.
  function sincronizar(lista) {
    if (!cartao) return;
    const novo = lista.find(c => c.id === cartao.id);
    if (!novo) return;   // pode vir do dashboard: fora do quadro, continua aberto
    const mudou = assinar(novo) !== assinatura;
    cartao = novo;
    assinatura = assinar(novo);
    if (mudou) desenhar();
    else atualizarAgora();
    marcarNoQuadro();
  }

  // -------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------
  function botaoIcone(texto, rotulo, aoClicar, foco) {
    const b = el('button', 'pp-icone', texto);
    b.type = 'button';
    b.title = rotulo;
    b.setAttribute('aria-label', rotulo);
    if (foco) b.setAttribute('data-foco', '');
    b.addEventListener('click', aoClicar);
    return b;
  }

  function cabecalho() {
    const cab = el('header', 'pp-gaveta__cab');

    const titulo = el('div', 'pp-gaveta__titulo');
    titulo.appendChild(el('div', 'pp-gaveta__cliente', cartao.cliente_nome));
    titulo.appendChild(el('div', 'pp-gaveta__ref', cartao.ref_cliente));
    cab.appendChild(titulo);

    const acoes = el('div', 'pp-gaveta__topo-acoes');
    if (U.pode(cartao, 'mexer')) {
      acoes.appendChild(botaoIcone('✎', 'Editar cliente, referência ou GP', editarPedido));
    }
    acoes.appendChild(botaoIcone('✕', 'Fechar (Esc)', () => fechar(), true));
    cab.appendChild(acoes);

    const meta = el('div', 'pp-gaveta__meta');
    meta.appendChild(U.avatar(cartao.gp_email, cartao.gp_nome));
    meta.appendChild(el('span', null,
      (cartao.gp_nome || cartao.gp_email || 'Sem GP') + ' · recebido a ' + U.dataHora(cartao.recebido_em)));
    cab.appendChild(meta);

    const etiquetas = el('div', 'pp-gaveta__etiquetas');
    if (cartao.ronda_atual > 1) etiquetas.appendChild(el('span', 'pp-etiqueta is-ronda', 'Ronda ' + cartao.ronda_atual));
    if (cartao.sem_resposta) etiquetas.appendChild(el('span', 'pp-etiqueta is-alerta', 'Sem resposta'));
    if (!cartao.precisa_malhas) etiquetas.appendChild(el('span', 'pp-etiqueta', 'Malhas: não aplicável'));
    if (etiquetas.childNodes.length) cab.appendChild(etiquetas);
    return cab;
  }

  function blocoAgora() {
    const bloco = el('section', 'pp-agora');
    bloco.setAttribute('data-agora', '');
    preencherAgora(bloco);
    return bloco;
  }

  function preencherAgora(bloco) {
    bloco.innerHTML = '';
    bloco.className = 'pp-agora' + (cartao.semaforo ? ' is-' + cartao.semaforo : '');

    const linha = el('div', 'pp-agora__linha');
    const ponto = el('span', 'pp-ponto');
    ponto.style.setProperty('--c', 'var(--pp-' + cartao.estado + ')');
    linha.appendChild(ponto);
    linha.appendChild(el('b', null, U.NOME_ESTADO[cartao.estado] || cartao.estado));
    if (cartao.responsavel) linha.appendChild(el('span', 'pp-agora__resp', 'Responsável: ' + cartao.responsavel));
    bloco.appendChild(linha);

    if (cartao.estado === 'fechado') {
      bloco.appendChild(el('div', 'pp-agora__resultado', U.RESULTADO[cartao.resultado] || 'Fechado'));
      if (cartao.motivo) {
        bloco.appendChild(el('div', 'pp-agora__nota',
          'Motivo: ' + cartao.motivo + (cartao.motivo_descricao ? ' - ' + cartao.motivo_descricao : '')));
      }
      bloco.appendChild(el('div', 'pp-agora__nota', 'Fechado a ' + U.dataHora(cartao.fechado_em)));
    } else {
      const tempo = el('div', 'pp-agora__tempo');
      tempo.appendChild(U.bolaTempo(cartao, true));
      const texto = el('div', 'pp-agora__texto');
      texto.appendChild(el('b', null, 'Tempo nesta etapa'));
      texto.appendChild(el('span', null, 'Objetivo ' + U.numero(cartao.objetivo)));
      tempo.appendChild(texto);
      bloco.appendChild(tempo);
      // As ações do pedido só aparecem aqui: o cartão do quadro fica limpo.
      bloco.appendChild(PedidosKanban.acoesDoPedido(cartao));
      if (cartao.estado === 'aguarda_cliente' && cartao.sem_resposta && U.pode(cartao, 'mexer')) {
        const email = el('button', 'pp-mini pp-email-botao', 'Preparar email ao cliente');
        email.type = 'button';
        email.addEventListener('click', () => PedidosAlertas.prepararEmail(cartao));
        bloco.appendChild(email);
      }
    }
  }

  function atualizarAgora() {
    const bloco = raiz && raiz.querySelector('[data-agora]');
    if (bloco) preencherAgora(bloco);
  }

  // Uma nota curta e livre sobre o pedido ("cliente pediu para esperar pela
  // amostra"). Grava-se ao sair do campo, sem botão: é a única coisa da
  // gaveta que se escreve, e não pode dar trabalho.
  async function guardarNota() {
    if (!nota.ta) return;
    const texto = nota.ta.value.trim();
    if (texto === nota.original) return;
    const id = nota.id;
    const estado = nota.estado;
    nota.original = texto;
    try {
      await PedidosStorage.guardarNota(id, texto);
      if (estado) estado.textContent = 'Guardado';
    } catch (erro) {
      nota.original = null;
      PedidosToast.erro('Não foi possível guardar a nota. ' + erro.message);
    }
  }

  function blocoNota() {
    const seccao = el('section', 'pp-nota');
    const cab = el('div', 'pp-nota__cab');
    const rotulo = el('label', 'pp-gaveta__subtitulo', 'Nota');
    rotulo.htmlFor = 'ppNota';
    cab.appendChild(rotulo);
    const estado = el('span', 'pp-nota__estado');
    estado.setAttribute('aria-live', 'polite');
    cab.appendChild(estado);
    seccao.appendChild(cab);

    const ta = el('textarea', 'pp-nota__campo');
    ta.id = 'ppNota';
    ta.rows = 2;
    ta.maxLength = 500;
    const edita = U.pode(cartao, 'mexer');
    ta.readOnly = !edita;
    ta.placeholder = edita ? 'Ex.: o cliente pediu para esperar pela amostra' : '';
    seccao.appendChild(ta);

    const id = cartao.id;
    nota.id = id;
    nota.original = '';
    nota.ta = ta;
    nota.estado = estado;
    ta.addEventListener('input', () => { estado.textContent = ''; });
    ta.addEventListener('blur', guardarNota);

    PedidosStorage.obterNota(id).then(valor => {
      if (nota.id !== id || ta.value) return;
      ta.value = valor || '';
      nota.original = (valor || '').trim();
      // Quem só lê não precisa de um campo vazio.
      if (!edita && !nota.original) seccao.classList.add('hidden');
    }).catch(() => {});
    return seccao;
  }

  function rodape() {
    const pe = el('footer', 'pp-gaveta__rodape');
    if (!U.pode(cartao, 'mexer')) return pe;
    const desfazer = el('button', 'secondary', '↶ Desfazer último movimento');
    desfazer.type = 'button';
    desfazer.setAttribute('data-desfazer', '');
    desfazer.disabled = true;
    desfazer.addEventListener('click', () => PedidosKanban.desfazerId(cartao.id));
    pe.appendChild(desfazer);
    return pe;
  }

  function atualizarRodape() {
    const b = raiz && raiz.querySelector('[data-desfazer]');
    if (!b) return;
    // Há o que desfazer se existir pelo menos um movimento além da receção.
    b.disabled = historico.filter(p => !p.anulada_em).length < 2;
  }

  async function desenhar() {
    const minha = ++versao;
    guardarNota();
    raiz.innerHTML = '';
    raiz.appendChild(cabecalho());

    const corpo = el('div', 'pp-gaveta__corpo');
    corpo.appendChild(blocoAgora());
    corpo.appendChild(blocoNota());
    corpo.appendChild(el('h3', 'pp-gaveta__subtitulo', 'Histórico'));
    const linha = el('div', 'pp-timeline');
    linha.appendChild(el('p', 'pp-gaveta__nota', 'A carregar o histórico...'));
    corpo.appendChild(linha);
    raiz.appendChild(corpo);
    raiz.appendChild(rodape());

    try {
      const passos = await PedidosStorage.historico(cartao.id);
      if (minha !== versao || !cartao) return;
      historico = passos;
    } catch (erro) {
      if (minha !== versao) return;
      linha.innerHTML = '';
      linha.appendChild(el('p', 'pp-erro', 'Não foi possível carregar o histórico. ' + erro.message));
      return;
    }
    desenharTimeline(linha);
    atualizarRodape();
  }

  function tituloDoPasso(passo) {
    const det = passo.detalhe || {};
    const nome = U.NOME_ESTADO;
    if (passo.estado_origem === null) {
      if (det.acao === 'negociacao') {
        return { texto: 'Cliente pediu negociação', sub: `Ronda ${passo.ronda}, volta a ${nome[passo.estado_destino]}` };
      }
      return { texto: 'Pedido recebido', sub: 'Entra em ' + nome[passo.estado_destino] };
    }
    if (passo.estado_destino === 'fechado') {
      return { texto: 'Pedido fechado', sub: U.RESULTADO[det.resultado] || '' };
    }
    if (det.acao === 'saltar_malhas') {
      return { texto: 'Malhas saltadas', sub: `${nome[passo.estado_origem]} → ${nome[passo.estado_destino]}` };
    }
    return { texto: `${nome[passo.estado_origem]} → ${nome[passo.estado_destino]}`, sub: '' };
  }

  const NOME_ORIGEM = {
    app: 'na aplicação', kanban: 'a arrastar o cartão', botao: 'no botão do cartão',
    desfazer: 'ao desfazer', seed: 'dados de demonstração'
  };

  function desenharTimeline(container) {
    container.innerHTML = '';
    const rondas = Math.max.apply(null, historico.map(p => p.ronda).concat([1]));
    let rondaAtual = 0;
    let anteriorValido = null;

    historico.forEach(passo => {
      if (passo.ronda !== rondaAtual) {
        rondaAtual = passo.ronda;
        if (rondas > 1) container.appendChild(el('div', 'pp-ronda', 'Ronda ' + rondaAtual));
      }
      container.appendChild(linhaDoPasso(passo, anteriorValido));
      if (!passo.anulada_em) anteriorValido = passo;
    });
  }

  function linhaDoPasso(passo, anteriorValido) {
    const linha = el('div', 'pp-passo' + (passo.anulada_em ? ' is-anulado' : ''));

    const ponto = el('span', 'pp-ponto');
    ponto.style.setProperty('--c', 'var(--pp-' + passo.estado_destino + ')');
    linha.appendChild(ponto);

    const corpo = el('div', 'pp-passo__corpo');
    const titulo = tituloDoPasso(passo);
    corpo.appendChild(el('div', 'pp-passo__titulo', titulo.texto));
    if (titulo.sub) corpo.appendChild(el('div', 'pp-passo__sub', titulo.sub));

    const data = el('div', 'pp-passo__data');
    data.appendChild(el('span', null, U.dataHora(passo.ocorrido_em)));
    if (!passo.anulada_em && U.pode(cartao, 'mexer')) {
      const lapis = el('button', 'pp-icone-mini', '✎');
      lapis.type = 'button';
      lapis.title = 'Corrigir a data deste passo';
      lapis.setAttribute('aria-label', 'Corrigir a data deste passo');
      lapis.addEventListener('click', () => abrirEditorData(passo, corpo));
      data.appendChild(lapis);
    }
    corpo.appendChild(data);

    const meta = [];
    if (passo.utilizador_email) meta.push(passo.utilizador_email);
    if (passo.origem && NOME_ORIGEM[passo.origem]) meta.push(NOME_ORIGEM[passo.origem]);
    if (meta.length) corpo.appendChild(el('div', 'pp-passo__meta', meta.join(' · ')));

    const chips = el('div', 'pp-passo__chips');
    if (!passo.anulada_em && anteriorValido && passo.dias_uteis !== null && passo.dias_uteis !== undefined) {
      chips.appendChild(el('span', 'pp-chip',
        'Esteve ' + U.numero(passo.dias_uteis) + ' em ' + U.NOME_ESTADO[anteriorValido.estado_destino]));
    }
    if (Number(passo.n_correcoes) > 0) {
      chips.appendChild(el('span', 'pp-chip is-corrigido', 'Data corrigida ' + passo.n_correcoes + 'x'));
    }
    if (passo.anulada_em) {
      chips.appendChild(el('span', 'pp-chip is-corrigido',
        'Desfeito a ' + U.dataHora(passo.anulada_em) + (passo.anulada_por ? ' por ' + passo.anulada_por : '')));
    }
    if (chips.childNodes.length) corpo.appendChild(chips);

    linha.appendChild(corpo);
    return linha;
  }

  // -------------------------------------------------------------------
  // Corrigir uma data, no próprio passo
  // -------------------------------------------------------------------
  async function abrirEditorData(passo, corpo) {
    if (corpo.querySelector('.pp-editor-data')) return;

    let limites = {};
    try {
      limites = ((await PedidosStorage.limitesCorrecao(passo.id)) || [])[0] || {};
    } catch (erro) { /* sem limites conhecidos: a base de dados valida na mesma */ }

    const agora = new Date();
    const maximo = limites.maximo && new Date(limites.maximo) < agora ? new Date(limites.maximo) : agora;

    const editor = el('div', 'pp-editor-data');
    const campo = document.createElement('input');
    campo.type = 'datetime-local';
    campo.value = U.paraInput(passo.ocorrido_em);
    if (limites.minimo) campo.min = U.paraInput(limites.minimo);
    campo.max = U.paraInput(maximo);
    campo.setAttribute('aria-label', 'Quando aconteceu');
    editor.appendChild(campo);

    const dica = [];
    if (limites.minimo) dica.push('depois de ' + U.dataHora(limites.minimo));
    dica.push(limites.maximo && new Date(limites.maximo) < agora
      ? 'antes de ' + U.dataHora(limites.maximo) : 'até agora');
    editor.appendChild(el('p', 'pp-editor-data__dica', 'Tem de ficar ' + dica.join(' e ') + '.'));

    const botoes = el('div', 'pp-editor-data__botoes');
    const cancelar = el('button', 'secondary', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', () => editor.remove());
    const guardar = el('button', 'primary', 'Guardar correção');
    guardar.type = 'button';
    botoes.appendChild(cancelar);
    botoes.appendChild(guardar);
    editor.appendChild(botoes);

    const erro = el('p', 'pp-erro hidden');
    erro.setAttribute('role', 'alert');
    editor.appendChild(erro);

    async function gravar() {
      if (!campo.value) {
        erro.textContent = 'Escolhe a data e a hora.';
        erro.classList.remove('hidden');
        return;
      }
      guardar.disabled = true;
      erro.classList.add('hidden');
      try {
        await PedidosStorage.corrigirData(passo.id, new Date(campo.value).toISOString());
        PedidosToast.ok('Data corrigida. A correção ficou registada.');
        await PedidosKanban.recarregar();
        if (cartao) await desenhar();
      } catch (falha) {
        erro.textContent = falha.message;
        erro.classList.remove('hidden');
        guardar.disabled = false;
      }
    }
    guardar.addEventListener('click', gravar);
    campo.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); gravar(); }
    });

    corpo.appendChild(editor);
    campo.focus();
  }

  // -------------------------------------------------------------------
  // Editar / apagar
  // -------------------------------------------------------------------
  function editarPedido() {
    if (!cartao) return;
    // Só se pode apagar um pedido que nunca teve um único movimento.
    const podeApagar = historico.length === 1 && !(Number(historico[0].n_correcoes) > 0);
    PedidosModal.abrirEditar(cartao, {
      podeApagar,
      aoConcluir: async () => {
        await PedidosKanban.recarregar();
        PedidosToast.ok('Pedido atualizado.');
      },
      aoApagar: async apagado => {
        fechar();
        await PedidosKanban.recarregar();
        PedidosToast.ok(`Pedido ${apagado.ref_cliente} apagado.`);
      }
    });
  }

  return { iniciar, abrir, fechar, sincronizar, get idAberto() { return cartao ? cartao.id : null; } };
})();
