# SUTRA IDE — Enterprise Capabilities & Architectural Reference

> **SUTRA IDE** is a next-generation, dual-mode enterprise AI engineering environment engineered to deliver developer-first autonomous coding, real-time multi-viewport preview, deep cognitive memory, and multi-model intelligence that surpasses traditional agentic frameworks like Antigravity, Codex, and Claude Code.

---

## 1. System Architecture & Dual Operating Modes

SUTRA operates seamlessly in two distinct, synchronized modes designed for different workflows:

### A. Manager Mode (Antigravity-Inspired Autonomous Mission Control)
- **High-Altitude Mission Command**: Direct the autonomous agent using natural language, slash commands, or element targeting.
- **Unified Hero & Interactive Chat Transcript**: Clean, distraction-free composer with quick action pills, voice dictation, file attachments, and prompt history.
- **De-Cluttered Interface**: Activity Panel automatically collapses when Live Preview opens, ensuring ample viewport room (>700px preview width and >440px chat width).
- **1-Click Turn Undo**: Revert file changes made by any turn with a single click, automatically restoring the prompt to the composer and vanishing subsequent turns from the chat.
- **Output-First Copy Tools**: Copy entire assistant answers or isolated code blocks with a single click.
- **Non-Intrusive Reactive Status Indicator**: Borderless, sleek status pill with glowing green beacon dot that smoothly rotates live execution descriptions without heavy boxed layout shifts.
- **SUTRA Cyber-Cat AI Companion Pet**: An interactive mascot peeking over the composer, reacting to generation states, providing developer tips, and reflecting system focus.

### B. Developer-First IDE Mode (Full-Featured Engineering Studio)
- **Obsidian Monaco Editor**: Custom-engineered editor with Tokyo Night / One Dark Pro inspired vibrant syntax highlighting.
- **Inline Unified Diff View**: Red/green diff highlighting for additions and deletions, with prominent **Accept (⌘Y / Ctrl+Y)** and **Reject (⌘N / Ctrl+N)** review buttons.
- **Interactive Multi-Tab File System**: Breadcrumb navigation, file status badges, dirty state tracking, and fast file switching.
- **Fast Inline AI Editor (⌘K)**: Prompt-driven in-place code mutations with immediate AST-aware line replacements.
- **Zen Mode & Minimap Controls**: Fullscreen focus mode (Alt+Z) and responsive column minimap toggles.

---

## 2. Autonomous Agent Engine & Tool Loop

### A. Goal Execution Loop (`/goal`)
- **Iterative Autonomous Loop**: Continuously plans, inspects, executes, and verifies tasks until the objective is accomplished.
- **Zero-AI-Slop Delivery**: Strips internal tags (`<!-- GOAL_COMPLETE -->`, system thinking injections) and replaces robotic prose with verified green receipt badges (`✓ Task Completed & Verified`).
- **Clean Thinking Trace**: Only authentic model reasoning tokens are surfaced in the collapsible Reasoning panel. Internal orchestration status messages do not pollute user-facing thinking.

### B. Supported Slash Commands
| Command | Name | Function |
| :--- | :--- | :--- |
| `/goal <prompt>` | Autonomous Goal Mode | High-rigor autonomous execution loop that iterates with continuous verification until fully solved. |
| `/plan <prompt>` | Implementation Plan | Generates an architectural plan artifact before making any code modifications. |
| `/test [args]` | Verification & Test Suite | Executes unit tests, typechecks the project, and reports diagnostics. |
| `/fix <issue>` | Auto-Diagnose & Fix | Identifies compile/lint errors and applies minimal surgical patches. |
| `/browser <query>` | Web Research | Fetches up-to-date web documentation and API references. |
| `/explain` | Architecture Breakdown | Explains component relationships and AST call graphs. |
| `/refactor` | Codebase Refactor | Cleans up technical debt, applies patterns, and improves maintainability. |
| `/schedule` | Scheduled Tasks / Timers | Configures recurring cron jobs or one-shot timers. |

### C. Tool Execution Dialect Support
- **Multi-Dialect Rescue Parser**: Supports OpenAI function calls, Anthropic tool use, Gemini function declarations, Qwen `<tool_call>`, Ollama JSON calls, and raw markdown code blocks.
- **Auto-Materialization**: Automatically extracts proposed file modifications from chat blocks and safely materializes them to disk.
- **Self-Healing Loop**: If a tool fails or generates syntax errors, SUTRA catches the diagnostic, invokes linting/typechecking, and self-corrects without crashing.

---

## 3. Cognitive 7-Tier Memory Engine

