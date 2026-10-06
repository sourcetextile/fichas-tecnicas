// Edge Function "enviar-email": recebe o pedido que a base de dados faz em
// pedidos_preco_sourcetextile_enviar_email() e envia o email pelo servidor SMTP
// da empresa.
//
//   POST  Authorization: Bearer <ENVIO_SEGREDO>
//   corpo {"to": "...", "subject": "...", "text": "..."}
//
// Tem de ser publicada SEM verificação de JWT (o segredo não é um JWT do
// Supabase; é verificado aqui dentro). Segredos da função (Edge Functions ->
// Secrets): ENVIO_SEGREDO, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM e, opcionalmente, DOMINIOS_PERMITIDOS.
//
// O porto tem de ser 465 (TLS direto): o Supabase bloqueia 25 e 587 nas
// Edge Functions.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SEGREDO = Deno.env.get("ENVIO_SEGREDO") ?? "";
const DOMINIOS = (Deno.env.get("DOMINIOS_PERMITIDOS") ?? "sourcetextile.pt,kaizen.com")
  .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

function resposta(status: number, mensagem: string) {
  return new Response(JSON.stringify({ ok: status === 200, mensagem }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta(405, "Método não permitido");

  // Sem segredo configurado a função recusa tudo, em vez de ficar aberta.
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!SEGREDO || !iguais(autorizacao, `Bearer ${SEGREDO}`)) {
    return resposta(401, "Não autorizado");
  }

  let corpo: { to?: unknown; subject?: unknown; text?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, "JSON inválido");
  }
  const { to, subject, text } = corpo ?? {};
  if (typeof to !== "string" || typeof subject !== "string" || typeof text !== "string" ||
      !to.trim() || !subject.trim() || !text.trim()) {
    return resposta(400, "Faltam to, subject ou text");
  }

  // Só envia para endereços dos domínios com acesso à aplicação.
  const destino = to.trim();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+$/.test(destino) ||
      !DOMINIOS.includes(destino.split("@")[1].toLowerCase())) {
    return resposta(400, "Destinatário não permitido");
  }

  const cliente = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST") ?? "",
      port: Number(Deno.env.get("SMTP_PORT") ?? "465"),
      tls: true,
      auth: {
        username: Deno.env.get("SMTP_USER") ?? "",
        password: Deno.env.get("SMTP_PASS") ?? "",
      },
    },
  });

  try {
    await cliente.send({
      from: Deno.env.get("SMTP_FROM") ?? "",
      to: destino,
      subject,
      content: text,
    });
    return resposta(200, "enviado");
  } catch (erro) {
    console.error("Falha SMTP:", erro);
    return resposta(502, "Falha no envio SMTP");
  } finally {
    try { await cliente.close(); } catch { /* já fechado */ }
  }
});
