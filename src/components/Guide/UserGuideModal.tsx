import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Rocket,
  Cpu,
  Bot,
  TerminalSquare,
  Layers,
  Palette,
  Smartphone,
  Keyboard,
  ArrowRight,
  ExternalLink,
  Play,
  Zap,
  ShieldCheck,
  Wifi
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const UserGuideModal: React.FC = () => {
  const {
    isGuideOpen,
    setGuideOpen,
    setSettingsOpen,
    toggleTerminal,
    togglePreview,
    setVaultModalOpen,
    setAssetStudioOpen,
    setQRPairingOpen
  } = useIDEStore();

  const [activeTab, setActiveTab] = useState<'quickstart' | 'models' | 'agent' | 'terminal' | 'vault' | 'media' | 'preview' | 'shortcuts'>('quickstart');

  if (!isGuideOpen) return null;

  const navItems = [
    { id: 'quickstart', label: 'Quick Start Tour', icon: Rocket },
    { id: 'models', label: 'AI Providers & Keys', icon: Cpu },
    { id: 'agent', label: 'Autonomous Agent', icon: Bot },
    { id: 'terminal', label: 'PowerShell Terminal', icon: TerminalSquare },
    { id: 'vault', label: 'UI Archetypes & Vault', icon: Layers },
    { id: 'media', label: 'Media & Asset Studio', icon: Palette },
    { id: 'preview', label: 'Multi-Device Preview', icon: Smartphone },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in">
      <div className="w-full max-w-5xl h-[88vh] bg-obsidian-canvas border border-obsidian-border rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <header className="h-14 px-6 border-b border-obsidian-border bg-obsidian-surface1 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-obsidian-inkPrimary">SUTRA Studio — User Guide</h2>
                <span className="px-2 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkSecondary text-[10px] font-mono">Guide</span>
              </div>
              <p className="text-[11px] text-obsidian-inkSecondary">Documentation for autonomous coding and tool orchestration.</p>
            </div>
          </div>

          <button
            onClick={() => setGuideOpen(false)}
            className="p-2 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer"
            title="Close Guide"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Modal Body with Sidebar and Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Navigation Sidebar */}
          <aside className="w-60 bg-obsidian-surface1 border-r border-obsidian-border p-3 flex flex-col gap-1 shrink-0 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-mono text-obsidian-inkMuted uppercase tracking-widest">Guide Topics</div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
                    isActive
                      ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-semibold shadow-sm border border-obsidian-border'
                      : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-obsidian-inkPrimary' : 'text-obsidian-inkMuted'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="mt-auto pt-4 border-t border-obsidian-border px-3 pb-2 space-y-2">
              <div className="text-[10px] font-mono text-obsidian-inkMuted">Need direct settings?</div>
              <button
                onClick={() => {
                  setGuideOpen(false);
                  setSettingsOpen(true);
                }}
                className="w-full py-1.5 px-2.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary text-xs font-medium transition-colors flex items-center justify-between"
              >
                <span>API Settings</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 p-6 sm:p-8 overflow-y-auto bg-obsidian-canvas text-obsidian-inkPrimary text-xs leading-relaxed space-y-6">
            {/* 1. Quick Start Checklist */}
            {activeTab === 'quickstart' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Rocket className="w-5 h-5 text-obsidian-inkSecondary" />
                    Quick Start Onboarding Tour
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Follow this 5-step checklist to start building full-stack applications with autonomous AI agents.
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      step: '1',
                      title: 'Open Your Workspace Folder',
                      description: 'Choose any folder on your computer. SUTRA operates directly on your local files with full read, write, and command execution capabilities.',
                      actionLabel: 'Browse Folder',
                      action: async () => {
                        try {
                          const res = await fetch('/api/fs/browse-folder', { method: 'POST' });
                          const data = await res.json();
                          if (data.success) window.location.reload();
                        } catch {
                          const p = prompt('Enter absolute path to workspace folder:');
                          if (p) {
                            fetch('/api/fs/set-workspace', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ path: p })
                            }).then(() => window.location.reload());
                          }
                        }
                      }
                    },
                    {
                      step: '2',
                      title: 'Configure Your AI Model & API Key',
                      description: 'Add your Google Gemini (free at Google AI Studio), OpenRouter, DeepSeek, Groq, Anthropic, OpenAI, or local Ollama endpoint. No keys are hardcoded.',
                      actionLabel: 'Open Settings',
                      action: () => {
                        setGuideOpen(false);
                        setSettingsOpen(true);
                      }
                    },
                    {
                      step: '3',
                      title: 'Prompt the Autonomous Coding Agent',
                      description: 'Ask the agent to build any feature, refactor code, create components, or fix bugs. The agent plans a step at a time — reading files, writing code, running terminal commands, and verifying changes automatically.',
                      actionLabel: 'Open Agent Panel',
                      action: () => {
                        setGuideOpen(false);
                      }
                    },
                    {
                      step: '4',
                      title: 'Inspect Design Vault & Generate Media',
                      description: 'Inject luxury UI templates from the Godly Design Vault or generate custom images, videos, sound effects, and SVGs on demand in the Asset Studio.',
                      actionLabel: 'Open Design Vault',
                      action: () => {
                        setGuideOpen(false);
                        setVaultModalOpen(true);
                      }
                    },
                    {
                      step: '5',
                      title: 'Launch Live Multi-Device Preview & Terminal',
                      description: 'Toggle the responsive viewport to inspect Desktop, Tablet, and Mobile iPhone screens, and open the built-in terminal.',
                      actionLabel: 'Open Live Preview',
                      action: () => {
                        setGuideOpen(false);
                        togglePreview();
                      }
                    }
                  ].map((item) => (
                    <div key={item.step} className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-obsidian-border transition-all">
                      <div className="flex items-start gap-3.5">
                        <div className="w-7 h-7 rounded-full bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary font-bold font-mono text-xs flex items-center justify-center shrink-0">
                          {item.step}
                        </div>
                        <div className="space-y-1">
                          <h4 className="font-semibold text-obsidian-inkPrimary text-sm">{item.title}</h4>
                          <p className="text-obsidian-inkSecondary text-xs leading-relaxed max-w-xl">{item.description}</p>
                        </div>
                      </div>
                      <button
                        onClick={item.action}
                        className="self-start sm:self-center px-3.5 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface4 border border-obsidian-border text-obsidian-inkPrimary text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <span>{item.actionLabel}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. AI Models & Providers */}
            {activeTab === 'models' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-obsidian-inkSecondary" />
                    AI Models & Provider Setup
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    SUTRA connects to any LLM provider via standard APIs or local offline inference.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      name: 'Google Gemini (Recommended)',
                      env: 'GEMINI_API_KEY',
                      desc: 'Fast, long-context (1M+ tokens), multimodal vision, and generous free tier.',
                      link: 'https://aistudio.google.com/app/apikey',
                      linkLabel: 'Get Gemini Key (Free)',
                      tag: 'Free / Fast'
                    },
                    {
                      name: 'OpenRouter Gateway',
                      env: 'OPENROUTER_API_KEY',
                      desc: 'Universal aggregator providing access to Claude 3.7, GPT-4o, DeepSeek, and 200+ models with one balance.',
                      link: 'https://openrouter.ai/keys',
                      linkLabel: 'Get OpenRouter Key',
                      tag: 'Universal'
                    },
                    {
                      name: 'DeepSeek (V3 & R1)',
                      env: 'DEEPSEEK_API_KEY',
                      desc: 'Cost-effective high-reasoning coding intelligence with chain-of-thought verification.',
                      link: 'https://platform.deepseek.com',
                      linkLabel: 'Get DeepSeek Key',
                      tag: 'Reasoning'
                    },
                    {
                      name: 'Groq (Ultra-Fast)',
                      env: 'GROQ_API_KEY',
                      desc: 'Sub-second inference speeds running Llama-3.3 70B and Qwen-2.5 on custom LPUs.',
                      link: 'https://console.groq.com/keys',
                      linkLabel: 'Get Groq Key (Free Tier)',
                      tag: '500+ tok/s'
                    },
                    {
                      name: 'Anthropic Claude',
                      env: 'ANTHROPIC_API_KEY',
                      desc: 'Claude 3.7 Sonnet (Hybrid Reasoning) and Claude 3.5 Sonnet frontier coding engines.',
                      link: 'https://console.anthropic.com',
                      linkLabel: 'Get Anthropic Key',
                      tag: 'Frontier'
                    },
                    {
                      name: 'Local Ollama (100% Offline)',
                      env: 'OLLAMA_BASE_URL',
                      desc: 'Completely private offline execution. Run `ollama run qwen2.5-coder` on your local GPU/CPU with zero cost.',
                      link: 'https://ollama.com',
                      linkLabel: 'Download Ollama',
                      tag: '100% Offline'
                    }
                  ].map((prov) => (
                    <div key={prov.name} className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <h4 className="font-semibold text-obsidian-inkPrimary text-sm">{prov.name}</h4>
                          <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-obsidian-surface2 text-obsidian-inkPrimary border border-obsidian-border">{prov.tag}</span>
                        </div>
                        <p className="text-obsidian-inkSecondary text-xs leading-relaxed mb-2">{prov.desc}</p>
                        <div className="font-mono text-[10px] text-obsidian-inkMuted bg-obsidian-surface2 p-1.5 rounded border border-obsidian-hairline">
                          Env var: <span className="text-obsidian-inkPrimary">{prov.env}</span>
                        </div>
                      </div>
                      <a
                        href={prov.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-obsidian-inkPrimary hover:text-obsidian-inkPrimary font-medium underline underline-offset-4"
                      >
                        <span>{prov.linkLabel}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline text-obsidian-inkSecondary text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-obsidian-inkSecondary shrink-0" />
                    <span>Keys entered in Settings are stored securely in your local SQLite database and are never transmitted to third parties.</span>
                  </div>
                  <button
                    onClick={() => {
                      setGuideOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="px-3 py-1.5 rounded bg-obsidian-accent text-obsidian-inkInverse font-semibold hover:bg-obsidian-accentHover transition-colors shrink-0 ml-3 cursor-pointer"
                  >
                    Open Settings Now
                  </button>
                </div>
              </div>
            )}

            {/* 3. Autonomous Coding Agent */}
            {activeTab === 'agent' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Bot className="w-5 h-5 text-obsidian-inkSecondary" />
                    Autonomous Agent & Tool Loop
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    The SUTRA Autonomous Agent plans, writes, and verifies code iteratively — directly in your local environment.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-3">
                    <h4 className="font-semibold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4 text-obsidian-inkSecondary" />
                      Integrated Tools
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { name: 'read_file', desc: 'Inspect exact file contents with line ranges before making changes.' },
                        { name: 'write_file', desc: 'Create new files or fully rewrite modules with complete code.' },
                        { name: 'edit_file', desc: 'Surgical string replacement with zero accidental side-effects.' },
                        { name: 'run_command', desc: 'Execute builds, test runners, git commands, and package installs.' },
                        { name: 'search_web & scrape_url', desc: 'Search the web for API documentation, packages, or error fixes.' },
                        { name: 'spawn_subagent', desc: 'Deploy parallel specialist agents (frontend, backend, QA, media).' },
                      ].map((t) => (
                        <div key={t.name} className="p-2.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-0.5">
                          <code className="text-[11px] font-mono text-obsidian-inkPrimary">{t.name}</code>
                          <p className="text-[11px] text-obsidian-inkSecondary">{t.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-3">
                    <h4 className="font-semibold text-obsidian-inkPrimary text-sm">Interactive Pause, Resume & Real-Time Steering</h4>
                    <p className="text-obsidian-inkSecondary text-xs">
                      Steer Astra live while generation streams, or inject fresh instructions directly into the thought loop.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Built-in Terminal */}
            {activeTab === 'terminal' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <TerminalSquare className="w-5 h-5 text-obsidian-inkSecondary" />
                    Built-in Terminal
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Integrated Windows terminal with full interactive ANSI color and PowerShell support.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-obsidian-inkPrimary text-sm">Quick Terminal Actions</h4>
                      <p className="text-obsidian-inkSecondary text-xs">Toggle the terminal anywhere using the keyboard shortcut or activity bar icon.</p>
                    </div>
                    <button
                      onClick={() => {
                        setGuideOpen(false);
                        toggleTerminal();
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <TerminalSquare className="w-3.5 h-3.5" />
                      <span>Toggle Terminal (Ctrl+`)</span>
                    </button>
                  </div>

                  <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline font-mono text-[11px] text-obsidian-inkPrimary space-y-1">
                    <div className="text-obsidian-inkMuted"># Common terminal commands to run:</div>
                    <div className="text-obsidian-inkPrimary">npm run dev</div>
                    <div className="text-obsidian-inkSecondary"># Start the Vite frontend and API server</div>
                    <div className="text-obsidian-inkPrimary mt-2">npm run build</div>
                    <div className="text-obsidian-inkSecondary"># Production compile & bundle verification</div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Godly Design Vault */}
            {activeTab === 'vault' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Layers className="w-5 h-5 text-obsidian-inkSecondary" />
                    Godly Design Vault & Live Web Scraper
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Access curated, production-ready React + Tailwind UI components and scrape live web designs for instant codebase injection.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-obsidian-inkPrimary text-sm">Explore Curated UI Patterns</h4>
                      <p className="text-obsidian-inkSecondary text-xs">Browse Hero sections, Bento Grids, Interactive Visualizers, and Navigation archetypes.</p>
                    </div>
                    <button
                      onClick={() => {
                        setGuideOpen(false);
                        setVaultModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Open Design Vault</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline">
                      <h5 className="font-semibold text-obsidian-inkPrimary text-xs mb-1">1. Browse Patterns</h5>
                      <p className="text-[11px] text-obsidian-inkSecondary">Filtered by Archetype: Landing, Dashboard, Minimal Editorial, Dark Canvas.</p>
                    </div>
                    <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline">
                      <h5 className="font-semibold text-obsidian-inkPrimary text-xs mb-1">2. 1-Click Injection</h5>
                      <p className="text-[11px] text-obsidian-inkSecondary">Inject component code directly into <code className="text-obsidian-inkPrimary">src/components/injected/</code>.</p>
                    </div>
                    <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline">
                      <h5 className="font-semibold text-obsidian-inkPrimary text-xs mb-1">3. Live Scraper</h5>
                      <p className="text-[11px] text-obsidian-inkSecondary">Search any website or paste a URL to extract and compress its design structure.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 6. Media & Asset Studio */}
            {activeTab === 'media' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Palette className="w-5 h-5 text-obsidian-inkSecondary" />
                    Multimodal Media & Asset Studio
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Generate production assets (Images, Videos, UI Sound Effects, and SVGs) directly into your workspace.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-obsidian-inkPrimary text-sm">Asset Generation Engine</h4>
                      <p className="text-obsidian-inkSecondary text-xs">Generated media files are automatically saved to <code className="text-obsidian-inkPrimary">public/assets/</code>.</p>
                    </div>
                    <button
                      onClick={() => {
                        setGuideOpen(false);
                        setAssetStudioOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span>Open Asset Studio</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                    <div className="p-2.5 rounded-lg bg-black/30 border border-obsidian-hairline text-center">
                      <div className="font-bold text-obsidian-inkPrimary text-xs">Images</div>
                      <div className="text-[10px] text-obsidian-inkMuted">1920x1080 / Square</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/30 border border-obsidian-hairline text-center">
                      <div className="font-bold text-obsidian-inkPrimary text-xs">Videos</div>
                      <div className="text-[10px] text-obsidian-inkMuted">16:9 / 9:16 Clips</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/30 border border-obsidian-hairline text-center">
                      <div className="font-bold text-obsidian-inkPrimary text-xs">Audio & TTS</div>
                      <div className="text-[10px] text-obsidian-inkMuted">Chimes, Clicks, Voice</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/30 border border-obsidian-hairline text-center">
                      <div className="font-bold text-obsidian-inkPrimary text-xs">Vector SVGs</div>
                      <div className="text-[10px] text-obsidian-inkMuted">Raw Clean SVG Code</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. Multi-Device Preview & Mobile Companion */}
            {activeTab === 'preview' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Smartphone className="w-5 h-5 text-obsidian-inkSecondary" />
                    Multi-Device Preview & Mobile Companion
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Test responsive viewports side-by-side or pair your smartphone over local Wi-Fi.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-3">
                    <h4 className="font-semibold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                      <Play className="w-4 h-4 text-obsidian-inkSecondary" />
                      Live Sandbox Multi-Viewport
                    </h4>
                    <p className="text-obsidian-inkSecondary text-xs leading-relaxed">
                      Toggle between <strong>Desktop (100%)</strong>, <strong>Tablet (iPad Pro 768px)</strong>, and <strong>Mobile (iPhone 15 Pro 393px)</strong>.
                    </p>
                    <button
                      onClick={() => {
                        setGuideOpen(false);
                        togglePreview();
                      }}
                      className="px-3 py-1.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary font-medium text-xs transition-colors cursor-pointer"
                    >
                      Toggle Preview Panel
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-3">
                    <h4 className="font-semibold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-obsidian-inkSecondary" />
                      Mobile Companion Bridge
                    </h4>
                    <p className="text-obsidian-inkSecondary text-xs leading-relaxed">
                      Scan the QR code with your phone to mirror the live preview, approve agent actions, and voice prompt from mobile.
                    </p>
                    <button
                      onClick={() => {
                        setGuideOpen(false);
                        setQRPairingOpen(true);
                      }}
                      className="px-3 py-1.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary font-medium text-xs transition-colors cursor-pointer"
                    >
                      Show Pairing QR Code
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 8. Keyboard Shortcuts */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-6 animate-in fade-in">
                <div>
                  <h3 className="text-lg font-bold text-obsidian-inkPrimary mb-1 flex items-center gap-2">
                    <Keyboard className="w-5 h-5 text-obsidian-inkSecondary" />
                    Keyboard Shortcuts & Cheatsheet
                  </h3>
                  <p className="text-obsidian-inkSecondary text-xs">
                    Accelerate your autonomous development workflow with universal shortcuts.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { key: '⌘K / Ctrl+K', desc: 'Open Command Palette & Quick File Finder' },
                    { key: 'Ctrl+S', desc: 'Save active file in Monaco Editor' },
                    { key: 'Ctrl+`', desc: 'Toggle Built-in Terminal' },
                    { key: 'Ctrl+Shift+E', desc: 'Open File Explorer' },
                    { key: 'Ctrl+Shift+F', desc: 'Open Workspace Code Search' },
                    { key: 'Esc', desc: 'Close any active modal or dialog' },
                  ].map((s) => (
                    <div key={s.key} className="p-3 rounded-lg bg-obsidian-surface1 border border-obsidian-border flex items-center justify-between">
                      <span className="text-obsidian-inkPrimary text-xs">{s.desc}</span>
                      <kbd className="px-2 py-1 rounded bg-obsidian-surface2 border border-obsidian-border text-[10px] font-mono text-obsidian-inkPrimary shadow-sm shrink-0 ml-2">
                        {s.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
