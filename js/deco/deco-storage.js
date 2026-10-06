// Persistência das Fichas de decoração — mesmo idioma de app/js/storage.js
// (init(client, table) por injeção de dependência), mas em objeto próprio:
// esta tabela e este CRUD não têm nada a ver com o Storage da Ficha técnica.
const DecoStorage = {
  _client: null,
  _table: null,

  init(client, table) {
    this._client = client;
    this._table = table;
  },

  async listFichas() {
    const { data, error } = await this._client
      .from(this._table)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('Não foi possível carregar as fichas de decoração:', error);
      return [];
    }
    return data;
  },

  async getFicha(id) {
    const { data, error } = await this._client
      .from(this._table)
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      console.warn('Não foi possível carregar a ficha de decoração:', error);
      return null;
    }
    return data;
  },

  async upsertFicha(entry) {
    const { data, error } = await this._client
      .from(this._table)
      .upsert(entry)
      .select()
      .single();
    if (error) {
      console.warn('Não foi possível guardar a ficha de decoração:', error);
      return null;
    }
    return data;
  },

  // Alteracao pontual de campos (ex.: o estado, mudado a partir da lista).
  // E um UPDATE verdadeiro, nao um upsert: um upsert parcial tentaria primeiro
  // o INSERT e esbarrava no NOT NULL de ref_nosso_modelo.
  async updateFicha(id, patch) {
    const { data, error } = await this._client
      .from(this._table)
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      console.warn('Nao foi possivel atualizar a ficha de decoracao:', error);
      return null;
    }
    return data;
  },

  async deleteFicha(id) {
    const { error } = await this._client.from(this._table).delete().eq('id', id);
    if (error) console.warn('Não foi possível apagar a ficha de decoração:', error);
  }
};
