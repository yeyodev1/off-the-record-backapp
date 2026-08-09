import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { bootstrapData } from "./config/bootstrap";
import { dbConnect } from "./config/mongo";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";

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

  await initialization;
  return serverlessApp(req, res);
}
