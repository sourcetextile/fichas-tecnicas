// Indicadores do dashboard: agregação pura, sem DOM, para se poder testar.
//
// Recebe as linhas de pedidos_preco_sourcetextile_kpis() (uma por pedido) e
// devolve taxas, médias e semáforos. Os tempos já vêm calculados pela base de
// dados com a função única de dias úteis; aqui só se agrupa e se faz a média.
//
// Definições (as do enunciado):
//  - Universo da conversão: pedidos com preço enviado que estão fechados, ou
//    em Aguarda Cliente e "sem resposta" (5 ou mais). Os que estão em
//    Aguarda Cliente há menos ficam de fora, como "em curso".
//  - Taxa de conversão = (converteu + converteu com negociação) / universo.
//  - Tempo de resposta sem negociação: pedidos de uma só ronda. Objetivo 3,
//    ou 1 se as malhas não se aplicam.
//  - Tempo de resposta com negociação: mais de uma ronda, todas com preço
//    enviado. Objetivo = 3 por ronda.
//  - Com menos de 5 pedidos a amostra é pequena.
const PedidosKpi = (() => {
  const AMOSTRA_MINIMA = 5;
  const CATEGORIAS = ['converteu', 'converteu_negociacao', 'nao_converteu', 'sem_resposta'];

  const numeros = lista => lista.filter(v => v !== null && v !== undefined && !Number.isNaN(Number(v))).map(Number);
  const media = lista => {
    const v = numeros(lista);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  function categoria(l) {
    if (l.estado === 'fechado') return l.preco_enviado ? l.resultado : null;
    if (l.estado === 'aguarda_cliente') return l.sem_resposta ? 'sem_resposta' : 'em_curso';
    return null;
  }

  function resultado(linhas) {
    const r = { total: 0, emCurso: 0, taxa: null };
    CATEGORIAS.forEach(c => { r[c] = 0; });
    linhas.forEach(l => {
      const c = categoria(l);
      if (c === 'em_curso') r.emCurso += 1;
      else if (c && r[c] !== undefined) { r[c] += 1; r.total += 1; }
    });
    if (r.total) r.taxa = (r.converteu + r.converteu_negociacao) / r.total;
    return r;
  }

  // Semáforo de um tempo contra o objetivo (mesma regra da função SQL).
  function semaforo(valor, objetivo, limiar) {
    if (valor === null || valor === undefined || !objetivo) return null;
    if (valor > objetivo) return 'vermelho';
    return valor >= objetivo * (limiar || 0.85) ? 'amarelo' : 'verde';
  }

  // Conversão: verde no objetivo ou acima, amarelo a partir de 85% dele.
  function semaforoConversao(taxa, objetivo, limiar) {
    if (taxa === null || objetivo === null || objetivo === undefined) return null;
    if (taxa >= objetivo) return 'verde';
    return taxa >= objetivo * (limiar || 0.85) ? 'amarelo' : 'vermelho';
  }

  const semNegociacao = linhas =>
    linhas.filter(l => Number(l.ronda_atual) === 1 && l.tempo_resposta !== null && l.tempo_resposta !== undefined);
  const comNegociacao = linhas =>
    linhas.filter(l => Number(l.ronda_atual) > 1 && l.tempo_resposta !== null && l.tempo_resposta !== undefined);

  const objetivoSem = l => (l.malhas_na ? 1 : 3);
  const objetivoCom = l => 3 * Number(l.ronda_atual);

  function tempoResposta(linhas, tipo) {
    const sub = tipo === 'sem' ? semNegociacao(linhas) : comNegociacao(linhas);
    const obj = tipo === 'sem' ? objetivoSem : objetivoCom;
    return {
      n: sub.length,
      media: media(sub.map(l => l.tempo_resposta)),
      objetivo: media(sub.map(obj)),
      rondas: media(sub.map(l => l.ronda_atual)),
      linhas: sub
    };
  }

  // Tempo por interveniente dentro de um conjunto de pedidos.
  function porInterveniente(sub, objetivos) {
    const o = objetivos || { malhas: 2, orcamentacao: 1 };
    return [
      { chave: 'malhas', nome: 'Aprov. Malhas', objetivo: o.malhas,
        media: media(sub.map(l => l.tempo_malhas)), n: numeros(sub.map(l => l.tempo_malhas)).length },
      { chave: 'orcamentacao', nome: 'Orçamentação (GP)', objetivo: o.orcamentacao,
        media: media(sub.map(l => l.tempo_orcamentacao)), n: numeros(sub.map(l => l.tempo_orcamentacao)).length }
    ];
  }

  function agrupar(linhas, chave, nome) {
    const mapa = new Map();
    linhas.forEach(l => {
      const k = l[chave];
      if (!mapa.has(k)) mapa.set(k, { chave: k, nome: nome(l), linhas: [] });
      mapa.get(k).linhas.push(l);
    });
    return [...mapa.values()];
  }

  const porGp = linhas => agrupar(linhas, 'gp_email', l => l.gp_nome || l.gp_email || 'Sem GP');
  const porCliente = linhas => agrupar(linhas, 'cliente_id', l => l.cliente_nome);

  // Trabalho em curso: pedidos abertos por GP e quantos estão em atraso.
  function emCurso(linhas) {
    const abertos = linhas.filter(l => l.estado !== 'fechado');
    return porGp(abertos).map(g => ({
      chave: g.chave, nome: g.nome, linhas: g.linhas,
      abertos: g.linhas.length,
      atraso: g.linhas.filter(l =>
        (l.estado === 'malhas' || l.estado === 'orcamentacao') && l.semaforo === 'vermelho').length
    }));
  }

  const cicloTotal = linhas => media(linhas.filter(l => l.estado === 'fechado').map(l => l.ciclo_total));

  const filtrar = (linhas, f) => linhas.filter(l =>
    (!f || !f.gp || String(l.gp_email || '').toLowerCase() === f.gp)
    && (!f || !f.cliente || l.cliente_id === f.cliente));

  // Motivos de não conversão, do mais frequente para o menos.
  function porMotivo(linhas) {
    const perdidos = linhas.filter(l => categoria(l) === 'nao_converteu');
    return agrupar(perdidos, 'motivo', l => l.motivo || 'Sem motivo')
      .sort((a, b) => b.linhas.length - a.linhas.length);
  }

  // Evolução mês a mês (pelo mês da receção, hora de Lisboa).
  function mesDe(iso) {
    return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 7);
  }

  function porMes(linhas) {
    return agrupar(linhas.filter(l => l.recebido_em), 'mes', l => mesDe(l.recebido_em))
      .map(g => Object.assign(g, {
        resultado: resultado(g.linhas),
        semNegociacao: tempoResposta(g.linhas, 'sem')
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // O "chave" de agrupar() é o campo; para o mês calcula-se antes.
  const porMesComChave = linhas => porMes(linhas.map(l => Object.assign({}, l, { mes: l.recebido_em ? mesDe(l.recebido_em) : null })));

  // Uma linha por pedido, para abrir no Excel (separador ; e vírgula decimal).
  function csv(linhas) {
    const cab = ['Cliente', 'Referência', 'GP', 'Estado', 'Resultado', 'Motivo', 'Ronda', 'Recebido em',
      'Lead time', 'Tempo em Aprov. Malhas', 'Tempo em Orçamentação', 'Ciclo total', 'Sem resposta'];
    const nomeEstado = { malhas: 'Aprov. Malhas', orcamentacao: 'Orçamentação', aguarda_cliente: 'Aguarda Cliente', fechado: 'Fechado' };
    const nomeRes = { converteu: 'Converteu', converteu_negociacao: 'Converteu com negociação', nao_converteu: 'Não converteu' };
    const num = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const cel = v => {
      const t = v === null || v === undefined ? '' : String(v);
      return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const corpo = linhas.map(l => [
      l.cliente_nome, l.ref_cliente, l.gp_nome || l.gp_email, nomeEstado[l.estado] || l.estado,
      nomeRes[l.resultado] || '', l.motivo || '', l.ronda_atual,
      l.recebido_em ? new Date(l.recebido_em).toLocaleDateString('pt-PT') : '',
      num(l.tempo_resposta), num(l.tempo_malhas), num(l.tempo_orcamentacao), num(l.ciclo_total),
      l.sem_resposta ? 'Sim' : ''
    ].map(cel).join(';'));
    return '\uFEFF' + [cab.join(';')].concat(corpo).join('\r\n');
  }

  const api = {
    porMotivo, porMes: porMesComChave, csv,
    AMOSTRA_MINIMA, categoria, resultado, semaforo, semaforoConversao,
    semNegociacao, comNegociacao, tempoResposta, porInterveniente,
    porGp, porCliente, emCurso, cicloTotal, filtrar, media
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
