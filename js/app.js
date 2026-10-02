const App = (() => {
  const ZONES = Generator.ZONES;
  const BLANK = Generator.BLANK_OPTION;

  // Disposição pedida da grelha (4 por linha)
  const TYPE_ORDER = [
    'Calças', 'Calções', 'Saia', 'Boxers',
    'Sweat', 'Sweat capuz', 'Casaco', 'Casaco capuz',
    'T-shirt', 'Top', 'Camisa', 'Polo',
    'Vestido', 'Macacão'
  ];

  const MAX_ROWS = 30;          // nº máximo de instâncias num campo repetível
  const SAVE_DEBOUNCE = 300;    // ms — auto-save enquanto se escreve

  // --- Elementos -----------------------------------------------------------
  const typeGrid = document.getElementById('typeGrid');
  const selectionScreen = document.getElementById('selectionScreen');
  const formScreen = document.getElementById('formScreen');
  const formTitle = document.getElementById('formTitle');
  const formContainer = document.getElementById('formContainer');
  const backButton = document.getElementById('backButton');
  const formHeader = document.getElementById('formHeader');
  const saveButton = document.getElementById('saveButton');
  const clearButton = document.getElementById('clearButton');
  const generateButton = document.getElementById('generateButton');
  const resultsPanel = document.getElementById('resultsPanel');
  const versionSimple = document.getElementById('versionSimple');
  const versionRich = document.getElementById('versionRich');
  const tabTypes = document.getElementById('tabTypes');
  const tabSaved = document.getElementById('tabSaved');
  const typesPanel = document.getElementById('typesPanel');
  const savedPanel = document.getElementById('savedPanel');
  const savedList = document.getElementById('savedList');
  const savedFilter = document.getElementById('savedFilter');

  const outputBoxes = {
    'Confeção': document.getElementById('outputConfeccao'),
    'Embalagem': document.getElementById('outputEmbalagem'),
    'Corte': document.getElementById('outputCorte')
  };
  const copyButtons = {
    'Confeção': document.getElementById('copyConfeccao'),
    'Embalagem': document.getElementById('copyEmbalagem'),
    'Corte': document.getElementById('copyCorte')
  };

  const headerFields = {
    nome: document.getElementById('headerNome'),
    referencia: document.getElementById('headerReferencia'),
    cliente: document.getElementById('headerCliente'),
    versao: document.getElementById('headerVersao'),
    gestora: document.getElementById('headerGestora'),
    data: document.getElementById('headerData')
  };

  // --- Dados ---------------------------------------------------------------
  const dataModule = CAMPOS_DATA.modulos.find(m => m.id === 'ficha-tecnica');
  const allRows = dataModule.rows.map((row, index) => ({
    ...row,
    key: slug(`${row.tipoPeca}-${row.zona}-${row.campo}-${row.subcategoria || ''}-${index}`)
  }));
  const typesInData = new Set(allRows.map(row => row.tipoPeca));
  const orderedTypes = TYPE_ORDER.filter(type => typesInData.has(type));

  let currentType = null;
  let currentRows = [];
  let formState = {};
  let headerState = {};
  let latestModel = null;

  // --- Auto-save (debounce enquanto se escreve; imediato nas alterações estruturais) ---
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveDraft();
  }

  function slug(value) {
    return value.toString().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  // Opções (campos Fixos) vêm do Excel separadas por vírgula; token "" = pode ficar vazio.
  function parseOptions(value) {
    if (!value) return [];
    return value.split(',')
      .map(item => item.trim())
      .filter(item => item && item !== '""');
  }

  // --- Separadores do ecrã inicial -----------------------------------------
  async function showTab(which) {
    const saved = which === 'saved';
    tabTypes.classList.toggle('active', !saved);
    tabSaved.classList.toggle('active', saved);
    tabTypes.setAttribute('aria-selected', String(!saved));
    tabSaved.setAttribute('aria-selected', String(saved));
    typesPanel.classList.toggle('hidden', saved);
    savedPanel.classList.toggle('hidden', !saved);
    if (saved) await renderSavedList();
  }

  // --- Grelha de seleção ---------------------------------------------------
  function renderTypeGrid() {
    typeGrid.innerHTML = '';
    orderedTypes.forEach(type => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'type-card';
      button.dataset.type = type;

      const sketch = document.createElement('span');
      sketch.className = 'sketch';
      sketch.innerHTML = SKETCHES[type] || SKETCHES['_fallback'];
      button.appendChild(sketch);

      const name = document.createElement('span');
      name.className = 'type-name';
      name.textContent = type;
      button.appendChild(name);

      button.addEventListener('click', () => selectType(type));
      typeGrid.appendChild(button);
    });
  }

  // --- Fichas guardadas -----------------------------------------------------
  async function saveFicha() {
    if (!currentType) return;
    const nome = (headerState.nome || '').trim();
    if (!nome) {
      // Nome obrigatório: evita que duas fichas sem nome (do mesmo tipo,
      // gravadas no mesmo dia por pessoas diferentes) colidam na chave
      // única (nome, tipo_peca) e uma sobrescreva a outra sem aviso.
      formHeader.open = true;
      headerFields.nome.focus();
      headerFields.nome.reportValidity();
      return;
    }
    const entry = {
      name: nome,
      type: currentType,
      savedAt: new Date().toISOString(),
      header: JSON.parse(JSON.stringify(headerState)),
      form: JSON.parse(JSON.stringify(formState))
    };
    await Storage.upsertSaved(entry);

    const original = saveButton.textContent;
    saveButton.textContent = 'Guardada ✓';
    saveButton.disabled = true;
    setTimeout(() => {
      saveButton.textContent = original;
      saveButton.disabled = false;
    }, 1300);
  }

  let savedListCache = [];

  async function renderSavedList() {
    savedListCache = await Storage.loadSaved();
    renderSavedListFiltered();
  }

  function renderSavedListFiltered() {
    const query = (savedFilter.value || '').trim().toLowerCase();
    const list = query
      ? savedListCache.filter(entry => entry.name.toLowerCase().includes(query))
      : savedListCache;
    savedList.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'saved-empty';
      empty.textContent = query
        ? 'Nenhuma ficha encontrada com esse nome.'
        : 'Ainda não há fichas guardadas. Preenche uma ficha e usa o botão "Guardar ficha".';
      savedList.appendChild(empty);
      return;
    }
    list.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'saved-item card';

      const info = document.createElement('div');
      info.className = 'saved-info';
      const name = document.createElement('p');
      name.className = 'saved-name';
      name.textContent = entry.name;
      const meta = document.createElement('p');
      meta.className = 'saved-meta';
      const date = new Date(entry.savedAt);
      const ref = (entry.header && entry.header.referencia || '').trim();
      const bits = [];
      if (ref) bits.push(ref);
      bits.push(entry.type);
      bits.push(`${date.toLocaleDateString('pt-PT')} ${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`);
      meta.textContent = bits.join(' · ');
      info.appendChild(name);
      info.appendChild(meta);
      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'saved-actions';
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'primary saved-open';
      openButton.textContent = 'Abrir';
      openButton.addEventListener('click', () => openSaved(entry));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'secondary saved-delete';
      deleteButton.textContent = 'Apagar';
      deleteButton.addEventListener('click', async () => {
        await Storage.deleteSaved(entry.id);
        await renderSavedList();
      });
      actions.appendChild(openButton);
      actions.appendChild(deleteButton);
      item.appendChild(actions);

      savedList.appendChild(item);
    });
  }

  function openSaved(entry) {
    // Repõe o snapshot como rascunho ativo e abre o formulário
    Storage.saveHeader(entry.type, entry.header || {});
    Storage.save(entry.type, entry.form || {});
    selectType(entry.type);
  }

  // --- Estado do formulário ------------------------------------------------
  function subCamposOf(row) {
    return Array.isArray(row.subCampos) ? row.subCampos : [];
  }

  function emptyInstance(subCampos) {
    const inst = {};
    subCampos.forEach(sc => {
      inst[sc.id] = '';
      if (sc.allowOutros) inst[`${sc.id}__outros`] = '';
    });
    return inst;
  }

  function normalizeInstance(subCampos, saved) {
    const inst = emptyInstance(subCampos);
    if (saved && typeof saved === 'object') {
      subCampos.forEach(sc => {
        if (saved[sc.id] != null) inst[sc.id] = String(saved[sc.id]);
        const ok = `${sc.id}__outros`;
        if (sc.allowOutros && saved[ok] != null) inst[ok] = String(saved[ok]);
      });
    }
    return inst;
  }

  function defaultStateFor(row) {
    if (row.repetivel) return [];
    if (row.tipo === 'Fixo') return row.medida ? { selected: [], extra: '', medida: '' } : { selected: [], extra: '' };
    return '';
  }

  function normalizeState(row, saved) {
    if (saved === undefined || saved === null) return defaultStateFor(row);
    if (row.repetivel) {
      const subCampos = subCamposOf(row);
      if (!Array.isArray(saved)) return [];
      return saved.slice(0, MAX_ROWS).map(item => normalizeInstance(subCampos, item));
    }
    if (row.tipo === 'Fixo') {
      const base = (typeof saved === 'object' && !Array.isArray(saved)) ? saved : {};
      const state = {
        selected: Array.isArray(base.selected) ? base.selected : [],
        extra: typeof base.extra === 'string' ? base.extra : (typeof saved === 'string' ? saved : '')
      };
      if (row.medida) state.medida = typeof base.medida === 'string' ? base.medida : '';
      return state;
    }
    return typeof saved === 'string' ? saved : ''; // Variável e Numérico: string
  }

  function initFormState() {
    const saved = Storage.load(currentType) || {};
    formState = {};
    currentRows.forEach(row => {
      formState[row.key] = normalizeState(row, saved[row.key]);
    });
  }

  function initHeaderState() {
    const draft = Storage.loadHeader(currentType) || {};
    headerState = {};
    Object.keys(headerFields).forEach(key => {
      headerState[key] = draft[key] || '';
      headerFields[key].value = headerState[key];
    });
  }

  function saveDraft() {
    if (!currentType) return;
    Storage.saveHeader(currentType, headerState);
    Storage.save(currentType, formState);
  }

  // --- Navegação -----------------------------------------------------------
  function selectType(type) {
    currentType = type;
    currentRows = allRows.filter(row => row.tipoPeca === type);
    formTitle.textContent = type;
    initHeaderState();
    initFormState();
    renderForm();
    latestModel = null;
    resultsPanel.classList.add('hidden');
    formScreen.classList.remove('hidden');
    selectionScreen.classList.add('hidden');
    Storage.saveLastType(type);
    window.scrollTo({ top: 0 });
  }

  function goBack() {
    flushSave();
    selectionScreen.classList.remove('hidden');
    formScreen.classList.add('hidden');
    Storage.saveLastType(null);
    window.scrollTo({ top: 0 });
  }

  // --- Render do formulário: 2 colunas (esquerda fixa, direita preenchível) --
  function renderForm() {
    formContainer.innerHTML = '';
    ZONES.forEach(zona => {
      const zoneRows = currentRows.filter(row => row.zona === zona);
      if (!zoneRows.length) return;
      formContainer.appendChild(renderZone(zona, zoneRows));
    });
  }

  // Zona colapsável (aberta por defeito), com o mesmo estilo do cabeçalho.
  function renderZone(zona, zoneRows) {
    const section = document.createElement('details');
    section.className = 'zone-section card';
    section.dataset.zona = zona;
    section.open = true;

    const summary = document.createElement('summary');
    summary.className = 'zone-title';
    summary.textContent = zona;
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'zone-body';

    const camposOrder = [];
    const porCampo = {};
    zoneRows.forEach(row => {
      if (!porCampo[row.campo]) {
        porCampo[row.campo] = [];
        camposOrder.push(row.campo);
      }
      porCampo[row.campo].push(row);
    });

    camposOrder.forEach(campo => {
      body.appendChild(renderCampoBlock(campo, porCampo[campo]));
    });

    section.appendChild(body);
    return section;
  }

  function renderCampoBlock(campo, campoRows) {
    const block = document.createElement('div');
    block.className = 'field-block';
    block.dataset.campo = campo;

    const repeatRow = campoRows.find(row => row.repetivel);
    if (repeatRow) {
      block.appendChild(renderFieldRow(repeatRow, campo, { title: true }));
      return block;
    }

    if (campoRows.length === 1 && !campoRows[0].subcategoria) {
      block.appendChild(renderFieldRow(campoRows[0], campo, { title: true }));
      return block;
    }

    // Grupo: a linha principal (sem subcategoria) leva o nome do campo;
    // as subcategorias ficam indentadas por baixo.
    const mainRow = campoRows.find(row => !row.subcategoria);
    if (mainRow) {
      block.appendChild(renderFieldRow(mainRow, campo, { title: true }));
    } else {
      block.appendChild(renderTitleOnlyRow(campo, campoRows[0].notas));
    }
    campoRows.filter(row => row.subcategoria).forEach(row => {
      block.appendChild(renderFieldRow(row, row.subcategoria, { sub: true }));
    });
    return block;
  }

  function renderTitleOnlyRow(campo, note) {
    const fieldRow = document.createElement('div');
    fieldRow.className = 'field-row field-row-title';
    const left = document.createElement('div');
    left.className = 'field-left';
    const label = document.createElement('span');
    label.className = 'field-label field-label-title';
    label.textContent = Generator.fixLabel(campo);
    left.appendChild(label);
    if (note) left.appendChild(makeNote(note));
    fieldRow.appendChild(left);
    fieldRow.appendChild(document.createElement('div'));
    return fieldRow;
  }

  function makeNote(text) {
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = Generator.fixLabel(text);
    return note;
  }

  // 3 secções por linha: esquerda (campo/subcategoria) · meio (opções fixas) · direita (descrição livre).
  // Campos Variável e repetível ocupam meio+direita (não têm opções fixas).
  function renderFieldRow(row, labelText, { title = false, sub = false } = {}) {
    const fieldRow = document.createElement('div');
    fieldRow.className = 'field-row' + (sub ? ' field-row-sub' : '');
    fieldRow.dataset.key = row.key;
    fieldRow.dataset.sub = row.subcategoria || '';

    const left = document.createElement('div');
    left.className = 'field-left';
    const isLabelable = row.tipo !== 'Fixo' && !row.repetivel;
    const label = document.createElement(isLabelable ? 'label' : 'span');
    label.className = 'field-label' + (title ? ' field-label-title' : '');
    label.id = `lbl-${row.key}`;
    if (isLabelable) label.htmlFor = `f-${row.key}`;
    label.textContent = Generator.fixLabel(labelText);
    left.appendChild(label);
    if (row.notas) left.appendChild(makeNote(row.notas));
    fieldRow.appendChild(left);

    if (!row.repetivel && row.tipo === 'Fixo') {
      const mid = document.createElement('div');
      mid.className = 'field-mid';
      mid.appendChild(renderChips(row));
      fieldRow.appendChild(mid);

      const right = document.createElement('div');
      right.className = 'field-right';
      // Campo de medida associado a uma opção (ex.: Pinça Pespontada → distância do pesponto).
      if (row.medida) {
        right.appendChild(makeCap(`${row.medida.label} (${row.medida.unidade})`, `med-${row.key}`));
        right.appendChild(renderMedidaInput(row));
      }
      right.appendChild(makeCap('Outras indicações', `f-${row.key}`));
      right.appendChild(renderExtraInput(row));
      fieldRow.appendChild(right);
    } else {
      const wide = document.createElement('div');
      wide.className = 'field-wide';
      wide.appendChild(
        row.repetivel ? renderRepeatControl(row)
          : row.tipo === 'Numérico' ? renderNumericControl(row)
          : renderVariavelControl(row)
      );
      fieldRow.appendChild(wide);
    }

    return fieldRow;
  }

  function makeCap(text, forId) {
    const cap = document.createElement('label');
    cap.className = 'field-cap';
    if (forId) cap.htmlFor = forId;
    cap.textContent = text;
    return cap;
  }

  // Campo Fixo — opções: chips multi-seleção + opção em branco
  function renderChips(row) {
    const chipList = document.createElement('div');
    chipList.className = 'chip-list';
    chipList.setAttribute('role', 'group');
    chipList.setAttribute('aria-labelledby', `lbl-${row.key}`);

    const state = () => formState[row.key];

    function makeChip(value, text, extraClass) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (extraClass ? ` ${extraClass}` : '');
      chip.dataset.value = value;
      chip.textContent = text;
      return chip;
    }

    const chips = [];
    const syncAll = () => {
      chips.forEach(({ chip, value }) => {
        const on = state().selected.includes(value);
        chip.classList.toggle('selected', on);
        chip.setAttribute('aria-pressed', String(on));
      });
    };

    const blankChip = makeChip(BLANK, '—', 'chip-blank');
    blankChip.title = 'Mencionar o campo sem escolher opção';
    blankChip.setAttribute('aria-label', 'Deixar em branco (o campo aparece na descrição sem valor)');
    blankChip.addEventListener('click', () => {
      const s = state();
      s.selected = s.selected.includes(BLANK) ? [] : [BLANK]; // exclusivo
      syncAll();
      flushSave();
    });
    chips.push({ chip: blankChip, value: BLANK });
    chipList.appendChild(blankChip);

    parseOptions(row.opcoes).forEach(option => {
      const chip = makeChip(option, option);
      chip.addEventListener('click', () => {
        const s = state();
        s.selected = s.selected.includes(option)
          ? s.selected.filter(v => v !== option)
          : [...s.selected.filter(v => v !== BLANK), option];
        syncAll();
        flushSave();
      });
      chips.push({ chip, value: option });
      chipList.appendChild(chip);
    });

    syncAll();
    return chipList;
  }

  // Campo Fixo — descrição livre. textarea (aceita Enter → nova linha) auto-resize.
  function renderExtraInput(row) {
    const textarea = document.createElement('textarea');
    textarea.id = `f-${row.key}`;
    textarea.className = 'extra-input';
    textarea.rows = 1;
    textarea.placeholder = 'Texto livre (opcional)';
    textarea.value = formState[row.key].extra || '';
    textarea.addEventListener('input', event => {
      formState[row.key].extra = event.target.value;
      autoExpand(event.target);
      scheduleSave();
    });
    requestAnimationFrame(() => autoExpand(textarea));
    return textarea;
  }

  // Campo Variável: textarea larga e baixa, com auto-expansão
  function renderVariavelControl(row) {
    const textarea = document.createElement('textarea');
    textarea.id = `f-${row.key}`;
    textarea.rows = 1;
    textarea.placeholder = 'Escrever indicações…';
    textarea.value = formState[row.key] || '';
    textarea.addEventListener('input', event => {
      formState[row.key] = event.target.value;
      autoExpand(event.target);
      scheduleSave();
    });
    requestAnimationFrame(() => autoExpand(textarea));
    return textarea;
  }

  function autoExpand(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }

  // Campo de medida (mm) associado a uma opção de um campo Fixo.
  function renderMedidaInput(row) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = `med-${row.key}`;
    input.className = 'medida-input';
    input.min = '0';
    input.inputMode = 'numeric';
    input.placeholder = row.medida.unidade;
    input.value = formState[row.key].medida || '';
    input.addEventListener('input', event => {
      formState[row.key].medida = event.target.value;
      scheduleSave();
    });
    return input;
  }

  // Campo Numérico: input numérico com sufixo de unidade (ex.: mm).
  function renderNumericControl(row) {
    const wrap = document.createElement('div');
    wrap.className = 'numeric-control';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = `f-${row.key}`;
    input.className = 'medida-input';
    input.min = '0';
    input.inputMode = 'numeric';
    input.placeholder = '0';
    input.value = formState[row.key] || '';
    input.addEventListener('input', event => {
      formState[row.key] = event.target.value;
      scheduleSave();
    });
    wrap.appendChild(input);
    if (row.unidade) {
      const unit = document.createElement('span');
      unit.className = 'unit-suffix';
      unit.textContent = row.unidade;
      wrap.appendChild(unit);
    }
    return wrap;
  }

  // Campo repetível (Bolsos, Botões, …): instâncias com sub-campos tipados
  // definidos em campos.js (row.subCampos + row.formato). Nada hard-coded aqui.
  function renderRepeatControl(row) {
    const subCampos = subCamposOf(row);
    const control = document.createElement('div');
    control.className = 'repeat-control';

    const list = document.createElement('div');
    list.className = 'repeat-list';
    control.appendChild(list);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'secondary repeat-add';
    addButton.textContent = `+ ${row.addLabel || 'Adicionar'}`;
    addButton.addEventListener('click', () => {
      if (formState[row.key].length >= MAX_ROWS) return;
      formState[row.key].push(emptyInstance(subCampos));
      flushSave();
      renderRepeatRows(row, list);
    });
    control.appendChild(addButton);

    renderRepeatRows(row, list);
    return control;
  }

  function renderRepeatRows(row, list) {
    const subCampos = subCamposOf(row);
    list.innerHTML = '';

    formState[row.key].forEach((inst, index) => {
      const line = document.createElement('div');
      line.className = 'repeat-row';

      subCampos.forEach(sc => line.appendChild(renderSubField(row, list, inst, sc)));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'repeat-remove';
      remove.setAttribute('aria-label', 'Remover esta instância');
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        formState[row.key].splice(index, 1);
        flushSave();
        renderRepeatRows(row, list);
      });
      line.appendChild(remove);

      list.appendChild(line);
    });
  }

  function renderSubField(row, list, inst, sc) {
    const field = document.createElement('div');
    field.className = `repeat-field repeat-field-${sc.tipo}`;

    const cap = document.createElement('span');
    cap.className = 'repeat-field-label';
    cap.textContent = sc.label;
    field.appendChild(cap);

    if (sc.tipo === 'numero') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'qty-input';
      input.min = '1';
      input.inputMode = 'numeric';
      input.value = inst[sc.id] || '';
      input.addEventListener('input', event => { inst[sc.id] = event.target.value; scheduleSave(); });
      field.appendChild(input);
    } else if (sc.tipo === 'fixo') {
      const select = document.createElement('select');
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '— escolher —';
      select.appendChild(empty);
      (sc.opcoes || []).forEach(option => {
        const optionEl = document.createElement('option');
        optionEl.value = option;
        optionEl.textContent = option;
        select.appendChild(optionEl);
      });
      select.value = inst[sc.id] || '';
      select.addEventListener('change', event => {
        inst[sc.id] = event.target.value;
        flushSave();
        if (sc.allowOutros) renderRepeatRows(row, list); // mostrar/esconder o texto livre
      });
      field.appendChild(select);

      if (sc.allowOutros && (inst[sc.id] || '').toLowerCase() === 'outros') {
        const textarea = document.createElement('textarea');
        textarea.className = 'repeat-outros';
        textarea.rows = 1;
        textarea.placeholder = 'Especificar…';
        textarea.value = inst[`${sc.id}__outros`] || '';
        textarea.addEventListener('input', event => {
          inst[`${sc.id}__outros`] = event.target.value;
          autoExpand(event.target);
          scheduleSave();
        });
        requestAnimationFrame(() => autoExpand(textarea));
        field.appendChild(textarea);
      }
    } else { // 'texto' — notas/localização: textarea auto-resize
      const textarea = document.createElement('textarea');
      textarea.rows = 1;
      textarea.placeholder = 'Escrever…';
      textarea.value = inst[sc.id] || '';
      textarea.addEventListener('input', event => {
        inst[sc.id] = event.target.value;
        autoExpand(event.target);
        scheduleSave();
      });
      requestAnimationFrame(() => autoExpand(textarea));
      field.appendChild(textarea);
    }

    return field;
  }

  // --- Resultados ----------------------------------------------------------
  function generate() {
    flushSave();
    latestModel = Generator.buildModel(currentRows, formState);
    renderOutputs();
    resultsPanel.classList.remove('hidden');
    resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function isRichActive() {
    return versionRich.classList.contains('active');
  }

  function renderOutputs() {
    if (!latestModel) return;
    const rich = isRichActive();
    ZONES.forEach(zone => {
      const box = outputBoxes[zone];
      box.innerHTML = rich
        ? Generator.richZone(latestModel, zone)
        : Generator.plainZoneHtml(latestModel, zone);
      box.classList.toggle('rich', rich);
    });
  }

  // Clicar num campo/subcategoria no texto gerado leva ao campo no formulário.
  function jumpToField(key) {
    const target = formContainer.querySelector(`.field-row[data-key="${key}"]`);
    if (!target) return;
    const details = target.closest('details');
    if (details && !details.open) details.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('field-flash');
    setTimeout(() => target.classList.remove('field-flash'), 1400);
  }

  async function copyText(text, html, button) {
    try {
      if (html && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard API indisponível');
      }
    } catch (err) {
      // Fallback (ex.: file:// sem permissões): textarea temporária + execCommand
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    const original = button.textContent;
    button.textContent = 'Copiado!';
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1300);
  }

  function copyZone(zone) {
    if (!latestModel) return;
    if (isRichActive()) {
      const html = Generator.richZone(latestModel, zone);
      copyText(Generator.richToPlain(html), html, copyButtons[zone]);
    } else {
      copyText(Generator.plainZone(latestModel, zone), null, copyButtons[zone]);
    }
  }

  // --- Limpar / eventos ----------------------------------------------------
  function clearDraft() {
    if (!currentType) return;
    Storage.clear(currentType);
    initHeaderState();
    initFormState();
    renderForm();
    latestModel = null;
    resultsPanel.classList.add('hidden');
    flushSave();
  }

  function handleHeaderInput(event) {
    const key = Object.keys(headerFields).find(k => headerFields[k] === event.target);
    if (key) {
      headerState[key] = event.target.value;
      scheduleSave();
    }
  }

  function bindEvents() {
    tabTypes.addEventListener('click', () => showTab('types'));
    tabSaved.addEventListener('click', () => showTab('saved'));
    savedFilter.addEventListener('input', renderSavedListFiltered);
    backButton.addEventListener('click', goBack);
    saveButton.addEventListener('click', saveFicha);
    clearButton.addEventListener('click', clearDraft);
    generateButton.addEventListener('click', generate);

    versionSimple.addEventListener('click', () => {
      versionSimple.classList.add('active');
      versionRich.classList.remove('active');
      renderOutputs();
    });
    versionRich.addEventListener('click', () => {
      versionRich.classList.add('active');
      versionSimple.classList.remove('active');
      renderOutputs();
    });

    ZONES.forEach(zone => {
      copyButtons[zone].addEventListener('click', () => copyZone(zone));
      outputBoxes[zone].addEventListener('click', event => {
        const span = event.target.closest('.jump[data-key]');
        if (span) jumpToField(span.dataset.key);
      });
    });
    Object.values(headerFields).forEach(field => field.addEventListener('input', handleHeaderInput));

    // Garante persistência ao fechar/recarregar mesmo com um save por gravar.
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
  }

  async function init() {
    renderTypeGrid();
    bindEvents();
    if (window.Auth) {
      const signedIn = await window.Auth.gate();
      if (!signedIn) return;
    }
    afterAuth();
  }

  // Chamado depois de confirmada a sessão (ou de imediato, no build
  // portátil, onde não existe window.Auth).
  function afterAuth() {
    const last = Storage.loadLastType();
    if (last && typesInData.has(last)) selectType(last);
  }

  return { init, afterAuth };
})();

window.addEventListener('DOMContentLoaded', () => App.init());

