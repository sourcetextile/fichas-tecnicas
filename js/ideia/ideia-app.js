// Secção "Ideia de preço": arranque e as duas vistas (Visualização e Edição).
//
// Regista-se em window.AppSecoes, como os Pedidos de preço: tem separador
// próprio sem mexer nas outras secções. Os dados carregam-se uma vez e as
// duas vistas trabalham sobre os mesmos objetos, por isso o que se edita
// aparece logo na visualização.
//
// Na visualização, a barra tem a pesquisa (procura em todas as tabelas) e
// o peso da peça (destaca a coluna certa nas tabelas por peso).
const IdeiaApp = (() => {
  const U = PedidosUtil;
  const el = U.el;

  const vistaVer = document.getElementById('ideiaVistaVer');
  const vistaEditar = document.getElementById('ideiaVistaEditar');
  const raizVer = document.getElementById('ideiaVisualizacao');
  const raizEditar = document.getElementById('ideiaEdicao');
  const estadoEl = document.getElementById('ideiaEstado');
  const consulta = document.getElementById('ideiaConsulta');
  const pesquisaEl = document.getElementById('ideiaPesquisa');
  const pesoEl = document.getElementById('ideiaPeso');

  const dados = { linhas: [], documentos: [] };
  let iniciado = false;
  let podeEditar = false;
  let carregado = false;
  let erro = null;
  let vista = 'ver';

  function estado(texto, tipo) {
    estadoEl.textContent = texto || '';
    estadoEl.className = 'ip-estado' + (tipo ? ' is-' + tipo : '');
  }

  function erroCarga(raiz) {
    raiz.innerHTML = '';
    const b = el('div', 'pp-hero');
    b.appendChild(el('h3', null, 'Não foi possível carregar as tabelas'));
    b.appendChild(el('p', null, erro));
    const t = el('button', 'primary', 'Tentar de novo');
    t.type = 'button';
    t.addEventListener('click', () => carregar().then(() => mostrar(vista)));
    b.appendChild(t);
    raiz.appendChild(b);
  }

  async function carregar() {
    try {
      const [linhas, documentos] = await Promise.all([IdeiaStorage.listar(), IdeiaStorage.listarDocumentos()]);
      dados.linhas = linhas;
      dados.documentos = documentos;
      erro = null;
      carregado = true;
    } catch (e) {
      erro = e.message;
    }
  }

  const peso = () => {
    const n = Number(String(pesoEl.value || '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function desenharVista() {
    IdeiaVista.desenhar(raizVer, dados, {
      podeEditar,
      pesquisa: pesquisaEl.value,
      peso: peso(),
      redesenhar: desenharVista
    });
  }

  function mostrar(qual, foco) {
    vista = qual === 'editar' && podeEditar ? 'editar' : 'ver';
    const editar = vista === 'editar';
    raizVer.classList.toggle('hidden', editar);
    raizEditar.classList.toggle('hidden', !editar);
    consulta.classList.toggle('hidden', editar);
    [[vistaVer, !editar], [vistaEditar, editar]].forEach(([b, ligado]) => {
      b.classList.toggle('is-ativo', ligado);
      b.setAttribute('aria-pressed', String(ligado));
    });
    const raiz = editar ? raizEditar : raizVer;
    if (erro) { erroCarga(raiz); return; }
    if (!carregado) { raiz.innerHTML = ''; raiz.appendChild(el('p', 'pp-dcard__nota', 'A carregar...')); return; }
    if (editar) {
      IdeiaEdicao.desenhar(raizEditar, dados, Object.assign({ aoEstado: estado }, foco || {}));
    } else {
      estado(podeEditar ? '' : 'Só leitura', podeEditar ? null : 'leitura');
      desenharVista();
    }
  }

  // Os avisos (PedidosToast) usam a caixa #pedidosToasts. Se ela estiver dentro
  // da secção dos Pedidos, fica escondida quando esta secção está aberta; tira-se
  // para fora, sem mexer em mais nada (a posição dela é fixa no ecrã).
  function libertarAvisos() {
    const caixa = document.getElementById('pedidosToasts');
    const pedidos = document.getElementById('sectionPedidos');
    if (caixa && pedidos && pedidos.contains(caixa)) pedidos.parentNode.insertBefore(caixa, pedidos.nextSibling);
  }

  async function arrancar() {
    libertarAvisos();
    if (!iniciado) {
      iniciado = true;
      IdeiaStorage.init(window.Auth.client);
      podeEditar = await IdeiaStorage.podeEditar();
      vistaEditar.classList.toggle('hidden', !podeEditar);
    }
    mostrar(vista);
    await carregar();
    mostrar(vista);
  }

  vistaVer.addEventListener('click', () => mostrar('ver'));
  vistaEditar.addEventListener('click', () => mostrar('editar'));

  // Pesquisa e peso redesenham já, a cada tecla.
  let pendente = null;
  const agendar = () => {
    if (pendente) return;
    pendente = requestAnimationFrame(() => { pendente = null; if (vista === 'ver' && carregado) desenharVista(); });
  };
  pesquisaEl.addEventListener('input', agendar);
  pesoEl.addEventListener('input', agendar);
  pesquisaEl.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pesquisaEl.value) { pesquisaEl.value = ''; agendar(); }
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.AppSecoes) return;
    window.AppSecoes.registar({
      chave: 'ideia',
      tab: 'tabSectionIdeia',
      seccao: 'sectionIdeia',
      titulo: 'Ideia de preço',
      descricao: '',
      aoAbrir: arrancar
    });
  });

  return { mostrar };
})();
