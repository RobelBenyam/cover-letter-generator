import { useCallback, useEffect, useState } from "react";

type ChatTurn = { role: "user" | "assistant"; content: string };

const PROFILE_STORAGE_KEY = "atlasco-cover-profile";

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
  const [jobDescription, setJobDescription] = useState("");
  const [letter, setLetter] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  /** When false and profile exists, show compact banner instead of textarea */
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fromBrowser = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (fromBrowser !== null) {
          setProfile(fromBrowser);
          if (fromBrowser.trim()) setEditProfileOpen(false);
          return;
        }
      } catch {
        /* private mode */
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
      } else if (err && !err.includes("404")) {
        setError(err);
      }
    })();
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
        jobListingUrl: "",
        jobWebsiteUrl: "",
        managerUrl: "",
      }),
    });
    setLoadingGen(false);
    if (err) {
      setError(err);
      return;
    }
    setLetter(data?.letter || "");
  }, [profile, jobDescription]);

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
        jobListingUrl: "",
        jobWebsiteUrl: "",
        managerUrl: "",
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
    setLetter(data?.letter || letter);
    setChatHistory([
      ...nextHistory,
      { role: "assistant", content: assistantMsg },
    ]);
  }, [chatInput, letter, chatHistory, profile, jobDescription]);

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
            {import.meta.env.PROD
              ? "Resume stays in this browser. API key lives in Vercel env only."
              : "Local: key in .env · resume in this browser + profile.txt when you save."}
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
          <h2 className="panel-title">Inputs</h2>
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
                      Use Edit to replace your resume text anytime.
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
                <label>Resume / profile</label>
                <textarea
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  placeholder="Paste your resume — then Save"
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
          <div className="field field--tight-top field--grow">
            <label htmlFor="jd">Job description</label>
            <textarea
              id="jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full posting (role, responsibilities, requirements)."
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
            {!profile.trim() ? (
              <span className="field-hint">Add a resume first (Edit resume).</span>
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
            <h3 className="chat-block-title">Refine with chat</h3>
            <p className="section-hint">
              Ask for edits (tone, length, one extra bullet). The model rewrites
              the full letter using only your resume facts.
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
              placeholder="e.g. Shorten to 250 words; keep the Raleigh angle"
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
