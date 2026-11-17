import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

if (!process.env["SESSION_SECRET"]) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const app: Express = express();

app.set("trust proxy", 1);

const isProduction = process.env["NODE_ENV"] === "production";

// Comma-separated list of site origins allowed to call the API / open the
// WebSocket, e.g. "https://categoriends.com,https://www.categoriends.com".
// When unset (local dev), every origin is allowed.
export const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function isOriginAllowed(origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return true; // same-origin / non-browser requests
  return allowedOrigins.includes(origin.replace(/\/+$/, ""));
}

export const sessionMiddleware = session({
  secret: process.env["SESSION_SECRET"],
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // The site (Vercel) and the game server (Railway) are on different
    // subdomains, so the cookie is scoped to the parent domain, e.g.
    // ".categoriends.com", to reach both the /api proxy and the WebSocket.
    domain: process.env["COOKIE_DOMAIN"] || undefined,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
