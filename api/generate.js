import {
  createOpenAIClient,
  guessNameFromLinkedIn,
  generateCoverLetter,
} from "../lib/openai-letter.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const {
      profile,
      jobDescription = "",
      jobListingUrl = "",
      jobWebsiteUrl = "",
      managerUrl = "",
      companyName = "",
      roleTitle = "",
      companyContext = "",
    } = body;

    if (typeof profile !== "string" || !profile.trim()) {
      res.status(400).json({ error: "profile is required" });
      return;
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
      companyName: String(companyName || "").trim(),
      roleTitle: String(roleTitle || "").trim(),
      companyContext: String(companyContext || "").trim(),
    });

    res.status(200).json({ letter });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
