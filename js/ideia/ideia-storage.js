// Ideia de preço: acesso aos dados e o que é comum às duas vistas.
//
// Dois tipos de tabela (migrations 0012 e 0013):
//  - As tabelas de referência (perdas por operação, margens, preço por
//    operação de tinturaria) vivem todas em `ideia_preco_sourcetextile_linhas`,
//    uma linha por linha de tabela.
//  - As tabelas de fornecedor (Lavagens, Tingimento) são documentos com
//    secções: grelhas de preços (por peso da peça, por cor) e listas de
//    custos, em `ideia_preco_sourcetextile_documentos`, com o PDF original
//    anexado num bucket privado.
// Ao contrário dos Pedidos de preço, aqui escreve-se diretamente nas tabelas:
// não há histórico a proteger, só valores de referência, e a base de dados
// (RLS) só deixa escrever a quem pode editar.
const IdeiaStorage = (() => {
  const TABELA = 'ideia_preco_sourcetextile_linhas';
  const DOCUMENTOS = 'ideia_preco_sourcetextile_documentos';
  const BUCKET = 'ideia-preco-sourcetextile-documentos';
  let client = null;

  // As tabelas de referência. Uma tabela nova é uma entrada aqui (e um valor
  // no check da coluna `tabela`, na base de dados).
  //   valor: 'pct' (percentagem) ou 'preco' (euros)
  //   ordem: 'alfabetica' (sempre por nome) ou 'manual' (setas na edição).
  //          Hoje todas estão por ordem alfabética.
  const TABELAS = [
    {
      chave: 'perdas', titulo: 'Perdas por operação', curto: 'Perdas',
      coluna: 'Operação', rotuloValor: 'Perda', valor: 'pct', ordem: 'alfabetica',
      novo: 'Adicionar operação', artigo: 'uma operação', contagem: ['operação', 'operações'],
      variantes: true, maior: 'Maior perda primeiro'
    },
    {
      chave: 'margens', titulo: 'Margens a aplicar', curto: 'Margens',
      coluna: 'Margem', rotuloValor: 'Percentagem', valor: 'pct', ordem: 'alfabetica',
      novo: 'Adicionar margem', artigo: 'uma margem', contagem: ['margem', 'margens'],
      variantes: false
    },
    {
      chave: 'tinturaria', titulo: 'Preço por operação de tinturaria', curto: 'Tinturaria',
      coluna: 'Operação', rotuloValor: 'Preço', valor: 'preco', ordem: 'alfabetica',
      novo: 'Adicionar operação', artigo: 'uma operação', contagem: ['operação', 'operações'],
      variantes: false
    }
  ];

  function init(supabase) {
    client = supabase;
  }

  // -------------------------------------------------------------------
  // Números
  // -------------------------------------------------------------------
  function lerNumero(texto, maximo) {
    const limpo = String(texto === null || texto === undefined ? '' : texto)
      .trim().replace('%', '').replace('€', '').replace(',', '.').trim();
    if (limpo === '') return { valor: null };
    const n = Number(limpo);
    if (!Number.isFinite(n)) return { erro: 'Escreve um número, por exemplo 2 ou 2,5.' };
    if (n < 0) return { erro: 'O valor não pode ser negativo.' };
    if (maximo !== undefined && n > maximo) return { erro: 'A percentagem tem de estar entre 0 e 100.' };
    return { valor: Math.round(n * 1000) / 1000 };
  }

  // "2", "2,5", "2.5" e "2%" são a mesma coisa. Vazio é "a avaliar".
  const lerPct = texto => lerNumero(texto, 100);
  const lerPreco = texto => lerNumero(texto);

  // 2 → "2%"; 2.5 → "2,5%"; vazio → null (quem desenha decide o que mostrar).
  function pct(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ',')) + '%';
  }

  // 0.65 → "0,65 €" (sempre com duas casas, como nas tabelas dos fornecedores).
  function euro(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    return Number(valor).toFixed(2).replace('.', ',') + ' €';
  }

  const formatar = (t, valor) => (t.valor === 'preco' ? euro(valor) : pct(valor));

  // Para escrever num campo: 2.5 → "2,5".
  const paraCampo = valor => (valor === null || valor === undefined ? '' : String(valor).replace('.', ','));

  // "Até 100 g" → [0, 100]; "101 a 200 g" → [101, 200]; o resto → null.
  function intervaloDe(nome) {
    const s = String(nome || '').toLowerCase().replace(/\s+/g, ' ');
    let m = s.match(/^at[eé]\s*(\d+)\s*g/);
    if (m) return [0, Number(m[1])];
    m = s.match(/^(\d+)\s*a\s*(\d+)\s*g/);
    if (m) return [Number(m[1]), Number(m[2])];
    return null;
  }

  // -------------------------------------------------------------------
  // Linhas das tabelas de referência
  // -------------------------------------------------------------------
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

  function normalizar(l) {
    return {
      id: l.id,
      tabela: l.tabela,
      ordem: Number(l.ordem) || 0,
      nome: l.nome || '',
      percentagem: num(l.percentagem),
      preco: num(l.preco),
      variantes: Array.isArray(l.variantes) ? l.variantes.map(v => ({ nome: v.nome || '', percentagem: num(v.percentagem) })) : [],
      observacoes: l.observacoes || '',
      updated_by: l.updated_by || null,
      updated_at: l.updated_at || null
    };
  }

  // O valor de uma linha, conforme a tabela (percentagem ou preço).
  const valorDe = (t, l) => (t.valor === 'preco' ? l.preco : l.percentagem);

  // As mensagens da base de dados não são para pessoas; estas são.
  function erroLegivel(error, fallback) {
    const msg = String((error && (error.message || error.details)) || '');
    console.warn('[ideia]', error);
    if (/duplicate|unique|_nome_uk/i.test(msg)) return 'Já existe uma linha com esse nome nesta tabela.';
    if (/row-level security|permission|42501|unauthorized/i.test(msg)) return 'Não tens permissão para editar estas tabelas.';
    if (/check constraint|percentagem/i.test(msg)) return 'Há um valor fora do permitido.';
    if (/mime|pdf/i.test(msg)) return 'Só se podem anexar ficheiros PDF.';
    if (/size|large/i.test(msg)) return 'O PDF é grande demais (máximo 20 MB).';
    return msg || fallback;
  }

  async function listar() {
    const { data, error } = await client.from(TABELA).select('*');
    if (error) throw new Error(erroLegivel(error, 'Não foi possível carregar as tabelas.'));
    return (data || []).map(normalizar);
  }

  async function guardar(linha) {
    const payload = {
      id: linha.id,
      tabela: linha.tabela,
      ordem: linha.ordem,
      nome: linha.nome.trim(),
      percentagem: linha.variantes.length ? null : linha.percentagem,
      preco: linha.preco,
      variantes: linha.variantes,
      observacoes: linha.observacoes.trim() || null
    };
    const { data, error } = await client.from(TABELA).upsert(payload).select();
    if (error) throw new Error(erroLegivel(error, 'Não foi possível guardar.'));
    return normalizar((data && data[0]) || payload);
  }

  async function apagar(id) {
    const { error } = await client.from(TABELA).delete().eq('id', id);
    if (error) throw new Error(erroLegivel(error, 'Não foi possível apagar.'));
  }

  // -------------------------------------------------------------------
  // Tabelas de fornecedor
  // -------------------------------------------------------------------
  function normalizarDoc(d) {
    return {
      id: d.id,
      ordem: Number(d.ordem) || 0,
      nome: d.nome || '',
      fornecedor: d.fornecedor || '',
      data_tabela: d.data_tabela || null,
      validade_meses: d.validade_meses === null || d.validade_meses === undefined ? null : Number(d.validade_meses),
      secoes: Array.isArray(d.secoes) ? d.secoes.map(s => ({
        titulo: s.titulo || '',
        tipo: s.tipo === 'lista' ? 'lista' : 'grelha',
        unidade: s.unidade || '',
        // Pôr a negrito o preço mais caro de cada linha (migration 0014).
        maximo: s.maximo === true,
        colunas: Array.isArray(s.colunas) ? s.colunas.slice() : [],
        linhas: Array.isArray(s.linhas) ? s.linhas.map(l => (s.tipo === 'lista'
          ? { nome: l.nome || '', texto: l.texto || '' }
          : { nome: l.nome || '', valores: (l.valores || []).map(num) })) : []
      })) : [],
      notas: Array.isArray(d.notas) ? d.notas.slice() : [],
      pdf_path: d.pdf_path || null,
      pdf_nome: d.pdf_nome || null,
      updated_by: d.updated_by || null,
      updated_at: d.updated_at || null
    };
  }

  async function listarDocumentos() {
    const { data, error } = await client.from(DOCUMENTOS).select('*');
    if (error) throw new Error(erroLegivel(error, 'Não foi possível carregar as tabelas de fornecedor.'));
    return (data || []).map(normalizarDoc).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt'));
  }

  async function guardarDocumento(doc) {
    const payload = {
      id: doc.id, ordem: doc.ordem, nome: doc.nome.trim(), fornecedor: doc.fornecedor.trim() || null,
      data_tabela: doc.data_tabela || null, validade_meses: doc.validade_meses,
      // Só o que é dado: as marcas da edição (ex.: linha acabada de criar) não vão.
      secoes: doc.secoes.map(s => {
        const limpa = { titulo: s.titulo, tipo: s.tipo, unidade: s.unidade, colunas: s.colunas };
        if (s.tipo === 'grelha' && s.maximo) limpa.maximo = true;
        limpa.linhas = s.linhas.map(l => (s.tipo === 'lista'
          ? { nome: l.nome, texto: l.texto }
          : { nome: l.nome, valores: l.valores }));
        return limpa;
      }),
      notas: doc.notas.filter(n => n.trim()),
      pdf_path: doc.pdf_path, pdf_nome: doc.pdf_nome
    };
    const { data, error } = await client.from(DOCUMENTOS).upsert(payload).select();
    if (error) throw new Error(erroLegivel(error, 'Não foi possível guardar.'));
    return normalizarDoc((data && data[0]) || payload);
  }

  // Validade: data da tabela + N meses. Devolve { ate, expirada } ou null.
  function validade(doc) {
    if (!doc.data_tabela || !doc.validade_meses) return null;
    const [a, m, d] = doc.data_tabela.split('-').map(Number);
    const ate = new Date(a, m - 1 + doc.validade_meses, d);
    ate.setDate(ate.getDate() - 1);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return { ate, expirada: ate < hoje };
  }

  async function carregarPdf(doc, ficheiro) {
    if (!/pdf$/i.test(ficheiro.type || '') && !/\.pdf$/i.test(ficheiro.name || '')) {
      throw new Error('Só se podem anexar ficheiros PDF.');
    }
    const caminho = doc.id + '/' + Date.now() + '.pdf';
    const { error } = await client.storage.from(BUCKET).upload(caminho, ficheiro, {
      contentType: 'application/pdf', upsert: true
    });
    if (error) throw new Error(erroLegivel(error, 'Não foi possível carregar o PDF.'));
    const antigo = doc.pdf_path;
    const novo = await guardarDocumento(Object.assign({}, doc, { pdf_path: caminho, pdf_nome: ficheiro.name }));
    if (antigo) client.storage.from(BUCKET).remove([antigo]).catch(() => {});
    return novo;
  }

  async function retirarPdf(doc) {
    const antigo = doc.pdf_path;
    const novo = await guardarDocumento(Object.assign({}, doc, { pdf_path: null, pdf_nome: null }));
    if (antigo) await client.storage.from(BUCKET).remove([antigo]);
    return novo;
  }

  async function urlPdf(doc) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(doc.pdf_path, 600);
    if (error) throw new Error(erroLegivel(error, 'Não foi possível abrir o PDF.'));
    return data.signedUrl;
  }

  // -------------------------------------------------------------------
  async function podeEditar() {
    try {
      const { data, error } = await client.rpc('ideia_preco_sourcetextile_pode_editar');
      return !error && data === true;
    } catch (erro) {
      return false;
    }
  }

  const novoId = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

  // Ordem alfabética, como as pessoas a leem ("Cardar 2x" antes de "Cardar 10x",
  // "Ácido" junto de "Acabamento").
  const porNome = (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt', { numeric: true, sensitivity: 'base' });

  // As linhas de uma tabela, já pela ordem certa para ela.
  function daTabela(linhas, chave) {
    const t = TABELAS.find(x => x.chave === chave);
    return linhas
      .filter(l => l.tabela === chave)
      .sort((a, b) => (t && t.ordem === 'alfabetica' ? porNome(a, b) : a.ordem - b.ordem || porNome(a, b)));
  }

  return {
    TABELAS, init, listar, guardar, apagar, podeEditar,
    listarDocumentos, guardarDocumento, carregarPdf, retirarPdf, urlPdf, validade,
    lerPct, lerPreco, pct, euro, formatar, paraCampo, intervaloDe, valorDe, novoId, daTabela, porNome
  };
})();
