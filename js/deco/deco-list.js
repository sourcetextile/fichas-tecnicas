// Ecrã de lista das Fichas de decoração: pesquisa, agrupamento por modelo,
// duplicar/apagar, e o fluxo "Nova ficha" (em branco ou a importar o
// cabeçalho de uma ficha técnica já existente e partilhada).
const DecoList = (() => {
  const decoListEl = document.getElementById('decoList');
  const filterInput = document.getElementById('decoListFilter');
  const estadoFilter = document.getElementById('decoListEstado');
  const newBlankButton = document.getElementById('decoNewBlankButton');
  const newFromFichaButton = document.getElementById('decoNewFromFichaButton');
  const importPicker = document.getElementById('decoImportPicker');
  const importList = document.getElementById('decoImportList');
  const importCancelButton = document.getElementById('decoImportCancelButton');

  const FICHA_TECNICA_TABLE = 'ficha_tecnica_sourcetextile_fichas';

  let cache = [];

  async function render() {
    cache = await DecoStorage.listFichas();
    renderFiltered();
  }

  function fasesDe(ficha) {
    const fases = (ficha.fases && typeof ficha.fases === 'object') ? ficha.fases : {};
    return DecoEditor.FASES.filter(nome => fases[nome]);
  }

  function renderFiltered() {
    const query = (filterInput.value || '').trim().toLowerCase();
    const fase = estadoFilter ? estadoFilter.value : '';
    let list = query ? cache.filter(f => matchesQuery(f, query)) : cache;
    if (fase) list = list.filter(f => fasesDe(f).includes(fase));
    decoListEl.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'saved-empty';
      empty.textContent = query
        ? 'Nenhuma ficha de decoração encontrada.'
        : 'Ainda não há fichas de decoração. Usa "Nova ficha em branco" ou "Importar de ficha técnica".';
      decoListEl.appendChild(empty);
      return;
    }
    groupByModelo(list).forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'deco-group';
      const header = document.createElement('div');
      header.className = 'deco-group-header';
      const heading = document.createElement('h3');
      heading.className = 'deco-group-title';
      heading.textContent = `${group.ref || '(sem referência)'} · ${group.items.length} ficha${group.items.length === 1 ? '' : 's'}`;
      header.appendChild(heading);
      groupEl.appendChild(header);
      group.items.forEach(ficha => groupEl.appendChild(renderCard(ficha)));
      decoListEl.appendChild(groupEl);
    });
  }

  function matchesQuery(f, query) {
    return [f.ref_nosso_modelo, f.ref_modelo_cliente, f.ofs, f.fornecedor]
      .some(v => (v || '').toLowerCase().includes(query));
  }

  function groupByModelo(list) {
    const map = new Map();
    list.forEach(f => {
      const key = f.ref_nosso_modelo || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    });
    return [...map.entries()].map(([ref, items]) => ({ ref, items }));
  }

  function tipoLabel(f) {
    const bits = [];
    if (f.estampado) bits.push('Estampado');
    if (f.bordado) bits.push('Bordado');
    return bits.join(' + ') || 'Sem tipo definido';
  }

  function renderCard(ficha) {
    const item = document.createElement('div');
    item.className = 'saved-item card deco-item';

    const info = document.createElement('div');
    info.className = 'saved-info';
    const title = document.createElement('p');
    title.className = 'saved-name';
    title.textContent = ficha.ref_modelo_cliente || ficha.ref_nosso_modelo || '(sem referência)';
    // Que fases desta ficha já existem — SMS, SMS+PPS, ou as três.
    const fases = fasesDe(ficha);
    fases.forEach(nome => {
      const chip = document.createElement('span');
      const finalizada = !!(ficha.fases[nome] && ficha.fases[nome].finalizada_em);
      chip.className = 'deco-fase-chip' + (finalizada ? ' is-finalizada' : '');
      chip.textContent = finalizada ? nome + ' ✓' : nome;
      chip.title = finalizada
        ? `Fase ${nome} finalizada`
        : `Fase ${nome} em curso`;
      title.appendChild(chip);
    });

    const meta = document.createElement('p');
    meta.className = 'saved-meta';
    const bits = [];
    if (ficha.ofs) bits.push(`OF ${ficha.ofs}`);
    bits.push(tipoLabel(ficha));
    if (ficha.fornecedor) bits.push(ficha.fornecedor);
    const date = new Date(ficha.updated_at);
    bits.push(`${date.toLocaleDateString('pt-PT')} ${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`);
    meta.textContent = bits.join(' · ');
    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'saved-actions';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'primary saved-open';
    openButton.textContent = 'Abrir';
    openButton.addEventListener('click', () => DecoApp.openEditor(ficha.id));
    actions.appendChild(openButton);

    const printButton = document.createElement('button');
    printButton.type = 'button';
    printButton.className = 'secondary';
    printButton.textContent = 'Imprimir';
    printButton.addEventListener('click', () => DecoPrint.imprimir([ficha]));
    actions.appendChild(printButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'secondary';
    duplicateButton.textContent = 'Duplicar';
    duplicateButton.addEventListener('click', async () => {
      const clone = { ...ficha, id: crypto.randomUUID() };
      delete clone.created_by;
      delete clone.updated_by;
      delete clone.created_at;
      delete clone.updated_at;
      await DecoStorage.upsertFicha(clone);
      await render();
    });
    actions.appendChild(duplicateButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'secondary saved-delete';
    deleteButton.textContent = 'Apagar';
    deleteButton.addEventListener('click', async () => {
      const fases = fasesDe(ficha);
      const detalhe = fases.length
        ? `Vai apagar ${fases.length === 1 ? 'a fase' : 'as fases'} ${fases.join(', ')}, o croqui e as imagens.`
        : 'Vai apagar o croqui e as imagens.';
      const confirmado = await DecoDialog.confirmar({
        titulo: 'Apagar esta ficha de decoração?',
        mensagem: `${ficha.ref_nosso_modelo || '(sem referência)'}${ficha.ofs ? ' · OF ' + ficha.ofs : ''}. ${detalhe} Esta ação não pode ser anulada.`,
        confirmar: 'Apagar definitivamente',
        perigo: true
      });
      if (!confirmado) return;
      deleteButton.disabled = true;
      // As imagens vivem numa pasta com o id da ficha: apaga-se a pasta, senão
      // ficavam no armazenamento sem nada que lhes aponte.
      await DecoImages.removeFolder(ficha.id);
      await DecoStorage.deleteFicha(ficha.id);
      await render();
    });
    actions.appendChild(deleteButton);

    item.appendChild(actions);
    return item;
  }

  // A forma de uma ficha nova (12 colunas, 3 linhas, prefixos pré-preenchidos)
  // vive no editor — aqui só se pedem os campos do cabeçalho por cima.
  function blankEntry(overrides) {
    return DecoEditor.blankEntry(overrides);
  }

  async function createBlank() {
    const saved = await DecoStorage.upsertFicha(blankEntry());
    if (saved) DecoApp.openEditor(saved.id);
  }

  async function openImportPicker() {
    decoListEl.classList.add('hidden');
    importPicker.classList.remove('hidden');
    importList.innerHTML = '<p class="saved-empty">A carregar fichas técnicas...</p>';
    const { data, error } = await window.Auth.client
      .from(FICHA_TECNICA_TABLE)
      .select('id, nome, tipo_peca, header, saved_at')
      .order('saved_at', { ascending: false });
    if (error || !data || !data.length) {
      importList.innerHTML = '<p class="saved-empty">Não foi possível carregar fichas técnicas, ou ainda não há nenhuma guardada.</p>';
      return;
    }
    importList.innerHTML = '';
    data.forEach(ficha => importList.appendChild(renderImportCard(ficha)));
  }

  function renderImportCard(ficha) {
    const item = document.createElement('div');
    item.className = 'saved-item card';
    const info = document.createElement('div');
    info.className = 'saved-info';
    const title = document.createElement('p');
    title.className = 'saved-name';
    title.textContent = ficha.nome;
    const meta = document.createElement('p');
    meta.className = 'saved-meta';
    const ref = (ficha.header && ficha.header.referencia || '').trim();
    meta.textContent = [ref, ficha.tipo_peca].filter(Boolean).join(' · ');
    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    const useButton = document.createElement('button');
    useButton.type = 'button';
    useButton.className = 'primary';
    useButton.textContent = 'Usar este cabeçalho';
    useButton.addEventListener('click', async () => {
      const saved = await DecoStorage.upsertFicha(blankEntry({
        ref_nosso_modelo: ficha.nome,
        ref_modelo_cliente: (ficha.header && ficha.header.referencia) || null
      }));
      if (saved) DecoApp.openEditor(saved.id);
    });
    item.appendChild(useButton);
    return item;
  }

  function closeImportPicker() {
    importPicker.classList.add('hidden');
    decoListEl.classList.remove('hidden');
  }

  function bindEvents() {
    filterInput.addEventListener('input', renderFiltered);
    if (estadoFilter) estadoFilter.addEventListener('change', renderFiltered);
    newBlankButton.addEventListener('click', createBlank);
    newFromFichaButton.addEventListener('click', openImportPicker);
    importCancelButton.addEventListener('click', closeImportPicker);
  }

  return { render, bindEvents };
})();
