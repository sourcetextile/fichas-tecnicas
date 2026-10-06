// O quadro dos Pedidos de Preço.
//
// Pensado para responder, de relance, a três perguntas: o que está parado,
// com quem, e há quanto tempo. Por isso:
//   - cada coluna ordena por urgência (o mais atrasado no topo), e é isso
//     que se vê primeiro sem mexer em nada;
//   - o cartão é compacto (cliente, referência, GP, barra de tempo e a
//     ação seguinte), para caberem muitos no mesmo ecrã;
//   - cada coluna tem o seu scroll e o cabeçalho fica sempre à vista;
//   - arrastar um cartão e carregar no botão fazem exatamente o mesmo.
//
// Os dias úteis e o semáforo vêm calculados da base de dados: recalcular
// aqui seria ter duas versões da mesma regra. Depois de cada ação o quadro
// mostra logo o resultado (otimista) e confirma com uma leitura ao servidor.
const PedidosKanban = (() => {
  const U = PedidosUtil;
  const el = U.el;

  const COLUNAS = [
    { estado: 'malhas', titulo: 'Aprov. Malhas', responsavel: 'Aprovisionamento',
      vazio: 'Nenhum pedido à espera de preço de malhas.' },
    { estado: 'orcamentacao', titulo: 'Orçamentação', responsavel: 'GP',
      vazio: 'Nenhum orçamento por preparar.' },
    { estado: 'aguarda_cliente', titulo: 'Aguarda Cliente', responsavel: 'Cliente',
      vazio: 'Nenhuma resposta de cliente em falta.' },
    { estado: 'fechado', titulo: 'Fechados', responsavel: null,
      vazio: 'Ainda não há pedidos fechados neste período.' }
  ];

  const JANELA_FECHADOS = 60;   // dias de fechados que o quadro carrega
  const LIMITE_FECHADOS = 25;   // quantos se desenham antes de "Mostrar todos"
  const ATUALIZAR_CADA = 45000; // ms entre leituras automáticas

  let raiz = null;
  let cartoes = [];
  let motivos = [];
  let objetivos = { malhas: 2, orcamentacao: 1, aguarda_cliente: 5 };
  let aoNovo = null;
  let carregado = false;
  let erroCarga = null;
  let ultimaLeitura = 0;
  let temporizador = null;

  const estadoUI = { gp: '', fechados: false, filtro: '', pesquisa: '' };
  let mostrarTodosFechados = false;
  const pilha = [];             // movimentos desfazíveis desta sessão, do mais antigo ao mais recente
  let idAArrastar = null;
  let destaque = null;          // pedido a mostrar e a piscar depois de desenhar
  let emCurso = 0;              // ações à espera da base de dados

  // -------------------------------------------------------------------
  // Regras de leitura do quadro
  // -------------------------------------------------------------------
  const razao = c => {
    const objetivo = Number(c.objetivo) || 0;
    return objetivo ? (Number(c.dias_etapa) || 0) / objetivo : 0;
  };

  // "Em atraso" é atraso da equipa: Aprov. Malhas e Orçamentação acima do
  // objetivo. O silêncio do cliente conta à parte, como "Sem resposta".
  const emAtraso = c =>
    (c.estado === 'malhas' || c.estado === 'orcamentacao') && c.semaforo === 'vermelho';

  const mesmoGp = c => !estadoUI.gp || String(c.gp_email || '').toLowerCase() === estadoUI.gp;

  // Pesquisa por cliente e por referência ao mesmo tempo, sem acentos,
  // maiúsculas nem pontuação ("cav 25" encontra CAV-2540).
  const passaPesquisa = c => {
    const t = U.normalizar(estadoUI.pesquisa);
    return !t || U.normalizar(c.cliente_nome).includes(t) || U.normalizar(c.ref_cliente).includes(t);
  };
  const passaBase = c => mesmoGp(c) && passaPesquisa(c);

  function visiveis() {
    return cartoes.filter(c => {
      if (!passaBase(c)) return false;
      if (estadoUI.filtro === 'atraso') return c.estado !== 'fechado' && emAtraso(c);
      if (estadoUI.filtro === 'sem_resposta') return c.estado !== 'fechado' && c.sem_resposta;
      return true;
    });
  }

  function ordenar(lista, estado) {
    const copia = lista.slice();
    if (estado === 'fechado') {
      return copia.sort((a, b) => new Date(b.fechado_em) - new Date(a.fechado_em));
    }
    // Em Aguarda Cliente a ordem é a de chegada: o mais recente primeiro.
    if (estado === 'aguarda_cliente') {
      return copia.sort((a, b) => new Date(b.etapa_desde) - new Date(a.etapa_desde));
    }
    // O mais atrasado primeiro; em empate, o que espera há mais tempo.
    return copia.sort((a, b) =>
      (razao(b) - razao(a)) || (new Date(a.recebido_em) - new Date(b.recebido_em)));
  }

  function calcularResumo() {
    const doGp = cartoes.filter(passaBase);
    const abertos = doGp.filter(c => c.estado !== 'fechado');
    const topo = pilha.length ? pilha[pilha.length - 1] : null;
    return {
      abertos: abertos.length,
      atraso: abertos.filter(emAtraso).length,
      semResposta: abertos.filter(c => c.sem_resposta).length,
      fechados: doGp.filter(c => c.estado === 'fechado').length,
      podeDesfazer: !!topo,
      ultimo: topo ? topo.ref : ''
    };
  }

  // -------------------------------------------------------------------
  // Ações
  //
  // correr() é o único caminho para alterar um pedido: mostra o resultado
  // já (otimista), chama a base de dados, e volta a ler o quadro. Se a
  // base de dados recusar, o quadro volta ao que era e a razão aparece.
  // -------------------------------------------------------------------
  async function correr(op) {
    if (op.otimista) {
      const c = cartoes.find(x => x.id === op.id);
      if (c) {
        op.otimista(c);
        destaque = op.id;
        desenhar();
      }
    }
    // Enquanto a ação não chega à base de dados, uma leitura automática
    // traria o estado antigo e o cartão saltaria de volta por um instante.
    emCurso += 1;
    try {
      try {
        await op.fazer();
      } catch (erro) {
        PedidosToast.erro(erro.message);
        try { await recarregar(); } catch (e) { /* o erro que interessa já foi mostrado */ }
        return false;
      }
      destaque = op.id;
      if (op.desfazivel) pilha.push({ id: op.id, ref: op.ref });
      try { await recarregar(); } catch (e) { /* mantém o que já está no ecrã */ }
      PedidosToast.ok(op.texto,
        op.desfazivel ? { rotulo: 'Desfazer', fn: () => desfazerId(op.id, op.ref) } : null);
      return true;
    } finally {
      emCurso -= 1;
    }
  }

  function aplicarMovimento(c, destino) {
    c.estado = destino;
    c.etapa_desde = new Date().toISOString();
    c.dias_etapa = 0;
    c.semaforo = 'verde';
    c.sem_resposta = false;
    c.objetivo = objetivos[destino];
    c.responsavel = U.RESPONSAVEL[destino] || null;
  }

  function mover(c, destino, origem) {
    return correr({
      id: c.id,
      ref: c.ref_cliente,
      fazer: () => PedidosStorage.mover(c.id, destino, origem),
      otimista: x => aplicarMovimento(x, destino),
      texto: `${c.ref_cliente} passou para ${U.NOME_ESTADO[destino]}.`,
      desfazivel: true
    });
  }

  function saltarMalhas(c) {
    return correr({
      id: c.id,
      ref: c.ref_cliente,
      fazer: () => PedidosStorage.saltarMalhas(c.id),
      otimista: x => { aplicarMovimento(x, 'orcamentacao'); x.precisa_malhas = false; },
      texto: `${c.ref_cliente}: malhas saltadas, passou para Orçamentação.`,
      desfazivel: true
    });
  }

  async function fechar(c, resultado) {
    let motivo = null;
    if (resultado === 'nao_converteu') {
      motivo = await PedidosModal.escolherMotivo(c, motivos);
      if (!motivo) return false;
    }
    return correr({
      id: c.id,
      ref: c.ref_cliente,
      fazer: () => PedidosStorage.fechar(
        c.id, resultado, motivo && motivo.motivoId, motivo && motivo.descricao),
      otimista: x => {
        x.estado = 'fechado';
        x.resultado = resultado;
        x.fechado_em = new Date().toISOString();
        x.dias_etapa = null;
        x.semaforo = null;
        x.objetivo = null;
        x.sem_resposta = false;
        x.responsavel = null;
      },
      texto: `${c.ref_cliente} fechado: ${U.RESULTADO[resultado]}.`,
      desfazivel: true
    });
  }

  async function pedirNegociacao(c) {
    const escolha = await DecoDialog.escolher({
      titulo: `Nova ronda do pedido ${c.ref_cliente}`,
      mensagem: 'O pedido volta ao início. O histórico da ronda ' + c.ronda_atual + ' fica guardado.',
      opcoes: [
        { etiqueta: 'Recomeçar em Aprov. Malhas', valor: 'malhas', destaque: true },
        { etiqueta: 'Saltar malhas, ir para Orçamentação', valor: 'orcamentacao' }
      ]
    });
    if (!escolha) return false;
    return correr({
      id: c.id,
      ref: c.ref_cliente,
      fazer: () => PedidosStorage.novaRonda(c.id, escolha === 'malhas'),
      otimista: x => {
        aplicarMovimento(x, escolha);
        x.ronda_atual += 1;
        x.precisa_malhas = escolha === 'malhas';
      },
      texto: `${c.ref_cliente} voltou ao início: ronda ${c.ronda_atual + 1}.`,
      desfazivel: true
    });
  }

  // Largar um cartão em "Fechados" NÃO fecha às cegas: pergunta como terminou.
  async function largar(destino, id) {
    const c = cartoes.find(x => x.id === id);
    if (!c || c.estado === destino) return;
    if (U.papel() !== 'admin' && c.estado !== 'fechado' && !alvoValido(destino)) {
      PedidosToast.erro(U.papel() === 'aprovisionamento'
        ? 'Só podes passar pedidos de Aprov. Malhas para Orçamentação.'
        : 'Só podes mexer nos pedidos que criaste.');
      return;
    }
    if (c.estado === 'fechado') {
      PedidosToast.erro('Este pedido está fechado. Para o reabrir, abre-o e usa Desfazer.');
      return;
    }
    if (destino === 'fechado') {
      if (c.estado !== 'aguarda_cliente') {
        PedidosToast.erro('Só se fecha um pedido que está em Aguarda Cliente.');
        return;
      }
      const negociou = c.ronda_atual > 1;
      const resultado = await DecoDialog.escolher({
        titulo: 'Como terminou este pedido?',
        mensagem: `${c.cliente_nome} · ${c.ref_cliente}`,
        opcoes: [
          { etiqueta: 'Converteu', valor: 'converteu', destaque: !negociou },
          { etiqueta: 'Converteu com negociação', valor: 'converteu_negociacao', destaque: negociou },
          { etiqueta: 'Não converteu', valor: 'nao_converteu' }
        ]
      });
      if (resultado) await fechar(c, resultado);
      return;
    }
    await mover(c, destino, 'kanban');
  }

  async function desfazerId(id, ref) {
    const i = pilha.map(p => p.id).lastIndexOf(id);
    const nome = ref || (i >= 0 ? pilha[i].ref : '') || (cartoes.find(x => x.id === id) || {}).ref_cliente || 'Pedido';
    if (i >= 0) pilha.splice(i, 1);
    return correr({
      id,
      ref: nome,
      fazer: () => PedidosStorage.desfazer(id),
      texto: `${nome}: movimento desfeito.`,
      desfazivel: false
    });
  }

  function desfazerUltimo() {
    const topo = pilha[pilha.length - 1];
    if (!topo) return Promise.resolve(false);
    return desfazerId(topo.id, topo.ref);
  }

  // -------------------------------------------------------------------
  // Cartão
  // -------------------------------------------------------------------
  function botoesDoCartao(c) {
    const barra = el('div', 'pp-card__acoes is-' + c.estado);
    // Só os botões que esta pessoa pode usar neste pedido.
    const mexe = U.pode(c, 'mexer');
    const avanca = U.pode(c, 'avancar_malhas');
    if (!mexe && !avanca) return barra;
    const add = (rotulo, fn, classe, dica) => {
      const b = el('button', 'pp-acao ' + classe, rotulo);
      b.type = 'button';
      if (dica) b.title = dica;
      b.addEventListener('click', event => { event.stopPropagation(); fn(); });
      barra.appendChild(b);
    };

    if (c.estado === 'malhas') {
      add('Preço de malhas enviado', () => mover(c, 'orcamentacao', 'botao'), 'is-primaria');
      if (mexe) {
        add('Saltar malhas', () => saltarMalhas(c), 'is-discreta',
          'Este pedido não precisa de consulta de malhas');
      }
    } else if (!mexe) {
      return barra;
    } else if (c.estado === 'orcamentacao') {
      add('Preço enviado ao cliente', () => mover(c, 'aguarda_cliente', 'botao'), 'is-primaria');
    } else if (c.estado === 'aguarda_cliente') {
      // Já houve negociação? Então o fecho provável é "com negociação" e é
      // esse que fica em destaque, e primeiro.
      const negociou = c.ronda_atual > 1;
      const comNeg = () => add('Converteu c/ negociação', () => fechar(c, 'converteu_negociacao'),
        'is-positiva' + (negociou ? ' is-sugerida' : ''), 'Converteu com negociação');
      const sem = () => add('Converteu', () => fechar(c, 'converteu'),
        'is-positiva' + (negociou ? '' : ' is-sugerida'));
      if (negociou) { comNeg(); sem(); } else { sem(); comNeg(); }
      add('Não converteu', () => fechar(c, 'nao_converteu'), 'is-negativa');
      add('Pediu negociação', () => pedirNegociacao(c), 'is-neutra', 'Cliente pediu negociação');
    }
    return barra;
  }

  function criarCartao(c) {
    const tom = c.estado === 'fechado'
      ? (c.resultado === 'nao_converteu' ? 'perdido' : 'ganho')
      : (c.semaforo || 'verde');
    const no = el('article', 'pp-card is-' + tom);
    no.dataset.id = c.id;
    no.tabIndex = 0;
    no.draggable = c.estado !== 'fechado' && (U.pode(c, 'mexer') || U.pode(c, 'avancar_malhas'));
    // Visualmente o responsável atual é a coluna onde o cartão está (uma
    // coluna, um responsável), por isso não se repete em 20 cartões. Quem
    // usa leitor de ecrã ouve-o aqui.
    no.setAttribute('aria-label', [
      c.cliente_nome + ', ' + c.ref_cliente,
      c.responsavel ? 'com ' + c.responsavel : U.RESULTADO[c.resultado],
      'GP ' + (c.gp_nome || c.gp_email || 'por definir'),
      c.ronda_atual > 1 ? 'ronda ' + c.ronda_atual : ''
    ].filter(Boolean).join('. '));
    if (PedidosDrawer.idAberto === c.id) no.classList.add('is-aberto');
    // Alerta de hoje para quem está ligado: uma marca discreta no cartão.
    if (PedidosAlertas.temAlerta(c.id)) {
      no.classList.add('has-alerta');
      no.title = 'Tens um alerta de hoje neste pedido';
    }

    const topo = el('div', 'pp-card__topo');
    topo.appendChild(el('span', 'pp-card__cliente', c.cliente_nome));
    if (c.estado !== 'fechado') topo.appendChild(U.bolaTempo(c));
    topo.appendChild(U.avatar(c.gp_email, c.gp_nome));
    no.appendChild(topo);

    const linhaRef = el('div', 'pp-card__linha');
    linhaRef.appendChild(el('span', 'pp-card__ref', c.ref_cliente));
    const etiquetas = el('span', 'pp-card__etiquetas');
    if (c.ronda_atual > 1) {
      const r = el('span', 'pp-etiqueta is-ronda', 'Ronda ' + c.ronda_atual);
      r.title = 'Este pedido já passou por ' + c.ronda_atual + ' rondas';
      etiquetas.appendChild(r);
    }
    if (c.sem_resposta) {
      const s = el('span', 'pp-etiqueta is-alerta', 'Sem resposta');
      s.title = 'À espera do cliente: ' + U.numero(c.dias_etapa);
      etiquetas.appendChild(s);
    }
    if (!c.precisa_malhas && c.estado !== 'fechado') {
      etiquetas.appendChild(el('span', 'pp-etiqueta', 'Malhas: não aplicável'));
    }
    linhaRef.appendChild(etiquetas);
    no.appendChild(linhaRef);

    if (c.estado === 'fechado') {
      // Tudo na mesma linha: os cartões têm todos a mesma altura.
      const res = el('span', 'pp-card__resultado is-' + tom);
      res.appendChild(el('b', null, U.RESULTADO[c.resultado] || 'Fechado'));
      if (c.motivo) res.appendChild(document.createTextNode(' · ' + c.motivo + (c.motivo_descricao ? ' - ' + c.motivo_descricao : '')));
      res.title = 'Fechado a ' + U.dataCurta(c.fechado_em);
      linhaRef.appendChild(res);
    } else if ((c.estado === 'malhas' && (U.pode(c, 'mexer') || U.pode(c, 'avancar_malhas')))
               || (c.estado === 'orcamentacao' && U.pode(c, 'mexer'))) {
      // Nestas duas colunas a ação seguinte é só uma: fica logo no cartão,
      // pequena e discreta. (Em Aguarda Cliente são quatro, na gaveta.)
      const seguinte = c.estado === 'malhas'
        ? ['Malhas enviadas', 'Preço de malhas enviado', 'orcamentacao']
        : ['Preço enviado', 'Preço enviado ao cliente', 'aguarda_cliente'];
      const b = el('button', 'pp-acao pp-card__acao', seguinte[0]);
      b.type = 'button';
      b.title = seguinte[1];
      b.addEventListener('click', event => { event.stopPropagation(); mover(c, seguinte[2], 'botao'); });
      linhaRef.appendChild(b);
    }

    const abrir = foco => PedidosDrawer.abrir(c, { foco });
    no.addEventListener('click', () => abrir(false));
    no.addEventListener('keydown', event => {
      if (event.target !== no) return;              // Enter num botão é do botão
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); abrir(true); }
    });

    no.addEventListener('dragstart', event => {
      idAArrastar = c.id;
      event.dataTransfer.setData('text/plain', c.id);
      event.dataTransfer.effectAllowed = 'move';
      no.classList.add('is-a-arrastar');
      document.body.classList.add('pp-a-arrastar');
    });
    no.addEventListener('dragend', () => {
      idAArrastar = null;
      no.classList.remove('is-a-arrastar');
      document.body.classList.remove('pp-a-arrastar');
      document.querySelectorAll('.pp-coluna.is-alvo').forEach(n => n.classList.remove('is-alvo'));
    });
    return no;
  }

  // -------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------
  function alvoValido(destino) {
    const c = cartoes.find(x => x.id === idAArrastar);
    if (!c || c.estado === destino || c.estado === 'fechado') return false;
    if (!U.pode(c, 'mexer')) {
      // A Aprovisionamento só tem um destino: de Aprov. Malhas para Orçamentação.
      return U.pode(c, 'avancar_malhas') && destino === 'orcamentacao';
    }
    if (destino === 'fechado') return c.estado === 'aguarda_cliente';
    return true;
  }

  function criarColuna(coluna, lista, totalSemFiltro) {
    const no = el('section', 'pp-coluna is-' + coluna.estado);
    no.dataset.estado = coluna.estado;
    no.setAttribute('aria-label', coluna.titulo);

    const cabeca = el('header', 'pp-coluna__cabeca');
    const linha1 = el('div', 'pp-coluna__linha');
    linha1.appendChild(el('h3', null, coluna.titulo));
    linha1.appendChild(el('span', 'pp-coluna__contagem', String(lista.length)));

    let pilula = null;
    if (coluna.estado === 'malhas' || coluna.estado === 'orcamentacao') {
      const n = lista.filter(emAtraso).length;
      if (n) pilula = n + ' em atraso';
    } else if (coluna.estado === 'aguarda_cliente') {
      const n = lista.filter(c => c.sem_resposta).length;
      if (n) pilula = n + ' sem resposta';
    }
    if (pilula) linha1.appendChild(el('span', 'pp-coluna__alerta', pilula));
    cabeca.appendChild(linha1);

    const linha2 = el('div', 'pp-coluna__sub');
    if (coluna.responsavel) linha2.appendChild(el('span', null, coluna.responsavel));
    if (coluna.estado === 'aguarda_cliente') {
      linha2.appendChild(el('span', null, 'Alerta aos ' + U.numero(objetivos.aguarda_cliente)));
    } else if (coluna.estado !== 'fechado') {
      linha2.appendChild(el('span', null, 'Objetivo ' + U.numero(objetivos[coluna.estado])));
    } else {
      linha2.appendChild(el('span', null, 'Recentes'));
    }
    cabeca.appendChild(linha2);
    no.appendChild(cabeca);

    const corpo = el('div', 'pp-coluna__corpo');
    const ordenada = ordenar(lista, coluna.estado);
    const cortar = coluna.estado === 'fechado' && !mostrarTodosFechados && ordenada.length > LIMITE_FECHADOS;
    const aDesenhar = cortar ? ordenada.slice(0, LIMITE_FECHADOS) : ordenada;

    if (!aDesenhar.length) {
      corpo.appendChild(el('p', 'pp-vazio',
        totalSemFiltro && (estadoUI.filtro || estadoUI.gp || estadoUI.pesquisa)
          ? 'Nenhum pedido com este filtro.'
          : coluna.vazio));
    }
    aDesenhar.forEach(c => corpo.appendChild(criarCartao(c)));

    if (cortar) {
      const mais = el('button', 'pp-mais', `Mostrar todos (${ordenada.length})`);
      mais.type = 'button';
      mais.addEventListener('click', () => { mostrarTodosFechados = true; desenhar(); });
      corpo.appendChild(mais);
    }
    no.appendChild(corpo);

    no.addEventListener('dragover', event => {
      if (!alvoValido(coluna.estado)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      no.classList.add('is-alvo');
    });
    no.addEventListener('dragleave', event => {
      if (!no.contains(event.relatedTarget)) no.classList.remove('is-alvo');
    });
    no.addEventListener('drop', event => {
      event.preventDefault();
      no.classList.remove('is-alvo');
      const id = event.dataTransfer.getData('text/plain') || idAArrastar;
      idAArrastar = null;
      largar(coluna.estado, id);
    });
    return no;
  }

  // -------------------------------------------------------------------
  // Desenho do quadro
  // -------------------------------------------------------------------
  function estadoVazio(titulo, texto, botao) {
    const no = el('div', 'pp-hero');
    no.appendChild(el('div', 'pp-hero__icone', '▤'));
    no.appendChild(el('h3', null, titulo));
    no.appendChild(el('p', null, texto));
    if (botao) {
      const b = el('button', 'primary', botao.rotulo);
      b.type = 'button';
      b.addEventListener('click', botao.fn);
      no.appendChild(b);
    }
    return no;
  }

  function desenhar() {
    if (!raiz) return;

    // O que a pessoa tinha (scroll de cada coluna, foco num cartão) sobrevive ao redesenho.
    const scrolls = {};
    raiz.querySelectorAll('.pp-coluna').forEach(col => {
      scrolls[col.dataset.estado] = col.querySelector('.pp-coluna__corpo').scrollTop;
    });
    const ativo = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('.pp-card') : null;
    const focoId = ativo && raiz.contains(ativo) ? ativo.dataset.id : null;

    raiz.innerHTML = '';

    if (erroCarga) {
      raiz.appendChild(estadoVazio('Não foi possível carregar os pedidos', erroCarga,
        { rotulo: 'Tentar de novo', fn: () => iniciarLeitura() }));
    } else if (!carregado) {
      raiz.appendChild(estadoVazio('A carregar os pedidos...', 'Só demora um instante.'));
    } else if (!cartoes.length) {
      raiz.appendChild(estadoVazio('Sem pedidos em aberto',
        'Cria um pedido com o botão abaixo. Cada pedido é um cliente mais uma referência.',
        aoNovo ? { rotulo: '+ Novo pedido', fn: aoNovo } : null));
    } else {
      const lista = visiveis();
      const colunas = COLUNAS.filter(c => c.estado !== 'fechado' || estadoUI.fechados);
      const grelha = el('div', 'pp-quadro');
      grelha.style.setProperty('--pp-colunas', String(colunas.length));
      colunas.forEach(coluna => {
        const daColuna = lista.filter(c => c.estado === coluna.estado);
        const semFiltro = cartoes.filter(c => c.estado === coluna.estado).length;
        grelha.appendChild(criarColuna(coluna, daColuna, semFiltro));
      });
      raiz.appendChild(grelha);
    }

    raiz.querySelectorAll('.pp-coluna').forEach(col => {
      const corpo = col.querySelector('.pp-coluna__corpo');
      corpo.scrollTop = scrolls[col.dataset.estado] || 0;
    });

    if (destaque) {
      const alvo = raiz.querySelector(`.pp-card[data-id="${destaque}"]`);
      if (alvo) {
        alvo.scrollIntoView({ block: 'nearest' });
        alvo.classList.add('is-destaque');
      }
      destaque = null;
    }
    if (focoId) {
      const voltar = raiz.querySelector(`.pp-card[data-id="${focoId}"]`);
      if (voltar) voltar.focus({ preventScroll: true });
    }

    PedidosApp.atualizarBarra(calcularResumo());
  }

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------
  async function recarregar() {
    const [dados] = await Promise.all([
      PedidosStorage.quadro(JANELA_FECHADOS),
      PedidosAlertas.carregar()
    ]);
    cartoes = dados || [];
    carregado = true;
    erroCarga = null;
    ultimaLeitura = Date.now();
    desenhar();
    PedidosDrawer.sincronizar(cartoes);
  }

  async function iniciarLeitura() {
    erroCarga = null;
    carregado = false;
    desenhar();
    try {
      const [listaMotivos, config] = await Promise.all([
        PedidosStorage.motivos(),
        PedidosStorage.config()
      ]);
      motivos = listaMotivos;
      if (config.objetivos) objetivos = Object.assign({}, objetivos, config.objetivos);
      await recarregar();
    } catch (erro) {
      erroCarga = erro.message || 'Verifica a ligação e tenta outra vez.';
      desenhar();
    }
  }

  // O quadro é partilhado: quando outra pessoa mexe (a Paula marca as malhas
  // no computador dela), o cartão tem de mudar aqui sem ninguém recarregar a
  // página. Lê de tempos a tempos e ao voltar ao separador, mas nunca a meio
  // de um arrasto.
  function podeAtualizar() {
    const seccao = document.getElementById('sectionPedidos');
    return document.visibilityState === 'visible'
      && seccao && !seccao.classList.contains('hidden')
      && !document.getElementById('pedidosQuadroWrap').classList.contains('hidden')
      && !idAArrastar
      && !emCurso
      && !document.querySelector('.deco-copy-overlay');
  }

  function agendarAtualizacao() {
    clearInterval(temporizador);
    temporizador = setInterval(() => {
      if (podeAtualizar()) recarregar().catch(() => {});
    }, ATUALIZAR_CADA);
    document.addEventListener('visibilitychange', () => {
      if (podeAtualizar() && Date.now() - ultimaLeitura > 15000) recarregar().catch(() => {});
    });
  }

  async function iniciar(container, opcoes) {
    raiz = container;
    aoNovo = (opcoes && opcoes.aoNovo) || null;
    if (opcoes && opcoes.estadoUI) Object.assign(estadoUI, opcoes.estadoUI);
    await iniciarLeitura();
    agendarAtualizacao();
  }

  // Depois de criar um pedido: lê o quadro, mostra o cartão novo a piscar.
  async function aposCriar(id, dados) {
    destaque = id;
    try { await recarregar(); } catch (e) { /* mantém o que já está no ecrã */ }
    PedidosToast.ok(`Pedido ${dados && dados.refCliente ? dados.refCliente : ''} criado.`.replace('  ', ' '));
  }

  // Clientes por ordem de pedido mais recente (para os botões do formulário).
  function clientesRecentes(quantos) {
    const vistos = [];
    cartoes.slice()
      .sort((a, b) => new Date(b.recebido_em) - new Date(a.recebido_em))
      .forEach(c => { if (!vistos.includes(c.cliente_nome)) vistos.push(c.cliente_nome); });
    return vistos.slice(0, quantos);
  }

  return {
    iniciar,
    recarregar,
    aposCriar,
    clientesRecentes,
    acoesDoPedido: botoesDoCartao,
    cartaoPorId: id => cartoes.find(c => c.id === id) || null,
    desfazerId,
    desfazerUltimo,
    get estado() { return estadoUI; },
    // Preferências guardadas, aplicadas antes do primeiro desenho.
    definirInicial(valores) { Object.assign(estadoUI, valores); },
    definir(chave, valor) {
      estadoUI[chave] = valor;
      if (chave === 'fechados' && !valor) mostrarTodosFechados = false;
      desenhar();
    },
    get motivos() { return motivos; }
  };
})();
