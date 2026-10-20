// Ideia de preço: as tabelas de fornecedor (Lavagens, Tingimento...).
//
// Cada tabela é um documento com secções: grelhas de preços (linhas x
// colunas, por peso da peça ou por cor) e listas de custos. Ficam
// digitalizadas para se poderem procurar e ler depressa, e o PDF original
// fica anexado para quem o quiser ver tal como veio do fornecedor.
//
// Ler uma grelha: a linha e a coluna por baixo do rato acendem (cruzamento);
// escrever o peso da peça na barra destaca a coluna certa; clicar no
// cabeçalho de uma coluna fixa-a em destaque. Nas grelhas marcadas com
// "maximo", o preço mais caro de cada linha vai a negrito. As linhas estão
// sempre por ordem alfabética.
const IdeiaDocumentos = (() => {
  const S = IdeiaStorage;
  const U = PedidosUtil;
  const el = U.el;

  const norm = s => U.normalizar(String(s || ''));
  const encaixa = (texto, pesquisa) => !pesquisa || norm(texto).includes(pesquisa);
  const numero = v => (v === null || v === undefined ? '-' : Number(v).toFixed(2).replace('.', ','));
  const dataPt = d => d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const unidade = s => (s.unidade ? '€ por ' + s.unidade : '€');

  // Coluna fixada à mão em cada grelha ("docId:secção" → índice).
  const fixadas = new Map();

  // -------------------------------------------------------------------
  // Vista
  // -------------------------------------------------------------------
  function colunaDoPeso(s, peso) {
    if (!peso) return -1;
    return s.colunas.findIndex(c => {
      const i = S.intervaloDe(c);
      return i && peso >= i[0] && peso <= i[1];
    });
  }

  function grelhaVista(doc, s, iSecao, linhas, opcoes) {
    const chave = doc.id + ':' + iSecao;
    const porPeso = s.colunas.some(c => S.intervaloDe(c));
    const doPeso = colunaDoPeso(s, opcoes.peso);
    const fixa = fixadas.has(chave) ? fixadas.get(chave) : -1;

    const caixa = el('div', 'ip-tab-caixa');
    const tab = el('table', 'ip-tab' + (s.colunas.length === 1 ? ' is-simples' : ''));

    const thead = el('thead');
    const tr = el('tr');
    tr.appendChild(el('th', 'ip-tab__canto', unidade(s)));
    s.colunas.forEach((c, i) => {
      const th = el('th', 'ip-tab__col' + (i === doPeso ? ' is-peso' : '') + (i === fixa ? ' is-fixa' : ''));
      const b = el('button', null, c);
      b.type = 'button';
      b.title = i === fixa ? 'Tirar o destaque' : 'Destacar esta coluna';
      b.addEventListener('click', () => {
        if (fixadas.get(chave) === i) fixadas.delete(chave); else fixadas.set(chave, i);
        opcoes.redesenhar();
      });
      th.appendChild(b);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    tab.appendChild(thead);

    // O mais caro de cada linha, só onde a secção o pede e há com que comparar.
    const comMaximo = s.maximo && s.colunas.length > 1;

    const tbody = el('tbody');
    linhas.slice().sort(S.porNome).forEach(l => {
      const r = el('tr');
      r.appendChild(el('th', 'ip-tab__nome', l.nome));
      const presentes = l.valores.filter(v => v !== null && v !== undefined);
      const maximo = comMaximo && presentes.length > 1 ? Math.max.apply(null, presentes) : null;
      s.colunas.forEach((c, i) => {
        const v = l.valores[i];
        const td = el('td', (v === null || v === undefined ? 'is-vazio' : '')
          + (maximo !== null && v === maximo ? ' is-max' : '')
          + (i === doPeso ? ' is-peso' : '') + (i === fixa ? ' is-fixa' : ''), numero(v));
        td.dataset.col = String(i);
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    tab.appendChild(tbody);

    // Cruzamento: a coluna por baixo do rato acende, como a linha (CSS).
    tab.addEventListener('mouseover', event => {
      const td = event.target.closest('td');
      tab.querySelectorAll('.is-cruz').forEach(n => n.classList.remove('is-cruz'));
      if (!td) return;
      const i = Number(td.dataset.col) + 2;
      tab.querySelectorAll(`tr > :nth-child(${i})`).forEach(n => n.classList.add('is-cruz'));
    });
    tab.addEventListener('mouseleave', () => tab.querySelectorAll('.is-cruz').forEach(n => n.classList.remove('is-cruz')));

    caixa.appendChild(tab);
    if (porPeso && opcoes.peso && doPeso < 0) {
      caixa.appendChild(el('p', 'ip-aviso', 'O peso indicado (' + opcoes.peso + ' g) não está nesta tabela.'));
    }
    return caixa;
  }

  function listaVista(linhas) {
    const dl = el('dl', 'ip-lista');
    linhas.slice().sort(S.porNome).forEach(l => {
      const linha = el('div', 'ip-lista__linha');
      linha.appendChild(el('dt', null, l.nome));
      linha.appendChild(el('dd', null, l.texto));
      dl.appendChild(linha);
    });
    return dl;
  }

  function vista(doc, opcoes) {
    const pesquisa = opcoes.pesquisa;
    const docEncaixa = encaixa(doc.nome + ' ' + doc.fornecedor, pesquisa);
    const secoes = doc.secoes.map((s, i) => {
      const tituloEncaixa = docEncaixa || encaixa(s.titulo, pesquisa);
      const linhas = s.linhas.filter(l => tituloEncaixa || encaixa(l.nome + ' ' + (l.texto || ''), pesquisa));
      return { s, i, linhas };
    }).filter(x => x.linhas.length);
    if (pesquisa && !secoes.length) return null;

    const cartao = el('section', 'ip-cartao ip-doc');
    cartao.id = 'ip-doc-' + doc.id;
    cartao.dataset.doc = doc.id;
    cartao.dataset.nome = doc.nome;

    const cab = el('header', 'ip-cartao__cab');
    cab.appendChild(el('h3', null, doc.nome));
    const origem = [doc.fornecedor, doc.data_tabela ? 'tabela de ' + dataPt(new Date(doc.data_tabela + 'T00:00')) : '']
      .filter(Boolean).join(' · ');
    if (origem) cab.appendChild(el('span', 'pp-dlegenda', origem));
    const val = S.validade(doc);
    if (val) {
      cab.appendChild(el('span', 'ip-validade ' + (val.expirada ? 'is-expirada' : 'is-valida'),
        val.expirada ? 'Fora de validade desde ' + dataPt(new Date(val.ate.getTime() + 86400000)) : 'Válida até ' + dataPt(val.ate)));
    }
    const dir = el('div', 'ip-cartao__dir');
    if (doc.pdf_path) {
      const pdf = el('button', 'pp-mini', 'Ver PDF original');
      pdf.type = 'button';
      pdf.addEventListener('click', () => abrirPdf(doc));
      dir.appendChild(pdf);
    }
    cab.appendChild(dir);
    cartao.appendChild(cab);

    secoes.forEach(({ s, i, linhas }) => {
      const bloco = el('section', 'ip-secao');
      const h = el('h4', null, s.titulo);
      if (s.tipo === 'grelha' && s.unidade) h.appendChild(el('span', 'ip-unidade', 'por ' + s.unidade));
      bloco.appendChild(h);
      bloco.appendChild(s.tipo === 'lista' ? listaVista(linhas) : grelhaVista(doc, s, i, linhas, opcoes));
      cartao.appendChild(bloco);
    });

    if (doc.notas.length && !pesquisa) {
      const ul = el('ul', 'ip-notas');
      doc.notas.forEach(n => ul.appendChild(el('li', null, n)));
      cartao.appendChild(ul);
    }
    return cartao;
  }

  async function abrirPdf(doc) {
    // A janela abre-se já (dentro do clique), para o browser não a bloquear.
    const janela = window.open('', '_blank');
    try {
      const url = await S.urlPdf(doc);
      if (janela) janela.location.href = url; else window.location.href = url;
    } catch (erro) {
      if (janela) janela.close();
      PedidosToast.erro(erro.message);
    }
  }

  // -------------------------------------------------------------------
  // Edição
  // -------------------------------------------------------------------
  let dados = null;
  let aoEstado = () => {};

  const copia = doc => JSON.parse(JSON.stringify(doc));

  async function gravar(doc, cartao) {
    if (!doc.nome.trim()) {
      aoEstado('A tabela precisa de um nome.', 'erro');
      return;
    }
    aoEstado('A guardar...', 'aguarda');
    try {
      const guardado = await S.guardarDocumento(doc);
      const i = dados.documentos.findIndex(d => d.id === doc.id);
      if (i >= 0) dados.documentos[i] = guardado;
      cartao.classList.add('is-guardada');
      setTimeout(() => cartao.classList.remove('is-guardada'), 1200);
      aoEstado('Guardado às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }), 'ok');
    } catch (erro) {
      aoEstado(erro.message, 'erro');
      PedidosToast.erro(erro.message);
    }
  }

  function input(valor, rotulo, classe, tipo) {
    const i = el('input', 'ip-ed-campo' + (classe ? ' ' + classe : ''));
    i.type = tipo || 'text';
    i.value = valor === null || valor === undefined ? '' : valor;
    i.setAttribute('aria-label', rotulo);
    return i;
  }

  function icone(texto, rotulo, fn) {
    const b = el('button', 'pp-icone-mini', texto);
    b.type = 'button';
    b.title = rotulo;
    b.setAttribute('aria-label', rotulo);
    b.addEventListener('click', fn);
    return b;
  }

  // Cada campo grava ao sair dele: liga o campo a uma função que mexe no doc.
  function ligar(campo, doc, cartao, aplicar) {
    campo.addEventListener('change', () => {
      campo.removeAttribute('aria-invalid');
      const erro = aplicar(campo.value);
      if (erro) {
        campo.setAttribute('aria-invalid', 'true');
        campo.title = erro;
        aoEstado(erro, 'erro');
        return;
      }
      campo.title = '';
      gravar(doc, cartao);
    });
    campo.addEventListener('keydown', event => { if (event.key === 'Enter') campo.blur(); });
  }

  function grelhaEdicao(doc, s, cartao) {
    const caixa = el('div', 'ip-tab-caixa');
    const tab = el('table', 'ip-tab is-edicao');
    const thead = el('thead');
    const tr = el('tr');
    tr.appendChild(el('th', 'ip-tab__canto', unidade(s)));
    s.colunas.forEach((c, i) => {
      const th = el('th');
      const campo = input(c, 'Coluna ' + (i + 1) + ' de ' + s.titulo, 'is-coluna');
      ligar(campo, doc, cartao, v => { s.colunas[i] = v.trim(); });
      th.appendChild(campo);
      tr.appendChild(th);
    });
    tr.appendChild(el('th'));
    thead.appendChild(tr);
    tab.appendChild(thead);

    const tbody = el('tbody');
    s.linhas.forEach((l, li) => {
      const r = el('tr');
      const thNome = el('th');
      const nome = input(l.nome, 'Nome da linha', 'is-nome');
      ligar(nome, doc, cartao, v => { if (!v.trim()) return 'A linha precisa de um nome.'; l.nome = v.trim(); return null; });
      thNome.appendChild(nome);
      r.appendChild(thNome);
      s.colunas.forEach((c, ci) => {
        const td = el('td');
        const campo = input(S.paraCampo(l.valores[ci]), l.nome + ', ' + c, 'is-valor');
        campo.inputMode = 'decimal';
        campo.placeholder = '-';
        ligar(campo, doc, cartao, v => {
          const lido = S.lerPreco(v);
          if (lido.erro) return lido.erro;
          l.valores[ci] = lido.valor;
          return null;
        });
        td.appendChild(campo);
        r.appendChild(td);
      });
      const tdX = el('td');
      tdX.appendChild(icone('✕', 'Apagar ' + l.nome, () => {
        s.linhas.splice(li, 1);
        redesenharDoc(doc, cartao, true);
      }));
      r.appendChild(tdX);
      tbody.appendChild(r);
    });
    tab.appendChild(tbody);
    caixa.appendChild(tab);
    return caixa;
  }

  function listaEdicao(doc, s, cartao) {
    const caixa = el('div', 'ip-ed-lista');
    s.linhas.forEach((l, li) => {
      const linha = el('div', 'ip-ed-lista__linha');
      const nome = input(l.nome, 'Custo', 'is-nome');
      ligar(nome, doc, cartao, v => { if (!v.trim()) return 'A linha precisa de um nome.'; l.nome = v.trim(); return null; });
      const texto = input(l.texto, 'Valor de ' + l.nome);
      ligar(texto, doc, cartao, v => { l.texto = v.trim(); return null; });
      linha.appendChild(nome);
      linha.appendChild(texto);
      linha.appendChild(icone('✕', 'Apagar ' + l.nome, () => {
        s.linhas.splice(li, 1);
        redesenharDoc(doc, cartao, true);
      }));
      caixa.appendChild(linha);
    });
    return caixa;
  }

  function blocoPdf(doc, cartao) {
    const bloco = el('div', 'ip-ed-pdf');
    const ficheiro = el('input');
    ficheiro.type = 'file';
    ficheiro.accept = 'application/pdf,.pdf';
    ficheiro.className = 'hidden';
    ficheiro.setAttribute('aria-label', 'Escolher o PDF de ' + doc.nome);
    ficheiro.addEventListener('change', async () => {
      const f = ficheiro.files && ficheiro.files[0];
      if (!f) return;
      aoEstado('A carregar o PDF...', 'aguarda');
      try {
        const novo = await S.carregarPdf(doc, f);
        substituirDoc(novo, cartao);
        aoEstado('PDF anexado.', 'ok');
      } catch (erro) {
        aoEstado(erro.message, 'erro');
        PedidosToast.erro(erro.message);
      }
    });
    bloco.appendChild(ficheiro);

    if (doc.pdf_path) {
      bloco.appendChild(el('span', 'ip-ed-pdf__nome', 'PDF original: ' + (doc.pdf_nome || 'documento.pdf')));
      const ver = el('button', 'pp-mini', 'Ver');
      ver.type = 'button';
      ver.addEventListener('click', () => abrirPdf(doc));
      bloco.appendChild(ver);
      const trocar = el('button', 'pp-mini', 'Trocar');
      trocar.type = 'button';
      trocar.addEventListener('click', () => ficheiro.click());
      bloco.appendChild(trocar);
      const retirar = el('button', 'pp-mini', 'Retirar');
      retirar.type = 'button';
      retirar.addEventListener('click', async () => {
        try {
          const novo = await S.retirarPdf(doc);
          substituirDoc(novo, cartao);
          aoEstado('PDF retirado.', 'ok');
        } catch (erro) {
          PedidosToast.erro(erro.message);
        }
      });
      bloco.appendChild(retirar);
    } else {
      bloco.appendChild(el('span', 'ip-ed-pdf__nome', 'Sem PDF original.'));
      const anexar = el('button', 'pp-mini', 'Anexar PDF');
      anexar.type = 'button';
      anexar.addEventListener('click', () => ficheiro.click());
      bloco.appendChild(anexar);
    }
    return bloco;
  }

  // Por ordem alfabética, como na consulta; a linha acabada de criar fica no
  // fim, onde a pessoa a está a escrever, até ao próximo desenho.
  function ordenarLinhas(doc) {
    doc.secoes.forEach(s => {
      s.linhas.sort((a, b) => (a._nova ? 1 : 0) - (b._nova ? 1 : 0) || S.porNome(a, b));
    });
  }

  function cartaoEdicao(doc) {
    ordenarLinhas(doc);
    const cartao = el('section', 'ip-cartao is-edicao ip-doc');
    cartao.dataset.doc = doc.id;
    cartao.id = 'ip-ed-doc-' + doc.id;

    const cab = el('header', 'ip-cartao__cab');
    cab.appendChild(el('h3', null, doc.nome || 'Tabela de fornecedor'));
    cartao.appendChild(cab);

    const meta = el('div', 'ip-ed-meta');
    const campo = (rotulo, controlo) => {
      const l = el('label', 'ip-ed-meta__campo');
      l.appendChild(el('span', null, rotulo));
      l.appendChild(controlo);
      return l;
    };
    const nome = input(doc.nome, 'Nome da tabela');
    ligar(nome, doc, cartao, v => { if (!v.trim()) return 'A tabela precisa de um nome.'; doc.nome = v.trim(); cab.querySelector('h3').textContent = doc.nome; return null; });
    const forn = input(doc.fornecedor, 'Fornecedor');
    ligar(forn, doc, cartao, v => { doc.fornecedor = v.trim(); return null; });
    const data = input(doc.data_tabela || '', 'Data da tabela', null, 'date');
    ligar(data, doc, cartao, v => { doc.data_tabela = v || null; return null; });
    const val = input(doc.validade_meses === null ? '' : doc.validade_meses, 'Validade em meses', 'is-curto', 'number');
    val.min = '1';
    val.max = '60';
    ligar(val, doc, cartao, v => {
      if (v === '') { doc.validade_meses = null; return null; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 60) return 'A validade é um número de meses, de 1 a 60.';
      doc.validade_meses = n;
      return null;
    });
    meta.appendChild(campo('Nome', nome));
    meta.appendChild(campo('Fornecedor', forn));
    meta.appendChild(campo('Data da tabela', data));
    meta.appendChild(campo('Validade (meses)', val));
    cartao.appendChild(meta);
    cartao.appendChild(blocoPdf(doc, cartao));

    doc.secoes.forEach(s => {
      const bloco = el('section', 'ip-secao');
      const h = el('div', 'ip-ed-secao__cab');
      const titulo = input(s.titulo, 'Título da secção', 'is-titulo');
      ligar(titulo, doc, cartao, v => { s.titulo = v.trim(); return null; });
      h.appendChild(titulo);
      if (s.tipo === 'grelha') {
        const un = input(s.unidade, 'Unidade de ' + s.titulo, 'is-curto');
        un.placeholder = 'peça, kg';
        ligar(un, doc, cartao, v => { s.unidade = v.trim(); return null; });
        const l = el('label', 'ip-ed-meta__campo is-inline');
        l.appendChild(el('span', null, '€ por'));
        l.appendChild(un);
        h.appendChild(l);
        if (s.colunas.length > 1) {
          const marca = el('label', 'ip-ed-maximo');
          const caixa = el('input');
          caixa.type = 'checkbox';
          caixa.checked = !!s.maximo;
          caixa.addEventListener('change', () => { s.maximo = caixa.checked; gravar(doc, cartao); });
          marca.appendChild(caixa);
          marca.appendChild(document.createTextNode('Destacar o preço mais caro de cada linha'));
          h.appendChild(marca);
        }
      }
      bloco.appendChild(h);
      bloco.appendChild(s.tipo === 'grelha' ? grelhaEdicao(doc, s, cartao) : listaEdicao(doc, s, cartao));
      const mais = el('button', 'ip-ed-mais', '+ Linha em ' + (s.titulo || 'esta secção'));
      mais.type = 'button';
      mais.addEventListener('click', () => {
        s.linhas.push(s.tipo === 'grelha'
          ? { nome: 'Nova linha', valores: s.colunas.map(() => null), _nova: true }
          : { nome: 'Novo custo', texto: '', _nova: true });
        redesenharDoc(doc, cartao, true, s.tipo === 'grelha' ? 'tbody tr:last-child .is-nome' : '.ip-ed-lista__linha:last-child .is-nome', bloco);
      });
      bloco.appendChild(mais);
      cartao.appendChild(bloco);
    });

    const notas = el('label', 'ip-ed-meta__campo is-notas');
    notas.appendChild(el('span', null, 'Notas (uma por linha)'));
    const ta = el('textarea', 'ip-ed-campo is-notas');
    ta.rows = Math.max(2, doc.notas.length);
    ta.value = doc.notas.join('\n');
    ta.setAttribute('aria-label', 'Notas de ' + doc.nome);
    ta.addEventListener('change', () => {
      doc.notas = ta.value.split('\n').map(n => n.trim()).filter(Boolean);
      gravar(doc, cartao);
    });
    notas.appendChild(ta);
    cartao.appendChild(notas);
    return cartao;
  }

  // Depois de acrescentar ou tirar uma linha: grava e desenha outra vez.
  function redesenharDoc(doc, cartao, gravarJa, focar, bloco) {
    const iSecao = bloco ? [...cartao.querySelectorAll('.ip-secao')].indexOf(bloco) : -1;
    const novo = cartaoEdicao(doc);
    cartao.replaceWith(novo);
    if (gravarJa) gravar(doc, novo);
    if (focar && iSecao >= 0) {
      const alvo = novo.querySelectorAll('.ip-secao')[iSecao].querySelector(focar);
      if (alvo) { alvo.focus(); alvo.select(); }
    }
  }

  function substituirDoc(guardado, cartao) {
    const i = dados.documentos.findIndex(d => d.id === guardado.id);
    if (i >= 0) dados.documentos[i] = guardado;
    cartao.replaceWith(cartaoEdicao(copia(guardado)));
  }

  function edicao(alvo, partilhados, opcoes) {
    dados = partilhados;
    aoEstado = (opcoes && opcoes.aoEstado) || (() => {});
    const bloco = el('div', 'ip-docs');
    bloco.appendChild(el('h2', 'ip-ed-titulo', 'Tabelas de fornecedor'));
    dados.documentos.forEach(d => bloco.appendChild(cartaoEdicao(copia(d))));
    alvo.appendChild(bloco);
  }

  return { vista, edicao };
})();
