# SUTRA Studio — Complete User Guide & Manual 📘

Welcome to **SUTRA Studio**. This comprehensive manual explains how to configure, operate, and master all studio capabilities.

---

## Table of Contents
1. [Initial Setup & Environment Configuration](#1-initial-setup--environment-configuration)
2. [Configuring AI Models & Fallback Chains](#2-configuring-ai-models--fallback-chains)
3. [Working with the Autonomous ReAct Agent](#3-working-with-the-autonomous-react-agent)
4. [Internal Autonomous Multimodal Asset Generation](#4-internal-autonomous-multimodal-asset-generation)
5. [Using the Windows PowerShell ConPTY Terminal](#5-using-the-windows-powershell-conpty-terminal)
6. [Live Multi-Device Sandbox Preview](#6-live-multi-device-sandbox-preview)
7. [Source Control & Git Integration](#7-source-control--git-integration)
8. [Keyboard Shortcuts Cheatsheet](#8-keyboard-shortcuts-cheatsheet)
9. [Troubleshooting & FAQs](#9-troubleshooting--faqs)

---

## 1. Initial Setup & Environment Configuration

### Starting the IDE
Run the dev stack from PowerShell or Command Prompt:
```bash
npm run dev
```
Or double-click `run-ide.bat`.

Once started:
- Open your browser to `http://localhost:5173`.
- Click **"Open Workspace"** on the Welcome screen or press `Ctrl+O` to select the local project folder you want to work on.

---

## 2. Configuring AI Models & Fallback Chains

SUTRA Studio supports frontier cloud models, custom API gateways, and 100% offline local inference with autonomous multi-tier fallback chains:

### Multi-Tier Fallback Chains
- **Text Reasoning**: Selected Model → Google Gemini → OpenRouter → Groq → DeepSeek → OpenAI → Anthropic → Local Ollama → SUTRA Engine.
- **Image Generation**: OmniRoute / DALL-E → Pollinations FLUX Engine → Bespoke Luxury Vector SVG Engine.
- **Video Generation**: OmniRoute Video → Pollinations Video Engine → High-FPS Procedural Animated Visual Canvas.
- **Audio & Speech**: OpenAI / OmniRoute TTS → Google TTS API → Procedural 44.1kHz 16-bit PCM WAV Synthesizer (zero external dependencies).

### Step 1: Open Settings
Click the **Settings** gear icon at the bottom of the ActivityBar on the left, or press `⌘K` / `Ctrl+K` and type `Settings`.

### Step 2: Enter API Keys
- **Google Gemini (Recommended)**:
  - Visit [Google AI Studio](https://aistudio.google.com/app/apikey) to generate a free API key.
  - Paste into the **Google Gemini** input box and click **Test** to verify connection latency.
- **OpenRouter**:
  - Visit [OpenRouter](https://openrouter.ai/keys) to get a single key that routes to 200+ models.
- **DeepSeek**:
  - Enter your DeepSeek API key for DeepSeek-V3 and DeepSeek-R1 reasoning.
- **Groq**:
  - Enter your Groq API key for ultra-fast (500+ tokens/sec) inference.
- **Anthropic Claude**:
  - Enter your `sk-ant-api03-...` key for Claude 3.7 and 3.5 Sonnet.
- **OpenAI**:
  - Enter your OpenAI API key for GPT-4o and o3-mini.
- **Local Ollama**:
  - Install Ollama from [ollama.com](https://ollama.com).
  - Run in your terminal: `ollama run qwen2.5-coder` or `ollama run llama3.3`.
  - SUTRA automatically connects to `http://localhost:11434/v1` with zero API costs.

### Step 3: Save Keys
Click **SAVE & APPLY API KEYS**. Keys are saved locally in SQLite and `.env`, persisting across all sessions.

---

## 3. Working with the Autonomous ReAct Agent

The SUTRA Autonomous Agent executes tasks directly within your local workspace using an iterative ReAct (Reason + Act) loop.

### How to Prompt the Agent
In the right-hand **Agent Panel**, describe what you want to build or fix in natural language:
- *"Build a luxury modern dark-mode landing page with a hero visualizer and responsive bento grid."*
- *"Audit the repository, run typecheck, and fix any TypeScript compiler errors."*
- *"Generate the required logo image and notification sound effects for this project."*

### Understanding Tool Calls
When the agent works, it displays interactive tool execution cards:
- **`read_file`**: Reads target files and line numbers.
- **`write_file`**: Writes full file implementations.
- **`edit_file`**: Applies surgical code replacements.
- **`run_command`**: Runs terminal commands (e.g. `npm install`, `npm test`, `npm run build`).
- **`generate_image_asset`**: Generates and embeds images directly into the workspace.
- **`generate_video_asset`**: Produces motion visuals and videos.
- **`generate_audio_asset`**: Generates audio cues and voiceover.
- **`search_web` & `scrape_url`**: Looks up modern documentation.
- **`spawn_subagent`**: Allocates parallel specialist agents.

### Autopilot vs Safe Mode
In the top TitleBar, you can toggle between:
- **Safe Mode**: The agent pauses and requests your approval before executing file writes or terminal commands.
- **Auto Mode (Autopilot)**: The agent runs unattended, executing steps autonomously until completion.

### Pausing & Steering
- **Pause**: Click the **Pause** button in the chat header at any time. All modified files, tool logs, and context are preserved.
- **Resume / Steer**: Type a new instruction while paused or running. The agent incorporates your course correction immediately.

---

## 4. Internal Autonomous Multimodal Asset Generation

SUTRA handles media generation internally through autonomous agent tools:
- **Image Assets**: Simply ask the agent *"Create a hero banner image"* or *"Design a minimalist monochrome logo"*. The agent autonomously calls `generate_image_asset` or `generate_svg_asset`, saves the file to `/public/assets/`, and embeds a live preview in the chat.
- **Video Assets**: Ask the agent to generate motion loops or UI video teasers. SUTRA outputs high-resolution video directly to your project.
- **Audio & Sound Effects**: Ask the agent for tactile UI sounds, notification clicks, or speech. SUTRA generates crisp 44.1kHz WAV / MP3 audio and attaches an inline audio player in the chat.

---

## 5. Using the Windows PowerShell ConPTY Terminal

SUTRA features a native Windows ConPTY terminal session.

- **Toggle Terminal**: Press ``Ctrl+` `` or click the terminal icon in the ActivityBar.
- **Features**: Full ANSI color rendering, JetBrains Mono font, instant resize handling, and background long-running command execution.

---

## 6. Live Multi-Device Sandbox Preview

- Click **Preview** in the TitleBar.
- Switch between **Desktop**, **Tablet (iPad Pro)**, and **Mobile (iPhone 15 Pro)** viewports.
- Run the **Visual QA** check to audit contrast, typography, and responsive ergonomics.

---

## 7. Source Control & Git Integration

- Click the **Git** icon in the ActivityBar to view unstaged and staged changes.
- Review diffs for any modified file.
- Enter a commit message and press `Ctrl+Enter` to commit changes directly.

---

## 8. Keyboard Shortcuts Cheatsheet

| Shortcut | Action |
|---|---|
| `Ctrl+P` / `⌘P` | Quick Open File |
| `Ctrl+K` / `⌘K` | SUTRA Command Palette |
| `Ctrl+Shift+F` | Search in Workspace |
| `Ctrl+Shift+E` | File Explorer |
| ``Ctrl+` `` | Toggle PowerShell Terminal |
| `Ctrl+S` | Save Active File |
| `Ctrl+Shift+S` | Save All Modified Files |
| `Ctrl+B` | Toggle Sidebar |

---

---

## 9. Troubleshooting & FAQs

- **Q: Model fails with rate limit or expired key?**
  - **A**: SUTRA automatically falls back to the next available provider in the chain (Google Gemini, Groq, DeepSeek, OpenAI, Anthropic, or Ollama) with zero disruption.
- **Q: How to reset workspace?**
  - **A**: Click the folder breadcrumb in the TitleBar or press `⌘K` and select `Open Local Workspace Folder`.
- **Q: How to configure API keys?**
  - **A**: Click the Settings gear icon in the ActivityBar or TitleBar to enter Google Gemini, OpenRouter, DeepSeek, Groq, Anthropic, or OpenAI keys. Keys are saved to SQLite and `.env`.
- **Q: Is Ollama local inference supported?**
  - **A**: Yes! Start Ollama locally with `ollama run qwen2.5-coder` and select `Qwen 2.5 Coder (Local Ollama)` from the TitleBar model selector.

### Q: How do I change the active workspace folder?
**A**: Click the **Open Workspace** button on the Welcome screen or in the Explorer header, or run `POST /api/fs/set-workspace`.

### Q: Does OmniCraft IDE work completely offline?
**A**: Yes! Start Ollama locally (`ollama run qwen2.5-coder`), and select the Ollama model in OmniCraft IDE. All coding, terminal execution, and previews operate 100% locally with zero internet required.
