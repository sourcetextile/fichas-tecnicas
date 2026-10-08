// Paleta de cores da decoração: matriz em que as COLUNAS são as cores base da
// decoração e as LINHAS as cores do artigo; cada cruzamento marca-se com um X.
// Título renomeável, colunas/linhas adicionáveis e removíveis, e uma foto
// opcional por cor base (no cabeçalho da coluna).
//
// Formato guardado em ficha.paleta (jsonb) — não depende de como se desenha:
//   { titulo: "Paleta de cores",
//     cores: ["Preto", "Branco"],            // cores do artigo
//     cores_base: [ { nome: "Pantone 186C", marcas: [true, false], foto: "<path>" } ] }
// marcas[i] da cor base corresponde a cores[i].
const DecoPalette = (() => {
  const table = document.getElementById('decoPaletaTable');
  const tituloInput = document.getElementById('decoPaletaTitulo');
  const addCorButton = document.getElementById('decoPaletaAddCor');
  const addBaseButton = document.getElementById('decoPaletaAddBase');

  let paleta = null;
  let onChange = function () {};
  let getFichaId = () => null;
  let bound = false;

  function normalize(value) {
    const out = (value && typeof value === 'object') ? value : {};
    if (typeof out.titulo !== 'string' || !out.titulo) out.titulo = 'Paleta de cores';
    if (!Array.isArray(out.cores)) out.cores = [];
    if (!Array.isArray(out.cores_base)) out.cores_base = [];
    out.cores_base.forEach(base => {
      if (!Array.isArray(base.marcas)) base.marcas = [];
      while (base.marcas.length < out.cores.length) base.marcas.push(false);
      base.marcas.length = out.cores.length;
    });
    return out;
  }

  function load(value, options) {
    paleta = normalize(value);
    onChange = (options && options.onChange) || function () {};
    getFichaId = (options && options.fichaId) || (() => null);
    tituloInput.value = paleta.titulo;
    render();
    if (!bound) {
      bindEvents();
      bound = true;
    }
    return paleta;
  }

  function changed() {
    onChange(paleta);
  }

  function miniButton(label, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'deco-mini-button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', handler);
    return button;
  }

  function addCor() {
    paleta.cores.push('');
    paleta.cores_base.forEach(base => base.marcas.push(false));
    render();
    changed();
  }

  function removeCor(index) {
    paleta.cores.splice(index, 1);
    paleta.cores_base.forEach(base => base.marcas.splice(index, 1));
    render();
    changed();
  }

  function addBase() {
    paleta.cores_base.push({ nome: '', marcas: paleta.cores.map(() => false), foto: null });
    render();
    changed();
  }

  function removeBase(index) {
    const base = paleta.cores_base[index];
    if (base && base.foto) DecoImages.remove(base.foto);
    paleta.cores_base.splice(index, 1);
    render();
    changed();
  }

  async function pickPhoto(base, index) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const uploaded = await DecoImages.upload(file, getFichaId(), `paleta-${index}`);
        base.foto = uploaded.path;
        render();
        changed();
      } catch (err) {
        window.alert(err.message || 'Não foi possível carregar a imagem.');
      }
    });
    input.click();
  }

  function render() {
    table.innerHTML = '';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const corner = document.createElement('th');
    corner.className = 'deco-paleta-corner';
    corner.textContent = 'Cor do artigo / Cor base';
    headRow.appendChild(corner);

    paleta.cores_base.forEach((base, baseIndex) => {
      const cell = document.createElement('th');
      cell.className = 'deco-paleta-foto';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'deco-paleta-cor-input';
      input.value = base.nome || '';
      input.placeholder = 'Cor base';
      input.addEventListener('input', () => {
        base.nome = input.value;
        changed();
      });
      cell.appendChild(input);

      if (base.foto) {
        const thumb = document.createElement('img');
        thumb.alt = base.nome || 'Cor base';
        DecoImages.getSignedUrl(base.foto).then(url => {
          if (url) thumb.src = url;
        });
        cell.appendChild(thumb);
        cell.appendChild(miniButton('✕ foto', 'Remover foto', () => {
          DecoImages.remove(base.foto);
          base.foto = null;
          render();
          changed();
        }));
      } else {
        cell.appendChild(miniButton('+ Foto', 'Adicionar foto desta cor base', () => pickPhoto(base, baseIndex)));
      }
      cell.appendChild(miniButton('✕', 'Remover esta cor base', () => removeBase(baseIndex)));
      headRow.appendChild(cell);
    });

    const toolsHead = document.createElement('th');
    toolsHead.textContent = '';
    headRow.appendChild(toolsHead);

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    paleta.cores.forEach((cor, rowIndex) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'deco-paleta-base-input';
      nameInput.value = cor || '';
      nameInput.placeholder = 'Cor do artigo';
      nameInput.addEventListener('input', () => {
        paleta.cores[rowIndex] = nameInput.value;
        changed();
      });
      nameCell.appendChild(nameInput);
      tr.appendChild(nameCell);

      paleta.cores_base.forEach(base => {
        const cell = document.createElement('td');
        cell.className = 'deco-paleta-mark';
        cell.textContent = base.marcas[rowIndex] ? 'X' : '';
        cell.tabIndex = 0;
        cell.title = 'Clica para marcar/desmarcar';
        const toggle = () => {
          base.marcas[rowIndex] = !base.marcas[rowIndex];
          cell.textContent = base.marcas[rowIndex] ? 'X' : '';
          cell.classList.toggle('is-marked', base.marcas[rowIndex]);
          changed();
        };
        cell.classList.toggle('is-marked', !!base.marcas[rowIndex]);
        cell.addEventListener('click', toggle);
        cell.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        });
        tr.appendChild(cell);
      });

      const toolsCell = document.createElement('td');
      toolsCell.appendChild(miniButton('Apagar', 'Apagar esta cor do artigo', () => removeCor(rowIndex)));
      tr.appendChild(toolsCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    if (!paleta.cores.length && !paleta.cores_base.length) {
      const tfoot = document.createElement('tfoot');
      const tr = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'saved-empty';
      cell.textContent = 'Sem paleta definida — usa "+ Cor" para as cores do artigo e "+ Cor base" para as cores da decoração.';
      tr.appendChild(cell);
      tfoot.appendChild(tr);
      table.appendChild(tfoot);
    }
  }

  function bindEvents() {
    tituloInput.addEventListener('input', () => {
      paleta.titulo = tituloInput.value;
      changed();
    });
    addCorButton.addEventListener('click', addCor);
    addBaseButton.addEventListener('click', addBase);
  }

  return { load, normalize };
})();
