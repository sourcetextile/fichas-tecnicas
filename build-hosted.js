// Constrói a versão hospedada (com login + Supabase partilhado) como um
// único index.html self-contained, em app/dist-hosted/.
//
// Nunca mexe em template.html/build.js — o ficheiro portátil
// "Ficha técnica do produto.html" continua a ser gerado à parte, sem
// depender deste script.
const fs = require('fs');
const path = require('path');

const appDir = __dirname;
const outDir = path.join(appDir, 'dist-hosted');
const OUT = path.join(outDir, 'index.html');

const readApp = rel => fs.readFileSync(path.join(appDir, rel), 'utf8');

let html = fs.readFileSync(path.join(appDir, 'template.hosted.html'), 'utf8');

// CSS → <style>
html = html.replace(
  /<link rel="stylesheet" href="app\/([^"]+)">/g,
  (_match, href) => `<style>\n${readApp(href)}\n</style>`
);

// <script src="..."></script> clássico → <script> com o conteúdo embutido
html = html.replace(
  /<script src="app\/([^"]+)"><\/script>/g,
  (_match, src) => `<script>\n${readApp(src)}\n</script>`
);

// <script type="module" src="..."></script> → <script type="module"> com o conteúdo embutido
html = html.replace(
  /<script type="module" src="app\/([^"]+)"><\/script>/g,
  (_match, src) => `<script type="module">\n${readApp(src)}\n</script>`
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`build ok → ${OUT}`);
