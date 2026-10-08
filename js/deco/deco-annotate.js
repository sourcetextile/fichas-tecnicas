// Croqui: painel de imagem + motor de anotações SVG (arte / desenho técnico).
//
// Coordenadas — imagem (x, y, escala) e pontos das anotações — são SEMPRE
// normalizadas 0–1 relativas ao painel, nunca pixels. O desenho converte para
// px no momento de renderizar (viewBox = tamanho real medido), por isso o
// mesmo dado desenha igual em qualquer ecrã e na folha impressa, sem esticar
// traços nem texto.
//
// Defaults retirados do XML dos ficheiros Excel reais (SWANIAW, SWASUAW,
// TSC10DSS): linhas tracejadas #FF0000 a 28575 EMU = 2,25 pt e cotas de dupla
// ponta a 38100 EMU = 3 pt.
const CroquiEditor = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PX_PER_PT = 96 / 72;

  // Colar com Ctrl+V: o evento "paste" so chega ao elemento com foco, e depois
  // de clicar num botao (ex.: "Importar") ou noutro campo o foco ja nao esta no
  // painel. Por isso ouve-se no documento e a imagem vai para o painel onde o
  // rato esteve / se clicou por ultimo. Em campos de texto cola-se texto normal.
  let painelAtivo = null;
  document.addEventListener('paste', event => {
    if (!painelAtivo || !painelAtivo.container.isConnected || !painelAtivo.container.offsetParent) return;
    const alvo = event.target;
    if (alvo && alvo.closest && alvo.closest('input, textarea, select, [contenteditable="true"]')) return;
    const data = event.clipboardData;
    if (!data) return;
    let file = null;
    for (const item of data.items || []) {
      if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
        file = item.getAsFile();
        break;
      }
    }
    if (!file && data.files) file = Array.from(data.files).find(f => f.type && f.type.startsWith('image/')) || null;
    if (!file) {
      // Nada de texto nem de imagem utilizavel: avisa em vez de ficar calado.
      if (!data.getData('text/plain')) {
        painelAtivo.aviso('Não há nenhuma imagem copiada. Copia a imagem (ou usa "Importar") e tenta outra vez.');
      }
      return;
    }
    event.preventDefault();
    painelAtivo.importar(file);
  });

  const DEFAULTS = {
    linha_tracejada: { cor: '#FF0000', espessura: 2.25 },
    linha: { cor: '#FF0000', espessura: 2.25 },
    seta_dupla: { cor: '#FF0000', espessura: 3 },
    seta: { cor: '#FF0000', espessura: 3 },
    retangulo: { cor: '#FF0000', espessura: 2.25 },
    circulo: { cor: '#FF0000', espessura: 2.25 },
    mao_livre: { cor: '#FF0000', espessura: 2.25 },
    etiqueta: { cor: '#FF0000', tamanho_texto: 14 },
    texto: { cor: '#000000', tamanho_texto: 14 }
  };

  const MAIN_TOOLS = [
    { id: 'imagem', icon: '✥', label: 'Imagem', title: 'Mover e redimensionar a imagem' },
    { id: 'selecionar', icon: '↖', label: 'Selecionar', title: 'Selecionar, mover e editar anotações' },
    { id: 'linha_tracejada', icon: '┈', label: 'Tracejada', title: 'Linha tracejada — 2,25 pt vermelho' },
    { id: 'linha', icon: '─', label: 'Linha', title: 'Linha contínua — 2,25 pt vermelho' },
    { id: 'seta_dupla', icon: '↔', label: 'Cota', title: 'Cota com seta nas duas pontas — 3 pt vermelho' },
    { id: 'texto', icon: 'T', label: 'Texto', title: 'Texto livre — 14 pt preto' }
  ];

  const MORE_TOOLS = [
    { id: 'retangulo', label: 'Retângulo tracejado' },
    { id: 'circulo', label: 'Círculo' },
    { id: 'seta', label: 'Seta simples' },
    { id: 'mao_livre', label: 'Mão livre' }
  ];

  const WIDTHS = [1, 1.5, 2.25, 3, 4.5];
  const TWO_POINT = ['linha', 'linha_tracejada', 'seta', 'seta_dupla', 'retangulo', 'circulo'];
  const LINE_LIKE = ['linha', 'linha_tracejada', 'seta', 'seta_dupla'];
  const BOX_LIKE = ['retangulo', 'circulo'];

  // Caixa ocupada pela imagem, em coordenadas normalizadas do painel. E a
  // base da ancoragem: uma anotacao com ancora "imagem" guarda os pontos em
  // fraccao da propria imagem, por isso acompanha-a quando ela e movida ou
  // redimensionada - uma cota do inicio ao fim da manga continua do inicio ao
  // fim da manga.
  function imageBox(imagem, width, height) {
    if (!imagem) return null;
    const natW = Number(imagem.largura_natural) || 0;
    const natH = Number(imagem.altura_natural) || 0;
    if (!(natW > 0) || !(natH > 0) || !(width > 0) || !(height > 0)) return null;
    const boxW = imagem.escala;
    const boxH = imagem.escala * width * (natH / natW) / height;
    if (!(boxW > 0) || !(boxH > 0)) return null;
    return {
      x: imagem.x, y: imagem.y, w: boxW, h: boxH,
      rot: Number(imagem.rotacao) || 0,
      W: width, H: height
    };
  }

  // A rotacao tem de ser feita em pixeis, nao em coordenadas normalizadas: os
  // dois eixos do painel nao tem a mesma escala, e rodar direto no espaco
  // normalizado deformava o angulo.
  function rotateAround(px, py, box, sentido) {
    if (!box.rot) return [px, py];
    const rad = sentido * box.rot * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = (box.x + box.w / 2) * box.W;
    const cy = (box.y + box.h / 2) * box.H;
    const dx = px * box.W - cx;
    const dy = py * box.H - cy;
    return [(cx + dx * cos - dy * sin) / box.W, (cy + dx * sin + dy * cos) / box.H];
  }

  function toPanelPoints(pontos, ancora, box) {
    if (ancora !== 'imagem' || !box) return pontos.map(point => point.slice());
    return pontos.map(point => rotateAround(
      box.x + point[0] * box.w,
      box.y + point[1] * box.h,
      box, 1
    ));
  }

  function toStoredPoints(pontos, ancora, box) {
    if (ancora !== 'imagem' || !box) return pontos.map(point => point.slice());
    return pontos.map(point => {
      const sem = rotateAround(point[0], point[1], box, -1);
      return [(sem[0] - box.x) / box.w, (sem[1] - box.y) / box.h];
    });
  }

  // Traco a mao livre suavizado (curvas por entre os pontos medios), senao
  // sai sempre com o aspecto serrilhado de uma polilinha.
  function smoothPath(pts) {
    if (pts.length < 3) return 'M ' + pts.map(point => point[0] + ',' + point[1]).join(' L ');
    let d = 'M ' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i += 1) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ' Q ' + pts[i][0] + ',' + pts[i][1] + ' ' + mx + ',' + my;
    }
    const last = pts[pts.length - 1];
    return d + ' L ' + last[0] + ',' + last[1];
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(key => {
        if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  // Fecha qualquer menu "⋯" aberto quando se clica fora dele (o <details>
  // sozinho ficaria aberto). Registado uma única vez para todos os painéis.
  let outsideBound = false;
  function bindOutsideClose() {
    if (outsideBound) return;
    outsideBound = true;
    document.addEventListener('click', event => {
      document.querySelectorAll('details.croqui-more[open]').forEach(details => {
        if (!details.contains(event.target)) details.open = false;
      });
    });
  }

  function newId() {
    return (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now() + Math.random());
  }

  // ---------------------------------------------------------------------
  // Desenho puro — partilhado pelo modo interativo e pela impressão.
  // ---------------------------------------------------------------------
  function drawInto(svg, data, width, height, ctx) {
    ctx = ctx || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!(width > 0) || !(height > 0)) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const defs = svgEl('defs');
    svg.appendChild(defs);

    ctx.box = imageBox(data.imagem, width, height);
    const list = Array.isArray(data.anotacoes) ? data.anotacoes : [];
    list.forEach(ann => {
      const group = drawAnnotation(ann, width, height, defs, ctx);
      if (group) svg.appendChild(group);
    });
  }

  function arrowMarker(defs, id, cor) {
    const marker = svgEl('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: 9.5,
      refY: 5,
      markerWidth: 4,
      markerHeight: 4,
      markerUnits: 'strokeWidth',
      orient: 'auto-start-reverse'
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: cor }));
    defs.appendChild(marker);
    return `url(#${id})`;
  }

  function drawAnnotation(ann, width, height, defs, ctx) {
    const norm = toPanelPoints(ann.pontos || [], ann.ancora, ctx.box);
    const pts = norm.map(p => [p[0] * width, p[1] * height]);
    if (!pts.length) return null;

    const cor = ann.cor || '#FF0000';
    const sw = Math.max(0.5, (ann.espessura || 2.25) * PX_PER_PT);
    const group = svgEl('g', { 'data-ann-id': ann.id, class: 'croqui-ann' });

    const shapes = [];
    let hit = null;

    if (ann.tipo === 'linha' || ann.tipo === 'linha_tracejada' || ann.tipo === 'seta' || ann.tipo === 'seta_dupla') {
      const [a, b] = [pts[0], pts[1] || pts[0]];
      const line = svgEl('line', {
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: cor, 'stroke-width': sw, 'stroke-linecap': 'round', fill: 'none'
      });
      if (ann.tipo === 'linha_tracejada') line.setAttribute('stroke-dasharray', `${sw * 3} ${sw * 2}`);
      if (ann.tipo === 'seta' || ann.tipo === 'seta_dupla') {
        line.setAttribute('marker-end', arrowMarker(defs, `mk-${ann.id}-e`, cor));
      }
      if (ann.tipo === 'seta_dupla') {
        line.setAttribute('marker-start', arrowMarker(defs, `mk-${ann.id}-s`, cor));
      }
      shapes.push(line);
      hit = svgEl('line', {
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: 'transparent', 'stroke-width': Math.max(14, sw + 10), fill: 'none'
      });
    } else if (ann.tipo === 'retangulo') {
      const [a, b] = [pts[0], pts[1] || pts[0]];
      const box = {
        x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1])
      };
      const rect = svgEl('rect', Object.assign({}, box, {
        fill: 'none', stroke: cor, 'stroke-width': sw, 'stroke-dasharray': `${sw * 3} ${sw * 2}`
      }));
      shapes.push(rect);
      hit = svgEl('rect', Object.assign({}, box, {
        fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, sw + 10)
      }));
    } else if (ann.tipo === 'circulo') {
      const [a, b] = [pts[0], pts[1] || pts[0]];
      const geo = {
        cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2,
        rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2
      };
      shapes.push(svgEl('ellipse', Object.assign({}, geo, { fill: 'none', stroke: cor, 'stroke-width': sw })));
      hit = svgEl('ellipse', Object.assign({}, geo, {
        fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, sw + 10)
      }));
    } else if (ann.tipo === 'mao_livre') {
      const d = smoothPath(pts);
      shapes.push(svgEl('path', {
        d, fill: 'none', stroke: cor, 'stroke-width': sw,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));
      hit = svgEl('path', {
        d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, sw + 10)
      });
    } else if (ann.tipo === 'texto' || ann.tipo === 'etiqueta') {
      const size = (ann.tamanho_texto || 14) * PX_PER_PT;
      const label = ann.tipo === 'etiqueta'
        ? (ctx.labelFor ? ctx.labelFor(ann.posicao_id) : null) || ann.texto || '?'
        : (ann.texto || '');
      const text = svgEl('text', {
        x: pts[0][0], y: pts[0][1],
        fill: cor,
        'font-size': size,
        'font-family': 'Calibri, Carlito, Arial, sans-serif',
        'font-weight': ann.tipo === 'etiqueta' ? 'bold' : 'normal',
        'dominant-baseline': 'middle',
        'text-anchor': ann.tipo === 'etiqueta' ? 'middle' : 'start',
        stroke: '#FFFFFF',
        'stroke-width': Math.max(2, size / 7),
        'paint-order': 'stroke fill'
      });
      text.textContent = label;
      shapes.push(text);
      const half = Math.max(size, label.length * size * 0.32);
      hit = svgEl('rect', {
        x: pts[0][0] - (ann.tipo === 'etiqueta' ? half / 2 : 0),
        y: pts[0][1] - size * 0.75,
        width: Math.max(half, size), height: size * 1.5,
        fill: 'transparent'
      });
    } else {
      return null;
    }

    if (hit) {
      hit.setAttribute('class', 'croqui-ann__hit');
      group.appendChild(hit);
    }
    shapes.forEach(shape => group.appendChild(shape));

    if (ann.tipo === 'etiqueta' && ctx.tooltipFor) {
      const tip = svgEl('title');
      tip.textContent = ctx.tooltipFor(ann.posicao_id) || '';
      group.appendChild(tip);
    }

    if (ctx.selectedId === ann.id) {
      group.setAttribute('class', 'croqui-ann croqui-ann--selected');
      if (ann.tipo === 'texto' || ann.tipo === 'etiqueta') {
        // Num texto, uma pega quadrada em cima do ponto tapava as proprias
        // letras (uma etiqueta "A" desaparecia por completo ao ser
        // selecionada). Aqui a seleccao e uma moldura a toda a volta.
        const bounds = hit ? {
          x: Number(hit.getAttribute('x')),
          y: Number(hit.getAttribute('y')),
          width: Number(hit.getAttribute('width')),
          height: Number(hit.getAttribute('height'))
        } : null;
        if (bounds) {
          group.appendChild(svgEl('rect', {
            x: bounds.x - 2, y: bounds.y - 2,
            width: bounds.width + 4, height: bounds.height + 4,
            class: 'croqui-ann__outline'
          }));
        }
      } else if (BOX_LIKE.includes(ann.tipo)) {
        // Um retangulo so com duas pegas obrigava a refazer a forma para
        // ajustar os outros dois cantos. Agora tem os quatro.
        const [a, b] = [pts[0], pts[1] || pts[0]];
        const minX = Math.min(a[0], b[0]);
        const maxX = Math.max(a[0], b[0]);
        const minY = Math.min(a[1], b[1]);
        const maxY = Math.max(a[1], b[1]);
        [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].forEach((corner, index) => {
          group.appendChild(svgEl('rect', {
            x: corner[0] - 5, y: corner[1] - 5, width: 10, height: 10,
            class: 'croqui-ann__handle', 'data-handle-index': index, 'data-handle-corner': 'true'
          }));
        });
      } else {
        pts.forEach((p, index) => {
          group.appendChild(svgEl('rect', {
            x: p[0] - 5, y: p[1] - 5, width: 10, height: 10,
            class: 'croqui-ann__handle', 'data-handle-index': index
          }));
        });
      }
    }

    return group;
  }

  // ---------------------------------------------------------------------
  // Render estático (impressão / pré-visualização) — mesmo motor, sem pegas.
  // ---------------------------------------------------------------------
  function renderStatic(svg, data, width, height, labelFor) {
    drawInto(svg, data || { anotacoes: [] }, width, height, { labelFor });
  }

  // ---------------------------------------------------------------------
  // Editor interativo
  // ---------------------------------------------------------------------
  function create(containerEl, opts) {
    const data = opts.initialData && typeof opts.initialData === 'object'
      ? opts.initialData
      : { imagem: null, anotacoes: [] };
    if (!Array.isArray(data.anotacoes)) data.anotacoes = [];
    const onChange = opts.onChange || function () {};
    const getPosicoes = opts.getPosicoes || (() => []);

    const stage = containerEl.querySelector('[data-croqui-stage]');
    const frame = containerEl.querySelector('[data-croqui-frame]');
    const img = containerEl.querySelector('.croqui-stage__image');
    const hint = containerEl.querySelector('.croqui-hint');
    const svg = containerEl.querySelector('[data-croqui-svg]');
    const fileInput = containerEl.querySelector('[data-croqui-file]');
    const uploadButton = containerEl.querySelector('[data-croqui-upload]');
    const resetButton = containerEl.querySelector('[data-croqui-reset]');
    const fitButton = containerEl.querySelector('[data-croqui-fit]');
    const removeButton = containerEl.querySelector('[data-croqui-remove]');
    const rotateButtons = containerEl.querySelectorAll('[data-croqui-rotate]');
    const statusEl = containerEl.querySelector('.croqui-status');
    const handle = containerEl.querySelector('[data-croqui-handle]');
    const toolbarEl = containerEl.querySelector('[data-croqui-toolbar]');
    const labelsEl = containerEl.querySelector('[data-croqui-labels]');

    // Barra flutuante que aparece colada ao que esta selecionado (Editar /
    // Duplicar / Apagar). Sem ela, apagar uma anotacao obrigava a saber a
    // tecla Delete ou a ir ao menu "..." - foi por isso que apagar uma
    // etiqueta se tornou impossivel na pratica.
    const selectionBar = document.createElement('div');
    selectionBar.className = 'croqui-selbar hidden';
    stage.appendChild(selectionBar);

    let tool = 'selecionar';
    let pendingPosicaoId = null;
    let selectedId = null;
    let drag = null;
    let draft = null;
    let colorInput = null;
    let widthSelect = null;
    const history = [];
    let historyIndex = -1;

    function capture(element, event) {
      try { element.setPointerCapture(event.pointerId); } catch (err) { /* ponteiro já libertado */ }
    }

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text || '';
    }

    function stageSize() {
      const rect = stage.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    }

    // Conversao entre o espaco do painel (onde acontecem os gestos) e o
    // espaco guardado (fraccao da imagem, quando a anotacao esta ancorada).
    function currentBox() {
      const size = stageSize();
      return imageBox(data.imagem, size.w, size.h);
    }

    function panelPoints(ann) {
      return toPanelPoints(ann.pontos || [], ann.ancora, currentBox());
    }

    function setPanelPoints(ann, pontos) {
      ann.pontos = toStoredPoints(pontos, ann.ancora, currentBox());
    }

    function anchorNew(ann, panelPontos) {
      if (data.imagem) ann.ancora = 'imagem';
      ann.pontos = toStoredPoints(panelPontos, ann.ancora, currentBox());
      return ann;
    }

    function naturalSize() {
      const w = Number(data.imagem && data.imagem.largura_natural) || img.naturalWidth || 0;
      const h = Number(data.imagem && data.imagem.altura_natural) || img.naturalHeight || 0;
      if (w > 0 && h > 0) return { w, h };
      return null;
    }

    function labelFor(posicaoId) {
      const pos = getPosicoes().find(p => p.id === posicaoId);
      return pos ? (pos.letra || '?') : null;
    }

    function tooltipFor(posicaoId) {
      const pos = getPosicoes().find(p => p.id === posicaoId);
      if (!pos) return 'Posição removida da tabela';
      return `${pos.letra || '?'} — ${pos.descricao || '(sem descrição)'}`;
    }

    // --- histórico (snapshots completos: cobre imagem E anotações) --------
    function snapshot() {
      return JSON.stringify({ imagem: data.imagem, anotacoes: data.anotacoes });
    }

    function commit() {
      const snap = snapshot();
      if (historyIndex >= 0 && history[historyIndex] === snap) return;
      history.length = historyIndex + 1;
      history.push(snap);
      if (history.length > 60) history.shift();
      historyIndex = history.length - 1;
      onChange(data);
    }

    function applySnapshot(snap) {
      const parsed = JSON.parse(snap);
      data.imagem = parsed.imagem;
      data.anotacoes = parsed.anotacoes || [];
      selectedId = null;
      render();
      onChange(data);
    }

    function undo() {
      if (historyIndex <= 0) return;
      historyIndex -= 1;
      applySnapshot(history[historyIndex]);
    }

    function redo() {
      if (historyIndex >= history.length - 1) return;
      historyIndex += 1;
      applySnapshot(history[historyIndex]);
    }

    // --- render -----------------------------------------------------------
    function render() {
      const size = stageSize();
      if (data.imagem) {
        frame.classList.remove('hidden');
        hint.classList.add('hidden');
        frame.style.left = data.imagem.x * 100 + '%';
        frame.style.top = data.imagem.y * 100 + '%';
        frame.style.width = data.imagem.escala * 100 + '%';
        const rot = Number(data.imagem.rotacao) || 0;
        frame.style.transform = rot ? 'rotate(' + rot + 'deg)' : '';
        if (data.imagem.path && img.dataset.loadedKey !== data.imagem.path) {
          img.dataset.loadedKey = data.imagem.path;
          DecoImages.getSignedUrl(data.imagem.path).then(url => {
            if (url) img.src = url;
          });
        }
      } else {
        frame.classList.add('hidden');
        hint.classList.remove('hidden');
        img.removeAttribute('src');
        delete img.dataset.loadedKey;
      }

      handle.classList.toggle('hidden', !(data.imagem && tool === 'imagem'));
      svg.classList.toggle('croqui-svg--passive', tool === 'imagem');
      stage.dataset.tool = tool;

      // A imagem tem de ir junto: e dela que sai a caixa de referencia usada
      // para colocar as anotacoes ancoradas.
      const drawData = draft
        ? { imagem: data.imagem, anotacoes: data.anotacoes.concat([draft]) }
        : { imagem: data.imagem, anotacoes: data.anotacoes };
      drawInto(svg, drawData, size.w, size.h, { selectedId, labelFor, tooltipFor });
      updateSelectionBar();
    }

    function selBarButton(label, title, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'croqui-selbar__button';
      button.textContent = label;
      button.title = title;
      // pointerdown e travado para o clique nao chegar ao SVG (que desmarcaria
      // a seleccao antes de o botao chegar a agir).
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.stopPropagation();
        handler();
      });
      return button;
    }

    function updateSelectionBar() {
      const ann = findAnnotation(selectedId);
      const group = ann
        ? [...svg.querySelectorAll('[data-ann-id]')].find(node => node.dataset.annId === ann.id)
        : null;
      if (!ann || !group || drag) {
        selectionBar.classList.add('hidden');
        return;
      }

      let box = null;
      try { box = group.getBBox(); } catch (err) { box = null; }
      if (!box) {
        selectionBar.classList.add('hidden');
        return;
      }

      selectionBar.innerHTML = '';
      if (ann.tipo === 'texto') {
        selectionBar.appendChild(selBarButton('Editar', 'Editar este texto', () => editTextOf(ann.id)));
      }
      selectionBar.appendChild(selBarButton('Duplicar', 'Duplicar', duplicateSelected));
      selectionBar.appendChild(selBarButton('Apagar', 'Apagar (tecla Delete)', deleteSelected));
      selectionBar.classList.remove('hidden');

      const { w, h } = stageSize();
      const barWidth = selectionBar.offsetWidth || 170;
      const barHeight = selectionBar.offsetHeight || 28;
      const left = Math.max(4, Math.min(w - barWidth - 4, box.x + box.width / 2 - barWidth / 2));
      let top = box.y - barHeight - 8;
      if (top < 2) top = Math.min(h - barHeight - 4, box.y + box.height + 8);
      selectionBar.style.left = Math.round(left) + 'px';
      selectionBar.style.top = Math.round(Math.max(2, top)) + 'px';
    }

    // --- imagem -----------------------------------------------------------
    // Trocar a imagem de fundo sem que as anotacoes saltem: guarda-se
    // a posicao visivel de cada uma, troca-se o fundo, e voltam a ser ancoradas
    // ao novo - a partir dai acompanham-no quando ele e movido ou escalado.
    function setBackground(novaImagem) {
      const antes = data.anotacoes.map(ann => panelPoints(ann));
      // A imagem que sai deixa de ter quem lhe aponte: apaga-se do
      // armazenamento, senao acumulavam-se ficheiros orfaos a cada troca.
      const anterior = data.imagem && data.imagem.path;
      if (anterior && (!novaImagem || novaImagem.path !== anterior)) {
        DecoImages.remove(anterior);
      }
      data.imagem = novaImagem;
      render();
      if (novaImagem) {
        fitImage();
        const box = currentBox();
        data.anotacoes.forEach((ann, index) => {
          ann.ancora = 'imagem';
          ann.pontos = toStoredPoints(antes[index], 'imagem', box);
        });
      } else {
        data.anotacoes.forEach((ann, index) => {
          delete ann.ancora;
          ann.pontos = antes[index];
        });
      }
      render();
    }

    async function importFile(file) {
      if (!file || !file.type || !file.type.startsWith('image/')) return;
      setStatus('A carregar imagem...');
      try {
        const uploaded = await DecoImages.upload(file, opts.fichaId(), opts.panelKey);
        setBackground({
          path: uploaded.path,
          largura_natural: uploaded.largura_natural,
          altura_natural: uploaded.altura_natural,
          x: 0, y: 0, escala: 1
        });
        setStatus('');
        commit();
      } catch (err) {
        setStatus(err.message || 'Não foi possível importar a imagem.');
      }
    }

    // "Ajustar à área": a imagem inteira cabe no painel — o lado que for
    // proporcionalmente maior é o que fica encostado à borda, por isso nunca
    // se perde nenhuma parte da foto.
    function fitImage() {
      if (!data.imagem) return;
      const nat = naturalSize();
      const { w, h } = stageSize();
      if (!nat || !(w > 0) || !(h > 0)) return;

      // Com a imagem rodada, o que tem de caber no painel e a caixa
      // envolvente da imagem JA rodada - senao uma foto virada 90 graus
      // saia fora do painel.
      const rad = (Number(data.imagem.rotacao) || 0) * Math.PI / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const r = nat.h / nat.w;
      const larguraMax = w / (cos + r * sin);
      const alturaMax = h / (sin + r * cos);
      const dispW = Math.min(w, larguraMax, alturaMax);
      const dispH = dispW * r;

      data.imagem.escala = dispW / w;
      data.imagem.x = (w - dispW) / 2 / w;
      data.imagem.y = (h - dispH) / 2 / h;
      render();
    }

    // "Repor tamanho": volta ao tamanho natural da imagem (100%), centrada.
    function resetImage() {
      if (!data.imagem) return;
      const nat = naturalSize();
      const { w, h } = stageSize();
      if (!nat || !(w > 0) || !(h > 0)) return;
      data.imagem.escala = nat.w / w;
      data.imagem.x = (w - nat.w) / 2 / w;
      data.imagem.y = (h - nat.h) / 2 / h;
      render();
    }

    function cabeNoPainel() {
      if (!data.imagem) return true;
      const rect = stage.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      return box.width <= rect.width + 1 && box.height <= rect.height + 1;
    }

    function onImagePointerDown(event) {
      if (!data.imagem || tool !== 'imagem') return;
      event.preventDefault();
      drag = { mode: 'image-move', startX: event.clientX, startY: event.clientY, orig: Object.assign({}, data.imagem) };
      capture(img, event);
    }

    function onHandlePointerDown(event) {
      if (!data.imagem || tool !== 'imagem') return;
      event.preventDefault();
      event.stopPropagation();
      const { w } = stageSize();
      drag = {
        mode: 'image-resize',
        startX: event.clientX,
        startY: event.clientY,
        orig: Object.assign({}, data.imagem),
        origWidthPx: data.imagem.escala * w,
        rot: Number(data.imagem.rotacao) || 0,
        stageW: w
      };
      capture(handle, event);
    }

    // --- anotações --------------------------------------------------------
    function pointFromEvent(event) {
      const rect = stage.getBoundingClientRect();
      return [
        Math.min(1.2, Math.max(-0.2, (event.clientX - rect.left) / rect.width)),
        Math.min(1.2, Math.max(-0.2, (event.clientY - rect.top) / rect.height))
      ];
    }

    // Estabilizador, como no PowerPoint: sem tecla nenhuma, uma linha que ja
    // esta quase horizontal ou quase vertical encaixa sozinha (tolerancia de
    // SNAP_TOL graus). Com Shift o encaixe e rigido, de 45 em 45 graus.
    const SNAP_TOL = 6;
    const SNAP_FREE = [-180, -90, 0, 90, 180];

    function constrain(from, to, shiftKey) {
      const { w, h } = stageSize();
      const dx = (to[0] - from[0]) * w;
      const dy = (to[1] - from[1]) * h;
      const length = Math.hypot(dx, dy);
      if (length < 2) return to;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      let target;
      if (shiftKey) {
        target = Math.round(angle / 45) * 45;
      } else {
        target = SNAP_FREE.find(candidate => Math.abs(angle - candidate) <= SNAP_TOL);
        if (target === undefined) {
          setSnapHint('');
          return to;
        }
      }
      const label = Math.abs(target) === 90
        ? 'vertical'
        : (Math.abs(target) % 180 === 0 ? 'horizontal' : target + '\u00B0');
      setSnapHint(label);
      const rad = target * Math.PI / 180;
      return [from[0] + Math.cos(rad) * length / w, from[1] + Math.sin(rad) * length / h];
    }

    function setSnapHint(text) {
      setStatus(text ? '\u2014 ' + text : '');
    }

    // O encaixe de angulo so faz sentido em linhas. Aplicado a um
    // retangulo, um arrasto largo e baixo colapsava a altura para zero.
    function shapeConstrain(tipo, from, to, shiftKey) {
      if (LINE_LIKE.includes(tipo)) return constrain(from, to, shiftKey);
      if (BOX_LIKE.includes(tipo) && shiftKey) {
        const { w, h } = stageSize();
        const dx = (to[0] - from[0]) * w;
        const dy = (to[1] - from[1]) * h;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        return [
          from[0] + (dx < 0 ? -side : side) / w,
          from[1] + (dy < 0 ? -side : side) / h
        ];
      }
      return to;
    }

    function currentStyle(tipo) {
      const base = DEFAULTS[tipo] || {};
      const style = {};
      if (base.espessura !== undefined) {
        style.espessura = widthSelect ? Number(widthSelect.value) : base.espessura;
      }
      if (base.tamanho_texto !== undefined) style.tamanho_texto = base.tamanho_texto;
      style.cor = colorInput ? colorInput.value : base.cor;
      return style;
    }

    function findAnnotation(id) {
      return data.anotacoes.find(a => a.id === id) || null;
    }

    function onSvgPointerDown(event) {
      if (tool === 'imagem') return;
      stage.focus({ preventScroll: true });

      if (tool === 'selecionar') {
        const handleEl = event.target.closest('[data-handle-index]');
        if (handleEl && selectedId) {
          event.preventDefault();
          drag = {
            mode: 'point',
            id: selectedId,
            index: Number(handleEl.dataset.handleIndex),
            corner: handleEl.dataset.handleCorner === 'true',
            orig: panelPoints(findAnnotation(selectedId))
          };
          capture(svg, event);
          return;
        }
        const groupEl = event.target.closest('[data-ann-id]');
        if (!groupEl) {
          selectedId = null;
          render();
          return;
        }
        event.preventDefault();
        selectedId = groupEl.dataset.annId;
        syncStyleControls();
        drag = {
          mode: 'move',
          id: selectedId,
          start: pointFromEvent(event),
          orig: panelPoints(findAnnotation(selectedId))
        };
        capture(svg, event);
        render();
        return;
      }

      event.preventDefault();
      const point = pointFromEvent(event);

      if (tool === 'texto') {
        openTextEditor(point, '', value => {
          if (!value) return;
          const ann = anchorNew(
            Object.assign({ id: newId(), tipo: 'texto', texto: value }, currentStyle('texto')),
            [point]
          );
          data.anotacoes.push(ann);
          setTool('selecionar');
          selectedId = ann.id;
          commit();
        }, 'texto');
        return;
      }

      if (tool === 'etiqueta') {
        if (!pendingPosicaoId) {
          setStatus('Escolhe primeiro uma posição na lista de etiquetas.');
          return;
        }
        const ann = anchorNew(Object.assign({
          id: newId(), tipo: 'etiqueta', posicao_id: pendingPosicaoId,
          texto: labelFor(pendingPosicaoId) || ''
        }, currentStyle('etiqueta')), [point]);
        data.anotacoes.push(ann);
        // Volta logo para "Selecionar" com a etiqueta nova selecionada: senao o
        // clique seguinte (inclusive o de a tentar apagar) largava outra por
        // cima, que era o que tornava isto impossivel de corrigir.
        setTool('selecionar');
        selectedId = ann.id;
        commit();
        render();
        return;
      }

      if (tool === 'mao_livre') {
        draft = Object.assign({ id: newId(), tipo: 'mao_livre', pontos: [point] }, currentStyle('mao_livre'));
        drag = { mode: 'freehand' };
        capture(svg, event);
        return;
      }

      if (TWO_POINT.includes(tool)) {
        draft = Object.assign({ id: newId(), tipo: tool, pontos: [point, point] }, currentStyle(tool));
        drag = { mode: 'draw', start: point };
        capture(svg, event);
      }
    }

    function onPointerMove(event) {
      if (!drag) return;

      if (drag.mode === 'image-move') {
        const rect = stage.getBoundingClientRect();
        const dx = (event.clientX - drag.startX) / rect.width;
        const dy = (event.clientY - drag.startY) / rect.height;
        data.imagem.x = Math.min(1, Math.max(-2, drag.orig.x + dx));
        data.imagem.y = Math.min(1, Math.max(-2, drag.orig.y + dy));
        render();
        return;
      }

      if (drag.mode === 'image-resize') {
        // Projecao do movimento do rato no eixo horizontal DA IMAGEM: com a
        // foto rodada, arrastar "para fora" deixa de ser arrastar para a
        // direita.
        const rad = drag.rot * Math.PI / 180;
        const ao_longo = (event.clientX - drag.startX) * Math.cos(rad)
          + (event.clientY - drag.startY) * Math.sin(rad);
        const widthPx = drag.origWidthPx + ao_longo;
        data.imagem.escala = Math.min(8, Math.max(0.05, widthPx / drag.stageW));
        render();
        return;
      }

      if (drag.mode === 'draw') {
        draft.pontos[1] = shapeConstrain(draft.tipo, drag.start, pointFromEvent(event), event.shiftKey);
        render();
        return;
      }

      if (drag.mode === 'freehand') {
        // Pontos demasiado juntos so acrescentam tremura ao traco.
        const point = pointFromEvent(event);
        const last = draft.pontos[draft.pontos.length - 1];
        const { w, h } = stageSize();
        const far = Math.hypot((point[0] - last[0]) * w, (point[1] - last[1]) * h) > 3;
        if (far) draft.pontos.push(point);
        render();
        return;
      }

      if (drag.mode === 'move') {
        const ann = findAnnotation(drag.id);
        if (!ann) return;
        const now = pointFromEvent(event);
        const dx = now[0] - drag.start[0];
        const dy = now[1] - drag.start[1];
        setPanelPoints(ann, drag.orig.map(p => [p[0] + dx, p[1] + dy]));
        render();
        return;
      }

      if (drag.mode === 'point') {
        const ann = findAnnotation(drag.id);
        if (!ann) return;
        const now = pointFromEvent(event);

        if (drag.corner) {
          const [a, b] = drag.orig;
          let minX = Math.min(a[0], b[0]);
          let maxX = Math.max(a[0], b[0]);
          let minY = Math.min(a[1], b[1]);
          let maxY = Math.max(a[1], b[1]);
          if (drag.index === 0) { minX = now[0]; minY = now[1]; }
          if (drag.index === 1) { maxX = now[0]; minY = now[1]; }
          if (drag.index === 2) { maxX = now[0]; maxY = now[1]; }
          if (drag.index === 3) { minX = now[0]; maxY = now[1]; }
          setPanelPoints(ann, [[minX, minY], [maxX, maxY]]);
          render();
          return;
        }

        const other = drag.index === 0 ? drag.orig[1] : drag.orig[0];
        const moved = other ? shapeConstrain(ann.tipo, other, now, event.shiftKey) : now;
        const pontos = drag.orig.map(point => point.slice());
        pontos[drag.index] = moved;
        setPanelPoints(ann, pontos);
        render();
      }
    }

    function onPointerUp() {
      if (!drag) return;
      const mode = drag.mode;
      drag = null;

      if (mode === 'draw' || mode === 'freehand') {
        const ann = draft;
        draft = null;
        if (ann && isMeaningful(ann)) {
          anchorNew(ann, ann.pontos);
          data.anotacoes.push(ann);
          // Como nas etiquetas: a ferramenta nao fica armada, senao o clique
          // seguinte desenhava outra forma por cima em vez de selecionar esta.
          setTool('selecionar');
          selectedId = ann.id;
          commit();
        }
        render();
        return;
      }

      commit();
      render();
    }

    function isMeaningful(ann) {
      if (ann.tipo === 'mao_livre') return ann.pontos.length > 2;
      const [a, b] = ann.pontos;
      const { w, h } = stageSize();
      return Math.abs(b[0] - a[0]) * w > 6 || Math.abs(b[1] - a[1]) * h > 6;
    }

    // --- editor de texto inline -------------------------------------------
    // A caixa fica com a mesma fonte e o mesmo tamanho do texto que vai ficar
    // desenhado, e cresce com o que se escreve: o que se ve a escrever e o que
    // fica no croqui.
    function openTextEditor(point, initial, done, tipo) {
      const existing = stage.querySelector('.croqui-text-input');
      if (existing) existing.remove();
      const fontPx = ((DEFAULTS[tipo || 'texto'] || {}).tamanho_texto || 14) * PX_PER_PT;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'croqui-text-input';
      input.value = initial || '';
      input.style.fontSize = fontPx + 'px';
      input.style.left = point[0] * 100 + '%';
      input.style.top = point[1] * 100 + '%';
      input.style.transform = tipo === 'etiqueta' ? 'translate(-50%, -50%)' : 'translateY(-50%)';
      const autoSize = () => {
        const chars = Math.max(6, (input.value || '').length + 1);
        input.style.width = Math.round(chars * fontPx * 0.56 + 14) + 'px';
      };
      autoSize();
      input.addEventListener('input', autoSize);
      stage.appendChild(input);
      input.focus();
      input.select();
      let finished = false;
      const finish = commitValue => {
        if (finished) return;
        finished = true;
        const value = input.value.trim();
        input.remove();
        done(commitValue ? value : null);
        render();
      };
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    }

    function onDoubleClick(event) {
      const groupEl = event.target.closest('[data-ann-id]');
      if (!groupEl) return;
      editTextOf(groupEl.dataset.annId);
    }

    function editTextOf(id) {
      const ann = findAnnotation(id);
      if (!ann || ann.tipo !== 'texto') return;
      selectedId = ann.id;
      openTextEditor(panelPoints(ann)[0], ann.texto || '', value => {
        if (value === null) return;
        if (!value) {
          data.anotacoes = data.anotacoes.filter(a => a.id !== ann.id);
          selectedId = null;
        } else {
          ann.texto = value;
        }
        commit();
      }, 'texto');
    }

    // --- ações sobre a seleção --------------------------------------------
    function deleteSelected() {
      if (!selectedId) return;
      data.anotacoes = data.anotacoes.filter(a => a.id !== selectedId);
      selectedId = null;
      commit();
      render();
    }

    function duplicateSelected() {
      const ann = findAnnotation(selectedId);
      if (!ann) return;
      const clone = JSON.parse(JSON.stringify(ann));
      clone.id = newId();
      clone.pontos = clone.pontos.map(p => [p[0] + 0.03, p[1] + 0.03]);
      data.anotacoes.push(clone);
      selectedId = clone.id;
      commit();
      render();
    }

    function reorderSelected(toFront) {
      const index = data.anotacoes.findIndex(a => a.id === selectedId);
      if (index < 0) return;
      const [ann] = data.anotacoes.splice(index, 1);
      if (toFront) data.anotacoes.push(ann);
      else data.anotacoes.unshift(ann);
      commit();
      render();
    }

    async function clearPanel() {
      if (!data.anotacoes.length) return;
      const confirmado = await DecoDialog.confirmar({
        titulo: 'Limpar as anotações deste painel?',
        mensagem: data.anotacoes.length === 1
          ? 'Vai apagar 1 anotação. A imagem de fundo fica.'
          : `Vai apagar ${data.anotacoes.length} anotações. A imagem de fundo fica.`,
        confirmar: 'Limpar painel',
        perigo: true
      });
      if (!confirmado) return;
      data.anotacoes = [];
      selectedId = null;
      commit();
      render();
    }

    function nudge(dx, dy) {
      const ann = findAnnotation(selectedId);
      if (!ann) return;
      const { w, h } = stageSize();
      setPanelPoints(ann, panelPoints(ann).map(p => [p[0] + dx / w, p[1] + dy / h]));
      render();
      commit();
    }

    function onKeyDown(event) {
      const key = event.key;
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        if (selectedId) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (key === 'Escape') {
        selectedId = null;
        setTool('selecionar');
        render();
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[key] && selectedId) {
        event.preventDefault();
        nudge(moves[key][0], moves[key][1]);
      }
    }

    // --- barra de ferramentas ---------------------------------------------
    function setTool(next, posicaoId) {
      tool = next;
      pendingPosicaoId = next === 'etiqueta' ? (posicaoId || pendingPosicaoId) : null;
      // Cada ferramenta traz o seu default do Mod.013.01 (tracejada 2,25 pt,
      // cota 3 pt, texto preto) — o utilizador pode depois mudar nos seletores.
      const preset = DEFAULTS[next];
      if (preset) {
        if (preset.espessura !== undefined && widthSelect) widthSelect.value = String(preset.espessura);
        if (preset.cor && colorInput) colorInput.value = preset.cor;
      }
      toolbarEl.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === tool);
      });
      labelsEl.querySelectorAll('[data-posicao-id]').forEach(chip => {
        chip.classList.toggle('active', tool === 'etiqueta' && chip.dataset.posicaoId === pendingPosicaoId);
      });
      if (next !== 'selecionar') selectedId = null;
      setStatus(next === 'etiqueta' ? 'Clica no croqui para colocar a etiqueta.' : '');
      render();
    }

    function syncStyleControls() {
      const ann = findAnnotation(selectedId);
      if (!ann) return;
      if (ann.cor && colorInput) colorInput.value = ann.cor;
      if (ann.espessura && widthSelect) widthSelect.value = String(ann.espessura);
    }

    function applyStyleToSelection() {
      const ann = findAnnotation(selectedId);
      if (!ann) return;
      if (colorInput) ann.cor = colorInput.value;
      if (widthSelect && ann.espessura !== undefined) ann.espessura = Number(widthSelect.value);
      commit();
      render();
    }

    function toolButton(def) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'croqui-tool';
      button.dataset.tool = def.id;
      button.title = def.title || def.label;
      button.innerHTML = `<span class="croqui-tool__icon">${def.icon}</span><span class="croqui-tool__label">${def.label}</span>`;
      button.addEventListener('click', () => setTool(def.id));
      return button;
    }

    function buildToolbar() {
      toolbarEl.innerHTML = '';
      MAIN_TOOLS.forEach(def => toolbarEl.appendChild(toolButton(def)));

      colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = '#FF0000';
      colorInput.className = 'croqui-color';
      colorInput.title = 'Cor da anotação';
      colorInput.addEventListener('input', applyStyleToSelection);
      toolbarEl.appendChild(colorInput);

      widthSelect = document.createElement('select');
      widthSelect.className = 'croqui-width';
      widthSelect.title = 'Espessura do traço';
      WIDTHS.forEach(value => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = String(value).replace('.', ',') + ' pt';
        if (value === 2.25) option.selected = true;
        widthSelect.appendChild(option);
      });
      widthSelect.addEventListener('change', applyStyleToSelection);
      toolbarEl.appendChild(widthSelect);

      const more = document.createElement('details');
      more.className = 'croqui-more';
      const summary = document.createElement('summary');
      summary.textContent = '⋯';
      summary.title = 'Mais ferramentas';
      more.appendChild(summary);
      const menu = document.createElement('div');
      menu.className = 'croqui-more__menu';

      MORE_TOOLS.forEach(def => {
        menu.appendChild(menuButton(def.label, () => {
          setTool(def.id);
          more.open = false;
        }));
      });
      menu.appendChild(document.createElement('hr'));
      menu.appendChild(menuButton('Trazer para a frente', () => { reorderSelected(true); more.open = false; }));
      menu.appendChild(menuButton('Enviar para trás', () => { reorderSelected(false); more.open = false; }));
      menu.appendChild(menuButton('Duplicar', () => { duplicateSelected(); more.open = false; }));
      menu.appendChild(menuButton('Apagar selecionado', () => { deleteSelected(); more.open = false; }));
      menu.appendChild(document.createElement('hr'));
      menu.appendChild(menuButton('Anular (Ctrl+Z)', () => { undo(); more.open = false; }));
      menu.appendChild(menuButton('Refazer (Ctrl+Shift+Z)', () => { redo(); more.open = false; }));
      menu.appendChild(menuButton('Limpar painel', () => { clearPanel(); more.open = false; }));
      more.appendChild(menu);
      toolbarEl.appendChild(more);
    }

    function menuButton(label, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'croqui-more__item';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    }

    // --- etiquetas de posição ---------------------------------------------
    function refreshLabels() {
      const posicoes = getPosicoes();
      labelsEl.innerHTML = '';
      const caption = document.createElement('span');
      caption.className = 'croqui-labels__caption';
      caption.textContent = 'Etiquetas:';
      labelsEl.appendChild(caption);

      if (!posicoes.length) {
        const empty = document.createElement('span');
        empty.className = 'croqui-labels__empty';
        empty.textContent = 'preenche a letra de uma posição na tabela acima.';
        labelsEl.appendChild(empty);
      }

      posicoes.forEach(pos => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'croqui-chip';
        chip.dataset.posicaoId = pos.id;
        chip.textContent = pos.letra || '?';
        chip.title = `Colocar a etiqueta ${pos.letra || '?'} — ${pos.descricao || '(sem descrição)'}`;
        chip.addEventListener('click', () => {
          const alreadyArmed = tool === 'etiqueta' && pendingPosicaoId === pos.id;
          setTool(alreadyArmed ? 'selecionar' : 'etiqueta', pos.id);
        });
        labelsEl.appendChild(chip);
      });
      render();
    }

    function orphanLabelIds() {
      const ids = new Set(getPosicoes().map(p => p.id));
      return data.anotacoes.filter(a => a.tipo === 'etiqueta' && !ids.has(a.posicao_id)).map(a => a.id);
    }

    function removeOrphanLabels() {
      const orphans = new Set(orphanLabelIds());
      if (!orphans.size) return 0;
      data.anotacoes = data.anotacoes.filter(a => !orphans.has(a.id));
      commit();
      render();
      return orphans.size;
    }

    // --- ligações ---------------------------------------------------------
    function bindEvents() {
      uploadButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) importFile(fileInput.files[0]);
        fileInput.value = '';
      });

      stage.addEventListener('dragover', event => event.preventDefault());
      stage.addEventListener('drop', event => {
        event.preventDefault();
        const file = event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) importFile(file);
      });

      const ativar = () => { painelAtivo = { container: containerEl, importar: importFile, aviso: setStatus }; };
      ['pointerenter', 'pointerdown', 'focusin'].forEach(nome => containerEl.addEventListener(nome, ativar));

      img.addEventListener('pointerdown', onImagePointerDown);
      handle.addEventListener('pointerdown', onHandlePointerDown);
      svg.addEventListener('pointerdown', onSvgPointerDown);
      svg.addEventListener('dblclick', onDoubleClick);
      stage.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerUp);
      stage.addEventListener('keydown', onKeyDown);

      fitButton.addEventListener('click', () => {
        fitImage();
        commit();
      });
      resetButton.addEventListener('click', () => {
        resetImage();
        commit();
      });
      rotateButtons.forEach(button => {
        button.addEventListener('click', () => {
          if (!data.imagem) {
            setStatus('Importa primeiro uma imagem.');
            return;
          }
          const passo = Number(button.dataset.croquiRotate) || 90;
          const atual = Number(data.imagem.rotacao) || 0;
          data.imagem.rotacao = ((atual + passo) % 360 + 360) % 360;
          render();
          // So se reenquadra se a imagem rodada deixar de caber: assim uma
          // foto que ja estava dimensionada a mao nao perde o enquadramento
          // so por ser rodada, mas tambem nunca desaparece do painel.
          if (!cabeNoPainel()) fitImage();
          commit();
        });
      });

      removeButton.addEventListener('click', () => {
        if (!data.imagem) return;
        setBackground(null);
        commit();
      });


      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => render());
        observer.observe(stage);
      } else {
        window.addEventListener('resize', render);
      }
    }

    buildToolbar();
    bindOutsideClose();
    bindEvents();
    setTool('selecionar');
    refreshLabels();
    history.push(snapshot());
    historyIndex = 0;

    return {
      getData: () => data,
      setData(newData) {
        data.imagem = (newData && newData.imagem) || null;
        data.anotacoes = (newData && Array.isArray(newData.anotacoes)) ? newData.anotacoes : [];
        selectedId = null;
        history.length = 0;
        history.push(snapshot());
        historyIndex = 0;
        refreshLabels();
      },
      refreshLabels,
      orphanLabelIds,
      removeOrphanLabels,
      fitImage,
      undo,
      redo,
      destroy() {
        window.removeEventListener('pointerup', onPointerUp);
      }
    };
  }

  return { create, renderStatic, drawInto, PX_PER_PT, imageBox };
})();
