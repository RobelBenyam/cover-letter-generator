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

const MAX_LETTER_WORDS = 300;
const IDEAL_MIN_WORDS = 200;
const IDEAL_MAX_WORDS = 260;
const REQUIRED_REPEATABLE_PREFIX = "What makes these results repeatable is";
/** Required letter closing — do not paraphrase. (Phone/email stay on resume, not in the letter.) */
const LETTER_CLOSING_BLOCK = `Sincerely,
Draven Blake`;
const HARD_CODED_SALES_NARRATIVE = `How you sell is framing this as I've done this through hard work, effort, results and will continue to do this elsewhere.

How I attain these results anywhere I go is my painstaking drive to be a top performer. I expect to deliver the best results, and before I sleep every night I have a ritual of improving incrementally by reflecting on everything I did throughout the day, and anything that could have been better I don't sleep until I resolve an answer or set a meeting with someone in my network at a future date to improve rapidly on that core point. At every job I always network with top performers and ask inspired questions to get behind the wheel of what more experienced people would do in my shoes, then blend it to my style over time on the key points and factors.

I've got a mindset of if I can't be one of the best eventually, I'm wasting everyone's time. Why I know that's achievable in any sales field is because the dedication to process, learning, and growth that I set for myself to be teachable, coachable and a deep hunger to grow every day. The reason I would like to transition out of D2C is because the AI company I'm working on is B2B SaaS and working in a B2C environment, while currently lucrative isn't fielding the knowledge experience and growth I require to accelerate my path of being a top contributer in our economy and towards the development of business in the age of technology.`;

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
  const normalizedEnd = String(letter || "").trim();
  const trimmedEnd = normalizedEnd.replace(/\r\n/g, "\n").trimEnd();
  const endsWithExactBlock = trimmedEnd.endsWith(LETTER_CLOSING_BLOCK);
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
  if (!endsWithExactBlock) {
    issues.push(
      'Letter must end with exactly: "Sincerely," then a line break, then "Draven Blake" — no phone, email, or address after the name.'
    );
  }
  const full = String(letter || "");
  const salutationMatch = full.match(/Dear Hiring Team,?\s*([\s\S]*)/i);
  const bodyStart = salutationMatch
    ? salutationMatch[1].slice(0, 500)
    : full.slice(0, 500);
  const hasNameIntro =
    /\bI'm Draven\b/i.test(bodyStart) ||
    /\bI am Draven\b/i.test(bodyStart) ||
    /\bHi[,\s—-]*\s*I'm Draven\b/i.test(bodyStart);
  if (!hasNameIntro) {
    issues.push(
      'Open with your first name in the first lines (e.g. "I\'m Draven" or "Hi — I\'m Draven") right after the salutation, then why you\'re applying.'
    );
  }
  return issues;
}

