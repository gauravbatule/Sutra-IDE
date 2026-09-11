# SUTRA Studio — User Guide

SUTRA is an AI-native development studio. Astra, the built-in autonomous agent, reads and writes files, runs commands, and builds entire projects in your workspace while you supervise from a keyboard-first interface.

---

## Contents

1. [Setup & Launch](#1-setup--launch)
2. [Providers & Authentication](#2-providers--authentication)
3. [Local Models (Ollama & LM Studio)](#3-local-models-ollama--lm-studio)
4. [Model Routing & Fallback](#4-model-routing--fallback)
5. [Working with Astra](#5-working-with-astra)
6. [Media Generation](#6-media-generation)
7. [Terminal](#7-terminal)
8. [Live Preview & Mobile Companion](#8-live-preview--mobile-companion)
9. [Git Integration](#9-git-integration)
10. [Keyboard Shortcuts](#10-keyboard-shortcuts)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Setup & Launch

**Prerequisites:** Node.js 18+. Windows 10/11 recommended (PowerShell terminal); macOS and Linux work with the default shell.

```bash
npm install
npm run dev
```

Two processes start together:

| Surface | Address | Notes |
|---|---|---|
| API server + WebSockets | `http://localhost:3001` | Express backend, agent stream, health at `/health` |
| Vite dev client | `http://localhost:5173` | Proxies `/api` and `/ws` to port 3001; bound to `0.0.0.0` for LAN access |

**Windows one-click launch:** double-click `run-ide.bat`. It starts the server on port 3001, waits for the health check, and opens `http://localhost:3001` in an app-mode browser window. Use this after running `npm run build` for a packaged experience, or as a quick daily launcher.

**Desktop shell:** `npm run desktop` starts the Electron window.

### First run

1. Open the app and click **Open Workspace** on the welcome screen to pick your project folder (falls back to typing an absolute path if no native picker is available).
2. Click **Configure Keys** (or open Settings) to connect at least one provider — or skip this entirely if your machine already has a Google sign-in (see the Antigravity Bridge below).
3. Describe what you want built in the Astra panel on the right.

Change the workspace anytime via **Open Workspace**, or from Manager mode's sidebar (**Open Folder** / create a new folder). Switching reloads the workspace view, terminal root, and media output directory.

---

## 2. Providers & Authentication

Open **Settings** from the ActivityBar gear icon or the command palette (`Ctrl+K`, then type Settings). The modal has six tabs: **Providers & Keys**, **Routing & Failovers**, **Local Model Discovery**, **Custom Endpoints**, **MCP Client**, and **About**.

### Provider catalog (Providers & Keys)

A searchable catalog of providers grouped by category: Frontier Labs, Web Session Cookies, Inference Hosts, Regional AI, Enterprise Cloud, Media & Voice, Local & Free.

Each provider supports one or more auth modes:

- **API Key** — paste the key, click **Save**, then **Test Ping** to verify latency.
- **Cookie Session** — paste web session cookies (the card shows which cookie names the provider expects).
- **OAuth Login** — opens the provider site; you sign in there and paste the session cookie back (used where no direct OAuth handshake exists).

Saved secrets are never echoed back — the form shows a masked preview only. Credentials persist in local SQLite; environment variables (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`) are also honored.

### Antigravity Bridge (zero-config Google)

If this machine has ever signed in with the Gemini CLI or the Antigravity IDE, SUTRA detects that existing Google sign-in at `~/.gemini/oauth_creds.json` automatically:

- **No key paste, no cookie paste, no OAuth flow inside SUTRA.** The stored refresh token is reused and access tokens are refreshed automatically before they expire; renewed tokens are written back so the Gemini CLI stays in sync.
- Requests route through Google's Code Assist API exactly like the Gemini CLI. Secrets stay in memory and are never logged.
- The providers **Antigravity (Google)** and **Antigravity Session** appear under Web Session Cookies with an **Auto Sign-In** badge, and are treated as connected the moment a usable local sign-in is found. The model picker lists these models under the **Antigravity Bridge** group.
- Pasting a cookie into those provider cards is an optional override only. An advanced variant can route through a self-hosted bridge runtime by setting a Base URL.

To check detection status: `GET /api/providers/antigravity-status` returns a plain-text summary (never secrets). If nothing is detected, see [Troubleshooting](#11-troubleshooting).

### Custom endpoints (Custom Endpoints tab)

Register any OpenAI-compatible endpoint or media model:

- Pick a category: **Image Generation**, **Video Diffusion**, **Voice & Audio**, or **LLM & Reasoning**.
- Enter a display name, the model ID / hub path, and the gateway (e.g. `replicate`, `fal-ai`, `openai`, or a local URL).
- The **description field is injected into the agent's system prompt**, teaching Astra when to route work to this model autonomously.
- Optional base URL and API key. For LLM entries, an optional context-window value is honored by routing and compaction (default 128K tokens if omitted).
- Saved models appear in the model picker without a restart and can be deleted from the same tab.

### MCP Client tab

Attach external MCP tool servers (stdio, SSE, or HTTP transport) such as databases or design tools. Registered servers stay active in the sidebar list and can be removed anytime.

---

## 3. Local Models (Ollama & LM Studio)

The **Local Model Discovery** tab manages on-device inference. Everything here works fully offline.

### Ollama manager

- Installed models are **fetched automatically** when the tab opens (Ollama daemon on `localhost:11434`); use the refresh icon to re-scan.
- Each row shows parameter size, disk size, and context window, plus capability badges:
  - **AGENT-READY** — supports tool calling; fully usable for Astra agent runs.
  - **CHAT ONLY** — no tool calling; chat responses only, not autonomous runs.
  - **VISION** — understands images.
- **Download any model** by typing its name (e.g. `qwen2.5-coder:7b`) and pressing Download. Progress streams live with a percentage bar.
- **Delete** a model from disk with the trash icon on its row.

Prefer tool-calling models (look for AGENT-READY) if you want Astra to act on them; chat-only models still work for plain conversations.

### LM Studio

Start the LM Studio local server (port 1234), press the scan icon in the Local Model Discovery tab, and discovered models register with the router immediately.

---

## 4. Model Routing & Fallback

### Auto chain

The default selection, **Astra Auto-Chain**, routes every request through your connected providers in order: Gemini, Claude, GPT, ChatGPT Web, Groq, DeepSeek, GLM, Grok, Ollama. You can also pin a specific model from the picker above the chat input.

### Automatic failover

Always active. When a provider errors or rate-limits, the request hands off across your connected providers — up to 30 total attempts before an honest failure. Every handoff is announced live in the Thinking trace and the Activity network log. Oversized tool outputs are compacted automatically at a 4,800-token safeguard so requests never die on payload limits.

### Priority ordering

Settings > Routing & Failovers > **Model Priority**: drag connected models to set the order the auto chain tries them. Top of the list is tried first. The order persists locally.

### Context windows drive compaction

Every model carries a known context window. When a conversation crosses the configured share of that window (default **80%**, adjustable 60–95% in Routing & Failovers), older messages are summarized automatically — long sessions keep working instead of failing on length. Compaction can be toggled off on the same panel. Custom LLM endpoints use the context-window value you supply.

### Thinking and reasoning

Reasoning-capable models stream their deliberation into a collapsible **Thinking** trace above the answer; fallback handoffs and retry notices also appear there. Which models expose reasoning varies — frontier reasoning models do, fast flash-tier models generally do not.

---

## 5. Working with Astra

Describe what you want in natural language: features, bug fixes, full apps, audits, refactors. Astra plans, edits files, runs commands, verifies results, and reports inline.

### Permission modes

Toggled from the command palette ("Permissions"), the shield control next to the Manager composer, or the status bar:

| Mode | Behavior |
|---|---|
| **Strict** | Astra asks for approval before every file write, edit, delete, and terminal command. Approval cards render inline in the chat. |
| **Full Access** | Astra works autonomously until the task completes. |

The active mode is always visible in the status bar. Checkpoints are captured before mutations either way.

### Tool cards

Each executed step renders as an inline card in chronological order: files read/written/edited, terminal commands with output, searches, git operations, generated media previews, subagent spawns, and more. Failed steps stay visible rather than disappearing.

### Slash commands

Type `/` in the composer to surface the command menu:

| Command | Purpose |
|---|---|
| `/plan` | Plan step by step, wait for confirmation |
| `/fix` | Find and fix every error, verify with build/tests |
| `/test` | Write and run tests for something |
| `/explain` | Explain structure, entry points, data flow |
| `/goal` | Long-mission loop: inspect, execute, test, and fix repeatedly until fully finished |

`/goal` can also be typed as a prefix, or enabled as a persistent toggle chip ("/goal ON") above the composer.

### Prompt queue

Messages sent while a task is running are staged in a numbered queue instead of interrupting. They dispatch automatically, in order, the moment the current run finishes. Remove items from the queue before they run; switching sessions clears it.

### Mid-flight steering

While Astra works, type an instruction and click **Steer**. Your message joins the live conversation at the next round boundary — no restart, no lost progress. If the run ends before the steer lands, it is moved to the queue instead of being dropped.

### Pause, resume, verify

Click **Pause** (or press `Esc` while generating) at any time. All progress, files, and tool outputs are preserved. The paused message offers **Resume** (continue where it left off) and **Verify** (audit all files, typecheck, and test). You can also type fresh instructions while paused.

### Long missions

Hours-long runs stay stable through three mechanisms working together: automatic failover across up to 30 attempts, automatic context compaction at the configured threshold, and elapsed-time tracking in the header. Astra also records clarifying questions mid-task with the `ask_user` tool — answer inline with options or free text.

### Learning from failed approaches

When a method fails repeatedly in your workspace, Astra records it as a lesson and silently avoids repeating that exact approach, starting with a different method instead. Lessons persist across sessions in workspace memory alongside compact per-file notes, so past dead ends are not re-explored tomorrow.

### Sessions, mentions, attachments

- Session history lives in the clock icon: resume, rename-by-first-prompt, or delete previous threads.
- `@` autocompletes workspace files directly into prompts.
- Attach or paste screenshots — vision-capable models analyze them through the auto-vision handoff.
- Voice dictation via the microphone icon where the browser supports it.
- Quick chips above the composer fire common missions (/goal Loop, Fix Errors, Scaffold App, QA Audit, Responsive UI, Assets).
- Complex work splits across parallel specialist subagents; monitor them from the Agents sidebar panel.

---

## 6. Media Generation

Media generation covers distinct capabilities, each routed to the best available engine with automatic fallbacks. Ask Astra in plain language — phrasing selects the modality automatically — or use the **Media Studio** (command palette > Media Studio) with dedicated Image, Video, and Audio tabs plus a gallery. Assets save under `public/assets/` and preview inline in chat.

| Capability | What it produces | Engines |
|---|---|---|
| Image | PNG/WebP artwork, banners, logos | DALL-E 3, Google Imagen, Replicate, Pollinations, SVG vector fallback |
| SVG | Clean scalable vector code | Built-in generator |
| Video | Short motion clips (.mp4/.webm) | Replicate Minimax, Pollinations |
| Speech / audio cues | Voiceover and UI sounds | Google TTS, procedural 44.1 kHz synthesizer fallback |
| Sound effects | Short non-musical cues, impacts, foley | Fully local DSP synthesis — deterministic per prompt, offline |
| Music | Instrumental tracks (score, loop, theme) with mood/BPM/loop options | Local synthesizer (chords, bass, lead, percussion) — offline |
| Song | Lyrics sung over an instrumental bed | Local instrumental bed + TTS narration of your lyrics, mixed locally with bed ducking; saved as separate stems if no ffmpeg is present |

Notes on honesty guarantees: video generation never inserts placeholders — if no video provider is configured, Astra asks you for a real .mp4/.webm file instead. Songs pair a locally synthesized instrumental bed with text-to-speech narration of the lyrics (not a trained singing voice), and every asset records its provenance. Custom image/video/audio models registered on the Custom Endpoints tab are injected into Astra's system prompt so tool routing matches your described purpose automatically.

---

## 7. Terminal

The integrated terminal runs a real ConPTY session via node-pty:

- **Windows:** PowerShell (`powershell -NoLogo`). **macOS/Linux:** your default `$SHELL`.
- Full xterm-256color truecolor rendering, instant resize, workspace-root working directory.
- Toggle from the ActivityBar terminal icon or the command palette entry "Terminal: Toggle PowerShell ConPTY Terminal".
- Background processes started by Astra (`run_background_process`) are tracked separately and stoppable from the Processes API and agent tools.

---

## 8. Live Preview & Mobile Companion

- Toggle **Preview** from the TitleBar or command palette. Viewports: **Fluid Desktop**, **Tablet (iPad Pro, 768x1024)**, **Mobile (iPhone 15 Pro, 393x852)**, with hard-reload and viewport labels.
- Generated sites are served read-only at `/workspace/<path>`, so any HTML Astra writes renders live immediately.
- The dev client binds to `0.0.0.0`, so other devices on your LAN can reach the preview.
- **Phone pairing:** command palette > "Mobile: Show Smartphone Pairing QR Code" scans over LAN Wi-Fi. From your phone you can approve permission requests, steer, and monitor runs.

---

## 9. Git Integration

- The Git sidebar shows branch, changed files, and diffs.
- Type a commit message and press `Ctrl+Enter` to stage and commit.
- Initialize a repository from the panel if the workspace has none.
- Astra mirrors these operations as tools: `git_status`, `git_diff`, `git_commit`, `git_branch`, `git_checkout`, `git_stash`, `git_log`, `git_cherry_pick` — useful for "commit this with a good message" style instructions.

---

## 10. Keyboard Shortcuts

Only verified bindings are listed.

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Ctrl+Shift+P` | Command palette and quick file open |
| `Esc` | Close palette/modal, cancel mention popup, stop dictation, or pause a running Astra task |
| `Enter` | Send prompt (composer) |
| `Shift+Enter` | New line in composer |
| `Ctrl+S` | Save the active file (editor) |
| `Ctrl+Enter` | Commit changes (Git panel message box) |

Everything else — terminal toggle, preview, sidebar panels, settings, permission switch — is reachable from the command palette (`Ctrl+K`).

---

## 11. Troubleshooting

**A provider fails or rate-limits.**
Nothing to do — the router hands off to the next connected provider automatically (up to 30 attempts), announcing each hop in the Thinking trace. Only a final exhausted failure surfaces, with one-click Retry Prompt and Configure API Keys actions.

**Changing the workspace.**
Welcome screen **Open Workspace**, Manager sidebar **Open Folder**, or create a brand-new folder from the same sidebar. The explorer, terminal root, and media directory all follow.

**Fully offline operation.**
Install Ollama, download a model in Settings > Local Model Discovery (e.g. `qwen2.5-coder:7b`), and pick it in the model selector. Coding, terminal, previews, sound-effect/music synthesis, and the procedural audio fallback all run locally. Check the badges: AGENT-READY models can drive Astra; CHAT ONLY models cannot execute tools.

**Antigravity sign-in not detected.**
SUTRA reads the Google sign-in that the Gemini CLI creates. If `~/.gemini/oauth_creds.json` does not exist yet, install the Gemini CLI and run `gemini` once — complete the browser sign-in — then restart SUTRA or re-check the provider list. The bridge picks up the credentials automatically and refreshes tokens from then on.

**Token expired for the Antigravity bridge.**
Refresh is automatic while a refresh token exists. If refresh fails (for example after revoking access), sign in once more with the Gemini CLI to renew.

**Port already in use.**
The server needs 3001 and the dev client 5173. Free the port or stop the other process; `run-ide.bat` reports if the server does not come online within 90 seconds.

**Where are my keys stored?**
Locally only — SQLite (`sutra.db`) plus `.env`. Nothing is prefilled back into forms; masked previews only. The About tab shows the installed version and checks for updates without ever downloading one automatically.
