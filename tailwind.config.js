/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './public/**/*.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          canvas: '#000000',      // Pure black canvas
          surface1: '#0a0a0c',    // Barely raised
          surface2: '#121214',    // Elevated
          surface3: '#18181b',    // Zinc-900 equivalent
          surface4: '#27272a',    // Zinc-800 equivalent
          border: 'rgba(255, 255, 255, 0.08)',
          hairline: 'rgba(255, 255, 255, 0.04)',
          inkPrimary: '#fafafa',  // Bright white
          inkSecondary: '#a1a1aa',// Muted text
          inkMuted: '#71717a',    // Faint text
          accent: '#ffffff',      // Pure white accent
          accentHover: '#e4e4e7',
          accentGlow: 'rgba(255, 255, 255, 0.08)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        hairline: '0 0 0 1px rgba(255, 255, 255, 0.04)',
        'hairline-accent': '0 0 0 1px rgba(255, 255, 255, 0.15)',
        elevation: '0 8px 32px -4px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};
