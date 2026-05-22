import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.js";
import { getModelName, getGeminiKeyCount } from "./aiAnalysis.js";
import { getGoogleKeyCount } from "./googleSearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 8080;

async function start() {
  const app = createApp();

  if (!isProd) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(root, "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  console.log(
    `Loaded ${getGoogleKeyCount()} Google key pair(s), ${getGeminiKeyCount()} Gemma key(s), model=${getModelName()}`
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`OSINT Investigator running at http://localhost:${PORT}`);
    console.log(`AI Model: ${getModelName()}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
