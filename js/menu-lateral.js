/* Menu lateral das Fichas Técnicas — o mesmo das outras apps da Source (ver menu.js do Portal).
   Lê os separadores de #appTabs (que a app já tem), mostra-os numa barra lateral e esconde os do topo;
   um clique no menu clica no separador original. Só aparece depois de iniciar sessão. */
(function () {
  if (window.__portalMenu) return;
  window.__portalMenu = true;
  var eu = { portal: (window.AppConfig && window.AppConfig.portalUrl) || '' };
  var NIVEIS = { consulta: 'Consulta', editor: 'Editor', admin: 'Administrador' };
  var cfg = { nome: 'Fichas Técnicas', cont: '#appTabs' };
  function falhou() {}
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var LARGO = function () { return window.matchMedia('(min-width: 1100px)').matches; };

  var CSS =
    'body.ml-on{padding-left:312px!important}' +
    'body.ml-on.ml-compacto{padding-left:108px!important}' +
    'body.ml-on .app-logo:not(.ml-logo),body.ml-on #appLogoLateral{display:none!important}' +
    'body.ml-on .app,body.ml-on .page-shell,body.ml-on .main-content{max-width:none!important;margin-left:0!important;margin-right:0!important}' +
    '.ml-side{position:fixed;left:16px;top:16px;bottom:16px;width:280px;z-index:30;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;border-radius:16px;padding:18px 14px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08);font:15px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1a1a1a}' +
    '.ml-side *{box-sizing:border-box}' +
    '.ml-topo{display:flex;align-items:center;gap:12px;padding:0 8px 14px;margin-bottom:8px;border-bottom:1px solid rgba(26,26,26,.22)}' +
    '.ml-logo{flex:none;height:64px;aspect-ratio:663/2000;background:#161615;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;mask-repeat:no-repeat;mask-position:center;mask-size:contain}' +
    '.ml-nome{font-weight:700;font-size:16px;line-height:1.2}' +
    '.ml-lista{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1 1 auto}' +
    '.ml-item{display:flex;align-items:center;gap:12px;width:100%;min-height:46px;margin:0 0 2px;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:#1a1a1a;font:inherit;font-size:15px;font-weight:600;text-align:left;cursor:pointer}' +
    '.ml-item:hover{background:rgba(26,26,26,.07)}' +
    '.ml-item.ml-ativo{background:#1a1a1a;color:#fff}' +
    '.ml-ini{flex:none;display:none;width:28px;height:28px;border-radius:50%;border:1.5px solid currentColor;align-items:center;justify-content:center;font-size:13px;font-weight:700}' +
    '.ml-txt{flex:1 1 auto;min-width:0}' +
    '.ml-badge{flex:none;min-width:22px;padding:1px 7px;border-radius:999px;background:rgba(26,26,26,.12);font-size:12px;font-weight:700;text-align:center}' +
    '.ml-ativo .ml-badge{background:rgba(255,255,255,.25)}' +
    '.ml-rodape{margin-top:10px;padding-top:12px;border-top:1px solid rgba(26,26,26,.22);display:flex;flex-direction:column;gap:8px}' +
    '.ml-user{padding:0 8px;font-size:13px;color:#5c5247}.ml-user b{display:block;color:#1a1a1a;font-size:14px}' +
    '.ml-portal{display:flex;align-items:center;justify-content:center;gap:6px;min-height:42px;border-radius:999px;background:#1a1a1a;color:#fff;font-weight:600;font-size:14px;text-decoration:none}' +
    '.ml-portal:hover{background:#000}' +
    '.ml-sair{min-height:40px;border:1px solid rgba(26,26,26,.22);border-radius:999px;background:#fff;color:#1a1a1a;font:inherit;font-size:14px;font-weight:600;cursor:pointer}.ml-sair:hover{background:#f6f2ea}' +
    'body.ml-on #authStatus{display:none!important}' +
    'body.ml-compacto .ml-sair{font-size:0;min-height:40px}body.ml-compacto .ml-sair::before{content:"⏻";font-size:16px}' +
    '.ml-rec{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:8px 12px;border:0;border-radius:10px;background:transparent;color:#5c5247;font:inherit;font-size:14px;font-weight:600;cursor:pointer}' +
    '.ml-rec:hover{background:rgba(26,26,26,.06);color:#1a1a1a}' +
    '.ml-rec::before{content:"«  Recolher menu";white-space:pre}' +
    '.ml-btn{display:none;position:fixed;left:12px;top:12px;z-index:29;min-height:40px;padding:8px 16px;border:1px solid rgba(26,26,26,.22);border-radius:999px;background:#fff;color:#1a1a1a;font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}' +
    '.ml-fundo{display:none;position:fixed;inset:0;z-index:29;background:rgba(26,26,26,.45)}' +
    '.ml-side button:focus-visible,.ml-side a:focus-visible,.ml-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(26,26,26,.25)}' +
    'body.ml-compacto .ml-side{width:76px;padding:16px 10px 12px}' +
    'body.ml-compacto .ml-nome,body.ml-compacto .ml-txt,body.ml-compacto .ml-badge,body.ml-compacto .ml-user{display:none}' +
    'body.ml-compacto .ml-topo{justify-content:center;padding:0 0 12px}' +
    'body.ml-compacto .ml-item{justify-content:center;padding:8px 0}' +
    'body.ml-compacto .ml-ini{display:flex}' +
    'body.ml-compacto .ml-rec{justify-content:center;padding:8px 0}' +
    'body.ml-compacto .ml-rec::before{content:"»";font-size:18px}' +
    'body.ml-compacto .ml-portal{font-size:0;min-height:42px}body.ml-compacto .ml-portal::before{content:"‹";font-size:20px}' +
    '@media (max-width:1099px){' +
    'body.ml-on,body.ml-on.ml-compacto{padding-left:0!important}' +
    '.ml-side,body.ml-compacto .ml-side{width:min(320px,88vw);left:0;top:0;bottom:0;border-radius:0 16px 16px 0;padding:18px 14px 14px;transform:translateX(-105%);transition:transform .18s ease-out;box-shadow:0 10px 40px rgba(0,0,0,.3)}' +
    'body.ml-gaveta .ml-side{transform:none}body.ml-gaveta .ml-fundo{display:block}' +
    '.ml-btn{display:inline-flex;align-items:center}' +
    '.ml-rec{display:none}' +
    'body.ml-compacto .ml-nome,body.ml-compacto .ml-txt,body.ml-compacto .ml-user{display:block}body.ml-compacto .ml-badge{display:inline-block}body.ml-compacto .ml-ini{display:none}' +
    'body.ml-compacto .ml-item{justify-content:flex-start;padding:10px 12px}body.ml-compacto .ml-topo{justify-content:flex-start}' +
    'body.ml-compacto .ml-portal{font-size:14px}body.ml-compacto .ml-portal::before{content:none}' +
    'body.ml-on{padding-top:56px!important}' +
    '}' +
    '@media (prefers-reduced-motion:reduce){.ml-side{transition:none}}' +
    '@media print{.ml-side,.ml-btn,.ml-fundo{display:none!important}body.ml-on,body.ml-on.ml-compacto{padding:0!important}}';

  var side, lista, cont, obs, pendente = false, ultimaAssin = '';

  function cabecalho() {
    var m = null, el = document.querySelector('.app-logo');
    if (el) { var cs = getComputedStyle(el); m = cs.webkitMaskImage && cs.webkitMaskImage !== 'none' ? cs.webkitMaskImage : (cs.maskImage !== 'none' ? cs.maskImage : null); }
    return m;
  }

  function lerItens() {
    if (!cont) return [{ txt: cfg.nome, ativo: true, el: null }];
    var out = [];
    Array.prototype.forEach.call(cont.children, function (c) {
      if (c.hidden || c.getAttribute('hidden') !== null) return;
      var cs = getComputedStyle(c);
      if (c.style.display === 'none') return;
      var b = c.querySelector('[class*=badge],[class*=count],[id*=Badge],.n,.c');
      var cl = c.cloneNode(true);
      Array.prototype.forEach.call(cl.querySelectorAll('[class*=badge],[class*=count],[id*=Badge],.n,.c'), function (x) { x.remove(); });
      var txt = (cl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      var bt = b && !b.hidden && b.getAttribute('hidden') === null ? (b.textContent || '').trim() : '';
      var ativo = c.classList.contains('active') || c.getAttribute('aria-selected') === 'true' || c.getAttribute('aria-current') === 'page' || c.classList.contains('on') || c.classList.contains('sel');
      out.push({ txt: txt, tit: c.getAttribute('title') || '', badge: bt, ativo: ativo, el: c });
    });
    return out;
  }

  function sincronizar() {
    var vis = !cont.classList.contains('hidden');                // só depois de iniciar sessão
    document.body.classList.toggle('ml-on', vis);
    side.style.display = vis ? '' : 'none';
    var em = document.getElementById('authEmail'), alvo = side.querySelector('#ml-email');
    if (alvo && em) alvo.textContent = em.textContent;
  }
  function desenhar() {
    pendente = false;
    sincronizar();
    var itens = lerItens();
    var assin = itens.map(function (i) { return i.txt + '|' + i.badge + '|' + (i.ativo ? 1 : 0); }).join('#');
    if (assin === ultimaAssin) return;
    ultimaAssin = assin;
    lista.innerHTML = '';
    itens.forEach(function (i) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'ml-item' + (i.ativo ? ' ml-ativo' : '');
      b.title = i.tit || i.txt;
      if (i.ativo) b.setAttribute('aria-current', 'page');
      b.innerHTML = '<span class="ml-ini" aria-hidden="true">' + esc(i.txt.charAt(0).toUpperCase()) + '</span><span class="ml-txt">' + esc(i.txt) + '</span>' + (i.badge ? '<span class="ml-badge">' + esc(i.badge) + '</span>' : '');
      b.addEventListener('click', function () {
        if (i.el) i.el.click();
        if (!LARGO()) gaveta(false);
        agendar();
      });
      li.appendChild(b); lista.appendChild(li);
    });
  }
  function agendar() { if (pendente) return; pendente = true; requestAnimationFrame(desenhar); }

  function gaveta(abrir) {
    document.body.classList.toggle('ml-gaveta', abrir);
    var f = document.querySelector('.ml-fundo'); if (f) f.style.display = abrir ? 'block' : '';
  }

  function montar() {
    var st = document.createElement('style'); st.id = 'ml-css'; st.textContent = CSS; document.head.appendChild(st);
    var mask = cabecalho();
    side = document.createElement('aside');
    side.className = 'ml-side'; side.setAttribute('aria-label', 'Menu da aplicação');
    side.innerHTML =
      '<div class="ml-topo">' + (mask ? '<div class="ml-logo" role="img" aria-label="Sourcetextile"></div>' : '') + '<span class="ml-nome">' + esc(cfg.nome) + '</span></div>' +
      '<nav aria-label="Secções"><ul class="ml-lista"></ul></nav>' +
      '<div class="ml-rodape"><button type="button" class="ml-rec" aria-label="Recolher ou expandir o menu" title="Recolher ou expandir o menu"></button>' +
      '<div class="ml-user"><b id="ml-email"></b></div><button type="button" class="ml-sair">Sair</button>' +
      (eu.portal ? '<a class="ml-portal" href="' + esc(eu.portal) + '" title="Voltar ao Portal da Source">‹ Voltar ao Portal</a>' : '') + '</div>';
    document.body.appendChild(side);
    if (mask) { var lg = side.querySelector('.ml-logo'); lg.style.webkitMaskImage = mask; lg.style.maskImage = mask; }
    lista = side.querySelector('.ml-lista');
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ml-btn'; btn.textContent = 'Menu'; btn.setAttribute('aria-label', 'Abrir o menu');
    var fundo = document.createElement('div'); fundo.className = 'ml-fundo';
    document.body.appendChild(btn); document.body.appendChild(fundo);
    btn.addEventListener('click', function () { gaveta(true); });
    fundo.addEventListener('click', function () { gaveta(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') gaveta(false); });
    side.querySelector('.ml-rec').addEventListener('click', function () {
      var c = !document.body.classList.contains('ml-compacto');
      document.body.classList.toggle('ml-compacto', c); ls('ml.compacto', c ? '1' : '0');
    });
    document.body.classList.toggle('ml-compacto', ls('ml.compacto') === '1');
    side.querySelector('.ml-sair').addEventListener('click', function () { var s = document.getElementById('signOutButton'); if (s) s.click(); });
    var ae = document.getElementById('authEmail'); if (ae) new MutationObserver(agendar).observe(ae, { childList: true, characterData: true, subtree: true });
    if (cont) {
      cont.style.display = 'none';
      var bar = cont.parentElement;
      if (bar && bar.classList.contains('tabs-bar') && bar.children.length === 1) bar.style.display = 'none';
      obs = new MutationObserver(agendar);
      obs.observe(cont, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    desenhar();
  }

  function arrancar(tent) {
    cont = null;
    if (cfg.cont) {
      cont = document.querySelector(cfg.cont);
      if (!cont || !lerItens().length) {
        if (tent < 40) return setTimeout(function () { arrancar(tent + 1); }, 250);   // a app pode construir os separadores depois de carregar
        return falhou();
      }
    }
    try { montar(); } catch (e) { try { document.body.classList.remove('ml-on'); if (cont) cont.style.display = ''; if (side) side.remove(); } catch (e2) {} falhou(); }
  }
  if (document.body) arrancar(0); else document.addEventListener('DOMContentLoaded', function () { arrancar(0); });
})();
