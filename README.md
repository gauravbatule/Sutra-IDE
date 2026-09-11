<div align="center">
<pre>
  ███████╗██╗   ██╗████████╗██████╗  █████╗     ██╗██████╗ ███████╗
  ██╔════╝██║   ██║╚══██╔══╝██╔══██╗██╔══██╗    ██║██╔══██╗██╔════╝
  ███████╗██║   ██║   ██║   ██████╔╝███████║    ██║██║  ██║█████╗  
  ╚════██║██║   ██║   ██║   ██╔══██╗██╔══██║    ██║██║  ██║██╔══╝  
  ███████║╚██████╔╝   ██║   ██║  ██║██║  ██║    ██║██████╔╝███████╗
  ╚══════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═╝╚═════╝ ╚══════╝
</pre>
  <h1>SUTRA IDE</h1>
  <p><strong>The AI-Native Autonomous Product Development Studio</strong></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT%20with%20Attribution-yellow.svg" alt="License" /></a>
    <a href="https://github.com/gauravbatule/Sutra-IDE"><img src="https://img.shields.io/badge/Tests-488%2F488%20passed%20(71%20suites)-brightgreen.svg" alt="Tests" /></a>
    <a href="https://github.com/gauravbatule/Sutra-IDE"><img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20%7C%20Cross--Platform-blue.svg" alt="Platform" /></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node" /></a>
    <a href="https://github.com/gauravbatule"><img src="https://img.shields.io/badge/Author-Gaurav%20Batule-orange.svg" alt="Author" /></a>
  </p>
  <p>
    <a href="https://github.com/gauravbatule/sutra-web">Website & Releases</a> •
    <a href="https://github.com/gauravbatule/Sutra-IDE/issues">Report Issue</a> •
    <a href="CONTRIBUTING.md">Contributing</a> •
    <a href="LICENSE">License</a>
  </p>
</div>

---

> [!IMPORTANT]
> ### ⚠️ Mandatory Attribution & Reuse Policy
> **SUTRA IDE is created by Gaurav Batule.**
> This project is open-source under the **MIT License with Attribution Requirement**. You are welcome to inspect, study, fork, and build upon this project.
> 
> **However, before reusing, redistributing, or forking any part of this codebase (in products, applications, SaaS, open-source projects, or distributions), you MUST provide explicit, prominent, and visible credit and attribution to Gaurav Batule and include a link back to the official repository:**
> 👉 **https://github.com/gauravbatule/Sutra-IDE**

> [!NOTE]
> ### 🤖 AI-Assisted Development & Community Validation
> **Transparency Notice**: This codebase was developed with the assistance of autonomous AI coding agents and LLM pair-programming workflows. While the system is backed by a rigorous automated test suite (**488/488 tests passing across 71 test suites**) and strict TypeScript compiler guarantees, **contributors and developers are encouraged to thoroughly review, audit, and validate logic for their specific environments.**
>
> 🔒 **Dependency & Security Recommendation (Axios Advisory)**:
> By default, SUTRA IDE uses native Node.js/browser `fetch` and direct socket bridges. If you integrate or extend SUTRA with `axios` in custom plugins, proxies, or downstream forks, **we strongly recommend ensuring you use the latest patched version (`axios >= 1.7.9`)** to avoid known vulnerabilities (such as SSRF, ReDoS, and prototype pollution) present in legacy releases (< 1.7.4).

---

## 🌟 Overview

**SUTRA IDE** bridges the gap between high-level architectural conversation and hands-on, full-stack code execution. Built from the ground up for developers who demand both the chat clarity of an autonomous agent and the precise editor mechanics of modern tools like Cursor and VS Code.

Unlike conventional chat wrappers, SUTRA pairs **Astra** (an autonomous agent engine) with a full **Monaco editor**, an interactive **Visual Element Inspector**, **110+ model routing**, a **7-tier cognitive memory system**, an **autonomous task scheduler**, and a **hardware-accelerated ConPTY terminal**.

---

## 🚀 Key Features

### 1. ⚡ Cursor-Class Inline AI & Code Editing
* **Inline Fast Edit (`Ctrl + K` / `Cmd + K`)**: Highlight any block of code or trigger on blank lines to describe changes in natural language. Watch streaming diffs appear directly in the editor buffer with instant Accept (`Enter`) or Reject (`Esc`).
* **AI Diagnostics Fixer Bar**: Floating glassmorphic indicator catches TypeScript, ESLint, and syntax errors in real time. A single click on **"Fix with AI"** feeds exact line numbers and LSP compiler errors directly to Astra for instant repair.
* **Full Monaco Engine**: Syntax highlighting, auto-complete, bracket matching, minimap, document symbol Outline Panel, and file breadcrumbs.
* **Side-by-Side Review Diffs**: Semantic LCS diff viewer with per-file or batch rollback and visual addition/deletion highlights.

### 2. 🧠 Chat-First "Manager Mode" + Instant IDE
* **Unified Dual-Mode Workflow**: Switch seamlessly between **Manager Mode** (conversation canvas for planning, roadmaps, and requirements review) and **IDE Mode** (file tree, tabs, editor, preview, and terminal).
* **Astra Autonomous Agent**:
  * **Strict vs. Full Access Safety Gates**: Granular approval controls for file writes, edits, and terminal commands.
  * **Interactive Question Anchors**: Instead of guessing ambiguous specs, Astra renders clickable multiple-choice decision cards to confirm architecture before touching code.
  * **Visual Multi-Agent Swarm**: Spawns parallel background subagents (research, indexing, debugging) and visualizes their live execution tree.
  * **Task Plans & Artifacts**: Live execution progress cards, markdown plan documents, and inline test walkthroughs.

