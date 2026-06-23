import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { Connect } from "vite";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

function htmlRewrite() {
  const middleware: Connect.NextHandleFunction = (req, _res, next) => {
    const url = req.url ?? "";
    const urlPath = url.split("?")[0].split("#")[0];
    const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    if (urlPath === "/tr" || urlPath.startsWith("/tr/")) {
      req.url = "/tr.html" + qs;
    } else if (urlPath === "/en" || urlPath.startsWith("/en/")) {
      req.url = "/en.html" + qs;
    } else if (urlPath === "/daily") {
      req.url = "/daily.html" + qs;
    } else if (urlPath === "/solo") {
      req.url = "/solo.html" + qs;
    } else if (urlPath === "/room/create") {
      req.url = "/room-create.html" + qs;
    } else if (urlPath === "/room/join") {
      req.url = "/room-join.html" + qs;
    }
    next();
  };
  return {
    name: "html-rewrite",
    configureServer(server: { middlewares: { use: (fn: Connect.NextHandleFunction) => void } }) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: Connect.NextHandleFunction) => void } }) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    htmlRewrite(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        en: path.resolve(import.meta.dirname, "en.html"),
        tr: path.resolve(import.meta.dirname, "tr.html"),
        daily: path.resolve(import.meta.dirname, "daily.html"),
        solo: path.resolve(import.meta.dirname, "solo.html"),
        "room-create": path.resolve(import.meta.dirname, "room-create.html"),
        "room-join": path.resolve(import.meta.dirname, "room-join.html"),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
