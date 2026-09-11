/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './public/**/*.html'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Every obsidian token resolves through the CSS variables defined in
        // src/styles/tokens.css. Previously these were hardcoded hex values, so
        // `bg-obsidian-canvas` compiled to a literal #000 and the light theme
        // (which only redefines the variables) had no effect — the app stayed
        // black no matter which theme was active.
        //
        // These consume the `R G B` channel mirrors (`--x-rgb`) rather than the
        // hex vars, in the `rgb(<channels> / <alpha-value>)` form. Without
        // `<alpha-value>`, Tailwind v3 emits NOTHING for any opacity modifier
        // (`bg-obsidian-danger/15`, `ring-obsidian-accent/50`, …) — the utility
        // silently disappears instead of degrading. With it, all ~53 opacity
        // modifiers across src/ compile correctly.
        //
        // Hairlines are intentionally left as bare `var(--hairline*)`: they
        // already bake their own alpha, so `<alpha-value>` would multiply
        // against it and yield lines ~15x too strong. Use them unmodified.
        obsidian: {
          canvas: 'rgb(var(--bg-canvas-rgb) / <alpha-value>)',
          surface0: 'rgb(var(--bg-surface-0-rgb) / <alpha-value>)',
          surface1: 'rgb(var(--bg-surface-1-rgb) / <alpha-value>)',
          surface2: 'rgb(var(--bg-surface-2-rgb) / <alpha-value>)',
          surface3: 'rgb(var(--bg-surface-3-rgb) / <alpha-value>)',
          surface4: 'rgb(var(--bg-surface-4-rgb) / <alpha-value>)',
          border: 'var(--hairline-light)',
          borderBright: 'var(--hairline-bright)',
          borderAccent: 'var(--hairline-accent)',
          hairline: 'var(--hairline)',
          inkPrimary: 'rgb(var(--ink-primary-rgb) / <alpha-value>)',
          inkSecondary: 'rgb(var(--ink-secondary-rgb) / <alpha-value>)',
          inkMuted: 'rgb(var(--ink-muted-rgb) / <alpha-value>)',
          inkFaint: 'rgb(var(--ink-faint-rgb) / <alpha-value>)',
          inkInverse: 'rgb(var(--ink-inverse-rgb) / <alpha-value>)',
          accent: 'rgb(var(--accent-silver-rgb) / <alpha-value>)',
          accentHover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
          accentGlow: 'var(--accent-glow)',
          success: 'rgb(var(--state-success-rgb) / <alpha-value>)',
          warning: 'rgb(var(--state-warning-rgb) / <alpha-value>)',
          danger: 'rgb(var(--state-danger-rgb) / <alpha-value>)',
          info: 'rgb(var(--state-info-rgb) / <alpha-value>)',
          thinking: 'rgb(var(--state-thinking-rgb) / <alpha-value>)',
          tool: 'rgb(var(--state-tool-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        hairline: '0 0 0 1px var(--hairline)',
        'hairline-accent': '0 0 0 1px var(--hairline-accent)',
        elevation: '0 8px 32px -4px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};
