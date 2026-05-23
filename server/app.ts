import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { initGoogleKeys } from "./googleSearch.js";
import { initGeminiKeys } from "./aiAnalysis.js";
import { progressStore, runOsintWithProgress } from "./osintService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const CLEANUP_AFTER_SECONDS = 600;
let initialized = false;

function initializeServices(): void {
  if (initialized) return;
  initGoogleKeys(
    (process.env.GOOGLE_API_KEYS || "").split(","),
    (process.env.GOOGLE_CSE_IDS || "").split(",")
  );
  initGeminiKeys(
    (process.env.GEMINI_API_KEYS || "").split(","),
    process.env.GEMMA_MODEL || "gemma-4-31b-it"
  );
  initialized = true;
}

export function createApp(): express.Application {
  initializeServices();

  const app = express();
  const api = express.Router();

  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "2mb" }));

  setInterval(() => {
    const now = Date.now();
    for (const [sid, data] of Object.entries(progressStore)) {
      if (
        (data.status === "completed" || data.status === "error") &&
        data._finishedAt &&
        now - data._finishedAt > CLEANUP_AFTER_SECONDS * 1000
      ) {
        delete progressStore[sid];
        console.log(`Cleaned up stale search: ${sid}`);
      }
    }
  }, 60_000);

  api.get("/", (_req, res) => {
    res.json({
      status: "online",
      service: "OSINT Investigator API",
      version: "3.0",
    });
  });

  api.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  api.post("/osint", (req, res) => {
    const data = req.body;
    if (!data) {
      res.status(400).json({ error: "Request body must be JSON." });
      return;
    }

    const name = String(data.name || "").trim();
    const city = String(data.city || "").trim();
    const extrasRaw = String(data.extraTerms || "").trim();
    const extras = extrasRaw.split(",").map((e: string) => e.trim()).filter(Boolean);
    const deepSearch = data.deepSearch !== false;

    if (!name) {
      res.status(400).json({ error: "Name is a required field." });
      return;
    }

    if (name.length > 200) {
      res.status(400).json({ error: "Name is too long (max 200 characters)." });
      return;
    }

    const active = Object.values(progressStore).filter((v) => v.status === "running").length;
    if (active >= 5) {
      res.status(429).json({ error: "Too many concurrent searches. Please wait and try again." });
      return;
    }

    const safeName = name.replace(/\s+/g, "_").slice(0, 30);
    const searchId = `${safeName}_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;

    progressStore[searchId] = {
      percentage: 0,
      stage: "Initializing...",
      status: "running",
      _startedAt: Date.now(),
    };

    (async () => {
      try {
        console.log(`Search started: ${searchId}`);
        const result = await runOsintWithProgress(name, city, extras, searchId, deepSearch);
        progressStore[searchId] = {
          ...progressStore[searchId],
          percentage: 100,
          stage: "Search complete!",
          status: "completed",
          result,
          _finishedAt: Date.now(),
        };
        const elapsed = (Date.now() - (progressStore[searchId]._startedAt || Date.now())) / 1000;
        console.log(`Search completed: ${searchId} (${elapsed.toFixed(1)}s)`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        progressStore[searchId] = {
          ...progressStore[searchId],
          status: "error",
          error: errorMsg,
          stage: "Search failed",
          _finishedAt: Date.now(),
        };
        console.error(`Search failed: ${searchId} — ${errorMsg}`);
      }
    })();

    res.json({
      searchId,
      message: `Search initiated for '${name}'. Poll /api/progress/${searchId} for updates.`,
    });
  });

  api.get("/progress/:searchId", (req, res) => {
    const progress = progressStore[req.params.searchId];
    if (!progress) {
      res.status(404).json({ error: "Search ID not found. It may have expired." });
      return;
    }

    const response: Record<string, unknown> = {
      percentage: progress.percentage,
      stage: progress.stage,
      status: progress.status,
    };

    if (progress.status === "completed" && progress.result) {
      response.result = progress.result;
    } else if (progress.status === "error") {
      response.error = progress.error || "Unknown error";
    }

    res.json(response);
  });

  api.post("/generate-report", (req, res) => {
    const data = req.body;
    if (!data) {
      res.status(400).json({ error: "Request body must be JSON." });
      return;
    }

    const personData = data.personData;
    if (!personData) {
      res.status(400).json({ error: "Missing personData in request body." });
      return;
    }

    try {
      const reportsDir = path.join(process.cwd(), "reports");
      fs.mkdirSync(reportsDir, { recursive: true });

      const nameSlug = String(personData.name || "person").replace(/\s+/g, "_").slice(0, 30);
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      const filename = `${nameSlug}_report_${timestamp}.json`;
      const filepath = path.join(reportsDir, filename);

      const report = {
        reportMeta: {
          generatedAt: new Date().toISOString(),
          toolVersion: "3.0",
          subject: personData.name || "Unknown",
          location: personData.location || "",
        },
        executiveSummary: personData.short_summary,
        detailedAnalysis: personData.detailed_summary,
        riskAssessment: personData.riskAnalysis,
        keyFindings: personData.keyFindings,
        associatedEntities: personData.associatedEntities,
        profileInformation: personData.profileInfo,
        entityRelationships: personData.entityAnalysis,
        sourceBreakdown: personData.sourceAnalysis,
        timeline: personData.timelineEvents,
        sources: personData.raw_data?.map(({ title, snippet, link, source, displayLink }: {
          title: string;
          snippet: string;
          link: string;
          source: string;
          displayLink?: string;
        }) => ({ title, snippet, link, source, displayLink })),
      };

      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
      console.log(`Report generated: ${filepath}`);

      res.json({
        reportPath: filepath,
        filename,
        message: "Report generated successfully.",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Report generation failed: ${msg}`);
      res.status(500).json({ error: `Failed to generate report: ${msg}` });
    }
  });

  api.get("/download-report/:filename", (req, res) => {
    const filepath = path.join(process.cwd(), "reports", req.params.filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "Report file not found." });
      return;
    }
    res.download(filepath, req.params.filename);
  });

  app.use("/api", api);
  return app;
}

export default createApp();
