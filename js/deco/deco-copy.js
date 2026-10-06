// "Reaproveitar de outra ficha" — o ganho de tempo real não está na primeira
// ficha de um modelo, está na quinta. Aqui escolhe-se uma ficha já feita e o
// que dela se quer trazer (croqui anotado, medidas, paleta, colocação e
// comentários); depois de copiado, tudo fica normalmente editável.
//
// As imagens do croqui são COPIADAS para a pasta desta ficha em vez de
// partilhadas: senão, apagar a imagem numa ficha apagava-a na outra.
const DecoCopy = (() => {
  const BLOCOS = [
    { key: 'croqui', label: 'Croqui (imagens e anotações)' },
    { key: 'medidas', label: 'Tamanhos e tabela de posições' },
    { key: 'paleta', label: 'Paleta de cores' },
    { key: 'colocacao', label: 'Colocação e comentários' },
    { key: 'identificacao', label: 'Fornecedor e tipo de decoração' }
  ];

  let overlay = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  // destino = a ficha aberta no editor; onDone corre depois de copiar.
  async function open(destino, onDone) {
    close();

    overlay = el('div', 'deco-copy-overlay');
    const dialog = el('div', 'deco-copy-dialog');
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) close();
    });

    dialog.appendChild(el('h2', null, 'Reaproveitar de outra ficha'));
    dialog.appendChild(el('p', 'deco-help', 'Escolhe o que queres trazer e depois a origem — outra fase desta ficha, ou outra ficha. O que for copiado fica editável aqui, como se o tivesses feito nesta fase.'));

    const options = el('div', 'deco-copy-options');
    const checks = {};
    BLOCOS.forEach(bloco => {
      const label = el('label', 'deco-checkbox deco-checkbox-small');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      checks[bloco.key] = input;
      label.appendChild(input);
      label.appendChild(document.createTextNode(bloco.label));
      options.appendChild(label);
    });
    dialog.appendChild(options);

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'saved-filter deco-copy-search';
    search.placeholder = 'Pesquisar por fase, modelo, referência, OF, fornecedor...';
    dialog.appendChild(search);

    const list = el('div', 'deco-copy-list');
    list.appendChild(el('p', 'saved-empty', 'A carregar fichas...'));
    dialog.appendChild(list);

    const actions = el('div', 'deco-copy-actions');
    const cancel = el('button', 'secondary', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    actions.appendChild(cancel);
    dialog.appendChild(actions);

    document.body.appendChild(overlay);

    const todas = await DecoStorage.listFichas();
    const outrasFichas = todas.filter(f => f.id !== destino.id);

    // As outras FASES desta ficha aparecem primeiro: é o caso mais comum —
    // o PPS parte do SMS. Cada fase é apresentada como se fosse uma origem
    // normal, com o conteúdo dela por cima da identificação desta ficha.
    const outrasFases = (DecoEditor.FASES || [])
      .filter(nome => nome !== destino.fase_ativa && destino.fases && destino.fases[nome])
      .map(nome => ({
        chave: 'fase:' + nome,
        etiqueta: 'Fase ' + nome + ' (esta ficha)',
        contexto: destino.fases[nome].finalizada_em ? 'finalizada' : 'em curso',
        destaque: true,
        dados: Object.assign({}, destino, destino.fases[nome].conteudo)
      }));

    const mesmoModelo = f => (f.ref_nosso_modelo || '') === (destino.ref_nosso_modelo || '');
    outrasFichas.sort((a, b) => (mesmoModelo(b) ? 1 : 0) - (mesmoModelo(a) ? 1 : 0));

    const candidatas = outrasFases.concat(outrasFichas.map(ficha => {
      const bits = [];
      if (mesmoModelo(ficha)) bits.push('mesmo modelo');
      if (ficha.ref_modelo_cliente) bits.push(ficha.ref_modelo_cliente);
      if (ficha.ofs) bits.push('OF ' + ficha.ofs);
      if (ficha.fornecedor) bits.push(ficha.fornecedor);
      const quando = ficha.updated_at ? new Date(ficha.updated_at).toLocaleDateString('pt-PT') : '';
      if (quando) bits.push(quando);
      return {
        chave: 'ficha:' + ficha.id,
        etiqueta: ficha.ref_nosso_modelo || '(sem referência)',
        contexto: bits.join(' · '),
        destaque: mesmoModelo(ficha),
        dados: ficha
      };
    }));

    list.innerHTML = '';
    if (!candidatas.length) {
      list.appendChild(el('p', 'saved-empty', 'Ainda não há outras fases nem outras fichas para reaproveitar.'));
      return;
    }

    function combina(origem, query) {
      if (!query) return true;
      const ficha = origem.dados;
      return [origem.etiqueta, ficha.ref_nosso_modelo, ficha.ref_modelo_cliente, ficha.ofs, ficha.fornecedor]
        .some(valor => (valor || '').toLowerCase().includes(query));
    }

    function renderList() {
      const query = search.value.trim().toLowerCase();
      const visiveis = candidatas.filter(origem => combina(origem, query));
      list.innerHTML = '';

      if (!visiveis.length) {
        list.appendChild(el('p', 'saved-empty', 'Nenhuma ficha corresponde a esta pesquisa.'));
        return;
      }

      visiveis.forEach(origem => {
        const item = el('div', 'deco-copy-item' + (origem.destaque ? ' is-same-model' : ''));
        const main = el('div', 'deco-copy-item-main');
        main.appendChild(el('p', 'deco-copy-item-name', origem.etiqueta));
        main.appendChild(el('p', 'deco-copy-item-meta', origem.contexto));
        item.appendChild(main);

        const use = el('button', 'primary', 'Copiar desta');
        use.type = 'button';
        use.addEventListener('click', async () => {
          use.disabled = true;
          use.textContent = 'A copiar...';
          const escolhidos = BLOCOS.filter(b => checks[b.key].checked).map(b => b.key);
          await aplicar(destino, origem.dados, escolhidos);
          close();
          onDone();
        });
        item.appendChild(use);
        list.appendChild(item);
      });
    }

    search.addEventListener('input', renderList);
    renderList();
    search.focus();
  }

  async function copiarPainel(painel, destinoId, panelKey) {
    const origem = (painel && typeof painel === 'object') ? painel : {};
    const copia = JSON.parse(JSON.stringify({
      imagem: origem.imagem || null,
      anotacoes: Array.isArray(origem.anotacoes) ? origem.anotacoes : []
    }));
    if (copia.imagem && copia.imagem.path) {
      copia.imagem.path = await DecoImages.copy(copia.imagem.path, destinoId, panelKey);
    }
    return copia;
  }

  async function aplicar(destino, origem, blocos) {
    if (blocos.includes('croqui')) {
      const croquiOrigem = origem.croqui || {};
      destino.croqui = {
        arte: await copiarPainel(croquiOrigem.arte, destino.id, 'arte'),
        desenho_tecnico: await copiarPainel(croquiOrigem.desenho_tecnico, destino.id, 'desenho-tecnico')
      };
    }

    if (blocos.includes('medidas')) {
      destino.tamanhos = JSON.parse(JSON.stringify(origem.tamanhos || []));
      // As posições levam ids novos: as etiquetas do croqui apontam para o id
      // da linha, por isso têm de ser reapontadas para as linhas desta ficha.
      const mapa = new Map();
      destino.posicoes = (origem.posicoes || []).map(pos => {
        const clone = JSON.parse(JSON.stringify(pos));
        const novoId = crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random();
        mapa.set(pos.id, novoId);
        clone.id = novoId;
        return clone;
      });
      ['arte', 'desenho_tecnico'].forEach(key => {
        const painel = destino.croqui && destino.croqui[key];
        if (!painel || !Array.isArray(painel.anotacoes)) return;
        painel.anotacoes.forEach(ann => {
          if (ann.tipo === 'etiqueta' && mapa.has(ann.posicao_id)) ann.posicao_id = mapa.get(ann.posicao_id);
        });
      });
    }

    if (blocos.includes('paleta')) {
      destino.paleta = JSON.parse(JSON.stringify(origem.paleta || {}));
      const bases = (destino.paleta && destino.paleta.cores_base) || [];
      for (let i = 0; i < bases.length; i += 1) {
        if (bases[i].foto) bases[i].foto = await DecoImages.copy(bases[i].foto, destino.id, 'paleta-' + i);
      }
    }

    if (blocos.includes('colocacao')) {
      destino.colocacao_tipo = origem.colocacao_tipo || null;
      destino.colocacao_texto = origem.colocacao_texto || null;
      destino.comentarios = JSON.parse(JSON.stringify(origem.comentarios || {}));
    }

    if (blocos.includes('identificacao')) {
      destino.fornecedor = origem.fornecedor || null;
      destino.estampado = !!origem.estampado;
      destino.bordado = !!origem.bordado;
    }
  }

  return { open, close };
})();
