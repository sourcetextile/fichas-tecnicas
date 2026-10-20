// Ideia de preço: a edição das tabelas.
//
// Tudo se edita no sítio, sem botão de guardar: cada campo grava ao sair
// dele, como a nota de um pedido. Acrescentar é um clique (a linha nova
// abre com o cursor no nome) e apagar é um clique com "Desfazer" no aviso.
// As perdas e a tinturaria estão sempre por ordem alfabética; só as margens
// se ordenam à mão, com as setas. Um valor em branco fica "a avaliar".
//
// Nas tabelas que o permitem (as perdas), uma linha pode ter um valor por
// tipo de malha (ex.: Ramular - Jersey 5%, Outros 3%).
const IdeiaEdicao = (() => {
  const S = IdeiaStorage;
  const U = PedidosUtil;
  const el = U.el;

  let dados = null;         // { linhas: [...] }, partilhado com a visualização
  let raiz = null;
  let aoEstado = () => {};

  // -------------------------------------------------------------------
  // Gravar
  // -------------------------------------------------------------------
  function marcarErro(campo, mensagem) {
    campo.setAttribute('aria-invalid', 'true');
    campo.title = mensagem;
    aoEstado(mensagem, 'erro');
  }

  function limparErro(campo) {
    campo.removeAttribute('aria-invalid');
    campo.title = '';
  }

  async function gravar(linha, no) {
    if (!linha.nome.trim()) {
      const nome = no.querySelector('[data-campo="nome"]');
      if (nome) marcarErro(nome, 'Dá um nome à linha antes de a guardar.');
      return false;
    }
    const repetida = dados.linhas.some(l => l.id !== linha.id && l.tabela === linha.tabela
      && l.nome.trim().toLowerCase() === linha.nome.trim().toLowerCase());
    if (repetida) {
      const nome = no.querySelector('[data-campo="nome"]');
      if (nome) marcarErro(nome, 'Já existe uma linha com esse nome nesta tabela.');
      return false;
    }
    aoEstado('A guardar...', 'aguarda');
    try {
      const guardada = await S.guardar(linha);
      const i = dados.linhas.findIndex(l => l.id === linha.id);
      if (i >= 0) dados.linhas[i] = guardada; else dados.linhas.push(guardada);
      linha.novo = false;
      no.classList.remove('is-nova');
      no.classList.add('is-guardada');
      setTimeout(() => no.classList.remove('is-guardada'), 1200);
      aoEstado('Guardado às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }), 'ok');
      return true;
    } catch (erro) {
      aoEstado(erro.message, 'erro');
      PedidosToast.erro(erro.message);
      return false;
    }
  }

  // Lê os campos da linha para o objeto. Devolve false se algum não é válido.
  function lerLinha(t, linha, no) {
    let valido = true;
    const nome = no.querySelector('[data-campo="nome"]');
    linha.nome = nome.value;
    limparErro(nome);

    const obs = no.querySelector('[data-campo="obs"]');
    linha.observacoes = obs.value;

    if (linha.variantes.length) {
      linha.variantes = [...no.querySelectorAll('.ip-ed-variante')].map(v => {
        const campoPct = v.querySelector('[data-campo="vpct"]');
        const lido = S.lerPct(campoPct.value);
        limparErro(campoPct);
        if (lido.erro) { marcarErro(campoPct, lido.erro); valido = false; }
        return { nome: v.querySelector('[data-campo="vnome"]').value.trim(), percentagem: lido.erro ? null : lido.valor };
      });
      linha.percentagem = null;
    } else {
      const campoPct = no.querySelector('[data-campo="pct"]');
      const lido = t.valor === 'preco' ? S.lerPreco(campoPct.value) : S.lerPct(campoPct.value);
      limparErro(campoPct);
      if (lido.erro) { marcarErro(campoPct, lido.erro); valido = false; }
      else if (t.valor === 'preco') linha.preco = lido.valor;
      else linha.percentagem = lido.valor;
    }
    return valido;
  }

  async function aoMudar(t, linha, no) {
    if (!lerLinha(t, linha, no)) return;
    // Uma linha nova sem nome ainda não se grava: está a ser escrita.
    if (linha.novo && !linha.nome.trim()) return;
    await gravar(linha, no);
  }

  // -------------------------------------------------------------------
  // Peças da linha
  // -------------------------------------------------------------------
  function campoTexto(valor, campo, rotulo, placeholder) {
    const i = el('input', 'ip-ed-campo');
    i.type = 'text';
    i.value = valor || '';
    i.dataset.campo = campo;
    i.setAttribute('aria-label', rotulo);
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function campoPct(valor, campo, rotulo, sinal) {
    const caixa = el('span', 'ip-pct');
    const i = el('input', 'ip-ed-campo');
    i.type = 'text';
    i.inputMode = 'decimal';
    i.value = S.paraCampo(valor);
    i.placeholder = 'A avaliar';
    i.dataset.campo = campo;
    i.setAttribute('aria-label', rotulo);
    caixa.appendChild(i);
    caixa.appendChild(el('span', 'ip-pct__sinal', sinal || '%'));
    return caixa;
  }

  function icone(texto, rotulo, fn, classe) {
    const b = el('button', 'pp-icone-mini ' + (classe || ''), texto);
    b.type = 'button';
    b.title = rotulo;
    b.setAttribute('aria-label', rotulo);
    b.addEventListener('click', fn);
    return b;
  }

  function celulaValor(t, linha, no) {
    const celula = el('div', 'ip-ed-valor');
    if (linha.variantes.length) {
      const lista = el('div', 'ip-ed-variantes');
      linha.variantes.forEach((v, i) => {
        const vl = el('div', 'ip-ed-variante');
        vl.appendChild(campoTexto(v.nome, 'vnome', 'Tipo de malha', 'Tipo de malha'));
        vl.appendChild(campoPct(v.percentagem, 'vpct', 'Perda de ' + (v.nome || 'este tipo')));
        vl.appendChild(icone('✕', 'Tirar este tipo', () => {
          lerLinha(t, linha, no);
          linha.variantes.splice(i, 1);
          // Com um só tipo, deixa de haver divisão: fica esse valor.
          if (linha.variantes.length === 1) {
            linha.percentagem = linha.variantes[0].percentagem;
            linha.variantes = [];
          }
          substituir(t, linha, no, true);
        }));
        lista.appendChild(vl);
      });
      celula.appendChild(lista);
      const mais = el('button', 'pp-mini', '+ Tipo');
      mais.type = 'button';
      mais.addEventListener('click', () => {
        lerLinha(t, linha, no);
        linha.variantes.push({ nome: '', percentagem: null });
        substituir(t, linha, no, false, '.ip-ed-variante:last-child [data-campo="vnome"]');
      });
      celula.appendChild(mais);
    } else {
      celula.appendChild(t.valor === 'preco'
        ? campoPct(linha.preco, 'pct', t.rotuloValor + ' de ' + (linha.nome || 'esta linha'), '€')
        : campoPct(linha.percentagem, 'pct', t.rotuloValor + ' de ' + (linha.nome || 'esta linha')));
      if (t.variantes) {
        const dividir = el('button', 'pp-mini', 'Por tipo');
        dividir.type = 'button';
        dividir.title = 'Um valor diferente por tipo de malha (ex.: Jersey e Outros)';
        dividir.addEventListener('click', () => {
          lerLinha(t, linha, no);
          linha.variantes = [
            { nome: 'Jersey', percentagem: linha.percentagem },
            { nome: 'Outros', percentagem: linha.percentagem }
          ];
          linha.percentagem = null;
          substituir(t, linha, no, true, '[data-campo="vpct"]');
        });
        celula.appendChild(dividir);
      }
    }
    return celula;
  }

  // Volta a desenhar uma linha (quando muda de valor único para tipos).
  function substituir(t, linha, no, gravarJa, focar) {
    const novo = linhaEditavel(t, linha);
    no.replaceWith(novo);
    if (focar) {
      const alvo = novo.querySelector(focar);
      if (alvo) alvo.focus();
    }
    if (gravarJa && !linha.novo) gravar(linha, novo);
  }

  function linhaEditavel(t, linha) {
    const no = el('div', 'ip-ed-linha' + (linha.novo ? ' is-nova' : ''));
    no.dataset.id = linha.id;
    no.dataset.nome = linha.nome;

    const mover = el('div', 'ip-ed-mover');
    if (t.ordem === 'manual') {
      mover.appendChild(icone('↑', 'Subir', () => trocar(t, linha, -1)));
      mover.appendChild(icone('↓', 'Descer', () => trocar(t, linha, 1)));
    }
    no.appendChild(mover);

    no.appendChild(campoTexto(linha.nome, 'nome', t.coluna, 'Nome'));
    no.appendChild(celulaValor(t, linha, no));
    no.appendChild(campoTexto(linha.observacoes, 'obs', 'Observações', 'Observações'));
    no.appendChild(icone('✕', 'Apagar ' + (linha.nome || 'esta linha'), () => apagar(t, linha, no), 'ip-ed-apagar'));

    // Grava ao sair de um campo que mudou. Enter também conta como sair.
    no.addEventListener('change', event => {
      if (event.target.matches('input')) aoMudar(t, linha, no);
    });
    no.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('input')) event.target.blur();
    });
    return no;
  }

  // -------------------------------------------------------------------
  // Acrescentar, apagar, ordenar
  // -------------------------------------------------------------------
  function acrescentar(t) {
    const daTabela = S.daTabela(dados.linhas, t.chave);
    const linha = {
      id: S.novoId(), tabela: t.chave, ordem: (daTabela.length ? daTabela[daTabela.length - 1].ordem : 0) + 1,
      nome: '', percentagem: null, preco: null, variantes: [], observacoes: '', novo: true
    };
    const corpo = raiz.querySelector(`.ip-cartao[data-tabela="${t.chave}"] .ip-ed-corpo`);
    const vazio = corpo.querySelector('.pp-dcard__nota');
    if (vazio) vazio.remove();
    const no = linhaEditavel(t, linha);
    corpo.appendChild(no);
    no.querySelector('[data-campo="nome"]').focus();
  }

  async function apagar(t, linha, no) {
    if (linha.novo) { no.remove(); return; }
    const copia = Object.assign({}, linha, { variantes: linha.variantes.map(v => Object.assign({}, v)) });
    try {
      await S.apagar(linha.id);
    } catch (erro) {
      PedidosToast.erro(erro.message);
      return;
    }
    dados.linhas = dados.linhas.filter(l => l.id !== linha.id);
    desenharTabela(t);
    aoEstado('Apagado.', 'ok');
    PedidosToast.ok(`Linha "${linha.nome}" apagada.`, {
      rotulo: 'Desfazer',
      fn: async () => {
        try {
          const reposta = await S.guardar(copia);
          dados.linhas.push(reposta);
          desenharTabela(t);
          aoEstado('Reposto.', 'ok');
        } catch (erro) {
          PedidosToast.erro(erro.message);
        }
      }
    });
  }

  async function trocar(t, linha, sentido) {
    const lista = S.daTabela(dados.linhas, t.chave);
    const i = lista.findIndex(l => l.id === linha.id);
    const j = i + sentido;
    if (i < 0 || j < 0 || j >= lista.length) return;
    const a = lista[i];
    const b = lista[j];
    // Ordens iguais (linhas antigas) trocam-se por posição, não por valor.
    const oa = a.ordem === b.ordem ? j + 1 : b.ordem;
    const ob = a.ordem === b.ordem ? i + 1 : a.ordem;
    aoEstado('A guardar...', 'aguarda');
    try {
      const [na, nb] = await Promise.all([
        S.guardar(Object.assign({}, a, { ordem: oa })),
        S.guardar(Object.assign({}, b, { ordem: ob }))
      ]);
      dados.linhas = dados.linhas.map(l => (l.id === na.id ? na : l.id === nb.id ? nb : l));
      desenharTabela(t, a.id, sentido < 0 ? 'Subir' : 'Descer');
      aoEstado('Ordem guardada.', 'ok');
    } catch (erro) {
      PedidosToast.erro(erro.message);
    }
  }

  // -------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------
  function cartaoTabela(t) {
    const cartao = el('section', 'ip-cartao is-edicao');
    cartao.dataset.tabela = t.chave;
    const cab = el('header', 'ip-cartao__cab');
    cab.appendChild(el('h3', null, t.titulo));
    cab.appendChild(el('span', 'pp-dlegenda ip-ed-contagem'));
    if (t.ordem === 'alfabetica') cab.appendChild(el('span', 'pp-dlegenda', '· por ordem alfabética'));
    cartao.appendChild(cab);

    const titulos = el('div', 'ip-ed-linha is-cabecalho');
    ['', t.coluna, t.rotuloValor + (t.valor === 'preco' ? ' (€)' : ''), 'Observações', '']
      .forEach(x => titulos.appendChild(el('span', null, x)));
    cartao.appendChild(titulos);

    cartao.appendChild(el('div', 'ip-ed-corpo'));

    const mais = el('button', 'ip-ed-mais', '+ ' + t.novo);
    mais.type = 'button';
    mais.addEventListener('click', () => acrescentar(t));
    cartao.appendChild(mais);
    return cartao;
  }

  function desenharTabela(t, focoId, focoBotao) {
    const cartao = raiz.querySelector(`.ip-cartao[data-tabela="${t.chave}"]`);
    const corpo = cartao.querySelector('.ip-ed-corpo');
    corpo.innerHTML = '';
    const lista = S.daTabela(dados.linhas, t.chave);
    cartao.querySelector('.ip-ed-contagem').textContent = lista.length + (lista.length === 1 ? ' linha' : ' linhas');
    if (!lista.length) corpo.appendChild(el('p', 'pp-dcard__nota', 'Ainda não há linhas. Acrescenta ' + t.artigo + '.'));
    lista.forEach(l => corpo.appendChild(linhaEditavel(t, Object.assign({}, l, {
      variantes: l.variantes.map(v => Object.assign({}, v))
    }))));
    if (focoId) {
      const no = corpo.querySelector(`.ip-ed-linha[data-id="${focoId}"]`);
      const b = no && no.querySelector(`[aria-label="${focoBotao}"]`);
      if (b) b.focus();
    }
  }

  function desenhar(alvo, partilhados, opcoes) {
    raiz = alvo;
    dados = partilhados;
    aoEstado = (opcoes && opcoes.aoEstado) || (() => {});
    raiz.innerHTML = '';
    raiz.appendChild(el('p', 'ip-ajuda',
      'As alterações gravam-se sozinhas ao sair de cada campo. Um valor em branco fica "a avaliar".'));
    const grelha = el('div', 'ip-ed-grelha');
    S.TABELAS.forEach(t => grelha.appendChild(cartaoTabela(t)));
    raiz.appendChild(grelha);
    S.TABELAS.forEach(t => desenharTabela(t));
    IdeiaDocumentos.edicao(raiz, dados, { aoEstado });

    if (opcoes && opcoes.doc) {
      const doc = raiz.querySelector(`#ip-ed-doc-${CSS.escape(opcoes.doc)}`);
      if (doc) doc.scrollIntoView({ block: 'start' });
      return;
    }

    // Vindo de um clique na visualização: a linha certa, com o cursor lá.
    if (opcoes && opcoes.tabela) {
      const cartao = raiz.querySelector(`.ip-cartao[data-tabela="${opcoes.tabela}"]`);
      const no = opcoes.id && cartao.querySelector(`.ip-ed-linha[data-id="${opcoes.id}"]`);
      const alvoFoco = no
        ? (no.querySelector('[data-campo="pct"]') || no.querySelector('[data-campo="vpct"]'))
        : null;
      (no || cartao).scrollIntoView({ block: 'center' });
      if (no) {
        no.classList.add('is-destaque');
        if (alvoFoco) alvoFoco.focus();
      }
    }
  }

  return { desenhar };
})();
