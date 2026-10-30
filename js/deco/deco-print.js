// Impressão das fichas de decoração — A4 retrato, uma página por ficha.
//
// Não há pré-visualização nem escolha de formato: o botão Imprimir monta a
// folha fora do campo de visão e chama logo a caixa de impressão do browser.
// A folha é DOM real ao tamanho exato de A4 a 96 dpi (794×1123 px), por isso o
// que o browser mostra na sua própria pré-visualização é o que sai na
// impressora, e o croqui usa o mesmo motor de desenho do editor
// (CroquiEditor.renderStatic).
//
// A tabela impressa é deliberadamente mais curta do que a do editor: só
// Posição, Descrição e os tamanhos preenchidos, com o valor JÁ CALCULADO — é
// o que o fornecedor precisa de ler, sem as parcelas que lhe deram origem.
const DecoPrint = (() => {
  const sheetsEl = document.getElementById('decoPrintSheets');

  // Painel do croqui na folha: 4:3, igual ao aspect-ratio do editor, para que
  // as coordenadas normalizadas caiam exatamente no mesmo sítio.
  const CROQUI_W = 352;
  const CROQUI_H = 264;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function band(text) {
    return el('div', 'deco-sheet__band', text);
  }

  // Nome de quem finalizou/atualizou a ficha (ver deco-nomes.js).
  function nomeDe(email) {
    return DecoNomes.deEmail(email);
  }

  function dataCurta(iso) {
    return iso ? new Date(iso).toLocaleDateString('pt-PT') : '';
  }

  function tecnicaLabel(ficha) {
    const bits = [];
    if (ficha.estampado) bits.push('Estampado');
    if (ficha.bordado) bits.push('Bordado');
    return bits.join(' + ') || 'Por definir';
  }

  function colocacaoLabel(ficha) {
    const bits = [];
    // Na base de dados continua a guardar-se 'Frente'/'Verso'; no ecrã é Exterior/Interior.
    const tipos = { Frente: 'Exterior', Verso: 'Interior' };
    if (ficha.colocacao_tipo) bits.push(tipos[ficha.colocacao_tipo] || ficha.colocacao_tipo);
    if (ficha.colocacao_texto) bits.push(ficha.colocacao_texto);
    return bits.join(' — ');
  }

  // --- tabela reduzida ----------------------------------------------------
  // Só vão para a folha as linhas que dão mesmo um valor calculado: uma linha
  // com descrição mas sem medidas não diz nada ao fornecedor e só ocupa espaço.
  function linhasComConteudo(ficha) {
    const posicoes = Array.isArray(ficha.posicoes) ? ficha.posicoes : [];
    const tamanhos = Array.isArray(ficha.tamanhos) ? ficha.tamanhos : [];
    return posicoes.filter(pos =>
      tamanhos.some((_, index) => DecoEditor.calcular(pos, index) !== null));
  }

  // Só entram os tamanhos que têm mesmo valor calculado nalguma linha.
  function tamanhosPreenchidos(ficha, linhas) {
    const tamanhos = Array.isArray(ficha.tamanhos) ? ficha.tamanhos : [];
    const usados = [];
    tamanhos.forEach((nome, index) => {
      if (linhas.some(pos => DecoEditor.calcular(pos, index) !== null)) usados.push(index);
    });
    return usados;
  }

  function posicoesTable(ficha) {
    const linhas = linhasComConteudo(ficha);
    if (!linhas.length) return null;
    const colunas = tamanhosPreenchidos(ficha, linhas);

    const table = el('table', 'deco-sheet__table');
    const thead = el('thead');
    const headRow = el('tr');
    headRow.appendChild(el('th', 'is-narrow', 'Pos.'));
    headRow.appendChild(el('th', 'is-wide', 'Descrição'));
    colunas.forEach(index => headRow.appendChild(el('th', null, ficha.tamanhos[index])));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const todas = Array.isArray(ficha.posicoes) ? ficha.posicoes : [];
    const tbody = el('tbody');
    linhas.forEach(pos => {
      const tr = el('tr');
      const letra = el('td', 'is-narrow is-letter');
      if (pos.letra) letra.appendChild(el('span', 'deco-sheet__letter-badge', pos.letra));
      tr.appendChild(letra);
      // O prefixo é da linha (a 1.ª é a vertical, a 2.ª a horizontal), por isso
      // vem do lugar que a posição ocupa na ficha, não do filtro já aplicado.
      tr.appendChild(el('td', 'is-wide',
        DecoEditor.descricaoCompleta(pos, todas.indexOf(pos))));

      // Colunas seguidas com o MESMO valor calculado saem unidas: é assim que
      // a folha fica a dizer "de XS a XL mede o mesmo" numa célula só, em vez
      // de repetir o número. Dispensa as uniões feitas à mão no editor —
      // essas dão valores iguais e caem naturalmente neste agrupamento.
      let i = 0;
      while (i < colunas.length) {
        const valor = DecoEditor.formatar(DecoEditor.calcular(pos, colunas[i]));
        let fim = i + 1;
        while (fim < colunas.length
          && DecoEditor.formatar(DecoEditor.calcular(pos, colunas[fim])) === valor) fim += 1;
        const cell = el('td', null, valor);
        if (fim - i > 1) {
          cell.colSpan = fim - i;
          cell.classList.add('is-unido');
        }
        tr.appendChild(cell);
        i = fim;
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // --- imagens -------------------------------------------------------------
  // As imagens (croqui e fotos da paleta) estão num bucket privado e chegam por
  // URL assinado: primeiro um pedido ao Supabase pelo URL, depois a descarga da
  // imagem. Cada carregamento fica registado em "coletor" (um por folha) para o
  // imprimir() esperar por TODOS antes de abrir a caixa de impressão. Esperar um
  // tempo fixo não chega: com o URL a demorar mais do que isso, a impressão
  // arrancava com os painéis vazios.
  let coletor = null;

  function carregarImagem(img, caminho, descricao) {
    const tarefa = (async () => {
      // Duas tentativas: o URL assinado ou a descarga podem falhar uma vez.
      for (let tentativa = 0; tentativa < 2; tentativa += 1) {
        const url = await DecoImages.getSignedUrl(caminho);
        if (!url) continue;
        const ok = await new Promise(resolve => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (ok) {
          // Descodificada antes de imprimir (uma imagem grande pode estar
          // "carregada" mas ainda por desenhar).
          try { await img.decode(); } catch (erro) { /* já está desenhável */ }
          return { ok: true, descricao };
        }
      }
      return { ok: false, descricao };
    })();
    if (coletor) coletor.push(tarefa);
    return tarefa;
  }

  // --- croqui --------------------------------------------------------------
  function croquiPanel(ficha, key, title) {
    const data = (ficha.croqui && ficha.croqui[key]) || { imagem: null, anotacoes: [] };
    const wrap = el('div', 'deco-sheet__croqui');
    wrap.appendChild(el('p', 'deco-sheet__croqui-title', title));

    const stage = el('div', 'deco-sheet__croqui-stage');
    stage.style.width = CROQUI_W + 'px';
    stage.style.height = CROQUI_H + 'px';

    if (data.imagem && data.imagem.path) {
      const frame = el('div', 'deco-sheet__croqui-frame');
      frame.style.left = (data.imagem.x || 0) * 100 + '%';
      frame.style.top = (data.imagem.y || 0) * 100 + '%';
      frame.style.width = (data.imagem.escala || 1) * 100 + '%';
      const rot = Number(data.imagem.rotacao) || 0;
      if (rot) frame.style.transform = 'rotate(' + rot + 'deg)';
      const img = document.createElement('img');
      img.alt = title;
      carregarImagem(img, data.imagem.path, title);
      frame.appendChild(img);
      stage.appendChild(frame);
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'deco-sheet__croqui-svg');
    CroquiEditor.renderStatic(svg, data, CROQUI_W, CROQUI_H, posicaoId => {
      const pos = (ficha.posicoes || []).find(p => p.id === posicaoId);
      return pos ? pos.letra : null;
    });
    stage.appendChild(svg);

    wrap.appendChild(stage);
    return wrap;
  }

  // --- paleta ---------------------------------------------------------------
  function paletaTable(paleta) {
    const cores = (paleta && Array.isArray(paleta.cores)) ? paleta.cores : [];
    const bases = (paleta && Array.isArray(paleta.cores_base)) ? paleta.cores_base : [];
    if (!cores.length && !bases.length) return null;

    // Cores do artigo em colunas e cores base em linhas (a foto da cor base,
    // se houver, na primeira coluna da linha).
    // A coluna da foto só aparece se alguma cor base tiver mesmo imagem.
    const comFoto = bases.some(base => base.foto);

    const table = el('table', 'deco-sheet__table deco-sheet__table--paleta');
    const thead = el('thead');
    const headRow = el('tr');
    if (comFoto) headRow.appendChild(el('th', 'is-foto', 'Foto'));
    headRow.appendChild(el('th', 'is-wide', 'Cor base'));
    cores.forEach(cor => headRow.appendChild(el('th', null, cor || '')));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    bases.forEach(base => {
      const tr = el('tr');
      if (comFoto) {
        const fotoCell = el('td', 'is-foto');
        if (base.foto) {
          const img = document.createElement('img');
          img.alt = base.nome || 'Cor base';
          carregarImagem(img, base.foto, 'Foto da cor ' + (base.nome || 'base'));
          fotoCell.appendChild(img);
        }
        tr.appendChild(fotoCell);
      }
      tr.appendChild(el('td', 'is-wide', base.nome || ''));
      cores.forEach((_, index) => {
        tr.appendChild(el('td', 'is-mark', base.marcas && base.marcas[index] ? 'X' : ''));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // --- folha ----------------------------------------------------------------
  function tile(label, value) {
    const box = el('div', 'deco-sheet__tile');
    box.appendChild(el('span', 'deco-sheet__tile-label', label));
    box.appendChild(el('span', 'deco-sheet__tile-value', value || '—'));
    return box;
  }

  function campo(label, value) {
    const box = el('div', 'deco-sheet__campo');
    box.appendChild(el('span', 'deco-sheet__campo-label', label));
    box.appendChild(el('span', 'deco-sheet__campo-value', value || '—'));
    return box;
  }

  function metaLine(label, value) {
    const line = el('div', 'deco-sheet__meta-line');
    line.appendChild(el('span', 'deco-sheet__meta-label', label));
    line.appendChild(el('span', 'deco-sheet__meta-value', value || '—'));
    return line;
  }

  function buildSheet(ficha) {
    const sheet = el('div', 'deco-sheet');
    const fase = (ficha.fases && ficha.fases[ficha.fase_ativa]) || {};

    // Regista os carregamentos de imagens desta folha (ver carregarImagem).
    const anterior = coletor;
    coletor = [];
    sheet.carregamentos = coletor;
    try {
      return montarFolha(sheet, ficha, fase);
    } finally {
      coletor = anterior;
    }
  }

  function montarFolha(sheet, ficha, fase) {

    const hero = el('div', 'deco-sheet__hero');

    // Logótipo empilhado à esquerda (desenhado por css/deco.css).
    const logo = el('div', 'deco-sheet__logo');
    logo.setAttribute('role', 'img');
    logo.setAttribute('aria-label', 'Sourcetextile');
    hero.appendChild(logo);

    const heroMain = el('div', 'deco-sheet__hero-main');
    heroMain.appendChild(el('p', 'deco-sheet__hero-eyebrow', 'Ficha de decorações'));
    const titulo = el('h1', 'deco-sheet__hero-title');
    titulo.appendChild(el('span', 'deco-sheet__hero-ref', ficha.ref_nosso_modelo || '—'));
    if (ficha.ofs) titulo.appendChild(el('span', 'deco-sheet__hero-of', 'OF ' + ficha.ofs));
    heroMain.appendChild(titulo);
    heroMain.appendChild(el('p', 'deco-sheet__hero-sub', tecnicaLabel(ficha)));
    hero.appendChild(heroMain);

    const heroMeta = el('div', 'deco-sheet__hero-meta');
    heroMeta.appendChild(metaLine('Fase', ficha.fase_ativa || 'SMS'));
    if (fase.finalizada_em) {
      heroMeta.appendChild(metaLine('Finalizada', dataCurta(fase.finalizada_em)));
      heroMeta.appendChild(metaLine('Por', nomeDe(fase.finalizada_por)));
    } else {
      heroMeta.appendChild(metaLine('Atualizada', dataCurta(ficha.updated_at)));
      heroMeta.appendChild(metaLine('Por', nomeDe(ficha.updated_by)));
    }
    hero.appendChild(heroMeta);
    sheet.appendChild(hero);

    const strip = el('div', 'deco-sheet__strip');
    strip.appendChild(tile('Fornecedor', ficha.fornecedor));
    strip.appendChild(tile('Referência da decoração', ficha.referencia_decoracao));
    if (ficha.certificacao) strip.appendChild(tile('Certificação', ficha.certificacao));
    sheet.appendChild(strip);

    // Ordem da folha: medidas, depois croqui e colocação, comentários e paleta.
    const tabela = posicoesTable(ficha);
    if (tabela) {
      sheet.appendChild(band('Medidas por tamanho'));
      sheet.appendChild(tabela);
    }

    sheet.appendChild(band('Croqui e colocação'));
    const bloco = el('div', 'deco-sheet__croquis');
    const paineis = el('div', 'deco-sheet__croqui-paineis');
    paineis.appendChild(croquiPanel(ficha, 'arte', 'Arte'));
    paineis.appendChild(croquiPanel(ficha, 'desenho_tecnico', 'Desenho técnico'));
    bloco.appendChild(paineis);

    // A colocação e as partes ficam junto ao croqui, que é onde se lêem.
    const colocacao = el('div', 'deco-sheet__colocacao');
    colocacao.appendChild(campo('Colocação', colocacaoLabel(ficha)));
    colocacao.appendChild(campo('Partes', ficha.colocacao_partes));
    bloco.appendChild(colocacao);
    sheet.appendChild(bloco);

    const texto = ((ficha.comentarios && ficha.comentarios.texto) || '').trim();
    if (texto) {
      sheet.appendChild(band('Comentários'));
      const note = el('div', 'deco-sheet__note');
      const body = el('div', 'deco-sheet__note-body');
      body.innerHTML = DecoEditor.sanitizeHtml((ficha.comentarios && ficha.comentarios.html) || '');
      note.appendChild(body);
      sheet.appendChild(note);
    }

    const paleta = paletaTable(ficha.paleta);
    if (paleta) {
      sheet.appendChild(band((ficha.paleta && ficha.paleta.titulo) || 'Paleta de cores'));
      sheet.appendChild(paleta);
    }

    const footer = el('div', 'deco-sheet__footer');
    footer.appendChild(el('span', null, 'Sourcetextile · ' + (ficha.ref_nosso_modelo || '')
      + (ficha.ofs ? ' · OF ' + ficha.ofs : '')));
    footer.appendChild(el('span', null, 'Mod.013.01'));
    sheet.appendChild(footer);

    return sheet;
  }

  const LIMITE_IMAGENS_MS = 30000;

  // Espera por todas as imagens de todas as folhas. Devolve a lista das que
  // não chegaram a carregar (vazia = está tudo pronto para imprimir).
  async function esperarImagens(folhas) {
    const tarefas = folhas.flatMap(folha => folha.carregamentos || []);
    if (!tarefas.length) return [];
    const resultados = await Promise.race([
      Promise.all(tarefas),
      new Promise(resolve => setTimeout(() => resolve(null), LIMITE_IMAGENS_MS))
    ]);
    // Passou o tempo: as que ainda estavam por acabar contam como falhadas.
    if (!resultados) return ['uma ou mais imagens (demoraram demasiado)'];
    return resultados.filter(r => !r.ok).map(r => r.descricao);
  }

  async function imprimir(fichas) {
    const lista = (fichas || []).filter(Boolean);
    sheetsEl.innerHTML = '';
    if (!lista.length) return;
    const folhas = lista.map(ficha => buildSheet(ficha));
    folhas.forEach(folha => sheetsEl.appendChild(folha));

    // Enquanto as imagens chegam, o cursor mostra que a aplicação está a
    // trabalhar (senão parece que o botão não fez nada).
    document.body.style.cursor = 'progress';
    let falhadas;
    try {
      falhadas = await esperarImagens(folhas);
    } finally {
      document.body.style.cursor = '';
    }
    if (falhadas.length) {
      // Em vez de imprimir com um painel vazio sem dizer nada, avisa.
      const continuar = await DecoDialog.confirmar({
        titulo: 'Imagens por carregar',
        mensagem: 'Não foi possível carregar: ' + falhadas.join(', ')
          + '. Se imprimires agora, estas imagens vão faltar na folha.',
        confirmar: 'Imprimir mesmo assim',
        cancelar: 'Cancelar'
      });
      if (!continuar) {
        sheetsEl.innerHTML = '';
        return;
      }
    }
    window.print();
  }

  function limpar() {
    sheetsEl.innerHTML = '';
  }

  return { imprimir, limpar, buildSheet };
})();
