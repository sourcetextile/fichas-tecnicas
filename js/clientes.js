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

  // chave (sem acentos nem maiúsculas) ->
  //   { nome, grafias: Map(grafia -> vezes), brutos: Set(texto exato na base) }
  const porChave = new Map();
  let lista = [];
  let carregadoEm = 0;
  let emCurso = null;

  const limpar = texto => String(texto || '').replace(/\s+/g, ' ').trim();
  const normalizar = texto => limpar(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // "bruto" é o texto tal como está na base (com espaços a mais, etc.): é com
  // ele que se encontram as fichas para corrigir ou eliminar um cliente.
  function contar(nome, vezes, bruto) {
    const grafia = limpar(nome);
    const chave = normalizar(grafia);
    if (!chave) return;
    if (!porChave.has(chave)) porChave.set(chave, { nome: grafia, grafias: new Map(), brutos: new Set() });
    const cliente = porChave.get(chave);
    cliente.grafias.set(grafia, (cliente.grafias.get(grafia) || 0) + vezes);
    if (bruto !== undefined) cliente.brutos.add(bruto);
  }

  function reconstruir() {
    lista = [];
    porChave.forEach((cliente, chave) => {
      let melhor = cliente.nome;
      let max = 0;
      let total = 0;
      cliente.grafias.forEach((vezes, grafia) => {
        total += vezes;
        if (vezes > max) { max = vezes; melhor = grafia; }
      });
      cliente.nome = melhor;
      lista.push({ nome: melhor, chave, total: cliente.brutos.size ? total : 0 });
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
          nomes.forEach(nome => { if (nome !== null && nome !== undefined) contar(nome, 1, String(nome)); });
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
  // Corrigir ou eliminar um cliente
  //
  // Não há uma tabela de clientes: um cliente existe enquanto houver fichas
  // com o seu nome. Por isso, mudar o nome ou eliminar é mudar essas fichas
  // (Ficha técnica: o cliente está no cabeçalho; Fichas de decoração: coluna
  // "cliente"). Eliminar NÃO apaga fichas: só lhes tira o cliente.
  // ---------------------------------------------------------------------
  // Campos "Cliente" abertos neste momento, para os acertar depois de uma
  // alteração (senão o rascunho voltava a gravar o nome antigo).
  const campos = [];

  async function alterarNaBase(brutos, novo) {
    const cliente = window.Auth.client;
    const tabelas = window.AppConfig.tabelas;
    let alteradas = 0;
    let erros = 0;
    for (const bruto of brutos) {
      const deco = await cliente.from(tabelas.deco).update({ cliente: novo }).eq('cliente', bruto).select('id');
      if (deco.error) erros += 1; else alteradas += deco.data.length;

      const fichas = await cliente.from(tabelas.fichas).select('id, header').eq('header->>cliente', bruto);
      if (fichas.error) { erros += 1; continue; }
      for (const linha of fichas.data) {
        const header = Object.assign({}, linha.header, { cliente: novo || '' });
        const resultado = await cliente.from(tabelas.fichas).update({ header }).eq('id', linha.id);
        if (resultado.error) erros += 1; else alteradas += 1;
      }
    }
    return { alteradas, erros };
  }

  // Muda o nome (novoNome) ou elimina (novoNome = null) o cliente com esta chave.
  async function alterar(chave, novoNome) {
    const atual = porChave.get(chave);
    if (!atual) return { alteradas: 0, erros: 0 };
    const resultado = await alterarNaBase(Array.from(atual.brutos), novoNome);
    if (!resultado.erros) porChave.delete(chave);
    // Os campos abertos que ainda tinham o nome antigo passam ao novo (ou ficam vazios).
    campos.forEach(campo => {
      if (normalizar(campo.input.value) === chave) campo.escrever(novoNome || '');
    });
    await carregar(true);
    if (novoNome && !existente(novoNome)) adicionar(novoNome);
    return resultado;
  }

  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  async function gerir() {
    await carregar(true);
    if (!lista.length) return;

    const chave = await DecoDialog.escolher({
      titulo: 'Gerir clientes',
      mensagem: 'Escolhe o cliente que queres corrigir ou eliminar. O número é o de fichas que o usam.',
      opcoes: lista.map(c => ({ etiqueta: `${c.nome} (${c.total})`, valor: c.chave }))
    });
    if (!chave) return;
    const cliente = lista.find(c => c.chave === chave);
    if (!cliente) return;

    const acao = await DecoDialog.escolher({
      titulo: cliente.nome,
      mensagem: cliente.total
        ? `${plural(cliente.total, 'ficha usa', 'fichas usam')} este cliente (Ficha técnica e Fichas de decoração).`
        : 'Nenhuma ficha usa este cliente.',
      opcoes: [
        { etiqueta: 'Mudar o nome / juntar a outro cliente', valor: 'renomear', destaque: true },
        { etiqueta: 'Eliminar o cliente', valor: 'eliminar' }
      ]
    });
    if (!acao) return;

    let novoNome = null;
    if (acao === 'renomear') {
      const texto = await DecoDialog.pedirTexto({
        titulo: 'Novo nome do cliente',
        mensagem: 'Se escreveres o nome de um cliente que já existe, os dois ficam juntos.',
        etiqueta: 'Nome do cliente',
        valor: cliente.nome,
        confirmar: 'Mudar o nome'
      });
      const limpo = limpar(texto);
      if (!limpo || limpo === cliente.nome) return;
      const igual = existente(limpo);
      novoNome = igual && igual.chave !== chave ? igual.nome : limpo;
    } else {
      const confirmado = await DecoDialog.confirmar({
        titulo: `Eliminar "${cliente.nome}"?`,
        mensagem: cliente.total
          ? `As ${plural(cliente.total, 'ficha', 'fichas')} que usam este cliente ficam sem cliente (não se apagam). Esta ação não pode ser anulada.`
          : 'Nenhuma ficha o usa; só sai da lista.',
        confirmar: 'Eliminar cliente',
        perigo: true
      });
      if (!confirmado) return;
    }

    document.body.style.cursor = 'progress';
    let resultado;
    try {
      resultado = await alterar(chave, novoNome);
    } finally {
      document.body.style.cursor = '';
    }
    if (resultado.erros) {
      await DecoDialog.confirmar({
        titulo: 'Nem tudo foi alterado',
        mensagem: `Houve ${plural(resultado.erros, 'erro', 'erros')} ao alterar as fichas. Tenta outra vez; se continuar, avisa quem gere a aplicação.`,
        confirmar: 'Ok',
        cancelar: 'Fechar'
      });
    }
  }

  // ---------------------------------------------------------------------
  // Criar um cliente novo
  //
  // Não pode acontecer por acaso (escrever "10" a meio de "10 Days" e sair do
  // campo criava um cliente "10"). Só se cria por uma ação deliberada, e com
  // confirmação: "+ Adicionar novo cliente" no menu, ou escrever um nome que
  // não existe e confirmar quando a aplicação pergunta. Se já existir um
  // cliente parecido, sugere-se esse primeiro.
  // ---------------------------------------------------------------------
  // Enquanto uma janela nossa está aberta, os campos ignoram o "blur" (a janela
  // tira-lhes o foco, e isso não pode disparar outra pergunta).
  let ocupado = false;

  // Devolve o nome do cliente a usar (existente ou criado agora) ou null.
  async function novoCliente(texto) {
    ocupado = true;
    try {
      let nome = limpar(texto);
      if (!nome) {
        const escrito = await DecoDialog.pedirTexto({
          titulo: 'Novo cliente',
          mensagem: 'Escreve o nome do cliente. Vai ficar disponível para todas as pessoas, por isso confirma que está escrito como deve ser.',
          etiqueta: 'Nome do cliente',
          confirmar: 'Continuar'
        });
        nome = limpar(escrito);
        if (!nome) return null;
      }

      const igual = existente(nome);
      if (igual) return igual.nome;

      const chave = normalizar(nome);
      const parecidos = lista.filter(c =>
        (c.chave.length >= 2 && chave.includes(c.chave)) || (chave.length >= 2 && c.chave.includes(chave)));
      if (parecidos.length) {
        const escolha = await DecoDialog.escolher({
          titulo: 'Já existe um cliente parecido',
          mensagem: `Já existe: ${parecidos.map(c => c.nome).join(', ')}. Queres usar um deles ou criar "${nome}" como cliente novo?`,
          opcoes: parecidos.slice(0, 4)
            .map(c => ({ etiqueta: 'Usar ' + c.nome, valor: 'usar:' + c.nome, destaque: true }))
            .concat([{ etiqueta: `Criar "${nome}" como novo`, valor: 'criar' }])
        });
        if (!escolha) return null;
        if (escolha.startsWith('usar:')) return escolha.slice(5);
      } else {
        const confirmado = await DecoDialog.confirmar({
          titulo: `Criar o cliente "${nome}"?`,
          mensagem: 'Vai ficar disponível para todas as pessoas. Confirma que o nome está escrito como deve ser.',
          confirmar: 'Criar cliente'
        });
        if (!confirmado) return null;
      }
      const criado = adicionar(nome);
      return criado ? criado.nome : nome;
    } finally {
      ocupado = false;
    }
  }

  // ---------------------------------------------------------------------
  // Menu do campo
  // ---------------------------------------------------------------------
  function ligar(input) {
    if (!input || input.dataset.clientesLigado) return;
    input.dataset.clientesLigado = '1';
    input.autocomplete = 'off';
    input.placeholder = 'Escolhe da lista';

    let fecharMenu = null;
    let interno = false;
    // O que o resto da aplicação já tem como valor deste campo. Escrever no
    // campo só chega à aplicação quando é um cliente que existe (ou vazio);
    // enquanto isso, o rascunho e o guardar automático não veem texto a meio.
    let ultimoValido = input.value;

    // Muda o valor como se a pessoa o tivesse escrito: quem guarda o rascunho
    // ouve o evento "input".
    function escrever(valor) {
      interno = true;
      input.value = valor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      interno = false;
    }
    campos.push({ input, escrever });

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
          rotulo: texto ? `+ Criar o cliente "${texto}"…` : '+ Adicionar novo cliente…'
        });
      }
      // Corrigir ou eliminar clientes: só quando já há clientes na lista.
      if (lista.length) opcoes.push({ gerir: true, rotulo: 'Gerir clientes… (mudar o nome, eliminar)' });
      if (!opcoes.length) return;

      const menu = document.createElement('div');
      menu.className = 'deco-desc-menu clientes-menu';
      menu.setAttribute('role', 'listbox');
      let ativo = -1;

      async function escolher(opcao) {
        fechar();
        if (opcao.gerir) {
          ocupado = true;
          try { await gerir(); } finally { ocupado = false; }
          return;
        }
        if (!opcao.novo) {
          escrever(opcao.nome);
          return;
        }
        // Cliente novo: só com confirmação (e a escrever o nome, se o campo estava vazio).
        input.value = ultimoValido;
        const criado = await novoCliente(texto);
        if (criado) escrever(criado);
        else input.focus();
      }

      const itens = opcoes.map(opcao => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'deco-desc-menu__item'
          + (opcao.novo ? ' clientes-menu__novo' : '')
          + (opcao.gerir ? ' clientes-menu__gerir' : '');
        item.setAttribute('role', 'option');
        item.textContent = opcao.novo || opcao.gerir ? opcao.rotulo : opcao.nome;
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

    input.addEventListener('focus', () => {
      ultimoValido = input.value;
      abrirComLista(false);
    });
    input.addEventListener('click', () => { if (!fecharMenu) abrirComLista(false); });

    // Ao escrever, o menu filtra; e só chega ao resto da aplicação (rascunho,
    // guardar automático) o que é um cliente que existe, ou o campo vazio. É
    // um listener de captura: corre antes dos da aplicação neste campo.
    input.addEventListener('input', evento => {
      if (interno) {
        ultimoValido = input.value;
        return;
      }
      abrirComLista(true);
      if (limpar(input.value) && !existente(input.value)) {
        evento.stopImmediatePropagation();
        return;
      }
      ultimoValido = input.value;
    }, true);

    input.addEventListener('blur', async () => {
      if (ocupado) return;
      fechar();
      const texto = limpar(input.value);
      if (!texto) return;
      await carregar();
      const cliente = existente(texto);
      if (cliente) {
        // Grafia diferente de um cliente que já existe: passa à da lista.
        if (cliente.nome !== input.value) escrever(cliente.nome);
        return;
      }
      // Nome que não existe: não fica no campo. Volta ao valor anterior (já é
      // o que a aplicação tem) e só se cria o cliente se a pessoa confirmar.
      input.value = ultimoValido;
      const criado = await novoCliente(texto);
      if (criado) escrever(criado);
    });
  }

  return { carregar, ligar, adicionar, gerir, lista: () => lista.map(c => c.nome) };
})();
