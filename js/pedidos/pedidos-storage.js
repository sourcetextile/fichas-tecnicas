// Acesso a dados dos Pedidos de Preço.
//
// A regra do módulo: o cliente NUNCA escreve diretamente nas tabelas de
// pedidos e de histórico. Todas as alterações passam por funções SQL (RPC)
// porque é lá que vivem as regras: registar a transição, recalcular o
// estado, validar a correção de uma data. Não é só uma convenção: desde a
// migration 0007 a base de dados recusa a escrita direta (só há SELECT nas
// tabelas de histórico), por isso a tabela e o histórico não podem divergir,
// venha a alteração de onde vier.
const PedidosStorage = (() => {
  const P = () => window.AppConfig.tabelas.pedidos;
  let client = null;

  function init(supabase) {
    client = supabase;
  }

  // Erros do Postgres chegam com a mensagem do RAISE EXCEPTION, que já
  // está escrita para ser lida por uma pessoa. É essa que mostramos.
  function falhar(error, fallback) {
    const msg = (error && (error.message || error.hint)) || fallback;
    console.warn('[pedidos]', error);
    throw new Error(msg);
  }

  async function rpc(nome, args) {
    const { data, error } = await client.rpc(P() + nome, args || {});
    if (error) falhar(error, 'Não foi possível completar a operação.');
    return data;
  }

  async function tabela(nome, seletor, ordem) {
    let q = client.from(P() + nome).select(seletor || '*');
    if (ordem) q = q.order(ordem.coluna, { ascending: ordem.ascendente !== false });
    const { data, error } = await q;
    if (error) {
      console.warn('[pedidos] leitura de ' + nome + ':', error);
      return [];
    }
    return data || [];
  }

  return {
    init,

    // --- leitura -----------------------------------------------------
    // Os fechados só vêm se se pedirem, e só os dos últimos N dias: o
    // quadro nunca carrega a história toda.
    quadro: fechadosDias => rpc('quadro', { p_fechados_dias: fechadosDias || 0 }),
    // Uma linha por pedido, com os factos dos indicadores (ver pedidos-kpi.js).
    kpis: (desde, ate) => rpc('kpis', { p_desde: desde || null, p_ate: ate || null }),
    historico: pedidoId => rpc('historico', { p_pedido: pedidoId }),
    limitesCorrecao: transicaoId => rpc('limites_correcao', { p_transicao: transicaoId }),

    clientes: () => tabela('clientes', 'id, nome, ativo', { coluna: 'nome' }),
    utilizadores: () => tabela('utilizadores', 'id, nome, email, papel, ativo', { coluna: 'nome' }),
    motivos: () => tabela('motivos', 'id, nome, ordem, pede_texto, ativo', { coluna: 'ordem' }),

    async config() {
      const linhas = await tabela('config', 'chave, valor');
      const out = {};
      linhas.forEach(linha => { out[linha.chave] = linha.valor; });
      return out;
    },

    // --- escrita (tudo por RPC) --------------------------------------
    criarPedido: ({ clienteNome, clienteId, refCliente, gpEmail, dataRececao, precisaMalhas }) =>
      rpc('criar_pedido', {
        p_cliente_nome: clienteNome || null,
        p_cliente_id: clienteId || null,
        p_ref_cliente: refCliente,
        p_gp_email: gpEmail,
        p_data_rececao: dataRececao || null,
        p_precisa_malhas: precisaMalhas !== false
      }),

    mover: (pedidoId, destino, origem) =>
      rpc('mover', { p_pedido: pedidoId, p_destino: destino, p_origem: origem || 'kanban' }),

    saltarMalhas: pedidoId => rpc('saltar_malhas', { p_pedido: pedidoId }),

    fechar: (pedidoId, resultado, motivoId, motivoDescricao) =>
      rpc('fechar', {
        p_pedido: pedidoId,
        p_resultado: resultado,
        p_motivo_id: motivoId || null,
        p_motivo_descricao: motivoDescricao || null
      }),

    novaRonda: (pedidoId, precisaMalhas) =>
      rpc('nova_ronda', { p_pedido: pedidoId, p_precisa_malhas: precisaMalhas !== false }),

    desfazer: pedidoId => rpc('desfazer', { p_pedido: pedidoId }),

    // Corrigir cliente, referência ou GP de um pedido (não toca no histórico).
    editarPedido: ({ pedidoId, clienteNome, clienteId, refCliente, gpEmail }) =>
      rpc('editar_pedido', {
        p_pedido: pedidoId,
        p_cliente_nome: clienteNome || null,
        p_cliente_id: clienteId || null,
        p_ref_cliente: refCliente,
        p_gp_email: gpEmail
      }),

    // Só funciona num pedido que nunca teve um único movimento.
    apagarPedido: pedidoId => rpc('apagar_pedido', { p_pedido: pedidoId }),

    meuPapel: () => rpc('meu_papel'),

    // --- alertas, notas e configuração --------------------------------
    alertasHoje: () => rpc('alertas_hoje'),
    marcarLidas: () => rpc('marcar_lidas'),
    obterNota: pedidoId => rpc('obter_nota', { p_pedido: pedidoId }),
    guardarNota: (pedidoId, nota) => rpc('guardar_nota', { p_pedido: pedidoId, p_nota: nota }),
    guardarTemplate: (assunto, corpo) => rpc('guardar_template', { p_assunto: assunto, p_corpo: corpo }),

    corrigirData: (transicaoId, novo) =>
      rpc('corrigir_data', { p_transicao: transicaoId, p_novo: novo })
  };
})();
