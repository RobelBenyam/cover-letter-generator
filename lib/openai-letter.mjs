import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export function loadEnvFile(rootDir = ROOT) {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

export function guessNameFromLinkedIn(url) {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("linkedin.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("in");
    if (idx === -1 || !parts[idx + 1]) return null;
    const slug = parts[idx + 1];
    const tokens = slug.split("-").filter((t) => t && !/^\d+$/.test(t));
    while (
      tokens.length > 2 &&
      /^[a-z0-9]{5,}$/i.test(tokens[tokens.length - 1])
    ) {
      tokens.pop();
    }
    if (tokens.length < 2) return null;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return tokens.map(cap).join(" ");
  } catch {
    return null;
  }
}

export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export function modelId() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export async function generateCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
    jobListingUrl,
    jobWebsiteUrl,
    managerUrl,
    managerNameGuess,
  } = opts;

  const userParts = [
    "Write a concise cover letter (under 400 words) for this job.",
    "Use a professional, direct tone suitable for B2B sales.",
    "Ground every claim in the candidate profile below—do not invent employers, metrics, degrees, or tools.",
    "If the job description is thin, stay general and focus on transferable hunting / consultative sales strengths.",
    managerNameGuess
      ? `If it fits naturally, address the hiring contact as "${managerNameGuess}" once (e.g. Dear ${managerNameGuess},). If awkward, use "Dear Hiring Team,".`
      : 'Use "Dear Hiring Team," unless a specific name is clearly implied.',
    "",
    "--- Candidate profile (source of truth) ---",
    profile,
    "",
    "--- Job context ---",
    jobDescription
      ? `Job description:\n${jobDescription}`
      : "(No job description provided—infer role type only from URLs and keep claims conservative.)",
    "",
    `LinkedIn job URL: ${jobListingUrl || "(none)"}`,
    `Company careers / ATS URL: ${jobWebsiteUrl || "(none)"}`,
    `Contact LinkedIn (if any): ${managerUrl || "(none)"}`,
  ];

  const res = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "You write tailored job cover letters. Never fabricate candidate facts. Output only the letter body (no markdown fences).",
      },
      { role: "user", content: userParts.join("\n") },
    ],
  });

  return (res.choices[0]?.message?.content || "").trim();
}

export async function refineCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
    jobListingUrl,
    jobWebsiteUrl,
    managerUrl,
    currentLetter,
    chatHistory,
    userMessage,
  } = opts;

  const historyText =
    Array.isArray(chatHistory) && chatHistory.length
      ? chatHistory
          .map(
            (m) =>
              `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`
          )
          .join("\n")
      : "(none yet)";

  const userContent = `Candidate profile (source of truth — never add facts not stated here):
${profile}

Job description:
${jobDescription || "(not provided)"}

LinkedIn job URL: ${jobListingUrl || "(none)"}
Careers / ATS URL: ${jobWebsiteUrl || "(none)"}
Contact LinkedIn: ${managerUrl || "(none)"}

Prior chat (for context only):
${historyText}

Current cover letter to revise:
---
${currentLetter}
---

New instruction from the user:
${userMessage}

Respond with a single JSON object only (no markdown, no code fences). Keys:
- "letter": the complete updated cover letter (full text, ready to send)
- "message": one short sentence acknowledging what you changed`;

  const res = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.45,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You revise cover letters per user instructions. Never invent employers, metrics, degrees, or experience not in the profile. Output valid JSON only.",
      },
      { role: "user", content: userContent },
    ],
  });

  const raw = (res.choices[0]?.message?.content || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      letter: currentLetter,
      message: "Could not parse the model response; try again.",
      parseError: true,
    };
  }

  const letter = String(parsed.letter || "").trim();
  const message = String(parsed.message || "Updated the letter.").trim();

  return {
    letter: letter || currentLetter,
    message,
  };
}
