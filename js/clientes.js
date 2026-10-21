// Lista de clientes partilhada pelos campos "Cliente" da Ficha técnica e das
// Fichas de decoração. Não há uma tabela de clientes: a lista sai dos clientes
// já escritos nas fichas guardadas das duas secções. Cada campo ganha um menu
// com esses clientes (a abrir ao clicar e a filtrar ao escrever) e a opção
// "Adicionar novo cliente".
//
// "Zara", "zara" e "ZARA " são o mesmo cliente: na lista aparece a grafia mais
// usada, e quem escrever outra grafia de um cliente que já existe fica com a
// grafia da lista (assim a lista não enche de duplicados).
//
// Só existe no build hospedado (precisa de window.Auth.client).
window.Clientes = (() => {
  const TTL_MS = 60 * 1000;

  // chave (sem acentos nem maiúsculas) -> { nome, grafias: Map(grafia -> vezes) }
  const porChave = new Map();
  let lista = [];
  let carregadoEm = 0;
  let emCurso = null;

  const limpar = texto => String(texto || '').replace(/\s+/g, ' ').trim();
  const normalizar = texto => limpar(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function contar(nome, vezes) {
    const grafia = limpar(nome);
    const chave = normalizar(grafia);
    if (!chave) return;
    if (!porChave.has(chave)) porChave.set(chave, { nome: grafia, grafias: new Map() });
    const cliente = porChave.get(chave);
    cliente.grafias.set(grafia, (cliente.grafias.get(grafia) || 0) + vezes);
  }

  function reconstruir() {
    lista = [];
    porChave.forEach((cliente, chave) => {
      let melhor = cliente.nome;
      let max = 0;
      cliente.grafias.forEach((vezes, grafia) => {
        if (vezes > max) { max = vezes; melhor = grafia; }
      });
      cliente.nome = melhor;
      lista.push({ nome: melhor, chave });
    });
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { sensitivity: 'base' }));
  }

  async function lerDaBase() {
    const cliente = window.Auth && window.Auth.client;
    if (!cliente || !window.AppConfig) return null;
    const tabelas = window.AppConfig.tabelas;
    const [fichas, decos] = await Promise.all([
      cliente.from(tabelas.fichas).select('cliente:header->>cliente'),
      cliente.from(tabelas.deco).select('cliente')
    ]);
    if (fichas.error && decos.error) {
      console.warn('Não foi possível carregar os clientes:', fichas.error);
      return null;
    }
    return [].concat(fichas.data || [], decos.data || []).map(linha => linha.cliente);
  }

  // Carrega (no máximo uma vez por minuto, salvo se forçado).
  function carregar(forcar) {
    if (emCurso) return emCurso;
    if (!forcar && carregadoEm && Date.now() - carregadoEm < TTL_MS) return Promise.resolve(lista);
    emCurso = (async () => {
      try {
        const nomes = await lerDaBase();
        if (nomes) {
          // Mantém os que foram acrescentados nesta sessão e ainda não estão numa ficha.
          const locais = [];
          porChave.forEach(cliente => cliente.grafias.forEach((_, g) => locais.push(g)));
          porChave.clear();
          nomes.forEach(nome => contar(nome, 1));
          locais.forEach(nome => { if (!porChave.has(normalizar(nome))) contar(nome, 1); });
          reconstruir();
          carregadoEm = Date.now();
        }
      } catch (erro) {
        console.warn('Não foi possível carregar os clientes:', erro);
      }
      emCurso = null;
      return lista;
    })();
    return emCurso;
  }

  function existente(nome) {
    const chave = normalizar(nome);
    return chave ? lista.find(c => c.chave === chave) || null : null;
  }

  // Acrescenta já à lista (sem esperar que a ficha seja guardada).
  function adicionar(nome) {
    const limpo = limpar(nome);
    if (!limpo || existente(limpo)) return existente(limpo);
    contar(limpo, 1);
    reconstruir();
    return existente(limpo);
  }

  // ---------------------------------------------------------------------
  // Menu do campo
  // ---------------------------------------------------------------------
  function ligar(input) {
    if (!input || input.dataset.clientesLigado) return;
    input.dataset.clientesLigado = '1';
    input.autocomplete = 'off';
    if (!input.placeholder) input.placeholder = 'Escolhe da lista ou escreve um novo';

    let fecharMenu = null;
    let interno = false;

    // Muda o valor como se a pessoa o tivesse escrito: quem guarda o rascunho
    // ouve o evento "input".
    function escrever(valor) {
      interno = true;
      input.value = valor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      interno = false;
    }

    function fechar() {
      if (fecharMenu) fecharMenu();
    }

    function abrir(filtrar) {
      fechar();
      const termo = filtrar ? normalizar(input.value) : '';
      const texto = limpar(input.value);
      const opcoes = lista
        .filter(c => !termo || c.chave.includes(termo))
        .map(c => ({ nome: c.nome }));
      if (!existente(texto)) {
        opcoes.push({
          novo: true,
          rotulo: texto ? `+ Adicionar "${texto}" como novo cliente` : '+ Adicionar novo cliente'
        });
      }
      if (!opcoes.length) return;

      const menu = document.createElement('div');
      menu.className = 'deco-desc-menu clientes-menu';
      menu.setAttribute('role', 'listbox');
      let ativo = -1;

      function escolher(opcao) {
        fechar();
        if (!opcao.novo) {
          escrever(opcao.nome);
          return;
        }
        if (texto) {
          const cliente = adicionar(texto);
          escrever(cliente ? cliente.nome : texto);
        } else {
          input.placeholder = 'Escreve o nome do novo cliente';
          input.focus();
        }
      }

      const itens = opcoes.map(opcao => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'deco-desc-menu__item' + (opcao.novo ? ' clientes-menu__novo' : '');
        item.setAttribute('role', 'option');
        item.textContent = opcao.novo ? opcao.rotulo : opcao.nome;
        // Sem isto o mousedown tira o foco do campo antes de o clique chegar.
        item.addEventListener('mousedown', evento => evento.preventDefault());
        item.addEventListener('click', () => escolher(opcao));
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
        const largura = Math.max(r.width, 240);
        const abaixo = window.innerHeight - r.bottom;
        menu.style.width = largura + 'px';
        menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) + 'px';
        if (abaixo < 200 && r.top > abaixo) {
          menu.style.top = 'auto';
          menu.style.bottom = (window.innerHeight - r.top + 2) + 'px';
          menu.style.maxHeight = Math.min(300, r.top - 12) + 'px';
        } else {
          menu.style.bottom = 'auto';
          menu.style.top = (r.bottom + 2) + 'px';
          menu.style.maxHeight = Math.min(300, Math.max(120, abaixo - 12)) + 'px';
        }
      }

      const aoTeclar = evento => {
        if (evento.key === 'ArrowDown') {
          evento.preventDefault();
          marcar(ativo + 1 >= itens.length ? 0 : ativo + 1);
        } else if (evento.key === 'ArrowUp') {
          evento.preventDefault();
          marcar(ativo - 1 < 0 ? itens.length - 1 : ativo - 1);
        } else if (evento.key === 'Enter' && ativo >= 0) {
          evento.preventDefault();
          escolher(opcoes[ativo]);
        } else if (evento.key === 'Escape' || evento.key === 'Tab') {
          fechar();
        }
      };
      const aoClicarFora = evento => {
        if (!menu.contains(evento.target) && evento.target !== input) fechar();
      };
      const aoRolar = () => {
        const r = input.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) fechar();
        else posicionar();
      };

      let terminado = false;
      function terminar() {
        if (terminado) return;
        terminado = true;
        fecharMenu = null;
        menu.remove();
        input.removeEventListener('keydown', aoTeclar);
        document.removeEventListener('mousedown', aoClicarFora, true);
        window.removeEventListener('scroll', aoRolar, true);
        window.removeEventListener('resize', terminar);
      }
      fecharMenu = terminar;

      input.addEventListener('keydown', aoTeclar);
      document.addEventListener('mousedown', aoClicarFora, true);
      window.addEventListener('scroll', aoRolar, true);
      window.addEventListener('resize', terminar);
      document.body.appendChild(menu);
      posicionar();
    }

    async function abrirComLista(filtrar) {
      await carregar();
      if (document.activeElement === input) abrir(filtrar);
    }

    input.addEventListener('focus', () => abrirComLista(false));
    input.addEventListener('click', () => { if (!fecharMenu) abrirComLista(false); });
    input.addEventListener('input', () => {
      if (!interno) abrirComLista(true);
    });
    input.addEventListener('blur', () => {
      fechar();
      const texto = limpar(input.value);
      if (!texto) return;
      // Uma grafia diferente de um cliente que já existe passa à da lista; um
      // nome novo fica na lista para os outros campos.
      const cliente = existente(texto) || adicionar(texto);
      const final = cliente ? cliente.nome : texto;
      if (final !== input.value) escrever(final);
    });
  }

  return { carregar, ligar, adicionar, lista: () => lista.map(c => c.nome) };
})();
