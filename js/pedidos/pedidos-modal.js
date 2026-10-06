// Os modais dos Pedidos de Preço: criar/editar um pedido e escolher o motivo
// de um "Não converteu". O detalhe de um cartão não é um modal: é a gaveta
// (pedidos-drawer.js), que deixa o quadro à vista.
//
// Reaproveitam a moldura de diálogo que já existe na secção das decorações
// (.deco-copy-overlay / .deco-copy-dialog), para não haver duas famílias de
// janelas na mesma aplicação.
const PedidosModal = (() => {
  const U = PedidosUtil;
  const el = U.el;
  let aberto = null;

  // aoFechar corre sempre que a janela se fecha, seja por que via for (Esc,
  // clique fora, botão, ou outra janela a abrir por cima): é como as
  // promessas dos diálogos se resolvem com "cancelado".
  function moldura(titulo, subtitulo, opcoes) {
    const config = opcoes || {};
    if (aberto) aberto();

    const overlay = el('div', 'deco-copy-overlay');
    const dialog = el('div', 'deco-copy-dialog ' + (config.largo ? 'pp-dialog-largo' : 'pp-dialog'));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', titulo);
    overlay.appendChild(dialog);
    dialog.appendChild(el('h2', null, titulo));
    if (subtitulo) dialog.appendChild(el('p', 'deco-help', subtitulo));

    let terminado = false;
    const onKey = event => { if (event.key === 'Escape') fechar(); };
    function fechar() {
      if (terminado) return;
      terminado = true;
      aberto = null;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (config.aoFechar) config.aoFechar();
    }
    aberto = fechar;

    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) fechar();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    return { dialog, fechar };
  }

  function campo(etiqueta, controlo, paraId) {
    const bloco = el('div', 'pp-campo');
    const rotulo = el('label', 'pp-campo__rotulo', etiqueta);
    if (paraId) rotulo.setAttribute('for', paraId);
    bloco.appendChild(rotulo);
    bloco.appendChild(controlo);
    return bloco;
  }

  function mostrarErro(dialog, mensagem) {
    let aviso = dialog.querySelector('.pp-erro');
    if (!aviso) {
      aviso = el('p', 'pp-erro');
      aviso.setAttribute('role', 'alert');
      dialog.insertBefore(aviso, dialog.querySelector('.pp-acoes-form'));
    }
    aviso.textContent = mensagem;
  }

  function limparErro(dialog) {
    const aviso = dialog.querySelector('.pp-erro');
    if (aviso) aviso.remove();
  }

  // -------------------------------------------------------------------
  // Lista de escolha com "criar novo" (usada para o cliente)
  //
  // A seta está sempre à vista: uma lista escondida numa caixa de texto não
  // se descobre. Ao escrever, a lista filtra. Se o que se escreveu não
  // existe, a última linha diz-o com todas as letras ("+ Criar cliente"),
  // e se existir um nome parecido (Cavvalure / Cavalure) avisa-se, porque
  // um erro de digitação que criasse um cliente novo em silêncio estragava
  // todos os números por cliente.
  // -------------------------------------------------------------------
  const MENU_MAX = 232;   // ~7 linhas: a lista não pode tapar o formulário todo

  function criarCombo(config) {
    const nomes = config.opcoes.slice().sort((a, b) => a.localeCompare(b, 'pt'));
    const raiz = el('div', 'pp-combo');

    const entrada = document.createElement('input');
    entrada.type = 'text';
    entrada.id = config.id;
    entrada.className = 'pp-combo__input';
    entrada.autocomplete = 'off';
    entrada.placeholder = config.placeholder || '';
    entrada.value = config.valor || '';
    entrada.setAttribute('role', 'combobox');
    entrada.setAttribute('aria-expanded', 'false');
    entrada.setAttribute('aria-autocomplete', 'list');

    const seta = el('button', 'pp-combo__seta', '⌄');
    seta.type = 'button';
    seta.tabIndex = -1;
    seta.setAttribute('aria-label', 'Mostrar a lista de clientes');

    const estado = el('div', 'pp-combo__estado');
    raiz.appendChild(entrada);
    raiz.appendChild(seta);
    raiz.appendChild(estado);

    let menu = null;
    let linhas = [];
    let ativo = -1;

    const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const existente = texto => nomes.find(n => igual(n, texto)) || null;

    function parecidos(texto) {
      const alvo = U.normalizar(texto);
      if (alvo.length < 3) return [];
      const limite = alvo.length <= 5 ? 1 : 2;
      return nomes.filter(n => !igual(n, texto) && U.distancia(alvo, U.normalizar(n)) <= limite);
    }

    function calcularLinhas(texto) {
      const alvo = U.normalizar(texto);
      const filtradas = nomes.filter(n => !alvo || U.normalizar(n).includes(alvo));
      const semelhantes = parecidos(texto).filter(n => !filtradas.includes(n));
      const out = [];
      semelhantes.forEach(n => out.push({ tipo: 'parecido', valor: n }));
      filtradas.forEach(n => out.push({ tipo: 'cliente', valor: n }));
      if (texto.trim() && !existente(texto)) out.push({ tipo: 'criar', valor: texto.trim() });
      return out;
    }

    function atualizarEstado() {
      estado.innerHTML = '';
      estado.className = 'pp-combo__estado';
      const texto = entrada.value;
      if (!texto.trim()) return;
      if (existente(texto)) {
        estado.classList.add('is-ok');
        estado.textContent = '✓ Cliente existente';
        return;
      }
      estado.classList.add('is-novo');
      estado.appendChild(document.createTextNode('+ Cliente novo: será criado com este nome. '));
      const perto = parecidos(texto)[0];
      if (perto) {
        const usar = el('button', 'pp-combo__usar', 'Usar «' + perto + '»');
        usar.type = 'button';
        usar.addEventListener('click', () => {
          entrada.value = perto;
          atualizarEstado();
          entrada.focus();
        });
        estado.appendChild(usar);
      }
    }

    function fecharMenu() {
      if (!menu) return;
      menu.remove();
      menu = null;
      linhas = [];
      ativo = -1;
      entrada.setAttribute('aria-expanded', 'false');
      window.removeEventListener('scroll', reposicionar, true);
      window.removeEventListener('resize', fecharMenu);
    }

    function reposicionar() {
      if (!menu) return;
      const r = entrada.getBoundingClientRect();
      const abaixo = window.innerHeight - r.bottom;
      menu.style.width = r.width + 'px';
      menu.style.left = r.left + 'px';
      if (abaixo < 200 && r.top > abaixo) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - r.top + 2) + 'px';
        menu.style.maxHeight = Math.min(MENU_MAX, Math.max(120, r.top - 12)) + 'px';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 2) + 'px';
        menu.style.maxHeight = Math.min(MENU_MAX, Math.max(120, abaixo - 12)) + 'px';
      }
    }

    function marcar(indice) {
      const itens = menu ? menu.querySelectorAll('.pp-combo__item') : [];
      if (itens[ativo]) itens[ativo].classList.remove('is-ativo');
      ativo = indice;
      if (itens[ativo]) {
        itens[ativo].classList.add('is-ativo');
        itens[ativo].scrollIntoView({ block: 'nearest' });
      }
    }

    // Definir o valor é sempre o mesmo gesto, venha de uma linha da lista ou
    // de um dos botões dos clientes recentes.
    function definir(valor) {
      entrada.value = valor;
      fecharMenu();
      atualizarEstado();
      if (config.aoMudar) config.aoMudar();
      if (config.aoEscolher) config.aoEscolher();
    }

    function escolher(linha) {
      definir(linha.valor);
    }

    function abrirMenu() {
      const novas = calcularLinhas(entrada.value);
      fecharMenu();
      if (!novas.length) return;
      linhas = novas;

      menu = el('div', 'pp-combo__menu');
      menu.setAttribute('role', 'listbox');
      linhas.forEach(linha => {
        const item = el('button', 'pp-combo__item is-' + linha.tipo);
        item.type = 'button';
        item.setAttribute('role', 'option');
        if (linha.tipo === 'criar') {
          item.appendChild(el('b', null, '+ Criar cliente «' + linha.valor + '»'));
        } else {
          item.appendChild(document.createTextNode(linha.valor));
          if (linha.tipo === 'parecido') item.appendChild(el('span', 'pp-combo__tag', 'Parecido'));
        }
        // Sem isto o mousedown tira o foco da caixa antes de o clique chegar.
        item.addEventListener('mousedown', event => event.preventDefault());
        item.addEventListener('click', () => escolher(linha));
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      entrada.setAttribute('aria-expanded', 'true');
      reposicionar();
      window.addEventListener('scroll', reposicionar, true);
      window.addEventListener('resize', fecharMenu);
    }

    // A lista NÃO abre quando o campo recebe o foco (o formulário abre com o
    // foco aqui): aberta logo à entrada tapava a referência e os botões, e
    // quem clicava na referência escolhia um cliente sem querer. Abre quando a
    // pessoa mostra que a quer: um clique no campo, na seta, ou a escrever.
    entrada.addEventListener('click', () => { if (!menu) abrirMenu(); });
    entrada.addEventListener('blur', fecharMenu);
    entrada.addEventListener('input', () => {
      abrirMenu();
      atualizarEstado();
      if (config.aoMudar) config.aoMudar();
    });
    entrada.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!menu) abrirMenu();
        marcar(ativo + 1 >= linhas.length ? 0 : ativo + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!menu) abrirMenu();
        marcar(ativo - 1 < 0 ? linhas.length - 1 : ativo - 1);
      } else if (event.key === 'Enter' && menu && ativo >= 0) {
        // Enter escolhe a linha marcada, não submete o formulário.
        event.preventDefault();
        event.stopPropagation();
        escolher(linhas[ativo]);
      } else if (event.key === 'Escape' && menu) {
        // Esc fecha só a lista, não a janela por baixo dela.
        event.stopPropagation();
        fecharMenu();
      } else if (event.key === 'Tab') {
        fecharMenu();
      }
    });
    seta.addEventListener('mousedown', event => event.preventDefault());
    seta.addEventListener('click', () => {
      if (menu) { fecharMenu(); return; }
      entrada.focus();
      abrirMenu();
    });

    atualizarEstado();
    return { raiz, entrada, existente, definir, fechar: fecharMenu };
  }

  // Botões lado a lado onde só um está ligado (GP, "precisa de malhas").
  function criarSegmentos(rotulo, opcoes, valorInicial, aoMudar) {
    const grupo = el('div', 'pp-segmentos');
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', rotulo);
    let valor = valorInicial;
    const botoes = [];
    opcoes.forEach(opcao => {
      const b = el('button', 'pp-segmento');
      b.type = 'button';
      if (opcao.avatar) b.appendChild(opcao.avatar);
      b.appendChild(document.createTextNode(opcao.texto));
      b.addEventListener('click', () => {
        valor = opcao.valor;
        pintar();
        if (aoMudar) aoMudar(valor);
      });
      botoes.push([b, opcao]);
      grupo.appendChild(b);
    });
    function pintar() {
      botoes.forEach(([b, opcao]) => {
        const ligado = opcao.valor === valor;
        b.classList.toggle('is-ativo', ligado);
        b.setAttribute('aria-pressed', String(ligado));
      });
    }
    pintar();
    return { raiz: grupo, valor: () => valor };
  }

  // -------------------------------------------------------------------
  // Criar ou editar um pedido — o mesmo formulário
  // -------------------------------------------------------------------
  function formulario(opcoes) {
    const editar = opcoes.modo === 'editar';
    const cartao = opcoes.cartao;
    const ativos = opcoes.clientes.filter(c => c.ativo);
    const gps = opcoes.utilizadores.filter(u => u.papel === 'gp' && u.ativo && u.email);
    const eu = String((window.Auth && window.Auth.email) || '').toLowerCase();
    const hoje = U.paraInput(new Date()).slice(0, 10);

    const { dialog, fechar } = moldura(
      editar ? 'Editar pedido' : 'Novo pedido de preço',
      editar
        ? 'Corrige o cliente, a referência ou a GP. O histórico e as datas não mudam.'
        : 'Um pedido é um cliente mais uma referência. Se o cliente ainda não existir, escreve o nome e ele é criado.');

    const combo = criarCombo({
      id: 'ppCliente',
      opcoes: ativos.map(c => c.nome),
      valor: editar ? cartao.cliente_nome : '',
      placeholder: 'Escreve ou escolhe da lista',
      aoMudar: () => limparErro(dialog),
      // Escolhido o cliente, o passo seguinte é a referência: o foco vai lá.
      aoEscolher: () => { ref.focus(); }
    });
    const blocoCliente = campo('Cliente', combo.raiz, 'ppCliente');
    dialog.appendChild(blocoCliente);

    // Os clientes com pedidos mais recentes, à mão: no caso normal (uma GP
    // que trabalha sempre com os mesmos) escolher o cliente é um só clique,
    // sem abrir lista nenhuma.
    const nomesAtivos = new Set(ativos.map(c => c.nome));
    const recentes = (opcoes.recentes || []).filter(n => nomesAtivos.has(n)).slice(0, 5);
    if (!editar && recentes.length) {
      const linhaRecentes = el('div', 'pp-recentes');
      linhaRecentes.appendChild(el('span', 'pp-recentes__rotulo', 'Recentes'));
      recentes.forEach(nome => {
        const b = el('button', 'pp-recente', nome);
        b.type = 'button';
        b.addEventListener('click', () => combo.definir(nome));
        linhaRecentes.appendChild(b);
      });
      blocoCliente.appendChild(linhaRecentes);
    }

    const ref = document.createElement('input');
    ref.type = 'text';
    ref.id = 'ppRef';
    ref.autocomplete = 'off';
    ref.placeholder = 'Ex.: REF-2026-014';
    ref.value = editar ? cartao.ref_cliente : '';
    ref.addEventListener('input', () => limparErro(dialog));
    dialog.appendChild(campo('Ref. cliente', ref, 'ppRef'));

    // Uma GP só cria pedidos em seu nome.
    const gpsPermitidos = U.papel() === 'gp'
      ? gps.filter(u => u.email.toLowerCase() === U.emailAtual)
      : gps;
    const opcoesGp = gpsPermitidos.map(u => ({ valor: u.email, texto: u.nome, avatar: U.avatar(u.email, u.nome) }));
    if (editar && cartao.gp_email && !gps.some(u => u.email.toLowerCase() === cartao.gp_email.toLowerCase())) {
      opcoesGp.push({
        valor: cartao.gp_email,
        texto: cartao.gp_nome || cartao.gp_email,
        avatar: U.avatar(cartao.gp_email, cartao.gp_nome)
      });
    }
    const gpInicial = editar
      ? cartao.gp_email
      : ((gps.find(u => u.email.toLowerCase() === eu) || gps[0] || {}).email || '');
    const segmentosGp = criarSegmentos('GP responsável', opcoesGp, gpInicial, () => limparErro(dialog));
    dialog.appendChild(campo('GP responsável', segmentosGp.raiz));

    let data = null;
    let malhas = null;
    if (!editar) {
      data = document.createElement('input');
      data.type = 'date';
      data.id = 'ppData';
      data.value = hoje;
      data.max = hoje;

      malhas = criarSegmentos('Precisa de consulta de malhas?',
        [{ valor: true, texto: 'Sim' }, { valor: false, texto: 'Não' }], true);

      // Lado a lado: poupa uma linha inteira ao formulário mais usado da app.
      const duas = el('div', 'pp-duas-colunas');
      duas.appendChild(campo('Data de receção', data, 'ppData'));
      duas.appendChild(campo('Precisa de consulta de malhas?', malhas.raiz));
      dialog.appendChild(duas);
    }

    const acoes = el('div', 'pp-acoes-form');
    const esquerda = el('div', 'pp-acoes-form__esq');
    const direita = el('div', 'pp-acoes-form__dir');

    if (editar && opcoes.podeApagar) {
      const apagar = el('button', 'pp-perigo', 'Apagar pedido');
      apagar.type = 'button';
      apagar.addEventListener('click', async () => {
        const confirmado = await DecoDialog.confirmar({
          titulo: 'Apagar este pedido?',
          mensagem: `${cartao.cliente_nome} · ${cartao.ref_cliente}. Só é possível porque o pedido ainda `
            + 'não teve nenhum movimento. Não se pode desfazer.',
          confirmar: 'Apagar pedido',
          perigo: true
        });
        if (!confirmado) return;
        try {
          await PedidosStorage.apagarPedido(cartao.id);
          fechar();
          if (opcoes.aoApagar) await opcoes.aoApagar(cartao);
        } catch (erro) {
          mostrarErro(dialog, erro.message);
        }
      });
      esquerda.appendChild(apagar);
    }

    const cancelar = el('button', 'secondary', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', fechar);
    const guardar = el('button', 'primary', editar ? 'Guardar' : 'Criar pedido');
    guardar.type = 'button';
    direita.appendChild(cancelar);
    direita.appendChild(guardar);
    acoes.appendChild(esquerda);
    acoes.appendChild(direita);
    dialog.appendChild(acoes);

    async function submeter() {
      const nomeCliente = combo.entrada.value.trim();
      if (!nomeCliente) {
        mostrarErro(dialog, 'Escolhe ou escreve o cliente.');
        combo.entrada.focus();
        return;
      }
      if (!ref.value.trim()) {
        mostrarErro(dialog, 'Escreve a referência do cliente.');
        ref.focus();
        return;
      }
      if (!segmentosGp.valor()) {
        mostrarErro(dialog, 'Escolhe a GP responsável.');
        return;
      }

      guardar.disabled = true;
      limparErro(dialog);
      try {
        const existente = ativos.find(c => c.nome.trim().toLowerCase() === nomeCliente.toLowerCase());
        const comum = {
          clienteNome: nomeCliente,
          clienteId: existente ? existente.id : null,
          refCliente: ref.value.trim(),
          gpEmail: segmentosGp.valor()
        };
        if (editar) {
          await PedidosStorage.editarPedido(Object.assign({ pedidoId: cartao.id }, comum));
          fechar();
          if (opcoes.aoConcluir) await opcoes.aoConcluir(cartao.id);
        } else {
          const id = await PedidosStorage.criarPedido(Object.assign({
            dataRececao: data.value || null,
            precisaMalhas: malhas.valor()
          }, comum));
          fechar();
          if (opcoes.aoConcluir) await opcoes.aoConcluir(id, comum);
        }
      } catch (erro) {
        mostrarErro(dialog, erro.message);
        guardar.disabled = false;
      }
    }

    guardar.addEventListener('click', submeter);
    // Enter em qualquer caixa de texto guarda: o pedido faz-se sem largar o teclado.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
      event.preventDefault();
      submeter();
    });

    (editar ? ref : combo.entrada).focus();
  }

  // extras.recentes: nomes dos clientes por ordem de pedido mais recente.
  async function abrirNovo(aoConcluir, extras) {
    const [clientes, utilizadores] = await Promise.all([
      PedidosStorage.clientes(),
      PedidosStorage.utilizadores()
    ]);
    formulario({
      modo: 'novo', clientes, utilizadores, aoConcluir,
      recentes: (extras && extras.recentes) || []
    });
  }

  async function abrirEditar(cartao, opcoes) {
    const [clientes, utilizadores] = await Promise.all([
      PedidosStorage.clientes(),
      PedidosStorage.utilizadores()
    ]);
    formulario(Object.assign({ modo: 'editar', cartao, clientes, utilizadores }, opcoes));
  }

  // -------------------------------------------------------------------
  // "Não converteu" — o motivo, num só ecrã. Escolher um motivo fecha o
  // pedido logo; só o "Outro" abre uma linha para a descrição opcional.
  // Devolve { motivoId, descricao } ou null se se cancelar.
  // -------------------------------------------------------------------
  function escolherMotivo(cartao, motivos) {
    return new Promise(resolve => {
      let resolvido = false;
      const concluir = valor => {
        if (resolvido) return;
        resolvido = true;
        resolve(valor);
      };

      const { dialog, fechar } = moldura(
        'Porque é que não converteu?',
        cartao.cliente_nome + ' · ' + cartao.ref_cliente,
        { aoFechar: () => concluir(null) });

      const grelha = el('div', 'pp-motivos');
      const linhaOutro = el('div', 'pp-motivo-outro hidden');
      const descricao = document.createElement('input');
      descricao.type = 'text';
      descricao.autocomplete = 'off';
      descricao.placeholder = 'Descrição (opcional)';
      const confirmarOutro = el('button', 'primary', 'Fechar pedido');
      confirmarOutro.type = 'button';
      linhaOutro.appendChild(descricao);
      linhaOutro.appendChild(confirmarOutro);

      let outro = null;
      const terminarOutro = () => {
        concluir({ motivoId: outro.id, descricao: descricao.value.trim() || null });
        fechar();
      };
      confirmarOutro.addEventListener('click', terminarOutro);
      descricao.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        terminarOutro();
      });

      const botoes = [];
      motivos.filter(m => m.ativo).forEach(m => {
        const b = el('button', 'pp-motivo', m.nome);
        b.type = 'button';
        b.addEventListener('click', () => {
          if (m.pede_texto) {
            outro = m;
            botoes.forEach(x => x.classList.toggle('is-ativo', x === b));
            linhaOutro.classList.remove('hidden');
            descricao.focus();
            return;
          }
          concluir({ motivoId: m.id, descricao: null });
          fechar();
        });
        botoes.push(b);
        grelha.appendChild(b);
      });
      dialog.appendChild(grelha);
      dialog.appendChild(linhaOutro);

      const acoes = el('div', 'pp-acoes-form');
      const direita = el('div', 'pp-acoes-form__dir');
      const cancelar = el('button', 'secondary', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', fechar);
      direita.appendChild(cancelar);
      acoes.appendChild(el('div', 'pp-acoes-form__esq'));
      acoes.appendChild(direita);
      dialog.appendChild(acoes);

      if (botoes[0]) botoes[0].focus();
    });
  }

  return { abrirNovo, abrirEditar, escolherMotivo, moldura };
})();
