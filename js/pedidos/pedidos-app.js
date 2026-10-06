// Secção "Pedidos de preço": arranque, barra de ferramentas e ligação à
// navegação de topo.
//
// A secção regista-se em window.AppSecoes (definido no deco-app.js, que é
// quem trata dos separadores de topo) em vez de mexer nos handlers
// existentes: as outras duas secções continuam a funcionar como antes.
//
// A barra de ferramentas responde a "como está o dia" antes de a pessoa
// olhar para o quadro: quantos pedidos estão abertos, quantos em atraso,
// quantos sem resposta do cliente. Cada número é também um filtro: um
// clique e o quadro mostra só esses.
const PedidosApp = (() => {
  const U = PedidosUtil;
  const el = U.el;

  const quadroWrap = document.getElementById('pedidosQuadroWrap');
  const quadro = document.getElementById('pedidosQuadro');
  const novoBtn = document.getElementById('pedidosNovoButton');
  const desfazerBtn = document.getElementById('pedidosDesfazerButton');
  const resumoEl = document.getElementById('pedidosResumo');
  const gpsEl = document.getElementById('pedidosFiltroGp');
  const fechadosBtn = document.getElementById('pedidosVerFechados');
  const pesquisa = document.getElementById('pedidosPesquisa');
  const controlos = document.getElementById('pedidosControlos');
  const dashEl = document.getElementById('pedidosDashboard');
  const vistaQuadro = document.getElementById('pedidosVistaQuadro');
  const vistaDash = document.getElementById('pedidosVistaDash');
  const vistaConfig = document.getElementById('pedidosVistaConfig');
  const configEl = document.getElementById('pedidosConfig');

  const CHAVE = 'pp-ui';
  let iniciado = false;

  // Lembrar a GP e os fechados é uma comodidade de quem usa o quadro todos
  // os dias: sem isto, era um clique por manhã só para voltar ao mesmo sítio.
  function lerPreferencias() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (erro) { return {}; }
  }
  function gravarPreferencias(parcial) {
    try { localStorage.setItem(CHAVE, JSON.stringify(Object.assign(lerPreferencias(), parcial))); }
    catch (erro) { /* sem armazenamento: o quadro funciona na mesma */ }
  }

  function novo() {
    PedidosModal.abrirNovo(
      (id, dados) => PedidosKanban.aposCriar(id, dados),
      { recentes: PedidosKanban.clientesRecentes(5) });
  }

  // O quadro ocupa o que resta do ecrã, para todas as colunas se verem de
  // uma vez e cada uma ter o seu scroll.
  function medir() {
    if (!quadroWrap || quadroWrap.offsetParent === null) return;
    const topoAbsoluto = quadroWrap.getBoundingClientRect().top + window.scrollY;
    const altura = Math.max(380, window.innerHeight - topoAbsoluto - 16);
    quadroWrap.style.setProperty('--pp-altura', altura + 'px');
  }

  // -------------------------------------------------------------------
  // Filtro por GP: um botão por pessoa, com a cor do avatar do cartão
  // -------------------------------------------------------------------
  function construirFiltroGp(utilizadores) {
    gpsEl.innerHTML = '';
    const gps = utilizadores.filter(u => u.papel === 'gp' && u.ativo && u.email);
    gpsEl.classList.toggle('hidden', gps.length < 2);

    const opcoes = [{ valor: '', texto: 'Todas', avatar: null }].concat(gps.map(u => ({
      valor: String(u.email).toLowerCase(),
      texto: U.primeiroNome(u.nome),
      completo: u.nome,
      avatar: U.avatar(u.email, u.nome)
    })));

    const botoes = opcoes.map(opcao => {
      const b = el('button', 'pp-gp');
      b.type = 'button';
      if (opcao.avatar) b.appendChild(opcao.avatar);
      b.appendChild(document.createTextNode(opcao.texto));
      if (opcao.completo) b.title = opcao.completo;
      b.addEventListener('click', () => {
        PedidosKanban.definir('gp', opcao.valor);
        gravarPreferencias({ gp: opcao.valor });
        pintarGp(botoes, opcoes);
      });
      gpsEl.appendChild(b);
      return b;
    });
    pintarGp(botoes, opcoes);
  }

  function pintarGp(botoes, opcoes) {
    const atual = PedidosKanban.estado.gp;
    botoes.forEach((b, i) => {
      const ligado = opcoes[i].valor === atual;
      b.classList.toggle('is-ativo', ligado);
      b.setAttribute('aria-pressed', String(ligado));
    });
  }

  // -------------------------------------------------------------------
  // Barra: resumo clicável, fechados, desfazer
  // -------------------------------------------------------------------
  function atualizarBarra(r) {
    const estado = PedidosKanban.estado;
    resumoEl.innerHTML = '';

    const chip = (filtro, numero, texto, alerta) => {
      const ligado = estado.filtro === filtro;
      const b = el('button', 'pp-kpi' + (ligado ? ' is-ativo' : '') + (alerta && numero > 0 ? ' is-alerta' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(ligado));
      b.appendChild(el('b', null, String(numero)));
      b.appendChild(document.createTextNode(' ' + texto));
      b.addEventListener('click', () =>
        PedidosKanban.definir('filtro', ligado && filtro !== '' ? '' : filtro));
      return b;
    };
    resumoEl.appendChild(chip('', r.abertos, 'em aberto', false));
    resumoEl.appendChild(chip('atraso', r.atraso, 'em atraso', true));
    resumoEl.appendChild(chip('sem_resposta', r.semResposta, 'sem resposta', true));

    const verFechados = estado.fechados;
    fechadosBtn.classList.toggle('is-ativo', verFechados);
    fechadosBtn.setAttribute('aria-pressed', String(verFechados));
    fechadosBtn.textContent = 'Fechados' + (r.fechados ? ' (' + r.fechados + ')' : '');

    desfazerBtn.disabled = !r.podeDesfazer;
    desfazerBtn.title = r.podeDesfazer
      ? 'Desfazer o último movimento (' + r.ultimo + ')'
      : 'Ainda não há nada para desfazer';

    medir();
  }

  // -------------------------------------------------------------------
  // Quadro ou dashboard
  // -------------------------------------------------------------------
  function mostrarVista(vista) {
    const dash = vista === 'dash';
    const cfg = vista === 'config';
    const quadroVisivel = !dash && !cfg;
    quadroWrap.classList.toggle('hidden', !quadroVisivel);
    dashEl.classList.toggle('hidden', !dash);
    configEl.classList.toggle('hidden', !cfg);
    controlos.classList.toggle('hidden', !quadroVisivel);
    [[vistaQuadro, quadroVisivel], [vistaDash, dash], [vistaConfig, cfg]].forEach(([b, ligado]) => {
      b.classList.toggle('is-ativo', ligado);
      b.setAttribute('aria-pressed', String(ligado));
    });
    if (dash) {
      PedidosDashboard.abrir();
    } else if (cfg) {
      PedidosConfig.abrir();
    } else {
      medir();
      PedidosKanban.recarregar().catch(() => {});
    }
  }

  // -------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------
  // O que cada perfil vê na barra. A base de dados recusa o resto na mesma.
  function aplicarPerfil() {
    novoBtn.classList.toggle('hidden', !U.podeCriar());
    desfazerBtn.classList.toggle('hidden', !U.podeCriar());
    vistaConfig.classList.toggle('hidden', !U.podeConfigurar());
    document.body.dataset.papel = U.papel();
  }

  async function arrancar() {
    medir();
    if (iniciado) {
      // Voltar ao separador mostra sempre o estado atual.
      if (!dashEl.classList.contains('hidden')) PedidosDashboard.abrir();
      else if (configEl.classList.contains('hidden')) PedidosKanban.recarregar().catch(() => {});
      return;
    }
    iniciado = true;

    PedidosStorage.init(window.Auth.client);
    let papel = 'leitura';
    try { papel = await PedidosStorage.meuPapel(); } catch (erro) { /* sem perfil: só leitura */ }
    U.definirPerfil(papel, window.Auth && window.Auth.email);
    aplicarPerfil();
    PedidosDrawer.iniciar();
    PedidosAlertas.iniciar();

    const utilizadores = await PedidosStorage.utilizadores();
    U.definirUtilizadores(utilizadores);

    const guardado = lerPreferencias();
    const gpValida = utilizadores.some(u =>
      String(u.email || '').toLowerCase() === guardado.gp && u.papel === 'gp');
    PedidosKanban.definirInicial({
      gp: gpValida ? guardado.gp : '',
      fechados: !!guardado.fechados
    });
    construirFiltroGp(utilizadores);

    await PedidosKanban.iniciar(quadro, { aoNovo: novo });
    medir();
  }

  novoBtn.addEventListener('click', novo);
  vistaQuadro.addEventListener('click', () => mostrarVista('quadro'));
  vistaDash.addEventListener('click', () => mostrarVista('dash'));
  vistaConfig.addEventListener('click', () => mostrarVista('config'));
  pesquisa.addEventListener('input', () => PedidosKanban.definir('pesquisa', pesquisa.value));
  desfazerBtn.addEventListener('click', () => PedidosKanban.desfazerUltimo());
  fechadosBtn.addEventListener('click', () => {
    const ligar = !PedidosKanban.estado.fechados;
    PedidosKanban.definir('fechados', ligar);
    gravarPreferencias({ fechados: ligar });
  });

  let medirPendente = false;
  window.addEventListener('resize', () => {
    if (medirPendente) return;
    medirPendente = true;
    requestAnimationFrame(() => { medirPendente = false; medir(); });
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.AppSecoes) return;
    window.AppSecoes.registar({
      chave: 'pedidos',
      tab: 'tabSectionPedidos',
      seccao: 'sectionPedidos',
      titulo: 'Pedidos de preço',
      descricao: '',
      aoAbrir: arrancar
    });
  });

  return { atualizarBarra, arrancar, medir };
})();
