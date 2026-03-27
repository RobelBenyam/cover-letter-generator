import { useCallback, useEffect, useState } from "react";
import bundledResume from "../../profile.example.txt?raw";

type ChatTurn = { role: "user" | "assistant"; content: string };
type SavedLetter = {
  id: string;
  companyName: string;
  roleTitle: string;
  companyContext: string;
  jobDescription: string;
  letter: string;
  chatHistory: ChatTurn[];
  createdAt: string;
  updatedAt: string;
};

const PROFILE_STORAGE_KEY = "atlasco-cover-profile";
const LETTERS_STORAGE_KEY = "atlasco-cover-letters";

/** Tells Grammarly (browser extension) not to inject on this field — optional for you to remove */
const noGrammarly = {
  "data-gramm": "false",
  "data-gramm_editor": "false",
} as const;

async function api<T>(
  path: string,
  init?: RequestInit
): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: (json as { error?: string }).error || res.statusText };
    }
    return { data: json as T };
  } catch (e) {
    return { error: String(e) };
  }
}

export default function App() {
  const [profile, setProfile] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [letter, setLetter] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [draftOk, setDraftOk] = useState(false);
  const [savedLetters, setSavedLetters] = useState<SavedLetter[]>([]);
  const [activeLetterId, setActiveLetterId] = useState<string | null>(null);
  /** When false and profile exists, show compact banner instead of textarea */
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      let stored = "";
      try {
        stored = localStorage.getItem(PROFILE_STORAGE_KEY) ?? "";
      } catch {
        /* private mode */
      }

      // Only trust localStorage if it has real content (empty string used to block profile.txt before)
      if (stored.trim()) {
        setProfile(stored);
        setEditProfileOpen(false);
        return;
      }

      const { data, error: err } = await api<{ profile: string }>(
        "/api/profile"
      );
      if (!err && data?.profile != null && data.profile.trim()) {
        setProfile(data.profile);
        setEditProfileOpen(false);
        try {
          localStorage.setItem(PROFILE_STORAGE_KEY, data.profile);
        } catch {
          /* ignore */
        }
        return;
      }

      const fallback = bundledResume.trim();
      setProfile(fallback);
      setEditProfileOpen(false);
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, fallback);
      } catch {
        /* ignore */
      }
      if (err && !String(err).includes("404") && !String(err).includes("Failed to fetch")) {
        setError(err);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LETTERS_STORAGE_KEY) || "[]";
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((x) => {
        return (
          x &&
          typeof x.id === "string" &&
          typeof x.letter === "string" &&
          typeof x.companyName === "string"
        );
      }) as SavedLetter[];
      setSavedLetters(valid);
    } catch {
      /* ignore corrupt local storage */
    }
  }, []);

  const persistLetters = useCallback(
    (next: SavedLetter[]) => {
      try {
        localStorage.setItem(LETTERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        setError("Could not save letters to browser storage.");
        return false;
      }
      setSavedLetters(next);
      return true;
    },
    [setSavedLetters]
  );

  const saveCurrentDraft = useCallback(
    (
      letterText = letter,
      history = chatHistory,
      options?: { forceNew?: boolean; clearChatInput?: boolean }
    ) => {
      if (!letterText.trim()) {
        setError("Generate or write a letter before saving.");
        return;
      }
      const now = new Date().toISOString();
      const base: SavedLetter = {
        id:
          options?.forceNew || !activeLetterId
            ? (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
            : activeLetterId,
        companyName: companyName.trim(),
        roleTitle: roleTitle.trim(),
        companyContext: companyContext.trim(),
        jobDescription: jobDescription.trim(),
        letter: letterText,
        chatHistory: history,
        createdAt: now,
        updatedAt: now,
      };

      const existing = options?.forceNew
        ? null
        : savedLetters.find((x) => x.id === activeLetterId) || null;
      if (existing) {
        base.createdAt = existing.createdAt;
      }

      const next = existing
        ? savedLetters.map((x) => (x.id === base.id ? base : x))
        : [base, ...savedLetters];
      if (!persistLetters(next)) return;
      setActiveLetterId(base.id);
      setDraftOk(true);
      window.setTimeout(() => setDraftOk(false), 1600);
      if (options?.clearChatInput) setChatInput("");
    },
    [
      letter,
      chatHistory,
      activeLetterId,
      companyName,
      roleTitle,
      companyContext,
      jobDescription,
      savedLetters,
      persistLetters,
    ]
  );

  const loadDraft = useCallback((item: SavedLetter) => {
    setCompanyName(item.companyName || "");
    setRoleTitle(item.roleTitle || "");
    setCompanyContext(item.companyContext || "");
    setJobDescription(item.jobDescription || "");
    setLetter(item.letter || "");
    setChatHistory(Array.isArray(item.chatHistory) ? item.chatHistory : []);
    setActiveLetterId(item.id);
    setError("");
  }, []);

  const deleteDraft = useCallback(
    (id: string) => {
      const next = savedLetters.filter((x) => x.id !== id);
      if (!persistLetters(next)) return;
      if (activeLetterId === id) setActiveLetterId(null);
    },
    [savedLetters, persistLetters, activeLetterId]
  );

  const startNewDraft = useCallback(() => {
    setCompanyName("");
    setRoleTitle("");
    setCompanyContext("");
    setJobDescription("");
    setLetter("");
    setChatHistory([]);
    setChatInput("");
    setActiveLetterId(null);
    setDraftOk(false);
    setCopyOk(false);
    setError("");
  }, []);

  const saveProfile = useCallback(async () => {
    setError("");
    setSaveOk(false);
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, profile);
    } catch {
      setError("Could not save to browser storage (private mode?).");
      return;
    }
    void api("/api/profile", {
      method: "POST",
      body: JSON.stringify({ profile }),
    });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  }, [profile]);

  const generate = useCallback(async () => {
    setError("");
    setLoadingGen(true);
    setChatHistory([]);
    const { data, error: err } = await api<{ letter: string }>("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        profile,
        jobDescription,
        companyName,
        roleTitle,
        companyContext,
      }),
    });
    setLoadingGen(false);
    if (err) {
      setError(err);
      return;
    }
    const generated = data?.letter || "";
    setLetter(generated);
    saveCurrentDraft(generated, [], { clearChatInput: true });
  }, [
    profile,
    jobDescription,
    companyName,
    roleTitle,
    companyContext,
    saveCurrentDraft,
  ]);

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || !letter.trim()) {
      setError(
        letter.trim()
          ? "Type a message first."
          : "Generate or paste a cover letter before chatting."
      );
      return;
    }
    setError("");
    setLoadingChat(true);
    setChatInput("");
    const nextHistory: ChatTurn[] = [...chatHistory, { role: "user", content: msg }];

    const { data, error: err } = await api<{
      letter: string;
      message: string;
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        profile,
        jobDescription,
        companyName,
        roleTitle,
        companyContext,
        currentLetter: letter,
        chatHistory,
        userMessage: msg,
      }),
    });

    setLoadingChat(false);
    if (err) {
      setError(err);
      setChatInput(msg);
      return;
    }

    const assistantMsg = data?.message || "Updated.";
    const nextLetter = data?.letter || letter;
    const nextChatHistory: ChatTurn[] = [
      ...nextHistory,
      { role: "assistant", content: assistantMsg },
    ];
    setLetter(nextLetter);
    setChatHistory(nextChatHistory);
    saveCurrentDraft(nextLetter, nextChatHistory, { clearChatInput: true });
  }, [
    chatInput,
    letter,
    chatHistory,
    profile,
    jobDescription,
    companyName,
    roleTitle,
    companyContext,
    saveCurrentDraft,
  ]);

  const copyLetter = useCallback(() => {
    if (!letter) return;
    void navigator.clipboard.writeText(letter);
    setCopyOk(true);
    window.setTimeout(() => setCopyOk(false), 2000);
  }, [letter]);

  return (
    <>
      <header className="app-header">
        <div className="app-header-titles">
          <h1>Cover letter</h1>
          <p className="sub">
            Personal use · not a shared product. Your resume stays on this device;
            it’s only sent to OpenAI when you generate or chat.{" "}
            {import.meta.env.PROD
              ? "API key is in Vercel env."
              : "Local: key in .env; Save also writes profile.txt for the CLI."}
          </p>
        </div>
        <span
          className={`env-pill ${import.meta.env.PROD ? "env-pill--prod" : "env-pill--dev"}`}
        >
          {import.meta.env.PROD ? "Production" : "Local"}
        </span>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}

      <div className="layout">
        <div className="panel panel--inputs">
          <h2 className="panel-title">Your inputs</h2>
          {profile.trim() && !editProfileOpen ? (
            <div className="resume-card">
              <div className="resume-card-main">
                <span className="resume-card-icon" aria-hidden>
                  ✓
                </span>
                <div>
                  <div className="resume-card-line">
                    <strong>Resume ready</strong>
                    <span className="resume-meta">
                      {profile.length.toLocaleString()} chars · this device
                    </span>
                  </div>
                  {import.meta.env.DEV ? (
                    <p className="resume-card-hint">
                      Saving also writes{" "}
                      <code>profile.txt</code> for CLI batch.
                    </p>
                  ) : (
                    <p className="resume-card-hint">
                      Personal · edit anytime. Nothing is stored on our servers.
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditProfileOpen(true)}
              >
                Edit resume
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="profile-edit">Your resume (private — this device)</label>
                <textarea
                  id="profile-edit"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  rows={8}
                />
              </div>
              <div className="row">
                <button type="button" className="btn-secondary" onClick={saveProfile}>
                  {import.meta.env.PROD ? "Save to this browser" : "Save (browser + profile.txt)"}
                </button>
                {profile.trim() ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditProfileOpen(false)}
                  >
                    Collapse
                  </button>
                ) : null}
                {saveOk ? (
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                    Saved
                  </span>
                ) : null}
              </div>
            </>
          )}
          <div className="field field--tight-top">
            <label htmlFor="company-name">Company name</label>
            <input
              id="company-name"
              type="text"
              {...noGrammarly}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Employer or brand hiring you (from posting or research)"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="role-title">Role title (optional)</label>
            <input
              id="role-title"
              type="text"
              {...noGrammarly}
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Account Executive — New Business"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="company-research">Company research (optional)</label>
            <p className="section-hint" style={{ marginTop: 0 }}>
              Paste what you actually know (this is the main source for “why this
              company” besides the JD): About page, product, ICP, 1–2 differentiators.
            </p>
            <textarea
              id="company-research"
              {...noGrammarly}
              value={companyContext}
              onChange={(e) => setCompanyContext(e.target.value)}
              rows={5}
              placeholder="Short notes in your own words (not the full JD)."
              autoComplete="off"
            />
          </div>
          <div className="field field--tight-top field--grow">
            <label htmlFor="jd">Job description</label>
            <textarea
              id="jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full posting (role, responsibilities, requirements). More text = better letters."
            />
          </div>
          <div className="row row--actions">
            <button
              type="button"
              className="btn-primary"
              disabled={loadingGen || !profile.trim()}
              onClick={generate}
            >
              {loadingGen ? "Generating…" : "Generate cover letter"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => saveCurrentDraft()}
              disabled={!letter.trim()}
            >
              {activeLetterId ? "Update saved draft" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => saveCurrentDraft(letter, chatHistory, { forceNew: true })}
              disabled={!letter.trim()}
            >
              Save as new
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={startNewDraft}
            >
              Clean up + new cover letter
            </button>
            {!profile.trim() ? (
              <span className="field-hint">Add a resume first (Edit resume).</span>
            ) : null}
            {draftOk ? (
              <span className="field-hint" style={{ color: "var(--muted)" }}>
                Draft saved
              </span>
            ) : null}
          </div>
        </div>

        <div className="panel panel--letter">
          <h2 className="panel-title">Letter &amp; chat</h2>
          <div className="field field--letter-grow">
            <label htmlFor="letter-out">Cover letter</label>
            <textarea
              id="letter-out"
              className="letter"
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              placeholder="Your letter appears here. Edit freely, then copy or refine with chat."
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn-secondary"
              onClick={copyLetter}
              disabled={!letter}
            >
              {copyOk ? "Copied" : "Copy letter"}
            </button>
          </div>

          <div className="chat-block">
            <h3 className="chat-block-title">Saved letters</h3>
            <p className="section-hint">
              Stored in this browser. Load any draft to continue editing.
            </p>
            <div className="chat-log">
              {savedLetters.length === 0 ? (
                <span style={{ color: "var(--muted)" }}>
                  No saved drafts yet.
                </span>
              ) : (
                [...savedLetters]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((item) => {
                    const isActive = item.id === activeLetterId;
                    const title = item.companyName || "Untitled company";
                    const role = item.roleTitle || "Untitled role";
                    const when = new Date(item.updatedAt).toLocaleString();
                    return (
                      <div
                        key={item.id}
                        className={`chat-msg ${isActive ? "assistant" : ""}`}
                        style={{ display: "grid", gap: "0.4rem" }}
                      >
                        <div>
                          <span className="who">{title}</span> · {role}
                        </div>
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                          Updated {when}
                        </span>
                        <div className="row">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => loadDraft(item)}
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => deleteDraft(item.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <div className="chat-block">
            <h3 className="chat-block-title">Refine with chat</h3>
            <p className="section-hint">
              Ask for edits (tone, length, one extra bullet). The model rewrites
              the full letter using your resume, JD, and company research.
            </p>
            <div className="chat-log">
            {chatHistory.length === 0 ? (
              <span style={{ color: "var(--muted)" }}>
                No messages yet — generate a letter, then chat below.
              </span>
            ) : (
              chatHistory.map((m, i) => (
                <div
                  key={i}
                  className={`chat-msg ${m.role === "assistant" ? "assistant" : ""}`}
                >
                  <span className="who">
                    {m.role === "user" ? "You" : "Assistant"}
                  </span>
                  {m.content}
                </div>
              ))
            )}
            </div>
            <div className="chat-input-row">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g. Tighten to ~220 words; keep Frontier metrics"
              aria-label="Chat instruction"
              disabled={!letter.trim()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={
                loadingChat || !letter.trim() || !chatInput.trim()
              }
              onClick={() => void sendChat()}
            >
              {loadingChat ? "…" : "Send"}
            </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
