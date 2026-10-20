// Ideia de preço: a visualização.
//
// Feita para consultar depressa:
//  - um índice no topo salta para qualquer tabela num clique;
//  - a pesquisa procura em todas as tabelas ao mesmo tempo (perdas, margens,
//    tinturaria e as tabelas dos fornecedores) e mostra só o que encaixa;
//  - nas tabelas por peso da peça, escrever o peso destaca a coluna certa.
//
// Gestão visual: cada perda e cada preço é uma barra com o comprimento do
// seu valor, todas na mesma escala dentro da tabela; nas perdas a cor
// aquece com o valor. As margens são números grandes, e o que está por
// decidir aparece como tal ("A avaliar"), em vez de um zero.
//
// Esta vista é só para ler: editar faz-se na vista Edição (botão no topo).
// Todas as tabelas estão por ordem alfabética.
const IdeiaVista = (() => {
  const S = IdeiaStorage;
  const U = PedidosUtil;
  const el = U.el;

  // Ordem escolhida nas tabelas que a deixam mudar (t.maior): 'alfabetica'
  // ou 'maior'. A tinturaria está sempre por ordem alfabética.
  const ordens = { perdas: 'alfabetica' };

  const norm = s => U.normalizar(String(s || ''));
  const encaixa = (texto, pesquisa) => !pesquisa || norm(texto).includes(pesquisa);

  // Três tons do mesmo castanho da app: baixa, média, alta (só nas perdas).
  const tom = (t, v) => (t.valor === 'preco' ? 'preco' : v >= 6 ? 'alta' : v >= 4 ? 'media' : 'baixa');

  const valorParaOrdenar = (t, l) => {
    if (l.variantes.length) return Math.max.apply(null, l.variantes.map(v => (v.percentagem === null ? -1 : v.percentagem)));
    const v = S.valorDe(t, l);
    return v === null ? -1 : v;
  };

  function barra(t, valor, escala) {
    const pista = el('div', 'ip-pista');
    if (valor === null) {
      pista.classList.add('is-avaliar');
      pista.appendChild(el('span', 'ip-avaliar', 'A avaliar'));
      return pista;
    }
    const fill = el('span', 'ip-fill is-' + tom(t, valor));
    fill.style.width = (escala ? valor / escala * 100 : 0) + '%';
    fill.dataset.valor = String(valor);
    pista.appendChild(fill);
    return pista;
  }

  function contagem(t, n) {
    return n + ' ' + (n === 1 ? t.contagem[0] : t.contagem[1]);
  }

  // -------------------------------------------------------------------
  // Tabelas com barras: perdas e tinturaria
  // -------------------------------------------------------------------
  function cartaoValores(t, todas, opcoes) {
    const pesquisa = opcoes.pesquisa;
    const tituloEncaixa = encaixa(t.titulo, pesquisa);
    const lista = S.daTabela(todas, t.chave).filter(l => tituloEncaixa
      || encaixa([l.nome, l.observacoes].concat(l.variantes.map(v => v.nome)).join(' '), pesquisa));
    if (pesquisa && !lista.length) return null;

    const cartao = el('section', 'ip-cartao');
    cartao.dataset.tabela = t.chave;
    cartao.id = 'ip-' + t.chave;

    // Escala: todos os valores da tabela (não só os filtrados), para uma
    // barra não mudar de tamanho por se estar a pesquisar.
    const valores = [];
    S.daTabela(todas, t.chave).forEach(l => {
      if (l.variantes.length) l.variantes.forEach(v => { if (v.percentagem !== null) valores.push(v.percentagem); });
      else if (S.valorDe(t, l) !== null) valores.push(S.valorDe(t, l));
    });
    const escala = Math.max.apply(null, valores.concat([t.valor === 'preco' ? 0.01 : 1]));

    const cab = el('header', 'ip-cartao__cab');
    cab.appendChild(el('h3', null, t.titulo));
    cab.appendChild(el('span', 'pp-dlegenda', contagem(t, lista.length)
      + (valores.length && !pesquisa
        ? ' · entre ' + S.formatar(t, Math.min.apply(null, valores)) + ' e ' + S.formatar(t, Math.max.apply(null, valores))
        : '')));
    const dir = el('div', 'ip-cartao__dir');
    if (t.maior) {
      const seg = el('div', 'pp-vistas ip-ordem');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Ordenar ' + t.curto);
      [['alfabetica', 'A a Z'], ['maior', t.maior]].forEach(([k, texto]) => {
        const b = el('button', 'pp-vista' + (ordens[t.chave] === k ? ' is-ativo' : ''), texto);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(ordens[t.chave] === k));
        b.addEventListener('click', () => { ordens[t.chave] = k; opcoes.redesenhar(); });
        seg.appendChild(b);
      });
      dir.appendChild(seg);
    }
    cab.appendChild(dir);
    cartao.appendChild(cab);

    if (!lista.length) {
      cartao.appendChild(el('p', 'pp-dcard__nota', 'Ainda não há linhas.'));
      return cartao;
    }

    const ordenada = t.maior && ordens[t.chave] === 'maior'
      ? lista.slice().sort((a, b) => valorParaOrdenar(t, b) - valorParaOrdenar(t, a))
      : lista;

    const corpo = el('div', 'ip-perdas');
    ordenada.forEach(l => {
      const linha = el('div', 'ip-perda');
      linha.dataset.id = l.id;

      const nome = el('span', 'ip-perda__nome');
      nome.appendChild(el('b', null, l.nome));
      if (l.observacoes) nome.appendChild(el('small', null, l.observacoes));
      linha.appendChild(nome);

      if (l.variantes.length) {
        const vs = el('span', 'ip-variantes');
        l.variantes.forEach(v => {
          const vl = el('span', 'ip-variante');
          vl.appendChild(el('span', 'ip-variante__nome', v.nome || 'Sem nome'));
          vl.appendChild(barra(t, v.percentagem, escala));
          vl.appendChild(el('b', 'ip-valor', S.formatar(t, v.percentagem) || '-'));
          vs.appendChild(vl);
        });
        linha.appendChild(vs);
      } else {
        const v = S.valorDe(t, l);
        linha.appendChild(barra(t, v, escala));
        linha.appendChild(el('b', 'ip-valor', S.formatar(t, v) || ''));
      }
      corpo.appendChild(linha);
    });
    cartao.appendChild(corpo);

    if (t.chave === 'perdas') {
      const legenda = el('div', 'ip-legenda');
      [['baixa', 'até 3%'], ['media', '4% a 5%'], ['alta', '6% ou mais']].forEach(([k, texto]) => {
        const item = el('span', 'ip-legenda__item');
        item.appendChild(el('i', 'ip-fill is-' + k));
        item.appendChild(document.createTextNode(texto));
        legenda.appendChild(item);
      });
      cartao.appendChild(legenda);
    }
    return cartao;
  }

  // -------------------------------------------------------------------
  // Margens: um número grande por cartão
  // -------------------------------------------------------------------
  function cartaoMargens(t, todas, opcoes) {
    const pesquisa = opcoes.pesquisa;
    const tituloEncaixa = encaixa(t.titulo, pesquisa);
    const lista = S.daTabela(todas, t.chave).filter(l => tituloEncaixa || encaixa(l.nome + ' ' + l.observacoes, pesquisa));
    if (pesquisa && !lista.length) return null;

    const cartao = el('section', 'ip-cartao');
    cartao.dataset.tabela = t.chave;
    cartao.id = 'ip-' + t.chave;

    const cab = el('header', 'ip-cartao__cab');
    cab.appendChild(el('h3', null, t.titulo));
    const porAvaliar = lista.filter(l => l.percentagem === null).length;
    cab.appendChild(el('span', 'pp-dlegenda', contagem(t, lista.length) + (porAvaliar ? ' · ' + porAvaliar + ' a avaliar' : '')));
    cartao.appendChild(cab);

    if (!lista.length) {
      cartao.appendChild(el('p', 'pp-dcard__nota', 'Ainda não há margens.'));
      return cartao;
    }

    const grelha = el('div', 'ip-margens');
    lista.forEach(l => {
      const tile = el('div', 'ip-margem' + (l.percentagem === null ? ' is-avaliar' : ''));
      tile.dataset.id = l.id;
      tile.appendChild(el('span', 'ip-margem__valor', S.pct(l.percentagem) || 'A avaliar'));
      tile.appendChild(el('span', 'ip-margem__nome', l.nome));
      if (l.observacoes) tile.appendChild(el('small', 'ip-margem__nota', l.observacoes));
      grelha.appendChild(tile);
    });
    cartao.appendChild(grelha);
    return cartao;
  }

  // -------------------------------------------------------------------
  // Índice e rodapé
  // -------------------------------------------------------------------
  function indice(cartoes) {
    const nav = el('nav', 'ip-indice');
    nav.setAttribute('aria-label', 'Ir para a tabela');
    cartoes.forEach(([id, texto]) => {
      const b = el('button', 'pp-gp', texto);
      b.type = 'button';
      b.addEventListener('click', () => {
        const alvo = document.getElementById(id);
        if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(b);
    });
    return nav;
  }

  function rodape(dados) {
    const todas = dados.linhas.concat(dados.documentos);
    const datas = todas.filter(l => l.updated_at).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (!datas.length) return null;
    const u = datas[0];
    return el('p', 'ip-rodape', 'Última alteração a ' + U.dataHora(u.updated_at) + (u.updated_by ? ' por ' + u.updated_by : '') + '.');
  }

  function desenhar(raiz, dados, opcoes) {
    const o = Object.assign({}, opcoes, { pesquisa: norm(opcoes.pesquisa).trim() });
    raiz.innerHTML = '';
    const T = chave => S.TABELAS.find(t => t.chave === chave);

    const perdas = cartaoValores(T('perdas'), dados.linhas, o);
    const margens = cartaoMargens(T('margens'), dados.linhas, o);
    const tinturaria = cartaoValores(T('tinturaria'), dados.linhas, o);
    const docs = dados.documentos.map(d => IdeiaDocumentos.vista(d, o)).filter(Boolean);

    const presentes = [];
    if (perdas) presentes.push(['ip-perdas', T('perdas').curto]);
    if (margens) presentes.push(['ip-margens', T('margens').curto]);
    if (tinturaria) presentes.push(['ip-tinturaria', T('tinturaria').curto]);
    docs.forEach(c => presentes.push([c.id, c.dataset.nome]));

    if (!presentes.length) {
      raiz.appendChild(el('p', 'ip-vazio', 'Nada encontrado para "' + opcoes.pesquisa.trim() + '".'));
      return;
    }
    if (presentes.length > 1) raiz.appendChild(indice(presentes));

    // À esquerda as perdas e, por baixo, as margens; à direita a tinturaria.
    // As duas colunas acabam à mesma altura: as margens esticam até lá.
    if (perdas || margens || tinturaria) {
      const esquerda = perdas || margens;
      const grelha = el('div', 'ip-grelha' + (esquerda && tinturaria ? '' : ' is-uma'));
      if (esquerda) {
        const coluna = el('div', 'ip-coluna');
        if (perdas) coluna.appendChild(perdas);
        if (margens) {
          margens.classList.add('is-estica');
          coluna.appendChild(margens);
        }
        grelha.appendChild(coluna);
      }
      if (tinturaria) grelha.appendChild(tinturaria);
      raiz.appendChild(grelha);
    }
    if (docs.length) {
      const bloco = el('div', 'ip-docs');
      docs.forEach(c => bloco.appendChild(c));
      raiz.appendChild(bloco);
    }
    const r = rodape(dados);
    if (r) raiz.appendChild(r);
  }

  return { desenhar };
})();
