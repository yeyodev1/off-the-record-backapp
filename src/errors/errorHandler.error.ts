import { Request, Response } from "express";
import axios from "axios";
import { sendAlert } from "../services/email.service";
import { CustomError } from "./customError.error";

export class ErrorHandler {
  private slackWebhookUrl: string;

  constructor(slackWebhookUrl: string) {
    this.slackWebhookUrl = slackWebhookUrl;
  }

  handleHttpError(res: Response, message: string, status: number, error: any, req?: Request) {
    console.error(`[${status}] ${message}`, error.details || error.stack || "");

    if (status >= 500) {
      if (this.slackWebhookUrl) this.notifySlack(message, status, error).catch(() => {});

      const ruta = req ? `${req.method} ${req.originalUrl.split("?")[0]}` : "";
      sendAlert(`Error ${status}${ruta ? ` en ${ruta}` : ""}: ${message}`.slice(0, 160), String(error.stack || error.details || message)).catch(
        () => {},
      );
    }

    // Un fallo inesperado no debe filtrar detalles internos (Mongo, rutas) al
    // cliente; los errores propios de la app sí llevan un mensaje pensado para él.
    const propio = error instanceof CustomError;
    res.status(status).json({ message: status >= 500 && !propio ? "Error interno del servidor" : message });
  }

  private async notifySlack(message: string, status: number, error: any) {
    await axios.post(this.slackWebhookUrl, {
      text: `:rotating_light: *Error ${status}*\n>${message}\n\`\`\`${JSON.stringify(error.details || error.stack || "", null, 2)}\`\`\``,
    });
  }
}