/** Phrases that read as generic AI cover-letter tone — trigger one rewrite pass. */
const AI_SLOP_TRIGGERS = [
  { re: /\bI am excited to apply\b/i, hint: 'Do not open with "I am excited to apply". Start with role + proof or "I\'m applying for…".' },
  { re: /\bI'm excited to apply\b/i, hint: 'Avoid "I\'m excited to apply".' },
  { re: /\bresonates\b/i, hint: 'Remove "resonate(s)" — say what you mean in plain words.' },
  { re: /\bdeeply resonates\b/i, hint: 'Remove "deeply resonates".' },
  { re: /\baligns perfectly\b/i, hint: 'Remove "aligns perfectly".' },
  { re: /\baligns strongly\b/i, hint: 'Remove "aligns strongly".' },
  { re: /\bdemonstrates a consistent ability\b/i, hint: 'Cut stiff phrasing like "demonstrates a consistent ability". Use direct verbs: I built, I closed, I hit.' },
  { re: /\bfast-paced environments\b/i, hint: 'Avoid cliché "fast-paced environments". Name the motion (quota, territory, outbound) instead.' },
  { re: /\bfast-paced\b/i, hint: 'Avoid "fast-paced". Say quota pressure, high activity, or outbound volume instead.' },
  { re: /\bideal fit\b/i, hint: 'Avoid "ideal fit". Say one concrete reason instead.' },
  { re: /\bI am particularly drawn\b/i, hint: 'Avoid "particularly drawn to". Use a concrete line from the JD.' },
  { re: /\bI am drawn to\b/i, hint: 'Avoid "I am drawn to". Say why the role fits in one concrete line.' },
  { re: /\bdemonstrating my ability\b/i, hint: 'Avoid "demonstrating my ability". Use: I closed / I hit / I built.' },
  { re: /\breputation for\b/i, hint: 'Avoid vague "reputation for". Cite what they actually say in the posting.' },
  { re: /\bdisrupt\b/i, hint: 'Avoid hype "disrupt". Say what you will do in plain terms.' },
  { re: /\bunmatched\b|\bunparalleled\b/i, hint: 'Avoid superlatives like unmatched/unparalleled unless it is your own metric.' },
  { re: /\bvalue-based selling\b/i, hint: 'Cut cliché "value-based selling" unless quoting the JD.' },
  { re: /\bthrilled to\b|\bdelighted to\b/i, hint: 'Avoid "thrilled/delighted". Stay confident and calm.' },
  { re: /\bleverage my\b/i, hint: 'Prefer "use" or "apply" over "leverage".' },
  { re: /\bcontinued growth and success\b/i, hint: 'Remove empty sign-off phrases like "growth and success".' },
];

function validateHumanVoice(letter) {
  const issues = [];
  for (const { re, hint } of AI_SLOP_TRIGGERS) {
    if (re.test(String(letter || ""))) {
      issues.push(`AI-slop / template tone: ${hint}`);
    }
  }
  return issues;
}

export async function generateCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
    companyName = "",
    roleTitle = "",
    companyContext = "",
  } = opts;

  const companyNameT = String(companyName || "").trim();
  const roleTitleT = String(roleTitle || "").trim();
  const companyContextT = String(companyContext || "").trim();
  const hasCompanyHook = Boolean(companyNameT || companyContextT);

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
    "Voice (critical): Sound like a sharp salesperson wrote this in one sitting — not like ChatGPT. Plain English, confident, specific. No marketing brochure tone.",
    "Vary sentence length: mix 5–8 word sentences with longer ones. Do not use three parallel clauses in a row (no 'X, Y, and Z' filler lists).",
    "After the salutation, open with a short name intro in plain English: e.g. 'I'm Draven, and I'm applying for [role] at [company] because…' or 'Hi — I'm Draven. I'm applying for…' (first name must appear in the first sentence or two).",
    "Do not start with 'I am excited to apply' or 'I am writing to express'.",
    "Do not parrot the company mission or homepage in sentence one. Weave product/context in after proof, in your own words.",
    `Length: aim for ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words (hard cap ${MAX_LETTER_WORDS}). Short and dense—cut throat-clearing and duplicate ideas; keep the strongest metrics only.`,
    "Use a professional, direct tone suitable for B2B sales.",
    "Treat the letter as sales copy: highlight quantified wins, pipeline impact, quota attainment, and fast time-to-value.",
    'Must include exactly one sentence that starts with: "What makes these results repeatable is".',
    "That sentence must explain the candidate's repeatable top-performer system (discipline, feedback loops, coachability, process rigor, rapid iteration).",
    "Use this structure: (1) Hook and role fit, (2) two tight quantified proof beats (not three bloated paragraphs), (3) repeatability-system sentence, (4) one short company-fit close.",
    "Anti-AI wording — NEVER use these (they read as LLM): resonates, aligns perfectly/strongly, thrilled, leverage (verb), utilize, fast-paced, ideal fit, particularly drawn, reputation for, disrupt (hype), unmatched, value-based selling (cliché), demonstrates my ability, rigorous process optimization (consulting-speak), continued growth and success.",
    "Anti-boilerplate: avoid empty recruiter-speak: transformative, people-first culture, exceptional results (unless tied to a number), continued growth and success. Prefer concrete verbs: built, closed, hit, sourced, booked.",
    "Company fit: weave in at least two specific JD or research cues in one lean paragraph—not a second essay.",
    "Closing: one concrete next step (e.g. ready to discuss territory plan, pipeline approach, or first-90-days plan)—not a generic thank-you only.",
    `End the letter with this exact closing only (no phone, email, or city — those belong on the resume):\n${LETTER_CLOSING_BLOCK}`,
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
    "--- Candidate profile (source of truth) ---",
    profile,
    `\nAdditional candidate sales narrative (hardcoded for this applicant; use selectively to strengthen credibility while keeping tone professional):\n${HARD_CODED_SALES_NARRATIVE}`,
    "",
    "--- Job context ---",
    jobDescription
      ? `Job description:\n${jobDescription}`
      : "(No job description provided—keep claims conservative and lean on resume + company research notes.)",
  ];

  const res = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.38,
    messages: [
      {
        role: "system",
        content:
          `You write tailored job cover letters that sound written by a real senior salesperson — confident, plain-spoken, specific — never like generic AI output. After Dear Hiring Team, the candidate must introduce himself by first name (Draven) in the first sentence or two. No "resonates", "aligns perfectly", "I am excited to apply", "demonstrates consistent ability", or brochure tone. Keep letters short: ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words preferred, never over ${MAX_LETTER_WORDS}. The letter must include exactly one sentence that starts with "What makes these results repeatable is" and explains the candidate's repeatable operating system. Ground company fit in the job description or research notes. End with the exact closing block in the instructions (Sincerely + name only — no phone, email, or address in the sign-off). Never fabricate facts. Output only the letter body (no markdown fences).`,
      },
      { role: "user", content: userParts.join("\n") },
    ],
  });
  let letter = (res.choices[0]?.message?.content || "").trim();
  const maxRetries = 2;
  let issues = [
    ...validateLetterConstraints(letter),
    ...validateHumanVoice(letter),
  ];
  for (let i = 0; i < maxRetries && issues.length; i++) {
    const retryPrompt = [
      "Your previous draft did not meet constraints.",
      ...issues.map((issue) => `- ${issue}`),
      "",
      "Rewrite the full letter from scratch. Sound human, not like an AI: short direct sentences, no mission-copy opener, no banned phrases.",
      "Satisfy all constraints exactly:",
      `- ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words preferred`,
      `- Never exceed ${MAX_LETTER_WORDS} words`,
      `- After Dear Hiring Team, include "I'm Draven" or "Hi — I'm Draven" in the first sentence or two`,
      `- Include exactly one sentence that starts with "${REQUIRED_REPEATABLE_PREFIX}"`,
      `- End with this exact closing (nothing after the name):\n${LETTER_CLOSING_BLOCK}`,
      "- Keep all claims grounded in provided candidate and company context.",
      "",
      "Draft to fix:",
      letter,
    ].join("\n");
    const retryRes = await openai.chat.completions.create({
      model: modelId(),
      temperature: 0.22,
      messages: [
        {
          role: "system",
          content:
            "You rewrite cover letters to strict constraints. Preserve a human voice: direct, uneven sentence rhythm, zero AI buzzwords. Output only the letter body (no markdown fences).",
        },
        { role: "user", content: userParts.join("\n") },
        { role: "assistant", content: letter },
        { role: "user", content: retryPrompt },
      ],
    });
    letter = (retryRes.choices[0]?.message?.content || "").trim();
    issues = [
      ...validateLetterConstraints(letter),
      ...validateHumanVoice(letter),
    ];
  }
  return letter;
}

