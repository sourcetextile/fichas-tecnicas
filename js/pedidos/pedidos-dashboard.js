// Dashboard dos Pedidos de Preço: do geral para o particular.
//   Nível 1: quatro cartões, à vista.
//   Nível 2: um clique num cartão abre o detalhe (por GP, por cliente, por
//            interveniente).
//   Nível 3: um clique numa linha lista os pedidos que compõem o número;
//            clicar num pedido abre-o na gaveta.
// As contas estão em pedidos-kpi.js. Nunca se escreve a unidade do tempo: o
// número, a cor e o objetivo chegam.
const PedidosDashboard = (() => {
  const U = PedidosUtil;
  const K = PedidosKpi;
  const el = U.el;

  const PERIODOS = [
    { k: '3m', texto: 'Últimos 3 meses', meses: 3 },
    { k: '1m', texto: 'Último mês', meses: 1 },
    { k: '6m', texto: 'Últimos 6 meses', meses: 6 },
    { k: 'ano', texto: 'Este ano' },
    { k: 'tudo', texto: 'Tudo' },
    { k: 'intervalo', texto: 'Intervalo específico' }
  ];

  const COR_CATEGORIA = {
    converteu: 'Converteu',
    converteu_negociacao: 'Converteu com negociação',
    nao_converteu: 'Não converteu',
    sem_resposta: 'Sem resposta'
  };

  let raiz = null;
  let linhas = [];
  let carregado = false;
  let erro = null;
  let config = { limiar: 0.85, objConversao: null, objetivos: { malhas: 2, orcamentacao: 1 } };
  const est = { periodo: '3m', de: '', ate: '', gp: '', cliente: '', cartao: '', grupo: null, ordem: { col: 'n', asc: false } };

  const pct = v => (v === null || v === undefined ? '-' : Math.round(v * 100) + '%');
  const pequena = n => n < K.AMOSTRA_MINIMA;

  function desde() {
    const hoje = new Date();
    if (est.periodo === 'intervalo') return est.de || null;
    const p = PERIODOS.find(x => x.k === est.periodo);
    let d = null;
    if (p && p.meses) { d = new Date(hoje); d.setMonth(d.getMonth() - p.meses); }
    if (p && p.k === 'ano') d = new Date(hoje.getFullYear(), 0, 1);
    return d ? d.toLocaleDateString('sv-SE') : null;
  }

  const ate = () => (est.periodo === 'intervalo' && est.ate ? est.ate : null);

  async function carregar() {
    erro = null;
    try {
      const [dados, cfg] = await Promise.all([PedidosStorage.kpis(desde(), ate()), PedidosStorage.config()]);
      linhas = dados || [];
      config.limiar = (cfg.limiar_amarelo && cfg.limiar_amarelo.valor) || 0.85;
      config.objConversao = cfg.objetivo_conversao && cfg.objetivo_conversao.valor !== undefined
        ? cfg.objetivo_conversao.valor : null;
      if (cfg.objetivos) config.objetivos = cfg.objetivos;
      carregado = true;
    } catch (e) {
      erro = e.message || 'Verifica a ligação e tenta outra vez.';
    }
    desenhar();
  }

  function abrir() {
    raiz = document.getElementById('pedidosDashboard');
    if (!raiz) return;
    carregado = false;
    desenhar();
    carregar();
  }

  const filtradas = () => K.filtrar(linhas, { gp: est.gp, cliente: est.cliente });

  // -------------------------------------------------------------------
  // Peças
  // -------------------------------------------------------------------
  function barraEmpilhada(r) {
    const barra = el('div', 'pp-pilha');
    if (!r.total) { barra.classList.add('is-vazia'); return barra; }
    ['converteu', 'converteu_negociacao', 'nao_converteu', 'sem_resposta'].forEach(c => {
      if (!r[c]) return;
      const seg = el('span', 'pp-pilha__seg is-' + c);
      seg.style.width = (r[c] / r.total * 100) + '%';
      seg.title = COR_CATEGORIA[c] + ': ' + r[c];
      barra.appendChild(seg);
    });
    return barra;
  }

  function bolaMedia(media, objetivo, grande) {
    if (media === null) return el('span', 'pp-bola is-neutro' + (grande ? ' is-grande' : ''), '-');
    const tom = K.semaforo(media, objetivo, config.limiar);
    return U.bola(media, tom, `${U.numero(media)}. Objetivo: ${U.numero(objetivo)}. ${U.PALAVRA[tom]}`, grande);
  }

  function amostra(n) {
    const t = el('span', 'pp-dn', 'Nr de pedidos: ' + n);
    if (pequena(n)) {
      t.appendChild(el('span', 'pp-dn__aviso', 'amostra pequena'));
    }
    return t;
  }

  // -------------------------------------------------------------------
  // Nível 1
  // -------------------------------------------------------------------
  function cartaoBase(chave, titulo, n) {
    const b = el('button', 'pp-dcard' + (est.cartao === chave ? ' is-ativo' : '') + (pequena(n) ? ' is-esbatido' : ''));
    b.type = 'button';
    b.setAttribute('aria-expanded', String(est.cartao === chave));
    b.appendChild(el('h3', null, titulo));
    b.addEventListener('click', () => {
      est.cartao = est.cartao === chave ? '' : chave;
      est.grupo = null;
      desenhar();
    });
    return b;
  }

  // Quatro barras, uma por baixo da outra: o comprimento de cada uma é a sua %.
  function barrasResultado(r) {
    const caixa = el('div', 'pp-hbars');
    Object.keys(COR_CATEGORIA).forEach(c => {
      const f = r.total ? r[c] / r.total : 0;
      const l = el('div', 'pp-hbar');
      l.appendChild(el('span', 'pp-hbar__nome', COR_CATEGORIA[c]));
      l.appendChild(el('span', 'pp-hbar__valor', (r.total ? pct(f) : '-') + ' (' + r[c] + ')'));
      const pista = el('div', 'pp-hbar__pista');
      const fill = el('span', 'pp-hbar__fill is-' + c);
      fill.style.width = (f * 100) + '%';
      pista.appendChild(fill);
      l.appendChild(pista);
      caixa.appendChild(l);
    });
    return caixa;
  }

  function cartaoResultado(ls) {
    const r = K.resultado(ls);
    const b = cartaoBase('resultado', 'Taxa de conversão', r.total);
    const topo = el('div', 'pp-dcard__topo');
    topo.appendChild(el('span', 'pp-dgrande', pct(r.taxa)));
    const tomConv = K.semaforoConversao(r.taxa, config.objConversao, config.limiar);
    if (tomConv) topo.appendChild(el('span', 'pp-bola is-pequena is-' + tomConv, ''));
    b.appendChild(topo);
    b.appendChild(barrasResultado(r));
    const rodape = el('div', 'pp-dcard__rodape');
    rodape.appendChild(amostra(r.total));
    if (r.emCurso) rodape.appendChild(el('span', null, 'Em curso, fora da conta: ' + r.emCurso));
    b.appendChild(rodape);
    const ciclo = K.cicloTotal(ls);
    if (ciclo !== null) b.appendChild(el('div', 'pp-dcard__nota', 'Ciclo total médio: ' + U.numero(ciclo)));
    return b;
  }

  function cartaoTempo(ls, tipo) {
    const t = K.tempoResposta(ls, tipo);
    const b = cartaoBase(tipo, tipo === 'sem' ? 'Lead time sem negociação' : 'Lead time com negociação', t.n);
    const topo = el('div', 'pp-dcard__topo');
    topo.appendChild(bolaMedia(t.media, t.objetivo, true));
    const texto = el('div', 'pp-dtexto');
    texto.appendChild(el('span', null, 'Lead time médio'));
    texto.appendChild(el('b', null, 'Objetivo ' + U.numero(t.objetivo)));
    topo.appendChild(texto);
    b.appendChild(topo);
    const rodape = el('div', 'pp-dcard__rodape');
    rodape.appendChild(amostra(t.n));
    if (tipo === 'com' && t.rondas !== null) rodape.appendChild(el('span', null, 'Rondas em média: ' + U.numero(t.rondas)));
    b.appendChild(rodape);
    return b;
  }

  function cartaoCurso(ls) {
    const grupos = K.emCurso(ls);
    const total = grupos.reduce((a, g) => a + g.abertos, 0);
    const b = cartaoBase('wip', 'Trabalho em curso', total);
    const topo = el('div', 'pp-dcard__topo');
    topo.appendChild(el('span', 'pp-dgrande', String(total)));
    topo.appendChild(el('span', 'pp-dlegenda', 'pedidos em aberto'));
    b.appendChild(topo);
    const lista = el('div', 'pp-dwip');
    grupos.forEach(g => {
      const l = el('div', 'pp-dwip__linha');
      l.appendChild(U.avatar(g.chave, g.nome));
      l.appendChild(el('span', 'pp-dwip__nome', g.nome));
      l.appendChild(el('b', null, String(g.abertos)));
      if (g.atraso) l.appendChild(el('span', 'pp-coluna__alerta', g.atraso + ' em atraso'));
      lista.appendChild(l);
    });
    if (!grupos.length) lista.appendChild(el('span', 'pp-dcard__nota', 'Nenhum pedido em aberto.'));
    b.appendChild(lista);
    return b;
  }

  // -------------------------------------------------------------------
  // Nível 2
  // -------------------------------------------------------------------
  // Motivos de não conversão: o número de pedidos perdidos por motivo.
  function cartaoMotivos(ls) {
    const grupos = K.porMotivo(ls);
    const total = grupos.reduce((a, g) => a + g.linhas.length, 0);
    const b = cartaoBase('motivos', 'Motivos de não conversão', total);
    b.appendChild(el('span', 'pp-dgrande', String(total)));
    const caixa = el('div', 'pp-hbars');
    grupos.slice(0, 4).forEach(g => {
      const f = total ? g.linhas.length / total : 0;
      const l = el('div', 'pp-hbar');
      l.appendChild(el('span', 'pp-hbar__nome', g.nome));
      l.appendChild(el('span', 'pp-hbar__valor', pct(f) + ' (' + g.linhas.length + ')'));
      const pista = el('div', 'pp-hbar__pista');
      const fill = el('span', 'pp-hbar__fill is-nao_converteu');
      fill.style.width = (f * 100) + '%';
      pista.appendChild(fill);
      l.appendChild(pista);
      caixa.appendChild(l);
    });
    if (!grupos.length) caixa.appendChild(el('p', 'pp-dcard__nota', 'Nenhum pedido perdido neste período.'));
    b.appendChild(caixa);
    const rodape = el('div', 'pp-dcard__rodape');
    rodape.appendChild(amostra(total));
    b.appendChild(rodape);
    return b;
  }

  function cabecalhoTabela(colunas, classe) {
    const cab = el('div', 'pp-tab__cab' + (classe ? ' ' + classe : ''));
    colunas.forEach(c => {
      if (!c.col) { cab.appendChild(el('span', null, c.texto)); return; }
      const b = el('button', 'pp-tab__ordem' + (est.ordem.col === c.col ? ' is-ativo' : ''),
        c.texto + (est.ordem.col === c.col ? (est.ordem.asc ? ' ↑' : ' ↓') : ''));
      b.type = 'button';
      b.addEventListener('click', () => {
        est.ordem = { col: c.col, asc: est.ordem.col === c.col ? !est.ordem.asc : c.col === 'nome' };
        desenhar();
      });
      cab.appendChild(b);
    });
    return cab;
  }

  function ordenar(rows) {
    const { col, asc } = est.ordem;
    const f = asc ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (col === 'nome') return f * a.nome.localeCompare(b.nome, 'pt');
      const va = a[col] === null || a[col] === undefined ? -Infinity : a[col];
      const vb = b[col] === null || b[col] === undefined ? -Infinity : b[col];
      return f * (va - vb);
    });
  }

  function seccao(titulo, colunas, rows, desenharLinha, tipo, opcoes) {
    const o = opcoes || {};
    const bloco = el('section', 'pp-tab');
    const h = el('h4', null, titulo);
    if (o.nota) h.appendChild(el('span', 'pp-dlegenda', o.nota));
    bloco.appendChild(h);
    if (!rows.length) { bloco.appendChild(el('p', 'pp-dcard__nota', 'Sem dados neste período.')); return bloco; }
    bloco.appendChild(cabecalhoTabela(colunas, o.classe));
    ordenar(rows).forEach(row => {
      const l = el('button', 'pp-tab__linha' + (o.classe ? ' ' + o.classe : '') + (!o.semEsbater && pequena(row.n) ? ' is-esbatido' : '') +
        (est.grupo && est.grupo.chave === row.chave && est.grupo.tipo === tipo ? ' is-ativo' : ''));
      l.type = 'button';
      desenharLinha(l, row);
      l.addEventListener('click', () => {
        est.grupo = { tipo, chave: row.chave, nome: row.nome, linhas: row.linhas, cartao: est.cartao };
        desenhar();
      });
      bloco.appendChild(l);
    });
    return bloco;
  }

  function linhasResultado(grupos) {
    return grupos.map(g => {
      const r = K.resultado(g.linhas);
      return { chave: g.chave, nome: g.nome, linhas: g.linhas, r, valor: r.taxa, n: r.total };
    }).filter(x => x.n > 0);
  }

  function desenharLinhaResultado(l, row) {
    l.appendChild(el('span', 'pp-tab__nome', row.nome));
    l.appendChild(barraEmpilhada(row.r));
    l.appendChild(el('b', null, pct(row.valor)));
    l.appendChild(amostra(row.n));
  }

  function linhasTempo(grupos, obj) {
    return grupos.map(g => {
      const sub = g.linhas;
      const media = K.media(sub.map(l => l.tempo_resposta));
      return { chave: g.chave, nome: g.nome, linhas: sub, valor: media,
        objetivo: K.media(sub.map(obj)), n: sub.length };
    }).filter(x => x.n > 0);
  }

  // Uma barra por valor. O comprimento é sempre proporcional ao valor e a
  // escala é a MESMA em todas as barras do detalhe; a risca marca o objetivo.
  function barraValor(valor, objetivo, escala) {
    const pista = el('div', 'pp-vbar');
    if (valor === null || valor === undefined) {
      pista.appendChild(el('span', 'pp-vbar__nulo', '-'));
      return pista;
    }
    const tom = K.semaforo(valor, objetivo, config.limiar) || 'verde';
    const fill = el('span', 'pp-vbar__fill is-' + tom);
    fill.style.width = (valor / escala * 100) + '%';
    fill.dataset.valor = String(valor);
    pista.appendChild(fill);
    pista.appendChild(el('b', 'pp-vbar__num', U.numero(valor)));
    const meta = el('i', 'pp-vbar__meta');
    meta.style.left = (objetivo / escala * 100) + '%';
    meta.title = 'Objetivo ' + U.numero(objetivo);
    pista.appendChild(meta);
    return pista;
  }

  function desenharLinhaTempo(objetivo, escala) {
    return (l, row) => {
      l.appendChild(el('span', 'pp-tab__nome', row.nome));
      l.appendChild(barraValor(row.valor, objetivo, escala));
      l.appendChild(amostra(row.n));
    };
  }

  function detalhe(ls) {
    const caixa = el('div', 'pp-ddetalhe');
    const c = est.cartao;
    if (c === 'resultado') {
      const cols = [{ texto: 'Nome', col: 'nome' }, { texto: '' }, { texto: 'Conversão', col: 'valor' }, { texto: 'Nr de pedidos', col: 'n' }];
      caixa.appendChild(seccao('Por GP', cols, linhasResultado(K.porGp(ls)), desenharLinhaResultado, 'gp'));
      caixa.appendChild(seccao('Por cliente', cols, linhasResultado(K.porCliente(ls)), desenharLinhaResultado, 'cliente'));
    } else if (c === 'sem' || c === 'com') {
      const t = K.tempoResposta(ls, c);
      const obj = c === 'sem' ? (l => (l.malhas_na ? 1 : 3)) : (l => 3 * Number(l.ronda_atual));
      const interv = K.porInterveniente(t.linhas, config.objetivos);
      const rGp = linhasTempo(K.porGp(t.linhas), obj);
      const rCli = linhasTempo(K.porCliente(t.linhas), obj);
      // Uma só escala para todas as barras desta página.
      const todos = [].concat(
        interv.map(i => i.media), interv.map(i => i.objetivo),
        rGp.map(x => x.valor), rCli.map(x => x.valor), [t.objetivo]
      ).filter(v => v !== null && v !== undefined);
      const escala = (Math.max.apply(null, todos.concat([0.1]))) * 1.15;

      const bloco = el('section', 'pp-tab');
      bloco.appendChild(el('h4', null, 'Por interveniente'));
      interv.forEach(i => {
        const l = el('div', 'pp-tab__linha is-barras is-fixa' + (pequena(i.n) ? ' is-esbatido' : ''));
        l.appendChild(el('span', 'pp-tab__nome', i.nome));
        l.appendChild(barraValor(i.media, i.objetivo, escala));
        const fim = el('span', 'pp-tab__fim');
        fim.appendChild(el('span', 'pp-dlegenda', 'Objetivo ' + U.numero(i.objetivo)));
        fim.appendChild(amostra(i.n));
        l.appendChild(fim);
        bloco.appendChild(l);
      });
      caixa.appendChild(bloco);

      // As GP e os clientes partilham o mesmo objetivo: diz-se uma vez, no título.
      const cols = [{ texto: 'Nome', col: 'nome' }, { texto: 'Lead time', col: 'valor' }, { texto: 'Nr de pedidos', col: 'n' }];
      const nota = 'Objetivo ' + U.numero(t.objetivo);
      caixa.appendChild(seccao('Por GP', cols, rGp, desenharLinhaTempo(t.objetivo, escala), 'gp', { classe: 'is-barras', nota }));
      caixa.appendChild(seccao('Por cliente', cols, rCli, desenharLinhaTempo(t.objetivo, escala), 'cliente', { classe: 'is-barras', nota }));
    } else if (c === 'motivos') {
      const grupos = K.porMotivo(ls);
      const total = grupos.reduce((a, g) => a + g.linhas.length, 0);
      const rows = grupos.map(g => ({ chave: g.chave, nome: g.nome, linhas: g.linhas,
        valor: g.linhas.length, n: g.linhas.length }));
      const cols = [{ texto: 'Motivo', col: 'nome' }, { texto: '' }, { texto: 'Pedidos', col: 'valor' }, { texto: '' }];
      caixa.appendChild(seccao('Por motivo', cols, rows, (l, row) => {
        l.appendChild(el('span', 'pp-tab__nome', row.nome));
        const pista = el('div', 'pp-hbar__pista');
        const fill = el('span', 'pp-hbar__fill is-nao_converteu');
        fill.style.width = (total ? row.valor / total * 100 : 0) + '%';
        pista.appendChild(fill);
        l.appendChild(pista);
        l.appendChild(el('b', null, String(row.valor) + ' (' + pct(total ? row.valor / total : null) + ')'));
        l.appendChild(el('span'));
      }, 'motivo', { semEsbater: true }));
    } else if (c === 'wip') {
      const rows = K.emCurso(ls).map(g => ({ chave: g.chave, nome: g.nome, linhas: g.linhas, valor: g.abertos, n: g.abertos, atraso: g.atraso }));
      const cols = [{ texto: 'GP', col: 'nome' }, { texto: 'Em aberto', col: 'valor' }, { texto: '' }, { texto: '' }];
      caixa.appendChild(seccao('Por GP', cols, rows, (l, row) => {
        l.appendChild(el('span', 'pp-tab__nome', row.nome));
        l.appendChild(el('b', null, String(row.valor)));
        l.appendChild(row.atraso ? el('span', 'pp-coluna__alerta', row.atraso + ' em atraso') : el('span'));
        l.appendChild(el('span'));
      }, 'gp'));
    }
    if (est.grupo && est.grupo.cartao === c) caixa.appendChild(nivel3());
    return caixa;
  }

  // -------------------------------------------------------------------
  // Nível 3: os pedidos que compõem o número
  // -------------------------------------------------------------------
  function nivel3() {
    const g = est.grupo;
    const c = est.cartao;
    const bloco = el('section', 'pp-tab pp-tab--pedidos');
    bloco.appendChild(el('h4', null, 'Pedidos: ' + g.nome));
    let lista = g.linhas;
    if (c === 'resultado') lista = lista.filter(l => K.categoria(l) && K.categoria(l) !== 'em_curso');
    lista.forEach(l => {
      const linha = el('button', 'pp-tab__linha is-pedido');
      linha.type = 'button';
      linha.appendChild(el('span', 'pp-tab__nome', l.cliente_nome + '  ' + l.ref_cliente));
      linha.appendChild(U.avatar(l.gp_email, l.gp_nome));
      let extra = null;
      if (c === 'resultado') extra = el('span', 'pp-dlegenda', COR_CATEGORIA[K.categoria(l)]);
      else if (c === 'wip') extra = el('span', 'pp-dlegenda', U.NOME_ESTADO[l.estado]);
      else if (c === 'motivos') extra = el('span', 'pp-dlegenda', l.motivo_descricao || '');
      else extra = bolaMedia(l.tempo_resposta, c === 'sem' ? (l.malhas_na ? 1 : 3) : 3 * Number(l.ronda_atual));
      linha.appendChild(extra);
      linha.addEventListener('click', () => PedidosDrawer.abrir(l));
      bloco.appendChild(linha);
    });
    if (!lista.length) bloco.appendChild(el('p', 'pp-dcard__nota', 'Nenhum pedido.'));
    return bloco;
  }

  // -------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const nomeMes = k => MESES[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4);

  // Evolução mês a mês (pelo mês em que o pedido foi recebido): a taxa de
  // conversão e o lead time sem negociação, cada um com uma barra por mês.
  function evolucao(ls) {
    const meses = K.porMes(ls);
    const bloco = el('section', 'pp-evolucao');
    bloco.appendChild(el('h4', null, 'Evolução por mês'));
    if (meses.length < 2) {
      bloco.appendChild(el('p', 'pp-dcard__nota', 'Ainda há pouco histórico para comparar meses.'));
      return bloco;
    }
    const colunas = el('div', 'pp-evolucao__colunas');

    const conv = el('div', 'pp-evolucao__col');
    conv.appendChild(el('h5', null, 'Taxa de conversão'));
    meses.filter(m => m.resultado.total > 0).forEach(m => {
      const l = el('div', 'pp-evo is-tres' + (pequena(m.resultado.total) ? ' is-esbatido' : ''));
      l.title = 'Nr de pedidos: ' + m.resultado.total;
      l.appendChild(el('span', 'pp-evo__mes', nomeMes(m.nome)));
      const pista = el('div', 'pp-hbar__pista');
      const fill = el('span', 'pp-hbar__fill is-converteu');
      fill.style.width = ((m.resultado.taxa || 0) * 100) + '%';
      pista.appendChild(fill);
      l.appendChild(pista);
      l.appendChild(el('b', 'pp-evo__valor', pct(m.resultado.taxa)));
      conv.appendChild(l);
    });
    colunas.appendChild(conv);

    const lead = el('div', 'pp-evolucao__col');
    lead.appendChild(el('h5', null, 'Lead time sem negociação'));
    const com = meses.filter(m => m.semNegociacao.media !== null);
    const escala = Math.max.apply(null, com.map(m => m.semNegociacao.media)
      .concat(com.map(m => m.semNegociacao.objetivo || 0)).concat([0.1])) * 1.15;
    com.forEach(m => {
      const l = el('div', 'pp-evo' + (pequena(m.semNegociacao.n) ? ' is-esbatido' : ''));
      l.title = 'Nr de pedidos: ' + m.semNegociacao.n;
      l.appendChild(el('span', 'pp-evo__mes', nomeMes(m.nome)));
      l.appendChild(barraValor(m.semNegociacao.media, m.semNegociacao.objetivo, escala));
      lead.appendChild(l);
    });
    colunas.appendChild(lead);
    bloco.appendChild(colunas);
    return bloco;
  }

  // Um ficheiro que abre no Excel: uma linha por pedido do que está filtrado.
  function exportar() {
    const texto = K.csv(filtradas());
    const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pedidos-de-preco-' + new Date().toLocaleDateString('sv-SE') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function filtros() {
    const barra = el('div', 'pp-dfiltros');

    const sel = el('select');
    sel.setAttribute('aria-label', 'Período');
    PERIODOS.forEach(p => {
      const o = el('option', null, p.texto);
      o.value = p.k;
      if (p.k === est.periodo) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      est.periodo = sel.value;
      est.grupo = null;
      if (est.periodo === 'intervalo' && !est.de) {
        const d = new Date(); d.setMonth(d.getMonth() - 1);
        est.de = d.toLocaleDateString('sv-SE');
        est.ate = new Date().toLocaleDateString('sv-SE');
      }
      carregar();
    });
    barra.appendChild(sel);

    if (est.periodo === 'intervalo') {
      [['De', 'de'], ['Até', 'ate']].forEach(([rotulo, chave]) => {
        const l = el('label', 'pp-inline', rotulo + ' ');
        const inp = el('input');
        inp.type = 'date';
        inp.value = est[chave] || '';
        inp.setAttribute('aria-label', rotulo);
        inp.addEventListener('change', () => { est[chave] = inp.value; est.grupo = null; carregar(); });
        l.appendChild(inp);
        barra.appendChild(l);
      });
    }

    const gps = [...new Map(linhas.filter(l => l.gp_email).map(l => [l.gp_email, l.gp_nome || l.gp_email])).entries()];
    const grupo = el('div', 'pp-gps');
    [['', 'Todas']].concat(gps).forEach(([email, nome]) => {
      const b = el('button', 'pp-gp' + (est.gp === String(email).toLowerCase() ? ' is-ativo' : ''));
      b.type = 'button';
      if (email) b.appendChild(U.avatar(email, nome));
      b.appendChild(document.createTextNode(email ? U.primeiroNome(nome) : nome));
      b.addEventListener('click', () => { est.gp = String(email).toLowerCase(); est.grupo = null; desenhar(); });
      grupo.appendChild(b);
    });
    barra.appendChild(grupo);

    const clientes = [...new Map(linhas.map(l => [l.cliente_id, l.cliente_nome])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'pt'));
    const cli = el('select');
    cli.setAttribute('aria-label', 'Cliente');
    const todos = el('option', null, 'Todos os clientes');
    todos.value = '';
    cli.appendChild(todos);
    clientes.forEach(([id, nome]) => {
      const o = el('option', null, nome);
      o.value = id;
      if (id === est.cliente) o.selected = true;
      cli.appendChild(o);
    });
    cli.addEventListener('change', () => { est.cliente = cli.value; est.grupo = null; desenhar(); });
    barra.appendChild(cli);

    const xls = el('button', 'pp-toggle pp-exportar', 'Exportar para Excel');
    xls.type = 'button';
    xls.addEventListener('click', exportar);
    barra.appendChild(xls);
    return barra;
  }

  function desenhar() {
    if (!raiz) return;
    raiz.innerHTML = '';
    if (erro) {
      const b = el('div', 'pp-hero');
      b.appendChild(el('h3', null, 'Não foi possível carregar o dashboard'));
      b.appendChild(el('p', null, erro));
      const t = el('button', 'primary', 'Tentar de novo');
      t.type = 'button';
      t.addEventListener('click', carregar);
      b.appendChild(t);
      raiz.appendChild(b);
      return;
    }
    if (!carregado) { raiz.appendChild(el('p', 'pp-dcard__nota', 'A carregar...')); return; }
    raiz.appendChild(filtros());
    const ls = filtradas();
    const cartoes = el('div', 'pp-dcartoes');
    cartoes.appendChild(cartaoResultado(ls));
    cartoes.appendChild(cartaoTempo(ls, 'sem'));
    cartoes.appendChild(cartaoTempo(ls, 'com'));
    cartoes.appendChild(cartaoCurso(ls));
    cartoes.appendChild(cartaoMotivos(ls));
    raiz.appendChild(cartoes);
    if (est.cartao) raiz.appendChild(detalhe(ls));
    else raiz.appendChild(el('p', 'pp-dcard__nota pp-ddica', 'Clica num cartão para ver o detalhe.'));
    raiz.appendChild(evolucao(ls));
  }

  return { abrir };
})();
