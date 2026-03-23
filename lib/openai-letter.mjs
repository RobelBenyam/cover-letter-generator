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

export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export function modelId() {
  return process.env.OPENAI_MODEL || "gpt-4.1";
}

const MAX_FETCH_CHARS = 9000;
const MAX_RESEARCH_CHARS = 5000;
const MAX_LETTER_WORDS = 350;
const IDEAL_MIN_WORDS = 250;
const IDEAL_MAX_WORDS = 320;
const REQUIRED_REPEATABLE_PREFIX = "What makes these results repeatable is";
const HARD_CODED_SALES_NARRATIVE = `How you sell is framing this as I've done this through hard work, effort, results and will continue to do this elsewhere.

How I attain these results anywhere I go is my painstaking drive to be a top performer. I expect to deliver the best results, and before I sleep every night I have a ritual of improving incrementally by reflecting on everything I did throughout the day, and anything that could have been better I don't sleep until I resolve an answer or set a meeting with someone in my network at a future date to improve rapidly on that core point. At every job I always network with top performers and ask inspired questions to get behind the wheel of what more experienced people would do in my shoes, then blend it to my style over time on the key points and factors.

I've got a mindset of if I can't be one of the best eventually, I'm wasting everyone's time. Why I know that's achievable in any sales field is because the dedication to process, learning, and growth that I set for myself to be teachable, coachable and a deep hunger to grow every day. The reason I would like to transition out of D2C is because the AI company I'm working on is B2B SaaS and working in a B2C environment, while currently lucrative isn't fielding the knowledge experience and growth I require to accelerate my path of being a top contributer in our economy and towards the development of business in the age of technology.`;

function compactWhitespace(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  const tokens = String(text || "").trim().match(/\S+/g);
  return tokens ? tokens.length : 0;
}