export async function refineCoverLetter(openai, opts) {
  const {
    profile,
    jobDescription,
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

  const userContent = `Candidate profile (source of truth — never add facts not stated here):
${profile}
\nAdditional candidate sales narrative (hardcoded for this applicant; use selectively, keep professional):
${HARD_CODED_SALES_NARRATIVE}

Employer & research (keep personalization consistent with this; do not invent employer facts):
Company name: ${cn || "(not provided)"}
Role title: ${rt || "(not provided)"}
Research notes:
${cc || "(none)"}

Job description:
${jobDescription || "(not provided)"}

Required letter closing (verbatim):
${LETTER_CLOSING_BLOCK}

Prior chat (for context only):
${historyText}

Current cover letter to revise:
---
${currentLetter}
---

New instruction from the user:
${userMessage}

Revision requirements:
- Keep ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words (hard cap: ${MAX_LETTER_WORDS}); prefer shorter if you can without losing proof
- Keep or add exactly one sentence that starts with "What makes these results repeatable is"
- After Dear Hiring Team, include a brief intro with first name: "I'm Draven" or "Hi — I'm Draven" in the first sentence or two
- Keep structure: hook, quantified proof, repeatability system, company-tailored close
- Human voice: sound like a real salesperson — not AI. No resonates/aligns perfectly/thrilled/leverage/I am excited to apply/fast-paced environments/demonstrates consistent ability.
- Vary sentence length; avoid symmetrical "At Company A… At Company B…" mirror paragraphs if you can rephrase.
- End with the exact closing block shown above (name only after Sincerely — no phone, email, or address)

Respond with a single JSON object only (no markdown, no code fences). Keys:
- "letter": the complete updated cover letter (full text, ready to send)
- "message": one short sentence acknowledging what you changed`;

  const res = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `You revise cover letters per user instructions. The result must sound human — direct, specific, uneven rhythm — never like generic LLM output. After Dear Hiring Team, the candidate must introduce himself as Draven (I'm Draven or Hi — I'm Draven) in the opening lines. Ban: resonates, aligns perfectly, I am excited to apply, demonstrates consistent ability, fast-paced environments, thrilled, leverage (verb). Optimize for sales storytelling; ground company fit in the JD or research notes. ${IDEAL_MIN_WORDS}-${IDEAL_MAX_WORDS} words preferred, never over ${MAX_LETTER_WORDS}. Exactly one sentence starts with "What makes these results repeatable is" (explain operating system). End with the exact closing block in the user message (Sincerely + Draven Blake only — no phone, email, or address). Never invent facts. Output valid JSON only with keys letter and message.`,
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
  const issues = [
    ...validateLetterConstraints(letter),
    ...validateHumanVoice(letter),
  ];

  if (!issues.length) {
    return {
      letter: letter || currentLetter,
      message,
    };
  }

  // One targeted retry for refinements, preserving JSON output contract.
  const retryUserContent = `${userContent}

Your previous revision failed constraints (format and/or human-voice rules):
${issues.map((i) => `- ${i}`).join("\n")}

Rewrite the full letter so it passes all constraints. Remove AI-sounding phrasing; keep a natural salesperson voice.`;
  const retryRes = await openai.chat.completions.create({
    model: modelId(),
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You revise cover letters to strict constraints. Human voice required — no AI buzzwords. Return valid JSON only with keys "letter" and "message".',
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