SUTRA features an autonomous 7-tier cognitive memory architecture that operates quietly in the background:
1. **Working Memory**: Real-time context tracking active tool invocations, files touched, and open user goals.
2. **Episodic Memory**: Full session transcripts, turn digests, and user steering decisions.
3. **Semantic Codebase Index**: Inverted token index and AST symbol graph for instant semantic recall across all source files.
4. **Procedural Memory**: Learned build commands, package manager conventions, test runners, and framework patterns.
5. **Architectural Memory**: High-level module boundaries, export contracts, and dependency graphs.
6. **User Preferences**: Formatting style, library preferences, model affinities, and custom directives.
7. **Long-Horizon Vault**: Persistent cross-session knowledge stored in `.sutrarules` and `.sutra/memory/`.

---

## 4. Multi-Model Router & Custom Models

- **Free-Tier Auto Routing**: Instant fallback to free inference providers (`pollinations`, `ling`, `groq`, `web`) without requiring local language server daemons.
- **Provider Support**:
  - Anthropic (Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude 3.5 Sonnet)
  - OpenAI (GPT-4o, o3-mini, o1)
  - DeepSeek (DeepSeek-R1, DeepSeek-V3)
  - Google Gemini (Gemini 2.5 Pro, Gemini 2.0 Flash)
  - xAI (Grok 2)
  - Groq LPUs (Llama 3.3 70B at 500+ tokens/sec)
  - Custom OpenAI-Compatible Endpoints (vLLM, Ollama, LM Studio, OpenRouter, LocalAI)
- **Speed & Tier Categorization**: Models grouped by speed (`Fast`, `Balanced`, `Primary`, `Ultimate`, `Free`).

---

## 5. Live Multi-Viewport Preview & Visual Element Inspector

- **Responsive Viewports**: Switch between Desktop (1440px), Tablet (768px), and Mobile (375px) sandboxes.
- **Instant In-IDE Live Preview**: Clicking `Run site` or `Preview` opens the sandboxed browser iframe directly inside the IDE without external tab blockers.
- **Visual Element Inspector**: Click any DOM element in the live preview to inspect its HTML context and send targeted modifications directly to the agent.
- **Visual QA Auditor**: Live accessibility checks, contrast validation, and responsive layout audits.

---

## 6. ConPTY Real-Time Terminal & Multi-Tab Drawer

- **True ConPTY Terminal**: Windows ConPTY / Unix pseudo-terminal emulation with full ANSI color support, keyboard shortcuts, and interactive shell support (PowerShell, Bash, Zsh, CMD).
- **Integrated Panels**:
  - **Terminal**: Direct interactive terminal session.
  - **Output**: Streaming build logs, Vite/Next dev servers, and daemon output.
  - **Problems**: Live diagnostic scanner aggregating TypeScript, ESLint, and compile errors.
  - **Quick Action Pills**: Fast 1-click execution for `npm run dev`, `npm test`, `git status`, and `git diff`.

---

## 7. Media Generation Suite

- **Image Generation**: High-fidelity UI mockups, brand assets, and game art rendered as artifacts.
- **Vector Graphics (SVG)**: Scalable icon libraries, system architecture diagrams, and mascots.
- **Audio & Sound Effects**: AI-generated music tracks, retro game sound effects, and UI feedback audio.
- **Focus Sound Generator**: Built-in 40Hz binaural alpha beat synthesizer with Lo-Fi ambient rain, cafe, and synthwave soundscapes.

---

## 8. Enterprise Developer Workspace Creation

- **Sleek Project Wizard**: Quick location roots (Drives, User folders, Home), recent workspaces, and direct directory drill-in.
- **Modern Stacks**:
  - **React 19 + Vite**: Modern SPA with Tailwind CSS, TypeScript, and live HMR.
  - **Node.js + Fastify**: High-throughput TypeScript API service.
  - **Python Environment**: Script and web environment with virtualenv support.
  - **Blank Canvas**: Clean slate ready for autonomous scaffolding.

---

## 9. SUTRA Enterprise Brand Assets

The official SUTRA emblems and assets are stored within the project:
- **Vector Emblem**: `public/assets/sutra-icon.svg` (Sacred geometry continuous infinity thread in obsidian and pure white)
- **Monochrome Logo**: `public/assets/sutra-logo-bw.svg`
- **Full Brand Logo**: `public/assets/sutra-logo.svg`
- **AI Cyber-Cat Mascot**: `public/assets/sutra-pet.jpg` (Interactive companion wearing developer headphones with SUTRA emblem)
- **Dark/Light Emblem Art**: `C:/Users/Gaurav Batule/.gemini/antigravity/brain/7d254f3a-5ece-47e1-9200-0d90e0c73446/sutra_enterprise_emblem_1788380290217.jpg`

---

*Engineered with precision for SUTRA IDE.*
