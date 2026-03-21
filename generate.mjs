#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import {
  loadEnvFile,
  createOpenAIClient,
  guessNameFromLinkedIn,
  generateCoverLetter,
} from "./lib/openai-letter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnvFile(__dirname);

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i === process.argv.length - 1) return null;
  return process.argv[i + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickColumn(row, candidates) {
  const keys = Object.keys(row);
  const map = new Map(keys.map((k) => [normalizeHeader(k), k]));
  for (const c of candidates) {
    const hit = map.get(normalizeHeader(c));
    if (hit && row[hit] != null && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  for (const k of keys) {
    const n = normalizeHeader(k);
    if (candidates.some((c) => normalizeHeader(c) === n)) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return "";
}

function pursueYes(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "letter";
}

async function main() {
  const csvPath = argValue("--csv");
  const profilePath = argValue("--profile") || join(__dirname, "profile.txt");
  const outDir = argValue("--out") || join(__dirname, "output");
  const singleJd = argValue("--jd-file");

  if (!csvPath && !singleJd) {
    console.error(`Usage:
  Batch (Google Sheet → File → Download → CSV):
    node generate.mjs --csv ./jobs.csv [--out ./output] [--profile ./profile.txt]

  Single job:
    node generate.mjs --jd-file ./jd.txt --company "Acme" --role "Account Executive" \\
      [--linkedin URL] [--careers-url URL] [--manager-url URL]

  Web UI: npm run dev

  Env: OPENAI_API_KEY (or .env in this folder). Optional: OPENAI_MODEL (default gpt-4o-mini).
`);
    process.exit(1);
  }

  let openai;
  try {
    openai = createOpenAIClient();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }

  if (!existsSync(profilePath)) {
    console.error(
      `Missing profile file: ${profilePath}\nCopy profile.example.txt to profile.txt and edit, or pass --profile /path/to/profile.txt`
    );
    process.exit(1);
  }

  const profile = readFileSync(profilePath, "utf8").trim();
  if (!profile) {
    console.error("Profile file is empty.");
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  if (singleJd) {
    const jd = readFileSync(singleJd, "utf8").trim();
    const company = argValue("--company") || "the company";
    const role = argValue("--role") || "the role";
    const managerUrl = argValue("--manager-url") || "";
    const name = managerUrl ? guessNameFromLinkedIn(managerUrl) : null;
    const letter = await generateCoverLetter(openai, {
      profile,
      jobDescription: jd,
      jobListingUrl: argValue("--linkedin") || "",
      jobWebsiteUrl: argValue("--careers-url") || "",
      managerUrl,
      managerNameGuess: name,
    });
    const fn = `cover-${slugify(company)}-${slugify(role)}.txt`;
    const path = join(outDir, fn);
    writeFileSync(path, letter + "\n", "utf8");
    console.log(path);
    return;
  }

  let raw = readFileSync(csvPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  let written = 0;
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const pursue = pickColumn(row, ["Persue?", "Pursue?", "pursue", "Pursue"]);
    if (!hasFlag("--all") && !pursueYes(pursue)) continue;

    const jobListing = pickColumn(row, [
      "Job Listing",
      "job listing",
      "LinkedIn",
      "linkedin job",
      "role_link",
    ]);
    const jobWebsite = pickColumn(row, ["Job website", "job website", "careers"]);
    const jd = pickColumn(row, ["Job Description", "job description", "description"]);
    const managerUrl = pickColumn(row, [
      "Potential managers Linked ins:",
      "Potential managers Linked ins",
      "manager linkedin",
      "hiring manager",
    ]);

    if (!jd) {
      console.warn(
        `Row ${i + 2}: empty Job Description — generating a conservative letter from links only (paste JD in column C for better results).`
      );
    }

    const managerNameGuess = managerUrl
      ? guessNameFromLinkedIn(managerUrl)
      : null;

    const letter = await generateCoverLetter(openai, {
      profile,
      jobDescription: jd,
      jobListingUrl: jobListing,
      jobWebsiteUrl: jobWebsite,
      managerUrl,
      managerNameGuess,
    });

    const base = slugify(`${i}-${jobListing || jobWebsite || "job"}`);
    const path = join(outDir, `cover-${base}.txt`);
    writeFileSync(path, letter + "\n", "utf8");
    console.log(path);
    written++;
  }

  if (written === 0) {
    console.warn(
      "No rows generated. Use Persue? = Yes in the sheet, fill Job Description, or pass --all to ignore Persue?."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
