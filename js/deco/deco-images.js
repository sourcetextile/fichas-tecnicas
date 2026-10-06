// Upload de imagens do croqui/paleta para o Supabase Storage — bucket privado
// ficha-tecnica-sourcetextile-deco. Redimensiona no cliente antes de enviar
// (lado maior ~2000px) e nunca guarda base64 na base de dados, só o path.
const DecoImages = (() => {
  const BUCKET = 'ficha-tecnica-sourcetextile-deco';
  const MAX_EDGE = 2000;
  const MAX_BYTES = 10 * 1024 * 1024;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível ler esta imagem (formato não suportado).'));
      };
      img.src = url;
    });
  }

  async function resizeIfNeeded(file) {
    const { img, url } = await loadImage(file);
    const { naturalWidth: width, naturalHeight: height } = img;
    const longEdge = Math.max(width, height);
    if (longEdge <= MAX_EDGE) {
      URL.revokeObjectURL(url);
      return { blob: file, width, height };
    }
    const scale = MAX_EDGE / longEdge;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
    return { blob, width: w, height: h };
  }

  async function upload(file, fichaId, panelKey) {
    if (file.size > MAX_BYTES) {
      throw new Error(`A imagem tem ${(file.size / 1024 / 1024).toFixed(1)} MB, o limite é 10 MB.`);
    }
    const { blob, width, height } = await resizeIfNeeded(file);
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${fichaId}/${panelKey}-${Date.now()}.${ext}`;
    const { error } = await window.Auth.client.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: blob.type, upsert: true });
    if (error) throw new Error('Não foi possível enviar a imagem: ' + error.message);
    return { path, largura_natural: width, altura_natural: height };
  }

  async function getSignedUrl(path) {
    const { data, error } = await window.Auth.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) {
      console.warn('Não foi possível obter a imagem:', error);
      return null;
    }
    return data.signedUrl;
  }

  // Copia um objeto ja existente para a pasta de outra ficha. E o que
  // permite reaproveitar o croqui de uma ficha sem as duas passarem a
  // partilhar o mesmo ficheiro (apagar numa apagaria na outra).
  async function copy(path, fichaId, panelKey) {
    if (!path) return null;
    const ext = path.split('.').pop() || 'jpg';
    const destino = `${fichaId}/${panelKey}-${Date.now()}.${ext}`;
    const { error } = await window.Auth.client.storage.from(BUCKET).copy(path, destino);
    if (error) {
      console.warn('Nao foi possivel copiar a imagem, fica partilhada:', error);
      return path;
    }
    return destino;
  }

  async function remove(path) {
    const caminhos = (Array.isArray(path) ? path : [path]).filter(Boolean);
    if (!caminhos.length) return;
    await window.Auth.client.storage.from(BUCKET).remove(caminhos);
  }

  // Apaga tudo o que a ficha tem no armazenamento. Como cada ficha guarda as
  // suas imagens em <fichaId>/..., basta limpar a pasta — isso apanha tambem
  // as que ficaram para tras quando uma imagem foi substituida por outra.
  async function removeFolder(fichaId) {
    if (!fichaId) return;
    const bucket = window.Auth.client.storage.from(BUCKET);
    const { data, error } = await bucket.list(String(fichaId), { limit: 1000 });
    if (error || !data || !data.length) return;
    const caminhos = data.map(item => fichaId + '/' + item.name);
    const resultado = await bucket.remove(caminhos);
    if (resultado.error) console.warn('Nao foi possivel limpar as imagens da ficha:', resultado.error);
  }

  return { upload, copy, getSignedUrl, remove, removeFolder };
})();
