#!/usr/bin/env node
import express from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnvFile,
  createOpenAIClient,
  guessNameFromLinkedIn,
  generateCoverLetter,
  refineCoverLetter,
} from "./lib/openai-letter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PROFILE_PATH = join(ROOT, "profile.txt");

loadEnvFile(ROOT);

const app = express();
const PORT = Number(process.env.COVER_LETTER_PORT || 3847);

app.use(express.json({ limit: "800kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/profile", (_req, res) => {
  if (!existsSync(PROFILE_PATH)) {
    return res.json({ profile: "" });
  }
  try {
    res.json({ profile: readFileSync(PROFILE_PATH, "utf8") });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/profile", (req, res) => {
  const { profile } = req.body || {};
  if (typeof profile !== "string") {
    return res.status(400).json({ error: "profile must be a string" });
  }
  try {
    writeFileSync(PROFILE_PATH, profile, "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const {
      profile,
      jobDescription,
      jobListingUrl,
      jobWebsiteUrl,
      managerUrl,
    } = req.body || {};

    if (typeof profile !== "string" || !profile.trim()) {
      return res.status(400).json({ error: "profile is required" });
    }

    const openai = createOpenAIClient();
    const managerNameGuess = managerUrl
      ? guessNameFromLinkedIn(managerUrl)
      : null;

    const letter = await generateCoverLetter(openai, {
      profile: profile.trim(),
      jobDescription: String(jobDescription || "").trim(),
      jobListingUrl: String(jobListingUrl || "").trim(),
      jobWebsiteUrl: String(jobWebsiteUrl || "").trim(),
      managerUrl: String(managerUrl || "").trim(),
      managerNameGuess,
    });

    res.json({ letter });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const {
      profile,
      jobDescription,
      jobListingUrl,
      jobWebsiteUrl,
      managerUrl,
      currentLetter,
      chatHistory,
      userMessage,
    } = req.body || {};

    if (typeof profile !== "string" || !profile.trim()) {
      return res.status(400).json({ error: "profile is required" });
    }
    if (typeof currentLetter !== "string") {
      return res.status(400).json({ error: "currentLetter is required" });
    }
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return res.status(400).json({ error: "userMessage is required" });
    }

    const openai = createOpenAIClient();
    const out = await refineCoverLetter(openai, {
      profile: profile.trim(),
      jobDescription: String(jobDescription || "").trim(),
      jobListingUrl: String(jobListingUrl || "").trim(),
      jobWebsiteUrl: String(jobWebsiteUrl || "").trim(),
      managerUrl: String(managerUrl || "").trim(),
      currentLetter,
      chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
      userMessage: userMessage.trim(),
    });

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const uiDist = join(ROOT, "ui", "dist");
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api")) return next();
    res.sendFile(join(uiDist, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  const hasUi = existsSync(uiDist);
  console.error(
    hasUi
      ? `Cover letter http://localhost:${PORT} (UI + API)`
      : `API http://localhost:${PORT} — run npm run build:ui for static UI, or npm run dev for Vite on 5173`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use (another server.mjs or app). Either:\n` +
        `  kill it:  lsof -i :${PORT}   then   kill <PID>\n` +
        `  or use a different port:  COVER_LETTER_PORT=3848 npm run dev\n` +
        `  (if you change the port, set the same COVER_LETTER_PORT in automation/cover-letter/.env so Vite’s proxy matches.)`
    );
    process.exit(1);
  }
  throw err;
});
