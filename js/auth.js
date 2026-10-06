// Login por magic-link / OTP (Supabase self-hosted da Kaizen) — só usado no
// build hospedado (app/build-hosted.js). O build portátil nunca carrega este
// ficheiro, por isso window.Auth simplesmente não existe aí.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// URL, chave e lista de acessos vivem em app/js/config.js — o unico
// ficheiro a mexer na migracao para o Supabase do cliente.
const TABLE = window.AppConfig.tabelas.fichas;

const supabase = createClient(
  window.AppConfig.supabaseUrl,
  window.AppConfig.publishableKey);

const isAllowed = email => window.AppConfig.temAcesso(email);

const loginScreen = document.getElementById('loginScreen');
const selectionScreen = document.getElementById('selectionScreen');
const authStatus = document.getElementById('authStatus');
const authEmail = document.getElementById('authEmail');
const loginStepEmail = document.getElementById('loginStepEmail');
const loginStepCode = document.getElementById('loginStepCode');
const loginEmailInput = document.getElementById('loginEmail');
const loginCodeInput = document.getElementById('loginCode');
const loginStatus = document.getElementById('loginStatus');
const loginSendButton = document.getElementById('loginSendButton');
const loginVerifyButton = document.getElementById('loginVerifyButton');
const loginBackButton = document.getElementById('loginBackButton');
const signOutButton = document.getElementById('signOutButton');

let pendingEmail = '';

function setStatus(message) {
  loginStatus.textContent = message || '';
}

function showCodeStep() {
  loginStepEmail.classList.add('hidden');
  loginStepCode.classList.remove('hidden');
  loginCodeInput.focus();
}

function showEmailStep() {
  loginStepCode.classList.add('hidden');
  loginStepEmail.classList.remove('hidden');
  loginCodeInput.value = '';
  setStatus('');
}

async function sendCode() {
  const email = loginEmailInput.value.trim();
  if (!email) {
    setStatus('Introduz um email.');
    return;
  }
  if (!isAllowed(email)) {
    setStatus('Este email não tem acesso a esta aplicação.');
    return;
  }
  loginSendButton.disabled = true;
  setStatus('A enviar código...');
  const { error } = await supabase.auth.signInWithOtp({ email });
  loginSendButton.disabled = false;
  if (error) {
    setStatus('Não foi possível enviar o código: ' + error.message);
    return;
  }
  pendingEmail = email;
  setStatus(`Código enviado para ${email}.`);
  showCodeStep();
}

async function verifyCode() {
  const code = loginCodeInput.value.trim();
  if (!code) {
    setStatus('Introduz o código recebido por email.');
    return;
  }
  loginVerifyButton.disabled = true;
  setStatus('A confirmar...');
  const { data, error } = await supabase.auth.verifyOtp({
    email: pendingEmail,
    token: code,
    type: 'email'
  });
  loginVerifyButton.disabled = false;
  if (error) {
    setStatus('Código inválido: ' + error.message);
    return;
  }
  const signedIn = await onSignedIn(data.session);
  // Ao contrário do arranque (App.init() → Auth.gate() → afterAuth()), este
  // login interativo acontece depois de App.init() já ter terminado (voltou
  // cedo por não haver sessão), por isso é preciso chamar afterAuth() aqui.
  if (signedIn && window.App) window.App.afterAuth();
}

async function onSignedIn(session) {
  const email = session && session.user && session.user.email;
  if (!isAllowed(email)) {
    setStatus('Este email não tem acesso a esta aplicação.');
    await supabase.auth.signOut();
    return false;
  }
  Storage.init(supabase, TABLE);
  window.Auth.email = email;
  authEmail.textContent = email;
  authStatus.classList.remove('hidden');
  loginScreen.classList.add('hidden');
  selectionScreen.classList.remove('hidden');
  // Barra de secções (Ficha técnica / Fichas de decoração) — este é o único
  // ponto por onde passam os dois caminhos de entrada (sessão já existente e
  // login interativo), por isso é aqui que tem de ser revelada.
  const appTabs = document.getElementById('appTabs');
  if (appTabs) appTabs.classList.remove('hidden');
  return true;
}

loginSendButton.addEventListener('click', sendCode);
loginVerifyButton.addEventListener('click', verifyCode);
loginBackButton.addEventListener('click', showEmailStep);
loginEmailInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') sendCode();
});
loginCodeInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') verifyCode();
});
signOutButton.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

window.Auth = {
  // Cliente autenticado partilhado — usado por outras secções (ex.: Fichas de
  // decoração) para aceder a outras tabelas/Storage sem duplicar login.
  client: supabase,

  // Chamado por App.init(): resolve true se já há sessão válida e permitida
  // (mostra logo o ecrã principal), false se for preciso mostrar o login.
  async gate() {
    const { data } = await supabase.auth.getSession();
    const session = data && data.session;
    if (session && isAllowed(session.user && session.user.email)) {
      return onSignedIn(session);
    }
    if (session) await supabase.auth.signOut();
    loginScreen.classList.remove('hidden');
    return false;
  }
};
