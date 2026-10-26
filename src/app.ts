import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { bootstrapData } from "./config/bootstrap";
import { dbConnect } from "./config/mongo";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { sendAlert } from "./services/email.service";

// Lo que escapa a Express (una promesa sin await, un timer que revienta) no
// pasa por el manejador de errores: sin esto se perdía en los logs.
process.on("unhandledRejection", (reason) => {
  console.error("Promesa rechazada sin manejar", reason);
  void sendAlert("Promesa rechazada sin manejar", String((reason as Error)?.stack || reason)).catch(() => {});
});
process.on("uncaughtException", (error) => {
  console.error("Excepción no capturada", error);
  void sendAlert("Excepción no capturada", String(error.stack || error)).catch(() => {});
});

const localOrigins = [
  "http://localhost:8100",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8101",
];

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const whitelist = [...localOrigins, ...configuredOrigins];

const allowVercelPreviews = process.env.CORS_ALLOW_VERCEL_PREVIEWS !== "false";
const vercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || whitelist.includes(origin) || (allowVercelPreviews && vercelPreview.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  // Vercel pone la IP real del cliente en x-forwarded-for (y la sobrescribe,
  // no se puede falsear desde fuera): sin esto req.ip sería la del proxy y el
  // freno de intentos de acceso bloquearía a todos a la vez.
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.get("/", (_req, res) => {
    res.json({ message: "Off The Record backend is alive" });
  });

  routerApi(app);

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}

const serverlessApp = createApp().app;
let initialization: Promise<void> | undefined;

export default async function serverlessHandler(
  req: express.Request,
  res: express.Response,
) {
  initialization ||= (async () => {
    await dbConnect();
    await bootstrapData();
  })();

  try {
    await initialization;
  } catch (error) {
    // Si Atlas no responde, la próxima petición debe reintentar, no heredar el fallo.
    initialization = undefined;
    console.error("No se pudo iniciar el backend", error);
    void sendAlert("El backend no pudo arrancar", String((error as Error).stack || error)).catch(() => {});
    res.status(503).json({ message: "Servicio no disponible, intenta en un momento" });
    return;
  }
  return serverlessApp(req, res);
}
