// Paleta de cores da decoração: matriz em que as COLUNAS são as cores do artigo
// e as LINHAS as cores base da decoração; cada cruzamento marca-se com um X.
// Título renomeável, colunas/linhas adicionáveis e removíveis, e uma foto
// opcional por cor base (na linha).
//
// Formato guardado em ficha.paleta (jsonb) — não depende de como se desenha:
//   { titulo: "Paleta de cores",
//     cores: ["Preto", "Branco"],            // cores do artigo
//     cores_base: [ { nome: "Pantone 186C", marcas: [true, false], foto: "<path>" } ] }
// marcas[i] da cor base corresponde a cores[i].
const DecoPalette = (() => {
  const table = document.getElementById('decoPaletaTable');
  const addCorButton = document.getElementById('decoPaletaAddCor');
  const addBaseButton = document.getElementById('decoPaletaAddBase');

  let paleta = null;
  let onChange = function () {};
  let getFichaId = () => null;
  let bound = false;

  function normalize(value) {
    const out = (value && typeof value === 'object') ? value : {};
    // O título é sempre o mesmo e não se edita (fichas antigas com outro título
    // passam a este).
    out.titulo = 'Paleta de cores';
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

  // Setas entre células, como no Excel. Os nomes são campos de texto: esquerda
  // e direita só saltam com o cursor na ponta do texto; cima e baixo saltam
  // sempre. Nas células do X as quatro setas saltam.
  function focavel(cell) {
    if (!cell) return null;
    const campo = cell.querySelector('input');
    if (campo) return campo;
    return cell.classList.contains('deco-paleta-mark') ? cell : null;
  }

  function onTabelaKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tecla = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(tecla)) return;

    const atual = event.target;
    const cell = atual.closest('td, th');
    if (!cell || !table.contains(cell)) return;

    if (atual instanceof HTMLInputElement && (tecla === 'ArrowLeft' || tecla === 'ArrowRight')) {
      const fim = atual.value.length;
      const todoSelecionado = atual.selectionStart === 0 && atual.selectionEnd === fim;
      const naPonta = atual.selectionStart === atual.selectionEnd
        && atual.selectionStart === (tecla === 'ArrowLeft' ? 0 : fim);
      if (!todoSelecionado && !naPonta) return;
    } else if (!(atual instanceof HTMLInputElement) && atual !== cell) {
      return; // um botão dentro da célula: não mexe
    }

    const linha = cell.parentElement;
    const linhas = Array.from(table.rows);
    let r = linhas.indexOf(linha);
    let c = Array.from(linha.cells).indexOf(cell);
    const dr = tecla === 'ArrowUp' ? -1 : tecla === 'ArrowDown' ? 1 : 0;
    const dc = tecla === 'ArrowLeft' ? -1 : tecla === 'ArrowRight' ? 1 : 0;

    // Continua na mesma direção até achar uma célula onde se possa estar
    // (salta a de cantos e a das ferramentas).
    for (;;) {
      r += dr;
      c += dc;
      const destino = linhas[r];
      if (!destino || c < 0 || c >= destino.cells.length) return;
      const alvo = focavel(destino.cells[c]);
      if (alvo) {
        event.preventDefault();
        alvo.focus();
        if (alvo instanceof HTMLInputElement) alvo.select();
        return;
      }
    }
  }

  function bindEvents() {
    table.addEventListener('keydown', onTabelaKeydown);
    addCorButton.addEventListener('click', addCor);
    addBaseButton.addEventListener('click', addBase);
  }

  return { load, normalize };
})();
