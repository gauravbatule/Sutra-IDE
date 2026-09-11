# SUTRA Studio ⚡
> **AI-Native Autonomous Software Development Studio & Multimodal Engineering Harness**

SUTRA Studio is a developer studio built for autonomous software development. It combines local and frontier AI multi-model routing, automatic fallback chains for text/image/video/audio, interactive ReAct agent tool loops, a native Windows PowerShell ConPTY terminal, Monaco code editor, and internal multimodal asset generation.

---

## 🚀 Quick Start Guide

### 1. Installation & Prerequisites
- **Node.js**: v18.0.0 or later
- **Operating System**: Windows 10/11, macOS, or Linux

```bash
# Clone or navigate to the project directory
cd omnicraft-ide

# Install dependencies
npm install
```

### 2. Launching SUTRA Studio
You can start the full development environment with a single command:

```bash
# Start Vite frontend, Express API server, and OmniRoute Gateway simultaneously
npm run dev
```

Or double-click `run-ide.bat` on Windows to start the studio and open the native app window automatically.

- **Desktop IDE URL**: [http://localhost:5173](http://localhost:5173)
- **API Server & WebSockets**: `http://localhost:3001`
- **OmniRoute Local Gateway**: `http://localhost:20128`

---

## 🧠 AI Provider & Model Setup

SUTRA Studio does not require hardcoded keys. You can configure any provider via the in-app **Settings Modal** (click Settings in the ActivityBar) or by adding environment variables in a `.env` file:

| Provider | Environment Variable | Recommended Models | Key Creation URL |
|---|---|---|---|
| **Google Gemini** | `GEMINI_API_KEY` | `gemini-2.0-flash`, `gemini-1.5-pro` | [aistudio.google.com](https://aistudio.google.com/app/apikey) (Free) |
| **OpenRouter** | `OPENROUTER_API_KEY` | Claude 3.7 Sonnet, GPT-4o, DeepSeek | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Groq LPUs** | `GROQ_API_KEY` | `llama-3.3-70b-versatile`, `qwen-2.5-coder` | [console.groq.com](https://console.groq.com/keys) (Free Tier) |
| **DeepSeek** | `DEEPSEEK_API_KEY` | `deepseek-v3`, `deepseek-r1` | [platform.deepseek.com](https://platform.deepseek.com) |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-3-7-sonnet`, `claude-3-5-sonnet` | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o`, `o3-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Local Ollama** | `OLLAMA_BASE_URL` | `qwen2.5-coder`, `llama3.3` | [ollama.com](https://ollama.com) (100% Offline) |

---

## 🛠️ Multi-Tier Autonomous Fallback Chains

SUTRA guarantees zero disruption during execution by employing multi-tier fallback chains:
- **Text Models**: Selected Model → Google Gemini → OpenRouter → Groq → DeepSeek → OpenAI → Anthropic → Local Ollama.
- **Image Generation**: OmniRoute / DALL-E → Pollinations FLUX Engine → Bespoke Luxury Vector SVG Engine.
- **Video Generation**: OmniRoute Video → Pollinations Video Engine → High-FPS Procedural Animated Visual Canvas.
- **Audio & Speech**: OpenAI / OmniRoute TTS → Google TTS API → Procedural 44.1kHz 16-bit PCM WAV Synthesizer.

---

## 🛠️ Studio Feature Tour

### 1. 🤖 Autonomous ReAct Agent Loop
- Operates directly on your workspace files with surgical precision.
- **Internal Multimodal Generation**: The agent generates images, videos, audio cues, and SVGs internally and presents them directly in the chat feed with interactive players.
- **Integrated Agent Tools**:
  - `read_file`: Inspect exact file contents before making edits.
  - `write_file`: Create new files or replace full modules.
  - `edit_file`: Targeted surgical string replacements.
  - `run_command`: Execute test runners, package installers, and build commands in PowerShell.
  - `generate_image_asset`: Creates and saves images to `/public/assets/`.
  - `generate_video_asset`: Creates motion video assets.
  - `generate_audio_asset`: Creates tactile UI audio and speech.
  - `search_web` & `scrape_url`: Query modern documentation and extract compressed web content.
  - `spawn_subagent`: Allocate parallel specialist workers (frontend, backend, QA, media).
- **Interactive Pause & Steering**: Hit **Pause** at any time without losing code or context, and provide real-time steering instructions.
- **Autopilot vs Safe Mode**: Toggle between **Auto** (unattended autonomous execution) and **Safe** (manual approval before modifying files or running commands).

### 2. 💻 PowerShell ConPTY Native Terminal
- Full interactive Windows PowerShell session with ANSI true-color and keystroke multiplexing.
- Toggle at any time with **`Ctrl+\``** or the terminal icon in the ActivityBar.

### 3. 📱 Multi-Device Live Viewport Sandbox
- Real-time live preview of your web application across responsive frames:
  - **Fluid Desktop** (100%)
  - **Tablet** (iPad Pro 768 × 1024)
  - **Mobile** (iPhone 15 Pro 393 × 852)
- Anti-Slop Visual QA auditor to verify WCAG contrast, typography friction, and responsive layout hygiene.

---

## ⌨️ Universal Keyboard Shortcuts

| Shortcut | Description |
|---|---|
| **`⌘K` / `Ctrl+K`** | Open Command Palette & Quick File Search |
| **`Ctrl+S`** | Save active file in Monaco Editor |
| **`Ctrl+\``** | Toggle PowerShell ConPTY Terminal |
| **`Ctrl+Shift+E`** | Open File Explorer |
| **`Ctrl+Shift+F`** | Open Workspace Code Search |
| **`Esc`** | Close any active modal or palette |

---

## 📁 Repository Architecture

```
omnicraft-ide/
├── public/                 # Static web assets & generated media
├── server/                 # Express backend & WebSocket multiplexer
│   ├── agentSwarm.ts       # Subagent matrix & parallel workers
│   ├── db.ts               # SQLite database (sessions, workspaces, keys)
│   ├── fsTools.ts          # Filesystem CRUD, grep search, git diffs
│   ├── mediaEngine.ts      # Multimodal asset generation engine
│   ├── modelRouter.ts      # Multi-provider dynamic AI routing
│   ├── ptyManager.ts       # Windows ConPTY PowerShell terminal manager
│   ├── mobileBridge.ts     # LAN QR pairing & phone socket gateway
│   └── index.ts            # REST API & WebSocket routing gateway
├── src/                    # React 18 + Vite frontend
│   ├── components/
│   │   ├── Agent/          # Autonomous agent chat, markdown, tool cards
│   │   ├── CommandPalette/ # Quick file & command search
│   │   ├── DesignVault/    # Godly UI patterns & live web scraper
│   │   ├── Editor/         # Monaco editor & tab bar
│   │   ├── Explorer/       # File tree & workspace manager
│   │   ├── Git/            # Real-time git status & visual diffs
│   │   ├── Guide/          # Interactive User Guide & onboarding tour
│   │   ├── Layout/         # TitleBar, ActivityBar, AppShell, StatusBar
│   │   ├── MediaStudio/    # Multimodal image, video, audio generation
│   │   ├── MobileConnect/  # QR code pairing modal
│   │   ├── Preview/        # Multi-device responsive sandbox preview
│   │   ├── Search/         # Workspace grep search
│   │   └── Settings/       # AI provider keys & latency tests
│   ├── stores/             # Zustand state management
│   └── App.tsx             # Main desktop & mobile shell
└── vendor/omniroute/       # Local OmniRoute multi-model gateway
```

---

## 📄 License
MIT License. Built for autonomous software engineering.
