# SUTRA

> AI-native autonomous product development studio

SUTRA pairs a calm, keyboard-first workspace with Astra, an autonomous engineering agent that reads, writes, and runs code directly in your project. Multi-provider model routing with automatic fallback, micro-checkpoints before every mutation, structured verification of completed work, and a native terminal — in one desktop-grade application.

---

## Quick Start

**Prerequisites:** Node.js 18+, Windows 10/11, macOS, or Linux.

```bash
npm install
npm run dev
```

Or double-click `run-ide.bat` on Windows to start the studio and open the native app window automatically.

| Surface | URL |
|---|---|
| Desktop IDE | http://localhost:5173 |
| API server & WebSockets | http://localhost:3001 |
| Bundled local model gateway | http://localhost:20128 |

---

## Model Setup

No hardcoded keys. Configure providers in-app via **Settings**, or provide environment variables in a `.env` file:

| Provider | Environment Variable | Notes |
|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | Free tier available |
| OpenRouter | `OPENROUTER_API_KEY` | Frontier + open models |
| Groq | `GROQ_API_KEY` | Free tier available |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| Anthropic | `ANTHROPIC_API_KEY` | |
| OpenAI | `OPENAI_API_KEY` | |
| Local Ollama | `OLLAMA_BASE_URL` | 100% offline |

Requests route through your selected model first, then fall back across configured providers automatically so long runs never stall on a single provider.

---

## How Astra Works

Astra operates on your workspace through a verified execution pipeline:

1. **Plan** — interprets the objective and proposes an approach.
2. **Act** — reads, edits, and runs code through sandboxed tools.
3. **Verify** — typechecks, tests, and builds where applicable; results are surfaced as evidence, not claims.
4. **Report** — every changed file, command, and verification result is reviewable inline.

### Agent Tools

| Tool | Purpose |
|---|---|
| `read_file` / `write_file` / `edit_file` / `delete_file` | Filesystem mutations, checkpointed before every write |
| `grep_search` / `list_directory` | Workspace search and inspection |
| `run_command` | Test runners, package managers, builds (PowerShell / shell) |
| `generate_image_asset` / `generate_video_asset` / `generate_audio_asset` | Multimodal asset generation into `/public/assets/` |
| `search_web` / `scrape_url` | Documentation research with content containment |
| `spawn_subagent` | Parallel specialist workers sharing one event log |

### Safety Model

- **Autonomous mode** for unattended runs; **approval mode** gates every mutation and command behind explicit consent.
- Automatic micro-checkpoints are captured before each modification, with selective rollback from the checkpoints API.
- Tool outputs from untrusted sources are structurally contained; credentials are redacted from all model context.

---

## Workspace

- **Manager mode** — chat-first home for planning and reviewing agent work.
- **IDE mode** — Monaco editor, file explorer, workspace search, Git panel, integrated terminal, diagnostics, live preview across device viewports.
- **Mobile companion** — pair by QR to approve, steer, and monitor runs from your phone.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette & quick file open |
| `Ctrl+S` | Save active file |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+Shift+E` | File explorer |
| `Ctrl+Shift+F` | Workspace search |
| `Esc` | Close modal or palette |

---

## Repository Layout

```
omnicraft-ide/
├── public/            # Static assets & generated media
├── server/            # Express API, WebSocket multiplexer, agent core
│   ├── harness/       # Turn engine, checkpoints, self-healing
│   ├── tools/         # Filesystem, LSP, diff, indexing, research tools
│   └── providers/     # Model provider catalog & auth
├── src/               # React 18 + Vite frontend
│   ├── components/    # Manager, Agent, Editor, Layout, Git, Preview...
│   └── stores/        # Zustand state
├── desktop/           # Electron shell
└── vendor/            # Bundled local model gateway (external project)
```

---

## License

MIT. Built for autonomous software engineering.
