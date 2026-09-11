export interface GodlyPattern {
  id: string;
  name: string;
  category: 'hero' | 'bento' | 'nav' | 'pricing' | 'card' | 'typography' | 'animation' | 'form' | 'dock';
  tier: 'luxury' | 'editorial' | 'minimalist' | 'kinetic';
  previewDescription: string;
  tags: string[];
  codeTemplate: string;
}

export const GODLY_VAULT_PATTERNS: GodlyPattern[] = [
  {
    id: 'godly-hero-editorial-1',
    name: 'Linear Obsidian Hero with Ambient Radial Specular',
    category: 'hero',
    tier: 'luxury',
    previewDescription: 'A near-black obsidian canvas with subtle 1px hairline border, dual-friction typography (Cinzel serif + Geist sans), and a scarce cobalt accent.',
    tags: ['Paper+Ink', 'Hairline', 'Editorial', 'Linear'],
    codeTemplate: `<section className="relative min-h-[85vh] flex flex-col items-center justify-center px-6 text-center bg-[#09090b] text-[#fafafa] overflow-hidden">
  {/* Ambient Specular Highlight */}
  <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-blue-500/10 blur-[120px] pointer-events-none rounded-full" />
  
  {/* Hairline Divider Ring */}
  <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-full bg-zinc-900/80 border border-white/5 text-xs text-zinc-400 font-mono tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
    AUTONOMOUS PRODUCT ENGINE 2026
  </div>

  <h1 className="text-5xl md:text-7xl font-bold tracking-tight max-w-4xl text-zinc-50 leading-[1.08] mb-6">
    Architect software with <span className="font-serif italic font-normal text-zinc-300">astronomical</span> precision.
  </h1>

  <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
    From idea to complete full-stack code, generative visual assets, and continuous visual verification in a unified workspace.
  </p>

  <div className="flex items-center gap-4">
    <button className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-95">
      Start Autonomous Build
    </button>
    <button className="px-6 py-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-zinc-300 font-medium text-sm transition-all">
      Explore Vault
    </button>
  </div>
</section>`,
  },

  {
    id: 'godly-bento-asymmetric-2',
    name: 'Asymmetric 5/7 Grid with Monospace Telemetry',
    category: 'bento',
    tier: 'editorial',
    previewDescription: 'Mathematical 5/7 asymmetric bento layout with 1px architectural dividers, live performance telemetry, and zero cheesy AI cards.',
    tags: ['Bento', 'Asymmetric', 'Telemetry', 'Vercel'],
    codeTemplate: `<div className="grid grid-cols-1 md:grid-cols-12 gap-4 max-w-6xl mx-auto p-6 bg-[#09090b]">
  {/* Primary 7-Col Feature */}
  <div className="md:col-span-7 p-8 rounded-xl bg-zinc-900/60 border border-white/5 flex flex-col justify-between group hover:border-white/10 transition-all">
    <div>
      <div className="text-xs font-mono text-blue-400 mb-2">01 / ARCHITECTURE</div>
      <h3 className="text-2xl font-bold text-zinc-50 mb-3">Parallel Agent Swarm Matrix</h3>
      <p className="text-zinc-400 text-sm leading-relaxed">
        Chief Architect distributes tasks across Frontend, Database, and QA subagents running simultaneously with live AST diff verification.
      </p>
    </div>
    <div className="mt-8 p-4 rounded-lg bg-zinc-950 border border-white/5 font-mono text-xs text-zinc-400">
      <span className="text-emerald-400">✓</span> [SwarmEngine] 5/5 Subagents synchronized in 42ms
    </div>
  </div>

  {/* Secondary 5-Col Feature */}
  <div className="md:col-span-5 p-8 rounded-xl bg-zinc-900/60 border border-white/5 flex flex-col justify-between group hover:border-white/10 transition-all">
    <div>
      <div className="text-xs font-mono text-amber-400 mb-2">02 / GENERATIVE MEDIA</div>
      <h3 className="text-2xl font-bold text-zinc-50 mb-3">Real Asset Synthesis</h3>
      <p className="text-zinc-400 text-sm leading-relaxed">
        Automatic production of SVGs, hero imagery, WebAudio tactile UI cues, and WebGL particle shaders directly into project assets.
      </p>
    </div>
    <div className="mt-8 flex items-center justify-between text-xs text-zinc-500 font-mono">
      <span>ASSETS: 14 GENERATED</span>
      <span className="text-blue-400">100% VECTOR</span>
    </div>
  </div>
</div>`,
  },

  {
    id: 'godly-nav-dock-3',
    name: 'Floating Glass & Hairline Micro-Dock',
    category: 'dock',
    tier: 'luxury',
    previewDescription: 'Tactile floating bottom action dock with spring physics hover, active indicator pip, and keyboard shortcut chords.',
    tags: ['Dock', 'Micro-Interaction', 'Spring'],
    codeTemplate: `<nav className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full bg-zinc-900/90 backdrop-blur-md border border-white/10 shadow-2xl flex items-center gap-6 z-50">
  <button className="text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors">
    <span className="w-2 h-2 rounded-full bg-blue-500" />
    Editor
  </button>
  <button className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">Agent Swarm</button>
  <button className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">Media Studio</button>
  <div className="h-4 w-px bg-white/10" />
  <button className="text-xs font-mono text-zinc-500 hover:text-zinc-300">⌘K</button>
</nav>`,
  },

  {
    id: 'godly-pricing-matrix-4',
    name: 'Tiered Pricing Matrix with Sub-pixel Hairlines',
    category: 'pricing',
    tier: 'minimalist',
    previewDescription: 'A clean, high-conversion pricing comparison matrix adhering strictly to the Paper+Ink+Accent model.',
    tags: ['Pricing', 'Hairline', 'Conversion'],
    codeTemplate: `<div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto p-6">
  {/* Starter */}
  <div className="p-8 rounded-xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between">
    <div>
      <h4 className="text-sm font-mono text-zinc-400 mb-2">INDIVIDUAL</h4>
      <div className="text-4xl font-bold text-white mb-4">$0 <span className="text-sm text-zinc-500 font-normal">/ month</span></div>
      <p className="text-zinc-400 text-sm mb-6">Local models through OmniRoute and the Monaco editor.</p>
    </div>
    <button className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-all">Get Started</button>
  </div>

  {/* Pro */}
  <div className="p-8 rounded-xl bg-zinc-900 border border-blue-500/30 relative flex flex-col justify-between shadow-2xl">
    <div className="absolute -top-3 right-6 px-2.5 py-0.5 rounded-full bg-blue-500 text-[10px] font-mono text-white tracking-wide">POPULAR</div>
    <div>
      <h4 className="text-sm font-mono text-blue-400 mb-2">AUTONOMOUS PRO</h4>
      <div className="text-4xl font-bold text-white mb-4">$29 <span className="text-sm text-zinc-500 font-normal">/ month</span></div>
      <p className="text-zinc-400 text-sm mb-6">Full Claude 3.7 Sonnet reasoning, parallel subagents, and phone companion.</p>
    </div>
    <button className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all shadow-lg shadow-blue-500/25">Deploy Pro</button>
  </div>
</div>`,
  },
];
