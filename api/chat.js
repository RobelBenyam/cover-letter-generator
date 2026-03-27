import { createOpenAIClient, refineCoverLetter } from "../lib/openai-letter.mjs";

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
      companyName = "",
      roleTitle = "",
      companyContext = "",
      currentLetter,
      chatHistory,
      userMessage,
    } = body;

    if (typeof profile !== "string" || !profile.trim()) {
      res.status(400).json({ error: "profile is required" });
      return;
    }
    if (typeof currentLetter !== "string") {
      res.status(400).json({ error: "currentLetter is required" });
      return;
    }
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      res.status(400).json({ error: "userMessage is required" });
      return;
    }

    const openai = createOpenAIClient();
    const out = await refineCoverLetter(openai, {
      profile: profile.trim(),
      jobDescription: String(jobDescription || "").trim(),
      companyName: String(companyName || "").trim(),
      roleTitle: String(roleTitle || "").trim(),
      companyContext: String(companyContext || "").trim(),
      currentLetter,
      chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
      userMessage: userMessage.trim(),
    });

    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
