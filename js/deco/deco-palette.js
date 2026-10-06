// Paleta de cores da decoração: matriz em que as COLUNAS são as cores do
// artigo e as LINHAS as cores base da decoração; cada cruzamento marca-se com
// um X. Título renomeável, colunas/linhas adicionáveis e removíveis, e uma
// foto opcional por cor base.
//
// Formato guardado em ficha.paleta (jsonb):
//   { titulo: "Paleta de cores",
//     cores: ["Preto", "Branco"],
//     cores_base: [ { nome: "Pantone 186C", marcas: [true, false], foto: "<path>" } ] }
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
    corner.textContent = 'Cor base / Cor do artigo';
    headRow.appendChild(corner);

    paleta.cores.forEach((cor, index) => {
      const cell = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'deco-paleta-cor-input';
      input.value = cor;
      input.placeholder = 'Cor';
      input.addEventListener('input', () => {
        paleta.cores[index] = input.value;
        changed();
      });
      cell.appendChild(input);
      cell.appendChild(miniButton('✕', 'Remover esta cor', () => removeCor(index)));
      headRow.appendChild(cell);
    });

    const fotoHead = document.createElement('th');
    fotoHead.textContent = 'Foto';
    headRow.appendChild(fotoHead);
    const toolsHead = document.createElement('th');
    toolsHead.textContent = '';
    headRow.appendChild(toolsHead);

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    paleta.cores_base.forEach((base, rowIndex) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'deco-paleta-base-input';
      nameInput.value = base.nome || '';
      nameInput.placeholder = 'Cor base da decoração';
      nameInput.addEventListener('input', () => {
        base.nome = nameInput.value;
        changed();
      });
      nameCell.appendChild(nameInput);
      tr.appendChild(nameCell);

      paleta.cores.forEach((_, colIndex) => {
        const cell = document.createElement('td');
        cell.className = 'deco-paleta-mark';
        cell.textContent = base.marcas[colIndex] ? 'X' : '';
        cell.tabIndex = 0;
        cell.title = 'Clica para marcar/desmarcar';
        const toggle = () => {
          base.marcas[colIndex] = !base.marcas[colIndex];
          cell.textContent = base.marcas[colIndex] ? 'X' : '';
          cell.classList.toggle('is-marked', base.marcas[colIndex]);
          changed();
        };
        cell.classList.toggle('is-marked', !!base.marcas[colIndex]);
        cell.addEventListener('click', toggle);
        cell.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        });
        tr.appendChild(cell);
      });

      const fotoCell = document.createElement('td');
      fotoCell.className = 'deco-paleta-foto';
      if (base.foto) {
        const thumb = document.createElement('img');
        thumb.alt = base.nome || 'Cor base';
        DecoImages.getSignedUrl(base.foto).then(url => {
          if (url) thumb.src = url;
        });
        fotoCell.appendChild(thumb);
        fotoCell.appendChild(miniButton('✕', 'Remover foto', () => {
          DecoImages.remove(base.foto);
          base.foto = null;
          render();
          changed();
        }));
      } else {
        fotoCell.appendChild(miniButton('+ Foto', 'Adicionar foto desta cor base', () => pickPhoto(base, rowIndex)));
      }
      tr.appendChild(fotoCell);

      const toolsCell = document.createElement('td');
      toolsCell.appendChild(miniButton('Apagar', 'Apagar esta cor base', () => removeBase(rowIndex)));
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