### 3. 🌐 110+ Models & Cookie Gateway
* **Universal Provider Routing**: One dropdown connecting **GPT-5, Claude 5, Gemini 3, DeepSeek V3/R1, Qwen 2.5, Grok, GLM, NVIDIA NIM, Cerebras, Groq, and local Ollama** instances.
* **Zero-API-Key Cookie Login**: No API credits? Paste browser session cookies for ChatGPT, Claude, or Gemini Web. SUTRA automatically reassembles split tokens.

### 4. 👁️ Live Preview & Visual Element Inspector
* **Zero-Config Framework Detection**: Auto-discovers running dev servers across **Next.js, Vite, Astro, Nuxt, Remix, Svelte, CRA, Python FastAPI/Flask, and static HTML**.
* **Visual Element Inspector**: Click any visual component directly inside your running web app. SUTRA captures its exact CSS selector, HTML tags, class names, DOM hierarchy, and computed styles. Ask Astra: *"Make this button emerald with rounded corners"* and it updates the exact React/CSS file directly.
* **Multi-Viewport Responsive Testing**: Instant switching between Desktop, Tablet, and Mobile views.

### 5. 🧠 7-Tier Cognitive Long-Horizon Memory
SUTRA maintains persistent context across sessions using 7 distinct memory layers:
1. **Working Memory**: Active session scratchpad and tool context.
2. **Semantic Memory**: Project architectural rules, codebase facts, and domain conventions.
3. **Episodic Memory**: Past conversation trajectories and solved bug histories.
4. **Procedural Memory**: Established testing workflows and build procedures.
5. **Retrieval Memory**: Vector and lexical search over previous workspace states.
6. **Parametric Memory**: Model capability scores and preferred prompt structures.
7. **Prospective Memory**: Delayed reminders and scheduled future task executions.

### 6. ⏱️ Autonomous Task Scheduler & Watchdog
* Schedule recurring background agent jobs (**Hourly, Daily, Weekly, or One-Time**).
* Built-in engine watchdog detects execution loops, timeouts, and stalls automatically.

### 7. 🎨 Built-In Multimodal Media Studio
* Text-to-image and text-to-video generation directly inside the IDE.
* Procedural UI sound and audio synthesizer generating clean WAV audio clips for buttons, chimes, and alerts.

### 8. 📱 Mobile Companion & QR Remote Control
* Scan a QR code on your phone to connect over local Wi-Fi.
* Steer builds via voice input and attach phone camera photos/mockups directly to your desktop workspace.

### 9. 🔒 100% Local-First & Private
* Zero telemetry. No forced external accounts. Your code, API keys, and session cookies stay strictly on your local machine.

### 10. 🪟 Native Windows Desktop Experience
* Compiled native C++ launcher (`SUTRA-IDE.exe`) with multi-resolution high-DPI icons, single-instance mutex, automatic port conflict recovery, and clean child process tree teardown.
* 1-click NSIS setup installer (`SUTRA-IDE-Setup-1.0.0.exe`) with Start Menu registration.

---

## 🏛️ Architecture Overview

| Subsystem | Core Technologies | Primary Role |
|---|---|---|
| **Editor & Workspace** | Monaco Editor, React 18, Tailwind CSS, Lucide | Inline AI editing, diagnostics fixer bar, tab management, file explorer |
| **Agentic Harness** | Astra Engine, AVO Loop, Self-Healing, Watchdog | Autonomous planning, tool dispatching, verification, loop prevention |
| **Intelligence Router** | OpenAI, Anthropic, Gemini, DeepSeek, Ollama | Dynamic failover routing across 110+ frontier & local models |
| **Live Preview** | Multi-Viewport, Element Inspector Injection | Dynamic dev-server detection and live DOM inspection |
| **Terminal & Shell** | ConPTY, xterm.js, CanvasAddon, WebLinks | Hardware-accelerated multi-tab terminal with automated error diagnostics |
| **Memory Subsystem** | 7-Type Cognitive Store, SQLite (`better-sqlite3`) | Persistent cross-session semantic, episodic, and procedural memory |
| **Native Packaging** | Microsoft C#/.NET Compiler (C++), Electron, NSIS | Standalone native launcher executable & Windows setup installer |

---

## 📦 Quick Start

### Prerequisites
- [Node.js 20+](https://nodejs.org)
- Windows 10/11, macOS, or Linux

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/gauravbatule/Sutra-IDE.git
cd Sutra-IDE

# 2. Install dependencies
npm install

# 3. Launch development studio
npm run dev
```

The application runs on:
* **Frontend Web Client**: `http://localhost:5173`
* **Local Server & API**: `http://localhost:3001`

### Building Production App

```bash
# Build production client and server bundles
npm run build

# Package native Windows launcher executable (SUTRA-IDE.exe)
npm run build:exe

# Package 1-click NSIS Windows installer (dist-exe/native/)
npm run desktop:build
```

---

## 🧪 Testing & Verification

SUTRA IDE includes a comprehensive test suite covering editor components, agent harnesses, memory subsystems, and WebSocket bridges:

```bash
# Run full test suite (71 test suites, 488 tests)
npm run test

# Run TypeScript static analysis
npm run typecheck

# Run linter
npm run lint
```

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## 📄 License & Attribution

This project is licensed under the **MIT License with Attribution Requirement** — see the [LICENSE](LICENSE) file for details.

### Author & Credits
* **Creator & Lead Architect**: [Gaurav Batule](https://github.com/gauravbatule)
* **GitHub**: [@gauravbatule](https://github.com/gauravbatule)
* **Website**: [https://github.com/gauravbatule/sutra-web](https://github.com/gauravbatule/sutra-web)

If you find SUTRA IDE useful, consider giving it a ⭐ on GitHub and sharing your feedback!
