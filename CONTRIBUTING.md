# Contributing to SUTRA IDE

Thank you for your interest in contributing to **SUTRA IDE**! We welcome bug reports, feature discussions, architectural improvements, and pull requests from developers around the world.

---

## ⚠️ Mandatory Attribution & Reuse Notice

SUTRA IDE is open source under the **MIT License with Attribution Requirement**.
- You are free to inspect the code, learn from its architecture, submit PRs, and build upon it.
- **If you fork, redistribute, or reuse any part of SUTRA IDE in any public repository, product, service, or distribution, you MUST provide explicit, visible, and prominent attribution to Gaurav Batule and include a link back to [https://github.com/gauravbatule/Sutra-IDE](https://github.com/gauravbatule/Sutra-IDE).**

---

## Getting Started

### Prerequisites
- **Node.js**: Version 20.0 or higher ([nodejs.org](https://nodejs.org))
- **npm**: Version 10+
- **Git**: Installed and configured
- **OS**: Windows 10/11 (fully supported with native launcher & NSIS), macOS, or Linux.

### Setting Up Your Environment
1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   `ash
   git clone https://github.com/<your-username>/Sutra-IDE.git
   cd Sutra-IDE
   `
3. **Install dependencies**:
   `ash
   npm install
   `
4. **Start the development servers**:
   `ash
   npm run dev
   `
   This concurrently runs:
   - Client dev server: http://localhost:5173
   - Local Express API & WebSockets: http://localhost:3001

---

## Available Scripts

| Command | Description |
|---|---|
| 
pm run dev | Starts client (Vite) and server (	sx) concurrently |
| 
pm run build | Builds production frontend (dist/) and server (dist-server/index.js) |
| 
pm run build:server | Bundles Node.js server via esbuild into single bundle |
| 
pm run build:exe | Compiles native Windows launcher executable (SUTRA-IDE.exe) |
| 
pm run desktop:build | Packages native NSIS installer via electron-builder |
| 
pm run test | Runs the test suite via Vitest (488 tests across 71 suites) |
| 
pm run typecheck | Validates TypeScript types across the entire codebase |
| 
pm run lint | Runs ESLint analysis |
| 
pm run format | Formats code with Prettier |

---

## Pull Request Guidelines

1. **Create a branch**:
   `ash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   `
2. **Ensure tests pass**:
   `ash
   npm run typecheck
   npm run test
   `
   All 71 test suites must pass cleanly without regressions.
3. **Write descriptive commit messages**:
   - eat(manager): add session search and filtering
   - ix(editor): resolve cursor offset in inline diff view
   - docs(readme): add troubleshooting section
4. **Submit your Pull Request** against the main branch with:
   - A clear explanation of what was changed and why.
   - Screenshots or recordings if your changes affect the UI.
   - Mention any related issues.

---

## Code Style & Architecture

- **React & TypeScript**: Modern functional components with hooks, strict typing, and zero ny wherever possible.
- **Tailwind & CSS Tokens**: We use semantic obsidian tokens (	okens.css) for consistent dark/light themes. Avoid hardcoded hex colors when standard theme tokens exist.
- **State Management**: Centralized with Zustand (src/stores/ideStore.ts). Keep atomic states localized.
- **Zero Secrets**: Never commit API keys, tokens, session cookies, or personal user data.

Thank you for helping make SUTRA IDE better for every developer! 🚀
