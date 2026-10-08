// Ecrã de edição de uma ficha de decoração.
//
// Uma ficha tem várias FASES (SMS / PPS / Produção), à maneira dos separadores
// de um Excel: o cabeçalho (referência, OF's, fornecedor) é comum, mas medidas,
// croqui, colocação, comentários e paleta são próprios de cada fase. A fase
// aberta é a cópia de trabalho nas colunas de topo da tabela; as restantes
// ficam guardadas em `fases`.
//
// Na tabela de posições cada linha ocupa DUAS linhas nas colunas de tamanho: em
// cima a medida escrita, em baixo o valor calculado (só de leitura).
const DecoEditor = (() => {
  const refNosso = document.getElementById('decoRefNosso');
  const refCliente = document.getElementById('decoRefCliente');
  const ofsInput = document.getElementById('decoOfs');
  const estampadoInput = document.getElementById('decoEstampado');
  const bordadoInput = document.getElementById('decoBordado');
  const fornecedorInput = document.getElementById('decoFornecedor');
  const saveStatus = document.getElementById('decoSaveStatus');
  const saveButton = document.getElementById('decoSaveButton');
  const printButton = document.getElementById('decoPrintButton');
  const copyButton = document.getElementById('decoCopyButton');
  const formTitle = document.getElementById('decoFormTitle');

  const tamanhosPreset = document.getElementById('decoTamanhosPreset');
  const addTamanhoButton = document.getElementById('decoAddTamanhoButton');
  const addPosicaoButton = document.getElementById('decoAddPosicaoButton');
  const removePosicaoButton = document.getElementById('decoRemovePosicaoButton');
  const mergeButton = document.getElementById('decoMergeButton');
  const unmergeButton = document.getElementById('decoUnmergeButton');
  const fillRowButton = document.getElementById('decoFillRowButton');
  const table = document.getElementById('decoPosicoesTable');

  const colocacaoFrente = document.getElementById('decoColocacaoFrente');
  const colocacaoVerso = document.getElementById('decoColocacaoVerso');
  const colocacaoTexto = document.getElementById('decoColocacaoTexto');
  const colocacaoPartes = document.getElementById('decoColocacaoPartes');
  const partesAddButton = document.getElementById('decoPartesAdd');
  const partesList = document.getElementById('decoPartes');

  const fasesEl = document.getElementById('decoFases');
  const finalizarButton = document.getElementById('decoFinalizarButton');
  const auditoriaEl = document.getElementById('decoAuditoria');

  const comentariosEl = document.getElementById('decoComentarios');
  const comentariosBold = document.getElementById('decoComentariosBold');
  const comentariosRed = document.getElementById('decoComentariosRed');
  const comentariosClear = document.getElementById('decoComentariosClear');

  const FASES = ['SMS', 'PPS', 'Produção'];
  const DEFAULT_TAMANHOS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  // Das descrições standard (DESCRICOES, logo a seguir) esta é a única que não
  // se basta a si própria — há mais do que uma pica, por isso ao escolhê-la
  // pergunta-se qual e compõe-se a frase final.
  const DESCRICAO_PICA = 'Da pica ao início da decoração';
  // A primeira linha é sempre a medida vertical e a segunda a horizontal — é o
  // mesmo par que marca %C/%L na coluna da Ficha MP. O prefixo é da linha, não
  // da escolha: fica à cabeça da célula e a GP escolhe a frase por baixo.
  const PREFIXOS = ['VERTICAL A PARTIR DE:', 'HORIZONTAL A PARTIR DO:'];

  function prefixoDaLinha(index) {
    return PREFIXOS[index] || '';
  }

  const DESCRICOES = [
    'Do ponto + alto ombro ao início da decoração',
    'Do centro ao início da decoração',
    'Do fundo ao início da decoração',
    'Do topo ao início da decoração',
    'Da costura lateral esquerda PV ao início da decoração',
    'Da costura lateral direita PV ao início da decoração',
    'Centrado',
    DESCRICAO_PICA
  ];
  const PRESETS = {
    'XS-5XL': DEFAULT_TAMANHOS.slice(),
    'XS-XXL': ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    'XXS-XXL': ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'],
    'XXS-4XL': ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']
  };

  let ficha = null;
  let saveTimer = null;
  let bound = false;
  let croquiArte = null;
  let croquiTecnico = null;
  let selection = null;   // { row, start, end } - intervalo de colunas de tamanho
  let anchor = null;      // celula onde comecou a seleccao (ancora do Shift)
  let dragSelecting = false;
  let suppressFocusSelect = false;
  let dragSizeIndex = null;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  // ---------------------------------------------------------------------
  // Cálculo da medida final
  //
  //   (medida + valor de costura + queda da costura) × (1 + %C/L)
  //
  // Arredondamento pedido: a parte decimal entre .4 e .6 encosta a .5; fora
  // desse intervalo vai à unidade mais próxima.
  // ---------------------------------------------------------------------
  function num(value) {
    if (value === null || value === undefined) return null;
    const texto = String(value).trim().replace(',', '.');
    if (!texto) return null;
    const n = Number(texto);
    return Number.isFinite(n) ? n : null;
  }

  function arredondar(valor) {
    const base = Math.floor(valor);
    // Arredondar a parte decimal antes de a comparar: 10 x 1,06 dá
    // 10,600000000000001 em vírgula flutuante, e o ,6 ficava de fora do
    // intervalo por um milionésimo.
    const fracao = Math.round((valor - base) * 1e6) / 1e6;
    if (fracao >= 0.4 && fracao <= 0.6) return base + 0.5;
    return Math.round(valor);
  }

  function calcular(pos, index) {
    const medida = num(pos.valores && pos.valores[index]);
    if (medida === null) return null;
    const total = (medida + (num(pos.costura) || 0) + (num(pos.queda) || 0))
      * (1 + (num(pos.mp) || 0) / 100);
    return arredondar(total);
  }

  function formatar(valor) {
    if (valor === null) return '';
    return (Number.isInteger(valor) ? String(valor) : valor.toFixed(1)).replace('.', ',');
  }

  // ---------------------------------------------------------------------
  // Forma dos dados
  // ---------------------------------------------------------------------
  function blankPosicao(overrides) {
    return Object.assign({
      id: uid(),
      letra: '',
      descricao: '',
      pica: '',
      valores: [],
      merges: [],
      costura: '',
      queda: '',
      mp: ''
    }, overrides);
  }

  function defaultPosicoes(tamanhos) {
    const empty = () => tamanhos.map(() => '');
    return [
      blankPosicao({ letra: 'A', valores: empty() }),
      blankPosicao({ letra: '', valores: empty() }),
      blankPosicao({ letra: '', descricao: '', valores: empty() })
    ];
  }

  function conteudoVazio() {
    const tamanhos = DEFAULT_TAMANHOS.slice();
    return {
      tamanhos,
      posicoes: defaultPosicoes(tamanhos),
      colocacao_tipo: null,
      colocacao_texto: null,
      colocacao_partes: null,
      ficha_mp: null,
      comentarios: {},
      paleta: {},
      croqui: {}
    };
  }

  function blankEntry(overrides) {
    const conteudo = conteudoVazio();
    return Object.assign({
      id: uid(),
      ref_nosso_modelo: 'Nova ficha',
      ref_modelo_cliente: null,
      ofs: null,
      estampado: false,
      bordado: false,
      fornecedor: null,
      layout_impressao: 'renovado',
      fase_ativa: FASES[0],
      fases: { [FASES[0]]: { conteudo: clone(conteudo) } }
    }, conteudo, overrides);
  }

  // ---------------------------------------------------------------------
  // Normalização (migra fichas gravadas antes das fases e antes das colunas
  // de costura/queda/%)
  // ---------------------------------------------------------------------
  function normalizeConteudo(alvo) {
    if (!Array.isArray(alvo.tamanhos) || !alvo.tamanhos.length) {
      alvo.tamanhos = DEFAULT_TAMANHOS.slice();
    }
    if (!Array.isArray(alvo.posicoes)) alvo.posicoes = [];
    alvo.posicoes = alvo.posicoes.map(pos => migratePosicao(pos, alvo.tamanhos));
    while (alvo.posicoes.length < 3) {
      alvo.posicoes.push(blankPosicao({ valores: alvo.tamanhos.map(() => '') }));
    }
    if (!alvo.croqui || typeof alvo.croqui !== 'object') alvo.croqui = {};
    if (!alvo.paleta || typeof alvo.paleta !== 'object') alvo.paleta = {};
    if (!alvo.comentarios || typeof alvo.comentarios !== 'object') alvo.comentarios = {};
    return alvo;
  }

  function normalizeFicha(entry) {
    normalizeConteudo(entry);

    if (!entry.fases || typeof entry.fases !== 'object' || Array.isArray(entry.fases)) entry.fases = {};
    if (!FASES.includes(entry.fase_ativa)) entry.fase_ativa = FASES[0];
    // Ficha anterior às fases: o que lá estava passa a ser a primeira fase.
    if (!Object.keys(entry.fases).length) {
      entry.fases = { [entry.fase_ativa]: { conteudo: extrairConteudo(entry) } };
    }
    if (!entry.fases[entry.fase_ativa]) {
      entry.fase_ativa = Object.keys(entry.fases)[0];
      aplicarConteudo(entry, entry.fases[entry.fase_ativa].conteudo);
    }
    return entry;
  }

  function migratePosicao(pos, tamanhos) {
    const out = blankPosicao({
      id: pos.id || uid(),
      letra: pos.letra || '',
      pica: pos.pica || '',
      costura: pos.costura === undefined ? '' : pos.costura,
      queda: pos.queda === undefined ? '' : pos.queda,
      mp: pos.mp === undefined ? '' : pos.mp
    });
    // Em fichas antigas o prefixo vinha em campo próprio, e durante um tempo
    // ficou colado à descrição. Agora é da linha: tira-se dos dois sítios para
    // não aparecer a dobrar.
    const desc = [pos.prefixo, pos.descricao]
      .map(parte => (parte ? String(parte).trim() : ''))
      .filter(Boolean)
      .join(' ');
    out.descricao = semPrefixo(desc);

    if (pos.modo === 'valor_unico') {
      out.valores = tamanhos.map(() => pos.valor || '');
      out.merges = tamanhos.length ? [[0, tamanhos.length - 1]] : [];
    } else {
      const valores = Array.isArray(pos.valores) ? pos.valores.slice() : [];
      while (valores.length < tamanhos.length) valores.push('');
      valores.length = tamanhos.length;
      out.valores = valores;
      out.merges = normalizeMerges(Array.isArray(pos.merges) ? pos.merges : [], tamanhos.length);
    }
    return out;
  }

  function semPrefixo(texto) {
    let resto = texto;
    PREFIXOS.forEach(prefixo => {
      if (resto.toUpperCase().startsWith(prefixo)) resto = resto.slice(prefixo.length);
    });
    return resto.trim();
  }

  function normalizeMerges(merges, count) {
    const clean = [];
    merges
      .map(range => [Number(range[0]), Number(range[1])])
      .filter(range => Number.isFinite(range[0]) && Number.isFinite(range[1]))
      .map(range => [Math.max(0, Math.min(range[0], range[1])), Math.min(count - 1, Math.max(range[0], range[1]))])
      .filter(range => range[1] > range[0])
      .sort((a, b) => a[0] - b[0])
      .forEach(range => {
        const last = clean[clean.length - 1];
        if (last && range[0] <= last[1]) return; // sobreposto — ignora
        clean.push(range);
      });
    return clean;
  }

  function rangesFor(pos, count) {
    const merges = normalizeMerges(pos.merges || [], count);
    const out = [];
    let index = 0;
    while (index < count) {
      const merge = merges.find(range => range[0] === index);
      if (merge) {
        out.push({ start: merge[0], span: merge[1] - merge[0] + 1 });
        index = merge[1] + 1;
      } else {
        out.push({ start: index, span: 1 });
        index += 1;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Fases
  // ---------------------------------------------------------------------
  function extrairConteudo(fonte) {
    return clone({
      tamanhos: fonte.tamanhos,
      posicoes: fonte.posicoes,
      colocacao_tipo: fonte.colocacao_tipo || null,
      colocacao_texto: fonte.colocacao_texto || null,
      colocacao_partes: fonte.colocacao_partes || null,
      ficha_mp: fonte.ficha_mp || null,
      comentarios: fonte.comentarios || {},
      paleta: fonte.paleta || {},
      croqui: fonte.croqui || {}
    });
  }

  function aplicarConteudo(alvo, conteudo) {
    const copia = normalizeConteudo(clone(conteudo || conteudoVazio()));
    alvo.tamanhos = copia.tamanhos;
    alvo.posicoes = copia.posicoes;
    alvo.colocacao_tipo = copia.colocacao_tipo || null;
    alvo.colocacao_texto = copia.colocacao_texto || null;
    alvo.colocacao_partes = copia.colocacao_partes || null;
    alvo.ficha_mp = copia.ficha_mp || null;
    alvo.comentarios = copia.comentarios;
    alvo.paleta = copia.paleta;
    alvo.croqui = copia.croqui;
  }

  function renderFases() {
    fasesEl.innerHTML = '';
    FASES.forEach(nome => {
      const existe = !!(ficha.fases && ficha.fases[nome]);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'deco-fase' + (nome === ficha.fase_ativa ? ' active' : '') + (existe ? '' : ' is-vazia');
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(nome === ficha.fase_ativa));
      button.textContent = nome;
      if (existe && ficha.fases[nome].finalizada_em) {
        const check = document.createElement('span');
        check.className = 'deco-fase__check';
        check.textContent = '✓';
        check.title = 'Fase finalizada';
        button.appendChild(check);
      }
      button.title = existe ? `Abrir a fase ${nome}` : `Criar a fase ${nome}`;
      button.addEventListener('click', () => trocarFase(nome));
      fasesEl.appendChild(button);
    });
    renderAuditoria();
  }

  function renderAuditoria() {
    const fase = (ficha.fases && ficha.fases[ficha.fase_ativa]) || {};
    finalizarButton.textContent = fase.finalizada_em ? 'Reabrir fase' : 'Finalizar fase';

    const partes = [];
    if (fase.finalizada_em) {
      const quando = new Date(fase.finalizada_em);
      const quem = nomeDe(fase.finalizada_por);
      partes.push(`${ficha.fase_ativa} finalizada a ${quando.toLocaleDateString('pt-PT')}${quem ? ' por ' + quem : ''}`);
    } else if (ficha.updated_at) {
      const quando = new Date(ficha.updated_at);
      partes.push(`Atualizada a ${quando.toLocaleDateString('pt-PT')} às ${quando.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`);
      const quem = nomeDe(ficha.updated_by);
      if (quem) partes.push(`por ${quem}`);
    } else {
      partes.push('Ainda não guardada.');
    }
    auditoriaEl.textContent = partes.join(' · ');
  }

  function nomeDe(email) {
    return (email || '').split('@')[0].replace(/[._]/g, ' ');
  }

  async function trocarFase(nome) {
    if (nome === ficha.fase_ativa) return;
    await doSave();

    if (!ficha.fases[nome]) {
      const origem = await escolherOrigem(nome);
      if (origem === null) return;
      ficha.fases[nome] = {
        conteudo: origem === '' ? extrairConteudo(conteudoVazio()) : clone(ficha.fases[origem].conteudo)
      };
    }

    ficha.fase_ativa = nome;
    aplicarConteudo(ficha, ficha.fases[nome].conteudo);
    load(ficha);
    await doSave();
  }

  // Ao criar uma fase nova pergunta-se de onde parte: em branco, ou a copiar
  // uma fase que ja exista (o caso normal - o PPS parte do SMS). Resolve com
  // o nome da fase escolhida, '' para comecar em branco, ou null se cancelar.
  function escolherOrigem(nome) {
    const existentes = FASES.filter(f => ficha.fases[f]);
    if (!existentes.length) return Promise.resolve('');

    return DecoDialog.escolher({
      titulo: 'Criar a fase ' + nome,
      mensagem: existentes.length === 1
        ? 'Queres partir do que j\u00e1 est\u00e1 em ' + existentes[0] + ', ou come\u00e7ar esta fase em branco?'
        : 'Queres partir de uma fase que j\u00e1 existe, ou come\u00e7ar esta fase em branco?',
      opcoes: existentes
        .map((origem, index) => ({
          etiqueta: 'Copiar de ' + origem,
          valor: origem,
          destaque: index === existentes.length - 1
        }))
        .concat([{ etiqueta: 'Come\u00e7ar em branco', valor: '' }])
    });
  }

  async function toggleFinalizar() {
    const fase = ficha.fases[ficha.fase_ativa];
    if (!fase) return;
    if (fase.finalizada_em) {
      delete fase.finalizada_em;
      delete fase.finalizada_por;
    } else {
      fase.finalizada_em = new Date().toISOString();
      fase.finalizada_por = await emailDaSessao();
    }
    renderFases();
    await doSave();
  }

  async function emailDaSessao() {
    try {
      const { data } = await window.Auth.client.auth.getSession();
      return (data && data.session && data.session.user && data.session.user.email) || null;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Partes da Colocação: as de fábrica estão no HTML; as que as pessoas
  // acrescentam ficam numa tabela partilhada e juntam-se à mesma lista.
  // ---------------------------------------------------------------------
  let partesExtraCarregadas = false;

  function partesNaLista() {
    return Array.from(partesList.options).map(o => o.value.trim().toLowerCase());
  }

  function juntarParte(nome) {
    if (partesNaLista().includes(nome.trim().toLowerCase())) return;
    const opcao = document.createElement('option');
    opcao.value = nome;
    const seguinte = Array.from(partesList.options).find(o => o.value.localeCompare(nome, 'pt') > 0);
    partesList.insertBefore(opcao, seguinte || null);
  }

  async function carregarPartesExtra() {
    if (partesExtraCarregadas) return;
    partesExtraCarregadas = true;
    (await DecoStorage.listPartesExtra()).forEach(juntarParte);
    atualizarBotaoParte();
  }

  function atualizarBotaoParte() {
    const valor = colocacaoPartes.value.trim();
    const novo = valor && !partesNaLista().includes(valor.toLowerCase());
    partesAddButton.classList.toggle('hidden', !novo);
    if (novo) partesAddButton.textContent = `+ Adicionar "${valor}" à lista`;
  }

  async function acrescentarParte() {
    const nome = colocacaoPartes.value.trim().replace(/\s+/g, ' ');
    if (!nome) return;
    partesAddButton.disabled = true;
    const ok = await DecoStorage.addParteExtra(nome);
    partesAddButton.disabled = false;
    if (!ok) {
      window.alert('Não foi possível acrescentar à lista. Se o problema continuar, avisa quem gere a aplicação.');
      return;
    }
    colocacaoPartes.value = nome;
    juntarParte(nome);
    atualizarBotaoParte();
    scheduleSave();
  }

  // ---------------------------------------------------------------------
  // Carregar / guardar
  // ---------------------------------------------------------------------
  function load(entry) {
    ficha = normalizeFicha(entry);
    selection = null;

    formTitle.textContent = `${ficha.ref_nosso_modelo || 'Ficha de decoração'} · ${ficha.fase_ativa}`;
    refNosso.value = ficha.ref_nosso_modelo || '';
    refCliente.value = ficha.ref_modelo_cliente || '';
    ofsInput.value = ficha.ofs || '';
    estampadoInput.checked = !!ficha.estampado;
    bordadoInput.checked = !!ficha.bordado;
    fornecedorInput.value = ficha.fornecedor || '';
    colocacaoTexto.value = ficha.colocacao_texto || '';
    colocacaoPartes.value = ficha.colocacao_partes || '';
    carregarPartesExtra();
    atualizarBotaoParte();
    renderColocacao();
    comentariosEl.innerHTML = sanitizeHtml((ficha.comentarios && ficha.comentarios.html) || '');
    renderFases();
    saveStatus.textContent = '';
    tamanhosPreset.value = '';

    renderTable();
    ficha.paleta = DecoPalette.load(ficha.paleta, {
      onChange: scheduleSave,
      fichaId: () => ficha.id
    });
    ensureCroqui();

    if (!bound) {
      bindEvents();
      bound = true;
    }
  }

  function payload() {
    const conteudo = {
      tamanhos: ficha.tamanhos,
      posicoes: ficha.posicoes,
      colocacao_tipo: ficha.colocacao_tipo || null,
      colocacao_texto: colocacaoTexto.value.trim() || null,
      colocacao_partes: colocacaoPartes.value.trim() || null,
      ficha_mp: (ficha.ficha_mp || '').trim() || null,
      comentarios: { html: sanitizeHtml(comentariosEl.innerHTML), texto: comentariosEl.textContent || '' },
      paleta: ficha.paleta || {},
      croqui: ficha.croqui || {}
    };

    // A fase aberta é sempre gravada a par das colunas de topo, para as duas
    // nunca divergirem.
    const fases = Object.assign({}, ficha.fases);
    fases[ficha.fase_ativa] = Object.assign({}, fases[ficha.fase_ativa], { conteudo: clone(conteudo) });

    return Object.assign({
      id: ficha.id,
      ref_nosso_modelo: refNosso.value.trim() || 'Sem referência',
      ref_modelo_cliente: refCliente.value.trim() || null,
      ofs: ofsInput.value.trim() || null,
      estampado: estampadoInput.checked,
      bordado: bordadoInput.checked,
      fornecedor: fornecedorInput.value.trim() || null,
      layout_impressao: 'renovado',
      fase_ativa: ficha.fase_ativa,
      fases
    }, conteudo);
  }

  function scheduleSave() {
    saveStatus.textContent = 'A guardar...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { doSave(); }, 800);
  }

  async function doSave() {
    clearTimeout(saveTimer);
    if (!ficha) return null;
    saveStatus.textContent = 'A guardar...';
    const body = payload();
    const saved = await DecoStorage.upsertFicha(body);
    if (!saved) {
      saveStatus.textContent = 'Não foi possível guardar — verifica a ligação.';
      return null;
    }
    // Só se copiam escalares e os campos de auditoria. As referências de
    // posicoes/croqui/paleta TÊM de continuar a ser as mesmas: os inputs da
    // tabela e os painéis do croqui escrevem diretamente nesses objetos, e
    // substitui-los aqui faria perder tudo o que se escrevesse a seguir.
    Object.assign(ficha, {
      ref_nosso_modelo: body.ref_nosso_modelo,
      ref_modelo_cliente: body.ref_modelo_cliente,
      ofs: body.ofs,
      estampado: body.estampado,
      bordado: body.bordado,
      fornecedor: body.fornecedor,
      colocacao_tipo: body.colocacao_tipo,
      colocacao_texto: body.colocacao_texto,
      colocacao_partes: body.colocacao_partes,
      ficha_mp: body.ficha_mp,
      comentarios: body.comentarios,
      layout_impressao: body.layout_impressao,
      fases: body.fases,
      fase_ativa: body.fase_ativa,
      created_at: saved.created_at,
      created_by: saved.created_by,
      updated_at: saved.updated_at,
      updated_by: saved.updated_by
    });
    formTitle.textContent = `${ficha.ref_nosso_modelo || 'Ficha de decoração'} · ${ficha.fase_ativa}`;
    const now = new Date();
    saveStatus.textContent = `Guardado às ${now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
    renderAuditoria();
    return ficha;
  }

  // ---------------------------------------------------------------------
  // Tamanhos
  // ---------------------------------------------------------------------
  function addTamanho() {
    ficha.tamanhos.push('Novo');
    ficha.posicoes.forEach(pos => pos.valores.push(''));
    selection = null;
    renderTable();
    scheduleSave();
  }

  function removeTamanho(index) {
    if (ficha.tamanhos.length <= 1) return;
    ficha.tamanhos.splice(index, 1);
    ficha.posicoes.forEach(pos => {
      pos.valores.splice(index, 1);
      pos.merges = [];
    });
    selection = null;
    renderTable();
    scheduleSave();
  }

  // Arrastar um tamanho para outra posicao (ou Alt+setas no teclado). As
  // celulas unidas sao desfeitas porque os intervalos deixariam de fazer
  // sentido depois de trocar a ordem das colunas.
  function moveTamanhoTo(from, to) {
    if (from === to || from < 0 || to < 0) return;
    const sizes = ficha.tamanhos;
    if (from >= sizes.length || to >= sizes.length) return;
    const [size] = sizes.splice(from, 1);
    sizes.splice(to, 0, size);
    ficha.posicoes.forEach(pos => {
      const [value] = pos.valores.splice(from, 1);
      pos.valores.splice(to, 0, value);
      pos.merges = [];
    });
    selection = null;
    anchor = null;
    renderTable();
    scheduleSave();
  }

  function clearDropMarks() {
    table.querySelectorAll('.is-drop-before, .is-drop-after')
      .forEach(cell => cell.classList.remove('is-drop-before', 'is-drop-after'));
  }

  function applyPreset(key) {
    const sizes = PRESETS[key];
    if (!sizes) return;
    ficha.tamanhos = sizes.slice();
    ficha.posicoes.forEach(pos => {
      const values = pos.valores || [];
      while (values.length < sizes.length) values.push('');
      values.length = sizes.length;
      pos.valores = values;
      pos.merges = normalizeMerges(pos.merges || [], sizes.length);
    });
    selection = null;
    renderTable();
    scheduleSave();
  }

  // ---------------------------------------------------------------------
  // Linhas (posições)
  // ---------------------------------------------------------------------
  function addPosicao() {
    ficha.posicoes.push(blankPosicao({ valores: ficha.tamanhos.map(() => '') }));
    renderTable();
    refreshCroquiLabels();
    scheduleSave();
  }

  async function removePosicao(index) {
    if (index === null || index === undefined || !ficha.posicoes[index]) return;
    if (ficha.posicoes.length <= 1) return;
    const removed = ficha.posicoes[index];
    const hasContent = removed.letra || removed.descricao || removed.valores.some(Boolean);
    if (hasContent) {
      const confirmado = await DecoDialog.confirmar({
        titulo: 'Apagar esta linha?',
        mensagem: [removed.letra, removed.descricao].filter(Boolean).join(' — ')
          || 'A linha tem medidas preenchidas.',
        confirmar: 'Apagar linha',
        perigo: true
      });
      if (!confirmado) return;
    }
    ficha.posicoes.splice(index, 1);
    selection = null;
    renderTable();
    refreshCroquiLabels();
    await handleOrphanLabels();
    scheduleSave();
  }

  // ---------------------------------------------------------------------
  // União / separação de células (como no Excel)
  // ---------------------------------------------------------------------
  function mergeSelection() {
    if (!selection || selection.end <= selection.start) return;
    const pos = ficha.posicoes[selection.row];
    if (!pos) return;
    const merges = (pos.merges || []).filter(range => range[1] < selection.start || range[0] > selection.end);
    merges.push([selection.start, selection.end]);
    pos.merges = normalizeMerges(merges, ficha.tamanhos.length);
    const value = pos.valores.slice(selection.start, selection.end + 1).find(Boolean) || '';
    for (let i = selection.start; i <= selection.end; i += 1) pos.valores[i] = value;
    renderTable();
    scheduleSave();
  }

  function unmergeSelection() {
    if (!selection) return;
    const pos = ficha.posicoes[selection.row];
    if (!pos) return;
    pos.merges = (pos.merges || []).filter(range => range[1] < selection.start || range[0] > selection.end);
    renderTable();
    scheduleSave();
  }

  function fillRowFromSelection() {
    if (!selection) return;
    const pos = ficha.posicoes[selection.row];
    if (!pos) return;
    const value = pos.valores[selection.start] || '';
    pos.valores = pos.valores.map(() => value);
    pos.merges = ficha.tamanhos.length > 1 ? [[0, ficha.tamanhos.length - 1]] : [];
    selection = { row: selection.row, start: 0, end: ficha.tamanhos.length - 1 };
    renderTable();
    scheduleSave();
  }

  function selectRowOnly(rowIndex) {
    anchor = { row: rowIndex, start: 0, end: 0 };
    setSelection(rowIndex, 0, 0);
  }

  function extendSelection(row, start, end) {
    if (!anchor) return;
    setSelection(row, Math.min(anchor.start, start), Math.max(anchor.end, end));
  }

  function setSelection(row, start, end) {
    selection = { row, start: Math.min(start, end), end: Math.max(start, end) };
    updateToolbarState();
    highlightSelection();
  }

  function updateToolbarState() {
    const active = !!selection;
    const span = active ? selection.end - selection.start + 1 : 0;
    mergeButton.disabled = !active || span < 2;
    fillRowButton.disabled = !active;
    let merged = false;
    if (active) {
      const pos = ficha.posicoes[selection.row];
      merged = (pos.merges || []).some(range => range[1] >= selection.start && range[0] <= selection.end);
    }
    unmergeButton.disabled = !merged;
  }

  function highlightSelection() {
    table.querySelectorAll('.is-selected').forEach(cell => cell.classList.remove('is-selected'));
    if (!selection) return;
    table.querySelectorAll('td[data-row][data-col]').forEach(cell => {
      const row = Number(cell.dataset.row);
      const start = Number(cell.dataset.col);
      const end = start + Number(cell.dataset.span || 1) - 1;
      if (row === selection.row && end >= selection.start && start <= selection.end) {
        cell.classList.add('is-selected');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Render da tabela
  // ---------------------------------------------------------------------
  function miniButton(label, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'deco-mini-button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', handler);
    return button;
  }

  function th(text, className) {
    const cell = document.createElement('th');
    cell.className = className || '';
    cell.textContent = text;
    return cell;
  }

  function renderTable() {
    // A tabela e refeita de raiz: um menu aberto ficaria preso a um input morto.
    fecharMenuDescricoes();
    table.innerHTML = '';
    const count = ficha.tamanhos.length;

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(th('Posição', 'deco-col-posicao'));
    headRow.appendChild(th('Descrição', 'deco-col-descricao'));
    headRow.appendChild(th('Valor de costura', 'deco-col-num'));
    headRow.appendChild(th('Queda da costura', 'deco-col-num'));
    // Cabecalho da Ficha MP dividido: o rotulo em cima, um campo livre em
    // baixo (vale para a coluna toda, nao por linha).
    const mpHead = document.createElement('th');
    mpHead.className = 'deco-col-num deco-col-mp-head';
    mpHead.appendChild(document.createTextNode('Ficha MP'));
    const mpHeadInput = document.createElement('input');
    mpHeadInput.type = 'text';
    mpHeadInput.className = 'deco-mp-head-input';
    mpHeadInput.value = ficha.ficha_mp || '';
    mpHeadInput.setAttribute('aria-label', 'Ficha MP');
    mpHeadInput.addEventListener('input', () => {
      ficha.ficha_mp = mpHeadInput.value;
      scheduleSave();
    });
    mpHead.appendChild(mpHeadInput);
    headRow.appendChild(mpHead);

    ficha.tamanhos.forEach((size, index) => {
      const cell = document.createElement('th');
      cell.className = 'deco-col-tamanho';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = size;
      input.className = 'deco-tamanho-input';
      input.setAttribute('aria-label', `Tamanho ${index + 1}`);
      input.addEventListener('input', () => {
        ficha.tamanhos[index] = input.value;
        scheduleSave();
      });
      input.addEventListener('keydown', event => {
        if (!event.altKey) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          moveTamanhoTo(index, index - 1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          moveTamanhoTo(index, index + 1);
        }
      });
      cell.appendChild(input);

      const controls = document.createElement('div');
      controls.className = 'deco-tamanho-controls';
      const grip = document.createElement('span');
      grip.className = 'deco-tamanho-grip';
      grip.textContent = '∷∷';
      grip.title = 'Arrastar para mudar este tamanho de lugar (ou Alt + setas)';
      grip.draggable = true;
      grip.addEventListener('dragstart', event => {
        dragSizeIndex = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });
      grip.addEventListener('dragend', () => {
        dragSizeIndex = null;
        clearDropMarks();
      });
      controls.appendChild(grip);
      controls.appendChild(miniButton('✕', 'Remover este tamanho', () => removeTamanho(index)));
      cell.appendChild(controls);

      cell.addEventListener('dragover', event => {
        if (dragSizeIndex === null || dragSizeIndex === index) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        clearDropMarks();
        cell.classList.add(index < dragSizeIndex ? 'is-drop-before' : 'is-drop-after');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('is-drop-before', 'is-drop-after');
      });
      cell.addEventListener('drop', event => {
        event.preventDefault();
        clearDropMarks();
        if (dragSizeIndex === null || dragSizeIndex === index) return;
        moveTamanhoTo(dragSizeIndex, index);
        dragSizeIndex = null;
      });

      headRow.appendChild(cell);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    ficha.posicoes.forEach((pos, rowIndex) => {
      tbody.appendChild(renderRowMedidas(pos, rowIndex, count));
      tbody.appendChild(renderRowCalculada(pos, rowIndex, count));
    });
    table.appendChild(tbody);

    updateToolbarState();
    highlightSelection();
  }

  function numeroInput(pos, campo, rowIndex, aria) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'deco-num-input';
    input.value = pos[campo] === undefined || pos[campo] === null ? '' : String(pos[campo]);
    input.setAttribute('aria-label', aria);
    input.addEventListener('input', () => {
      pos[campo] = input.value;
      atualizarCalculadas(rowIndex);
      scheduleSave();
    });
    input.addEventListener('focus', () => selectRowOnly(rowIndex));
    input.addEventListener('mousedown', () => selectRowOnly(rowIndex));
    return input;
  }

  // Menu das descrições standard. Um <datalist> nativo não mostra seta nenhuma
  // e, quando a célula já tem texto que não está na lista, abre vazio — numa
  // tabela densa ninguém adivinha que há ali uma escolha. Por isso a lista é
  // nossa: a seta abre-a sempre inteira, escrever vai filtrando. Vive no
  // <body>, em position:fixed, porque a tabela tem scroll horizontal e um menu
  // dentro da célula ficaria cortado.
  let fecharMenu = null;

  function fecharMenuDescricoes() {
    if (fecharMenu) fecharMenu();
  }

  function abrirMenuDescricoes(input, opcoes, onEscolha) {
    fecharMenuDescricoes();
    if (!opcoes.length) return;

    const menu = document.createElement('div');
    menu.className = 'deco-desc-menu';
    menu.setAttribute('role', 'listbox');

    let ativo = -1;
    const itens = opcoes.map(texto => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'deco-desc-menu__item';
      item.setAttribute('role', 'option');
      item.textContent = texto;
      // Sem isto o mousedown tira o foco do campo antes de o clique chegar.
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => {
        fechar();
        onEscolha(texto);
      });
      menu.appendChild(item);
      return item;
    });

    function marcar(indice) {
      if (itens[ativo]) itens[ativo].classList.remove('is-ativo');
      ativo = indice;
      if (itens[ativo]) {
        itens[ativo].classList.add('is-ativo');
        itens[ativo].scrollIntoView({ block: 'nearest' });
      }
    }

    function posicionar() {
      const r = input.getBoundingClientRect();
      const largura = Math.max(r.width, 300);
      const espacoAbaixo = window.innerHeight - r.bottom;
      menu.style.width = largura + 'px';
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) + 'px';
      // Sem espaço em baixo (última linha da tabela), abre para cima.
      if (espacoAbaixo < 180 && r.top > espacoAbaixo) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - r.top + 2) + 'px';
        menu.style.maxHeight = (r.top - 12) + 'px';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 2) + 'px';
        menu.style.maxHeight = Math.max(120, espacoAbaixo - 12) + 'px';
      }
    }

    const onTecla = event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        marcar(ativo + 1 >= itens.length ? 0 : ativo + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        marcar(ativo - 1 < 0 ? itens.length - 1 : ativo - 1);
      } else if (event.key === 'Enter' && ativo >= 0) {
        event.preventDefault();
        const texto = opcoes[ativo];
        fechar();
        onEscolha(texto);
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        fechar();
      }
    };
    const onFora = event => {
      if (!menu.contains(event.target) && event.target !== input) fechar();
    };
    const onScroll = () => {
      const r = input.getBoundingClientRect();
      // Saiu de vista (a tabela tem scroll proprio): ai sim, fecha.
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
        fechar();
        return;
      }
      posicionar();
    };

    let terminado = false;
    function fechar() {
      if (terminado) return;
      terminado = true;
      fecharMenu = null;
      menu.remove();
      input.removeEventListener('keydown', onTecla);
      document.removeEventListener('mousedown', onFora, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', fechar);
    }
    fecharMenu = fechar;

    input.addEventListener('keydown', onTecla);
    document.addEventListener('mousedown', onFora, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', fechar);

    document.body.appendChild(menu);
    posicionar();
  }

  function filtrarDescricoes(texto) {
    const termo = (texto || '').trim().toLowerCase();
    if (!termo) return DESCRICOES.slice();
    return DESCRICOES.filter(o => o.toLowerCase().includes(termo));
  }

  // "Da pica ao início da decoração" não diz de que pica se trata: pergunta-se
  // e compõe-se a frase completa, que é o que vai para o croqui e para a folha.
  async function perguntarPica(pos, input, anterior) {
    const nome = await DecoDialog.pedirTexto({
      titulo: 'Qual a pica?',
      mensagem: 'Identifica a pica a partir da qual se mede o início da decoração. '
        + 'Em branco fica só "Da pica ao início da decoração".',
      etiqueta: 'Pica',
      valor: pos.pica || '',
      placeholder: 'Ex.: de tamanho, de marca, de composição',
      confirmar: 'Aplicar'
    });
    if (nome === null) {
      // Cancelou: repõe a descrição que lá estava, em vez de deixar a frase
      // genérica que a escolha da lista acabou de escrever.
      pos.descricao = anterior || '';
      input.value = pos.descricao;
      input.title = pos.descricao;
      refreshCroquiLabels();
      scheduleSave();
      return;
    }
    pos.pica = nome.trim();
    pos.descricao = pos.pica
      ? `Da pica ${pos.pica} ao início da decoração`
      : DESCRICAO_PICA;
    input.value = pos.descricao;
    input.title = pos.descricao;
    refreshCroquiLabels();
    scheduleSave();
  }

  function renderRowMedidas(pos, rowIndex, count) {
    const tr = document.createElement('tr');
    tr.dataset.row = String(rowIndex);
    tr.className = 'deco-pos-row';

    const letraCell = document.createElement('td');
    letraCell.className = 'deco-col-posicao';
    letraCell.rowSpan = 2;
    const letraInput = document.createElement('input');
    letraInput.type = 'text';
    letraInput.className = 'deco-letra-input';
    letraInput.value = pos.letra || '';
    letraInput.maxLength = 3;
    letraInput.setAttribute('aria-label', `Posição da linha ${rowIndex + 1}`);
    letraInput.addEventListener('input', () => {
      pos.letra = letraInput.value.toUpperCase();
      letraInput.value = pos.letra;
      refreshCroquiLabels();
      scheduleSave();
    });
    letraInput.addEventListener('focus', () => selectRowOnly(rowIndex));
    letraInput.addEventListener('mousedown', () => selectRowOnly(rowIndex));
    letraCell.appendChild(letraInput);
    tr.appendChild(letraCell);

    const descCell = document.createElement('td');
    descCell.className = 'deco-col-descricao';
    descCell.rowSpan = 2;
    const descWrap = document.createElement('div');
    descWrap.className = 'deco-desc-cell';
    const prefixo = prefixoDaLinha(rowIndex);
    if (prefixo) {
      const prefixoTag = document.createElement('span');
      prefixoTag.className = 'deco-desc-prefixo';
      prefixoTag.textContent = prefixo;
      descWrap.appendChild(prefixoTag);
    }
    const descEscolha = document.createElement('div');
    descEscolha.className = 'deco-desc-escolha';
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'deco-desc-input';
    descInput.value = pos.descricao || '';
    descInput.autocomplete = 'off';
    descInput.placeholder = 'Escolhe da lista ou escreve';
    descInput.setAttribute('aria-label', `Descrição da linha ${rowIndex + 1}`);
    descInput.title = pos.descricao || '';

    // O que lá estava antes da escolha atual: é o que o Cancelar da janela da
    // pica repõe, para cancelar querer mesmo dizer "não mudes nada".
    let anterior = pos.descricao || '';

    function aplicarDescricao(texto) {
      const anteriorAgora = anterior;
      pos.descricao = texto;
      descInput.value = texto;
      descInput.title = texto;
      refreshCroquiLabels();
      scheduleSave();
      anterior = texto;
      if (texto !== DESCRICAO_PICA) return;
      perguntarPica(pos, descInput, anteriorAgora).then(() => {
        anterior = pos.descricao || '';
      });
    }

    const descToggle = document.createElement('button');
    descToggle.type = 'button';
    descToggle.className = 'deco-desc-toggle';
    descToggle.tabIndex = -1;
    descToggle.setAttribute('aria-label', `Escolher a descrição da linha ${rowIndex + 1}`);
    descToggle.textContent = '⌄';
    descToggle.addEventListener('mousedown', event => event.preventDefault());
    // A seta mostra sempre a lista toda, mesmo com a célula já preenchida.
    descToggle.addEventListener('click', () => {
      if (fecharMenu) { fecharMenuDescricoes(); return; }
      selectRowOnly(rowIndex);
      descInput.focus({ preventScroll: true });
      abrirMenuDescricoes(descInput, DESCRICOES, aplicarDescricao);
    });

    descInput.addEventListener('input', () => {
      pos.descricao = descInput.value;
      descInput.title = pos.descricao;
      refreshCroquiLabels();
      scheduleSave();
      const filtradas = filtrarDescricoes(descInput.value);
      // Já escolhida por inteiro: não vale a pena a lista com um item só.
      if (filtradas.length === 1 && filtradas[0] === descInput.value.trim()) {
        fecharMenuDescricoes();
      } else {
        abrirMenuDescricoes(descInput, filtradas, aplicarDescricao);
      }
    });
    descInput.addEventListener('focus', () => {
      anterior = pos.descricao || '';
      selectRowOnly(rowIndex);
      // Célula vazia: abre logo a lista, que é o que falta preencher.
      if (!descInput.value) abrirMenuDescricoes(descInput, DESCRICOES, aplicarDescricao);
    });
    descInput.addEventListener('mousedown', () => selectRowOnly(rowIndex));

    descEscolha.appendChild(descInput);
    descEscolha.appendChild(descToggle);
    descWrap.appendChild(descEscolha);
    descCell.appendChild(descWrap);
    tr.appendChild(descCell);

    const costuraCell = document.createElement('td');
    costuraCell.className = 'deco-col-num';
    costuraCell.rowSpan = 2;
    costuraCell.appendChild(numeroInput(pos, 'costura', rowIndex, `Valor de costura da linha ${rowIndex + 1}`));
    tr.appendChild(costuraCell);

    const quedaCell = document.createElement('td');
    quedaCell.className = 'deco-col-num';
    quedaCell.rowSpan = 2;
    quedaCell.appendChild(numeroInput(pos, 'queda', rowIndex, `Queda da costura da linha ${rowIndex + 1}`));
    tr.appendChild(quedaCell);

    const mpCell = document.createElement('td');
    mpCell.className = 'deco-col-num deco-col-mp';
    mpCell.rowSpan = 2;
    // A primeira linha é a vertical (%C) e a segunda a horizontal (%L): a
    // marca fica esbatida no canto, como no impresso de origem.
    const marca = rowIndex === 0 ? '%C' : (rowIndex === 1 ? '%L' : '');
    if (marca) {
      const tag = document.createElement('span');
      tag.className = 'deco-mp-tag';
      tag.textContent = marca;
      mpCell.appendChild(tag);
    }
    const mpInput = numeroInput(pos, 'mp', rowIndex, `Ficha MP da linha ${rowIndex + 1} (percentagem)`);
    mpInput.placeholder = '%';
    mpInput.addEventListener('blur', () => {
      const valor = num(mpInput.value);
      if (valor === null) return;
      const limitado = Math.min(100, Math.max(0, valor));
      pos.mp = String(limitado).replace('.', ',');
      mpInput.value = pos.mp;
      atualizarCalculadas(rowIndex);
      scheduleSave();
    });
    mpCell.appendChild(mpInput);
    tr.appendChild(mpCell);

    rangesFor(pos, count).forEach(range => {
      const cell = document.createElement('td');
      cell.className = 'deco-col-tamanho';
      cell.dataset.row = String(rowIndex);
      cell.dataset.col = String(range.start);
      cell.dataset.span = String(range.span);
      if (range.span > 1) {
        cell.colSpan = range.span;
        cell.classList.add('is-merged');
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = pos.valores[range.start] || '';
      input.dataset.row = String(rowIndex);
      input.dataset.col = String(range.start);
      input.setAttribute('aria-label', `${pos.letra || 'Linha ' + (rowIndex + 1)} — ${ficha.tamanhos[range.start] || ''}`);
      const cellEnd = range.start + range.span - 1;

      input.addEventListener('input', () => {
        for (let i = range.start; i <= cellEnd; i += 1) pos.valores[i] = input.value;
        atualizarCalculadas(rowIndex);
        scheduleSave();
      });

      // O evento de focus corria SEMPRE a seguir ao mousedown e repunha a
      // seleccao numa celula so - era esse o motivo de o Shift+clique nao
      // funcionar. Agora a ancora e explicita e o focus sabe quando se calar.
      input.addEventListener('focus', () => {
        if (suppressFocusSelect) return;
        anchor = { row: rowIndex, start: range.start, end: cellEnd };
        setSelection(rowIndex, range.start, cellEnd);
      });

      cell.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        if (event.shiftKey && anchor && anchor.row === rowIndex) {
          event.preventDefault();
          extendSelection(rowIndex, range.start, cellEnd);
          suppressFocusSelect = true;
          input.focus();
          suppressFocusSelect = false;
          return;
        }
        anchor = { row: rowIndex, start: range.start, end: cellEnd };
        setSelection(rowIndex, range.start, cellEnd);
        dragSelecting = true;
      });

      // Arrastar por cima das celulas marca o intervalo, como no Excel.
      cell.addEventListener('mouseenter', () => {
        if (!dragSelecting || !anchor || anchor.row !== rowIndex) return;
        extendSelection(rowIndex, range.start, cellEnd);
        const textSelection = window.getSelection();
        if (textSelection) textSelection.removeAllRanges();
      });
      input.addEventListener('keydown', event => handleCellKeydown(event, rowIndex, range.start));
      input.addEventListener('paste', event => handleCellPaste(event, pos, range.start));
      cell.appendChild(input);
      tr.appendChild(cell);
    });

    return tr;
  }

  // Segunda linha: só os tamanhos, com o valor calculado. Não é editável —
  // sai de uma fórmula, e deixar mexer nele era convidar a incoerências.
  function renderRowCalculada(pos, rowIndex, count) {
    const tr = document.createElement('tr');
    tr.dataset.row = String(rowIndex);
    tr.className = 'deco-pos-row deco-pos-row--calc';

    rangesFor(pos, count).forEach(range => {
      const cell = document.createElement('td');
      cell.className = 'deco-col-tamanho deco-calc-cell';
      cell.dataset.calcRow = String(rowIndex);
      cell.dataset.calcCol = String(range.start);
      if (range.span > 1) cell.colSpan = range.span;
      cell.textContent = formatar(calcular(pos, range.start));
      cell.title = 'Valor calculado: (medida + costura + queda) × (1 + %)';
      tr.appendChild(cell);
    });

    return tr;
  }

  function atualizarCalculadas(rowIndex) {
    const pos = ficha.posicoes[rowIndex];
    if (!pos) return;
    table.querySelectorAll(`td[data-calc-row="${rowIndex}"]`).forEach(cell => {
      cell.textContent = formatar(calcular(pos, Number(cell.dataset.calcCol)));
    });
  }

  function handleCellKeydown(event, rowIndex, colIndex) {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const target = rowIndex + (event.key === 'ArrowUp' ? -1 : 1);
      const cell = table.querySelector(`input[data-row="${target}"][data-col="${colIndex}"]`)
        || table.querySelector(`input[data-row="${target}"]`);
      if (cell) {
        event.preventDefault();
        cell.focus();
      }
    }
  }

  function handleCellPaste(event, pos, startCol) {
    const text = (event.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\t\n]/.test(text)) return;
    event.preventDefault();
    const values = text.split('\n')[0].split('\t');
    values.forEach((value, offset) => {
      const col = startCol + offset;
      if (col < pos.valores.length) pos.valores[col] = value.trim();
    });
    renderTable();
    scheduleSave();
  }

  // ---------------------------------------------------------------------
  // Croqui
  // ---------------------------------------------------------------------
  // Frase completa (prefixo da linha + escolha), que e o que vai para a folha
  // impressa e para as etiquetas do croqui.
  function descricaoCompleta(pos, index) {
    return [prefixoDaLinha(index), pos.descricao || ''].filter(Boolean).join(' ');
  }

  function positionsForLabels() {
    // O indice conta-se antes do filtro: e o lugar na ficha que diz se a linha
    // e a vertical ou a horizontal.
    return ficha.posicoes
      .map((pos, index) => ({
        id: pos.id,
        letra: pos.letra,
        descricao: descricaoCompleta(pos, index)
      }))
      .filter(item => (item.letra || '').trim());
  }

  function refreshCroquiLabels() {
    if (croquiArte) croquiArte.refreshLabels();
    if (croquiTecnico) croquiTecnico.refreshLabels();
  }

  async function handleOrphanLabels() {
    const panels = [croquiArte, croquiTecnico].filter(Boolean);
    const total = panels.reduce((sum, panel) => sum + panel.orphanLabelIds().length, 0);
    if (!total) return;
    const confirmado = await DecoDialog.confirmar({
      titulo: 'Etiquetas sem posição',
      mensagem: total === 1
        ? 'Ficou 1 etiqueta no croqui sem posição correspondente na tabela.'
        : `Ficaram ${total} etiquetas no croqui sem posição correspondente na tabela.`,
      confirmar: total === 1 ? 'Remover a etiqueta' : 'Remover as etiquetas',
      cancelar: 'Deixar ficar',
      perigo: true
    });
    if (confirmado) panels.forEach(panel => panel.removeOrphanLabels());
  }

  function ensureCroqui() {
    if (!ficha.croqui.arte || typeof ficha.croqui.arte !== 'object') ficha.croqui.arte = { imagem: null, anotacoes: [] };
    if (!ficha.croqui.desenho_tecnico || typeof ficha.croqui.desenho_tecnico !== 'object') {
      ficha.croqui.desenho_tecnico = { imagem: null, anotacoes: [] };
    }

    const panels = document.querySelectorAll('#decoEditorScreen .croqui-panel');
    if (!croquiArte) {
      croquiArte = CroquiEditor.create(panels[0], {
        initialData: ficha.croqui.arte,
        fichaId: () => ficha.id,
        panelKey: 'arte',
        getPosicoes: positionsForLabels,
        onChange: data => {
          ficha.croqui.arte = data;
          scheduleSave();
        }
      });
    } else {
      croquiArte.setData(ficha.croqui.arte);
      ficha.croqui.arte = croquiArte.getData();
    }

    if (!croquiTecnico) {
      croquiTecnico = CroquiEditor.create(panels[1], {
        initialData: ficha.croqui.desenho_tecnico,
        fichaId: () => ficha.id,
        panelKey: 'desenho-tecnico',
        getPosicoes: positionsForLabels,
        onChange: data => {
          ficha.croqui.desenho_tecnico = data;
          scheduleSave();
        }
      });
    } else {
      croquiTecnico.setData(ficha.croqui.desenho_tecnico);
      ficha.croqui.desenho_tecnico = croquiTecnico.getData();
    }
  }

  // ---------------------------------------------------------------------
  // Colocação
  // ---------------------------------------------------------------------
  function renderColocacao() {
    colocacaoFrente.classList.toggle('active', ficha.colocacao_tipo === 'Frente');
    colocacaoVerso.classList.toggle('active', ficha.colocacao_tipo === 'Verso');
  }

  function setColocacao(tipo) {
    ficha.colocacao_tipo = ficha.colocacao_tipo === tipo ? null : tipo;
    renderColocacao();
    scheduleSave();
  }

  // ---------------------------------------------------------------------
  // Comentários (negrito / realce a vermelho)
  // ---------------------------------------------------------------------
  const ALLOWED_TAGS = ['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'FONT', 'UL', 'OL', 'LI'];
  // Estes não se "desembrulham" (o conteúdo é código, não texto) — apagam-se.
  const DROP_TAGS = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'];

  function sanitizeHtml(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html || '';
    holder.querySelectorAll('*').forEach(node => {
      if (!holder.contains(node)) return;
      if (DROP_TAGS.includes(node.tagName)) {
        node.remove();
        return;
      }
      if (!ALLOWED_TAGS.includes(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      [...node.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const keep = (name === 'style' && !/expression|url\s*\(|javascript:/i.test(attr.value))
          || (name === 'color' && node.tagName === 'FONT');
        if (!keep) node.removeAttribute(attr.name);
      });
    });
    return holder.innerHTML;
  }

  function exec(command, value) {
    comentariosEl.focus();
    // Sem styleWithCSS o browser gera <b> e <font color>, que e o que o
    // sanitizador deixa passar e o que a folha impressa sabe desenhar.
    try { document.execCommand('styleWithCSS', false, false); } catch (err) { /* ignorado */ }
    document.execCommand(command, false, value);
    scheduleSave();
  }

  // Carregar num botao da barra tirava o foco ao editor: o blur reescrevia o
  // conteudo e a seleccao desaparecia antes de o comando correr — era por
  // isso que Negrito/Realcar nao faziam nada. Travar o mousedown mantem o
  // foco e a seleccao onde estao.
  function semPerderSelecao(button, handler) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', handler);
  }

  // ---------------------------------------------------------------------
  async function openPrint() {
    const saved = await doSave();
    DecoPrint.imprimir([saved || payload()]);
  }

  function bindEvents() {
    [refNosso, refCliente, ofsInput, fornecedorInput, colocacaoTexto, colocacaoPartes].forEach(input => {
      input.addEventListener('input', scheduleSave);
    });
    [estampadoInput, bordadoInput].forEach(input => input.addEventListener('change', scheduleSave));
    colocacaoPartes.addEventListener('input', atualizarBotaoParte);
    partesAddButton.addEventListener('click', acrescentarParte);

    document.addEventListener('mouseup', () => { dragSelecting = false; });
    addTamanhoButton.addEventListener('click', addTamanho);
    addPosicaoButton.addEventListener('click', addPosicao);
    removePosicaoButton.addEventListener('click', () => removePosicao(selection ? selection.row : null));
    mergeButton.addEventListener('click', mergeSelection);
    unmergeButton.addEventListener('click', unmergeSelection);
    fillRowButton.addEventListener('click', fillRowFromSelection);
    tamanhosPreset.addEventListener('change', () => {
      if (tamanhosPreset.value) applyPreset(tamanhosPreset.value);
      tamanhosPreset.value = '';
    });

    finalizarButton.addEventListener('click', toggleFinalizar);
    colocacaoFrente.addEventListener('click', () => setColocacao('Frente'));
    colocacaoVerso.addEventListener('click', () => setColocacao('Verso'));

    comentariosEl.addEventListener('input', scheduleSave);
    comentariosEl.addEventListener('blur', () => {
      // So se reescreve se a limpeza tiver mesmo mudado alguma coisa: trocar
      // o innerHTML sem necessidade destroi a posicao do cursor.
      const limpo = sanitizeHtml(comentariosEl.innerHTML);
      if (limpo !== comentariosEl.innerHTML) comentariosEl.innerHTML = limpo;
    });
    semPerderSelecao(comentariosBold, () => exec('bold'));
    semPerderSelecao(comentariosRed, () => {
      exec('foreColor', '#FF0000');
      exec('bold');
    });
    semPerderSelecao(comentariosClear, () => exec('removeFormat'));

    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      await doSave();
      saveButton.disabled = false;
    });
    printButton.addEventListener('click', openPrint);
    copyButton.addEventListener('click', () => {
      DecoCopy.open(ficha, async () => {
        // Recarregar o editor com a ficha já enriquecida — tudo o que foi
        // copiado fica imediatamente editável, como o resto.
        load(ficha);
        await doSave();
      });
    });
  }

  return {
    load, doSave, blankEntry, blankPosicao, defaultPosicoes,
    prefixoDaLinha, descricaoCompleta,
    DEFAULT_TAMANHOS, FASES, rangesFor, normalizeFicha, sanitizeHtml,
    calcular, formatar, extrairConteudo, aplicarConteudo
  };
})();
