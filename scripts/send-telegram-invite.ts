/**
 * Correo con la guía para conectar Telegram (≈5 minutos).
 *
 *   bun scripts/send-telegram-invite.ts --to persona@correo.com   ← prueba a una sola dirección
 *   bun scripts/send-telegram-invite.ts                            ← simulacro: cuenta destinatarios
 *   bun scripts/send-telegram-invite.ts --all                      ← envío real a lectores activos sin Telegram
 */
import "dotenv/config";
import mongoose from "mongoose";
import { UserModel } from "../src/models/user.model";
import { renderEmail, sendEmailBatch } from "../src/services/email.service";

const READER_ROLE_ID = 2;
const appUrl = (process.env.PUBLIC_APP_URL || "https://app.otr.com.ec").replace(/\/+$/, "");
const toIndex = process.argv.indexOf("--to");
const TO = toIndex > -1 ? String(process.argv[toIndex + 1] || "").trim().toLowerCase() : "";
const ALL = process.argv.includes("--all");

export function inviteEmail() {
  const subject = "Recibe las noticias de Off The Record en Telegram";
  const { html, text } = renderEmail({
    eyebrow: "Nuevo · toma 5 minutos",
    title: subject,
    body: [
      "Desde ahora puedes recibir cada reportaje y actualización de Off The Record directamente en tu Telegram, en cuanto se publica.",
      "Cómo conectarlo (unos 5 minutos):",
      "1. Instala Telegram en tu celular (App Store o Google Play) y crea tu cuenta si aún no la tienes.\n" +
        `2. Entra a ${appUrl.replace(/^https?:\/\//, "")} con tu correo y tu contraseña.\n` +
        "3. Ve a Ajustes (tu nombre, arriba a la derecha) o pulsa el botón de abajo.\n" +
        "4. En «Noticias en Telegram», pulsa «Conectar Telegram».\n" +
        "5. Se abrirá el bot @otr_ec_bot: pulsa «Iniciar». Te llegará un mensaje confirmando que quedaste conectado.",
      "Si en algún momento quieres dejar de recibirlas, escribe /stop al bot o desconéctalo desde Ajustes. Ahí mismo puedes activar o desactivar las noticias por correo y agregar un correo adicional.",
    ].join("\n\n"),
    ctaLabel: "Conectar Telegram",
    ctaUrl: `${appUrl}/lector/ajustes`,
  });
  return { subject, html, text };
}

async function main() {
  const { subject, html, text } = inviteEmail();

  if (TO) {
    const [result] = await sendEmailBatch([{ to: TO, subject, html, text }]);
    console.log(result.ok ? `Enviado a ${TO}` : `No se pudo enviar a ${TO}: ${result.error}`);
    return;
  }

  await mongoose.connect(process.env.DB_URI as string);
  const users = await UserModel.find({ active: true, roleId: READER_ROLE_ID, telegramChatId: { $in: ["", null] } }).select("email");
  const emails = [...new Set(users.map((user) => String(user.email || "").toLowerCase()).filter(Boolean))];
  console.log(`Lectores activos sin Telegram: ${emails.length}`);

  if (!ALL) {
    console.log("Simulacro: no se envió nada. Repite con --all para enviar.");
  } else {
    const results = await sendEmailBatch(emails.map((to) => ({ to, subject, html, text })));
    const failed = results.filter((result) => !result.ok);
    console.log(`Enviados: ${results.length - failed.length} · fallidos: ${failed.length}`);
    for (const result of failed.slice(0, 10)) console.log(`  ${result.to}: ${result.error}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Falló:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
