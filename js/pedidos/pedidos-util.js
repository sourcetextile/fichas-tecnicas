// Peças partilhadas pelo quadro, pela gaveta de detalhe e pelos modais:
// nomes dos estados, formatação, avatares das GP e a barra de tempo.
//
// Fica num ficheiro só para o cartão do quadro e o cabeçalho da gaveta
// mostrarem o tempo exatamente da mesma maneira.
const PedidosUtil = (() => {
  const NOME_ESTADO = {
    malhas: 'Aprov. Malhas',
    orcamentacao: 'Orçamentação',
    aguarda_cliente: 'Aguarda Cliente',
    fechado: 'Fechado'
  };

  const RESPONSAVEL = {
    malhas: 'Aprovisionamento',
    orcamentacao: 'GP',
    aguarda_cliente: 'Cliente'
  };

  const RESULTADO = {
    converteu: 'Converteu',
    converteu_negociacao: 'Converteu com negociação',
    nao_converteu: 'Não converteu'
  };

  // Além da cor, cada estado do semáforo tem um símbolo e uma palavra:
  // quem não distinga as cores lê o mesmo.
  const SIMBOLO = { verde: '✓', amarelo: '!', vermelho: '!!' };
  const PALAVRA = {
    verde: 'dentro do objetivo',
    amarelo: 'perto do objetivo',
    vermelho: 'acima do objetivo'
  };

  // Cores dos avatares: fundo claro e tinta escura, contraste acima de 4,5:1.
  const PALETA = [
    { bg: '#E8D9C5', ink: '#4A3320' },
    { bg: '#DCE7DA', ink: '#24452F' },
    { bg: '#E7DCEC', ink: '#4A3A79' },
    { bg: '#F3DDD4', ink: '#7A3421' },
    { bg: '#D9E5EE', ink: '#254A66' },
    { bg: '#F2E8BE', ink: '#6B5510' }
  ];

  let utilizadores = [];

  function el(tag, classe, texto) {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined && texto !== null) no.textContent = texto;
    return no;
  }

  function numero(valor) {
    if (valor === null || valor === undefined || valor === '') return '-';
    return Number(valor).toFixed(1).replace('.', ',');
  }

  function dataCurta(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function dataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // Valor para um <input type="datetime-local">, na hora local de quem vê.
  function paraInput(data) {
    const d = data instanceof Date ? data : new Date(data);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      + `T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Sem acentos, sem pontuação, sem maiúsculas: para comparar nomes de clientes.
  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Distância de edição (Levenshtein), só para avisar de um cliente com nome parecido.
  function distancia(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const atual = [i];
      for (let j = 1; j <= b.length; j += 1) {
        atual[j] = Math.min(
          anterior[j] + 1,
          atual[j - 1] + 1,
          anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      anterior = atual;
    }
    return anterior[b.length];
  }

  // -------------------------------------------------------------------
  // Pessoas
  // -------------------------------------------------------------------
  function definirUtilizadores(lista) {
    utilizadores = lista || [];
  }

  // -------------------------------------------------------------------
  // Perfil de quem está ligado. É só para a interface esconder o que não
  // se pode fazer: quem decide é a base de dados (migration 0010).
  //   admin             tudo
  //   gp                só os pedidos em que é a GP responsável
  //   aprovisionamento  só passar de Aprov. Malhas para Orçamentação
  //   leitura           só ver
  // -------------------------------------------------------------------
  let perfil = { papel: 'admin', email: '' };

  function definirPerfil(papel, email) {
    perfil = { papel: papel || 'leitura', email: String(email || '').toLowerCase().trim() };
  }

  const papel = () => perfil.papel;

  // acao: 'mexer' (tudo o que altera um pedido) ou 'avancar_malhas'.
  function pode(c, acao) {
    if (perfil.papel === 'admin') return true;
    if (perfil.papel === 'gp') {
      return String((c && c.gp_email) || '').toLowerCase().trim() === perfil.email;
    }
    if (perfil.papel === 'aprovisionamento') {
      return acao === 'avancar_malhas' && !!c && c.estado === 'malhas';
    }
    return false;
  }

  const podeCriar = () => perfil.papel === 'admin' || perfil.papel === 'gp';
  const podeConfigurar = () => perfil.papel === 'admin' || perfil.papel === 'gp';

  function utilizadorPorEmail(email) {
    const alvo = String(email || '').toLowerCase().trim();
    if (!alvo) return null;
    return utilizadores.find(u => String(u.email || '').toLowerCase().trim() === alvo) || null;
  }

  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    const primeira = partes[0][0];
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primeira + ultima).toUpperCase();
  }

  function primeiroNome(nome) {
    return String(nome || '').trim().split(/\s+/)[0] || '';
  }

  // Cada GP fica sempre com a mesma cor: pela ordem em que aparece na lista.
  function corDe(email) {
    const alvo = String(email || '').toLowerCase().trim();
    const gps = utilizadores
      .filter(u => u.papel === 'gp' && u.email)
      .map(u => String(u.email).toLowerCase().trim());
    let indice = gps.indexOf(alvo);
    if (indice < 0) {
      let h = 0;
      for (const c of alvo) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      indice = h;
    }
    return PALETA[indice % PALETA.length];
  }

  function avatar(email, nomeAlternativo) {
    const u = utilizadorPorEmail(email);
    const nome = (u && u.nome) || nomeAlternativo || email || 'Sem GP';
    const no = el('span', 'pp-avatar', iniciais(nome));
    const cor = corDe(email);
    no.style.setProperty('--pp-av-bg', cor.bg);
    no.style.setProperty('--pp-av-ink', cor.ink);
    no.title = nome;
    no.setAttribute('role', 'img');
    no.setAttribute('aria-label', 'GP: ' + nome);
    return no;
  }

  // -------------------------------------------------------------------
  // Bola do tempo: o número, a branco, dentro de um círculo verde, amarelo
  // ou vermelho. Sem unidade e sem barra: a cor diz se está dentro do
  // objetivo, o número diz quanto. Também serve o dashboard.
  // -------------------------------------------------------------------
  function bola(valor, tom, titulo, grande) {
    const no = el('span', 'pp-bola is-' + (tom || 'neutro') + (grande ? ' is-grande' : ''), numero(valor));
    if (titulo) {
      no.title = titulo;
      no.setAttribute('role', 'img');
      no.setAttribute('aria-label', titulo);
    }
    return no;
  }

  function bolaTempo(cartao, grande) {
    const tom = cartao.semaforo || 'verde';
    return bola(cartao.dias_etapa, tom,
      `Nesta etapa: ${numero(cartao.dias_etapa)}. Objetivo: ${numero(cartao.objetivo)}. ${PALAVRA[tom]}`, grande);
  }

  return {
    NOME_ESTADO, RESPONSAVEL, RESULTADO, SIMBOLO, PALAVRA,
    el, numero, dataCurta, dataHora, paraInput,
    normalizar, distancia,
    definirUtilizadores, utilizadorPorEmail, primeiroNome, iniciais, avatar,
    bola, bolaTempo,
    definirPerfil, papel, pode, podeCriar, podeConfigurar,
    get emailAtual() { return perfil.email; }
  };
})();
