// Secção "Fichas de decoração" — navegação de topo entre as duas secções da
// app, e navegação interna entre a lista e o editor desta secção.
const DecoApp = (() => {
  const DECO_TABLE = 'ficha_tecnica_sourcetextile_deco_fichas';

  const decoListScreen = document.getElementById('decoListScreen');
  const decoEditorScreen = document.getElementById('decoEditorScreen');
  const decoFormTitle = document.getElementById('decoFormTitle');
  const decoBackButton = document.getElementById('decoBackButton');

  const pageTitle = document.getElementById('pageTitle');
  const pageDescription = document.getElementById('pageDescription');

  // O cabeçalho da página acompanha a secção que está aberta — senão a app
  // continuava a dizer "Ficha técnica do produto" dentro das decorações.
  //
  // As secções vivem num registo em vez de estarem escritas à mão nos
  // handlers: qualquer módulo novo (ex.: Pedidos de preço) regista-se em
  // window.AppSecoes e passa a ter separador, sem mexer aqui.
  const SECOES = [
    {
      chave: 'ficha',
      tab: 'tabSectionFicha',
      seccao: 'sectionFicha',
      titulo: 'Ficha técnica do produto',
      descricao: 'Seleciona a peça e preenche apenas os campos relevantes. A aplicação gera descrições standard por zona — Confeção, Embalagem e Corte.'
    },
    {
      chave: 'deco',
      tab: 'tabSectionDeco',
      seccao: 'sectionDeco',
      titulo: 'Fichas de decoração',
      descricao: 'Cada decoração de um modelo — estampado, bordado, tachas, fitas — com as medidas por tamanho, o croqui anotado e a paleta de cores, pronta a enviar ao fornecedor.',
      compacta: true,
      aoAbrir: () => ensureInit()
    }
  ];

  let initialized = false;

  function showSection(which) {
    const atual = SECOES.find(s => s.chave === which) || SECOES[0];
    SECOES.forEach(s => {
      const tab = document.getElementById(s.tab);
      const seccao = document.getElementById(s.seccao);
      const ativa = s === atual;
      if (tab) {
        tab.classList.toggle('active', ativa);
        tab.setAttribute('aria-selected', String(ativa));
      }
      if (seccao) seccao.classList.toggle('hidden', !ativa);
    });
    // Marca o body para o cabeçalho da página seguir a mesma escala mais
    // compacta destas secções, sem mexer na Ficha técnica.
    document.body.classList.toggle('is-deco', !!atual.compacta);
    // Cada secção pode ajustar o cabeçalho da página (ex.: o quadro dos
    // Pedidos de preço precisa de todo o espaço vertical que puder).
    document.body.dataset.secao = atual.chave;
    if (pageTitle) pageTitle.textContent = atual.titulo;
    if (pageDescription) pageDescription.textContent = atual.descricao;
    if (atual.aoAbrir) atual.aoAbrir();
  }

  // Registo aberto às secções novas. Chamado no DOMContentLoaded dos
  // módulos, ou seja antes de bindTabEvents() correr.
  window.AppSecoes = {
    registar(secao) {
      if (SECOES.some(s => s.chave === secao.chave)) return;
      SECOES.push(Object.assign({ compacta: true }, secao));
      const tab = document.getElementById(secao.tab);
      if (tab) tab.addEventListener('click', () => showSection(secao.chave));
    },
    mostrar: showSection
  };

  async function showListScreen() {
    // Sair do editor grava o que ainda estiver pendente no debounce.
    if (!decoEditorScreen.classList.contains('hidden')) await DecoEditor.doSave();
    decoEditorScreen.classList.add('hidden');
    decoListScreen.classList.remove('hidden');
    DecoList.render();
  }

  async function openEditor(id) {
    decoListScreen.classList.add('hidden');
    decoEditorScreen.classList.remove('hidden');
    decoFormTitle.textContent = 'A carregar...';
    const ficha = await DecoStorage.getFicha(id);
    if (!ficha) {
      decoFormTitle.textContent = 'Não foi possível abrir esta ficha.';
      return;
    }
    DecoEditor.load(ficha);
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    DecoStorage.init(window.Auth.client, DECO_TABLE);
    DecoList.bindEvents();
    showListScreen();
  }

  function bindTabEvents() {
    SECOES.forEach(s => {
      const tab = document.getElementById(s.tab);
      if (tab) tab.addEventListener('click', () => showSection(s.chave));
    });
    decoBackButton.addEventListener('click', showListScreen);
  }

  // A barra #appTabs é revelada pelo auth.js (em onSignedIn), que é o único
  // ponto comum aos dois caminhos de entrada: sessão já existente ao abrir, e
  // login interativo por código. Aqui só ligamos os handlers dos separadores.
  window.addEventListener('DOMContentLoaded', () => bindTabEvents());

  return { openEditor };
})();