function countRequiredRepeatabilitySentences(letter) {
  const normalized = String(letter || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  // Count sentence-level occurrences that start with the required prefix.
  const sentencePattern = new RegExp(
    `(?:^|[.!?]\\s+)${REQUIRED_REPEATABLE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "g"
  );
  const matches = normalized.match(sentencePattern);
  return matches ? matches.length : 0;
}

function validateLetterConstraints(letter) {
  const issues = [];
  const wc = countWords(letter);
  const repeatabilityCount = countRequiredRepeatabilitySentences(letter);
  if (wc > MAX_LETTER_WORDS) {
    issues.push(`Word count is ${wc}; must be <= ${MAX_LETTER_WORDS}.`);
  }
  if (wc < IDEAL_MIN_WORDS || wc > IDEAL_MAX_WORDS) {
    issues.push(
      `Word count target miss (${wc}); aim for ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words.`
    );
  }
  if (repeatabilityCount !== 1) {
    issues.push(
      `Required sentence count is ${repeatabilityCount}; must include exactly one sentence starting with "${REQUIRED_REPEATABLE_PREFIX}".`
    );
  }
  return issues;
}

function stripHtmlToText(html) {
  return compactWhitespace(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

async function fetchTextFromUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "user-agent": "AtlascoCoverLetterBot/1.0 (+research)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const contentType = String(res.headers.get("content-type") || "");
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return "";
    }
    const body = await res.text();
    const clipped = body.slice(0, MAX_FETCH_CHARS);
    return contentType.includes("text/html")
      ? stripHtmlToText(clipped)
      : compactWhitespace(clipped);
  } catch {
    return "";
  }
}

async function buildWebsiteResearchBlock({ jobListingUrl, jobWebsiteUrl }) {
  const candidates = [
    { label: "Job listing page", url: jobListingUrl },
    { label: "Company/job website page", url: jobWebsiteUrl },
  ].filter((x) => String(x.url || "").trim());
  if (!candidates.length) return "(No URL research fetched.)";

  const snippets = await Promise.all(
    candidates.map(async ({ label, url }) => {
      const text = await fetchTextFromUrl(url);
      if (!text) return `${label} (${url}): (unavailable or blocked)`;
      return `${label} (${url}): ${text.slice(0, MAX_RESEARCH_CHARS)}`;
    })
  );
  return snippets.join("\n\n");
}

export async function generateCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
    jobListingUrl,
    jobWebsiteUrl,
    companyName = "",
    roleTitle = "",
    companyContext = "",
  } = opts;

  const companyNameT = String(companyName || "").trim();
  const roleTitleT = String(roleTitle || "").trim();
  const companyContextT = String(companyContext || "").trim();
  const hasCompanyHook = Boolean(companyNameT || companyContextT);
  const websiteResearch = await buildWebsiteResearchBlock({
    jobListingUrl,
    jobWebsiteUrl,
  });

  const personalizationBlock = hasCompanyHook
    ? [
        "Personalization (required when research below exists):",
        "- Use the employer name naturally at least once if a company name is given.",
        "- Include at least three specific ties to the employer drawn only from the research block or explicit job-description lines (what they sell, who they serve, market, culture, tech focus, hiring story)—not generic praise.",
        "- Never invent funding, logos, customers, awards, or slogans not stated in the research or JD.",
      ]
    : [
        "Job-posting-only mode: Many listings are mostly requirements. Mirror their stated scope, stack, motion (e.g. hunter, SMB), and geography from the JD.",
        "- Do not invent company facts. Prefer Dear Hiring Team unless the employer name appears in the JD text.",
      ];

  const userParts = [
    "Write a concise cover letter for this job.",
    "Length target for maximum effectiveness: 250-320 words (hard cap: 350 words, single page).",
    "Use a professional, direct tone suitable for B2B sales.",
    "Treat the letter as sales copy: highlight quantified wins, pipeline impact, quota attainment, and fast time-to-value.",
    'Must include exactly one sentence that starts with: "What makes these results repeatable is".',
    "That sentence must explain the candidate's repeatable top-performer system (discipline, feedback loops, coachability, process rigor, rapid iteration).",
    "Use this structure: (1) Hook and role fit, (2) 2-3 quantified proof points, (3) repeatability-system sentence, (4) tailored company close.",
    "Ground every claim in the candidate profile below—do not invent employers, metrics, degrees, or tools.",
    "If the job description is thin, stay general and focus on transferable hunting / consultative sales strengths.",
    ...personalizationBlock,
    'Use "Dear Hiring Team," unless a specific name is clearly implied in the job text.',
    "",
    "--- Employer & research (for why this company) ---",
    `Company / brand name: ${companyNameT || "(not provided)"}`,
    `Role title to echo if useful: ${roleTitleT || "(not provided)"}`,
    companyContextT
      ? `Candidate research notes (use for personalization; must not contradict the resume):\n${companyContextT}`
      : "(No extra company research—personalize only from the job description + resume.)",
    "",
    "--- URL research snippets (fetched at runtime) ---",
    websiteResearch,
    "",
    "--- Candidate profile (source of truth) ---",
    profile,
    `\nAdditional candidate sales narrative (hardcoded for this applicant; use selectively to strengthen credibility while keeping tone professional):\n${HARD_CODED_SALES_NARRATIVE}`,
    "",
    "--- Job context ---",
    jobDescription
      ? `Job description:\n${jobDescription}`
      : "(No job description provided—infer role type only from URLs and keep claims conservative.)",
    "",
    `LinkedIn job URL: ${jobListingUrl || "(none)"}`,
    `Company careers / ATS URL: ${jobWebsiteUrl || "(none)"}`,
  ];

  const res = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          'You write tailored job cover letters. Keep letters concise and high-signal: 250-320 words preferred, never over 350 words. The letter must include exactly one sentence that starts with "What makes these results repeatable is" and explains the candidate\'s repeatable top-performer operating system. Never fabricate candidate facts or employer facts beyond the provided job text and research block. Output only the letter body (no markdown fences).',
      },
      { role: "user", content: userParts.join("\n") },
    ],
  });
  let letter = (res.choices[0]?.message?.content || "").trim();
  const issues = validateLetterConstraints(letter);
  if (!issues.length) return letter;

  // One targeted retry to enforce hard output constraints.
  const retryPrompt = [
    "Your previous draft did not meet hard constraints.",
    ...issues.map((i) => `- ${i}`),
    "",
    "Rewrite the full letter now and satisfy all constraints exactly:",
    `- ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words preferred`,
    `- Never exceed ${MAX_LETTER_WORDS} words`,
    `- Include exactly one sentence that starts with "${REQUIRED_REPEATABLE_PREFIX}"`,
    "- Keep all claims grounded in provided candidate and company context.",
    "",
    "Draft to fix:",
    letter,
  ].join("\n");
  const retryRes = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content:
          'You rewrite cover letters to strict constraints. Output only the letter body (no markdown fences).',
      },
      { role: "user", content: userParts.join("\n") },
      { role: "assistant", content: letter },
      { role: "user", content: retryPrompt },
    ],
  });
  letter = (retryRes.choices[0]?.message?.content || "").trim();
  return letter;
}

export async function refineCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
    jobListingUrl,
    jobWebsiteUrl,
    companyName = "",
    roleTitle = "",
    companyContext = "",
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

  const cn = String(companyName || "").trim();
  const rt = String(roleTitle || "").trim();
  const cc = String(companyContext || "").trim();
  const websiteResearch = await buildWebsiteResearchBlock({
    jobListingUrl,
    jobWebsiteUrl,
  });

  const userContent = `Candidate profile (source of truth — never add facts not stated here):
${profile}
\nAdditional candidate sales narrative (hardcoded for this applicant; use selectively, keep professional):
${HARD_CODED_SALES_NARRATIVE}

Employer & research (keep personalization consistent with this; do not invent employer facts):
Company name: ${cn || "(not provided)"}
Role title: ${rt || "(not provided)"}
Research notes:
${cc || "(none)"}
URL research snippets:
${websiteResearch}

Job description:
${jobDescription || "(not provided)"}

LinkedIn job URL: ${jobListingUrl || "(none)"}
Careers / ATS URL: ${jobWebsiteUrl || "(none)"}

Prior chat (for context only):
${historyText}

Current cover letter to revise:
---
${currentLetter}
---

New instruction from the user:
${userMessage}

Revision requirements:
- Keep 250-320 words (hard cap: 350)
- Keep or add exactly one sentence that starts with "What makes these results repeatable is"
- Keep structure: hook, quantified proof, repeatability system, company-tailored close

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
          'You revise cover letters per user instructions. Optimize for sales-impact storytelling and company-specific relevance. Keep the revised letter concise and high-signal: 250-320 words preferred, never over 350 words. It must include exactly one sentence that starts with "What makes these results repeatable is" and that sentence must explain the candidate\'s repeatable top-performer system through process and learning rigor. Never invent candidate facts or employer facts beyond the profile, job description, and research block. Output valid JSON only.',
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
  const issues = validateLetterConstraints(letter);

  if (!issues.length) {
    return {
      letter: letter || currentLetter,
      message,
    };
  }

  // One targeted retry for refinements, preserving JSON output contract.
  const retryUserContent = `${userContent}

Your previous revision failed hard constraints:
${issues.map((i) => `- ${i}`).join("\n")}

Rewrite the full letter now so it passes all constraints exactly.`;
  const retryRes = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You revise cover letters to strict constraints. Return valid JSON only with keys "letter" and "message".',
      },
      { role: "user", content: retryUserContent },
    ],
  });
  const retryRaw = (retryRes.choices[0]?.message?.content || "").trim();
  try {
    const retryParsed = JSON.parse(retryRaw);
    const retryLetter = String(retryParsed.letter || "").trim();
    const retryMessage = String(retryParsed.message || "Updated with tighter constraints.").trim();
    return {
      letter: retryLetter || letter || currentLetter,
      message: retryMessage,
    };
  } catch {
    return {
      letter: letter || currentLetter,
      message: "Updated the letter, but strict formatting retry failed.",
    };
  }
}
