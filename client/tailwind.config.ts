import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07070a', 900: '#0c0c11', 850: '#111118', 800: '#16161f', 700: '#1f1f2b', 600: '#2a2a3a' },
        ember: { 300: '#ffc078', 400: '#ffa94d', 500: '#ff8a1f', 600: '#f06d00', 700: '#c25400' },
        amber: { 400: '#fbbf24' },
        mint: { 400: '#4ade80' },
        danger: { 400: '#f87171' },
      },
      fontFamily: {
        display: ['"Rajdhani"', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,138,31,.35), 0 10px 40px -10px rgba(255,138,31,.45)',
        'glow-lg': '0 0 60px -10px rgba(255,138,31,.7)',
      },
      keyframes: {
        // Opacity-only so it runs on the compositor.
        pulseGlow: { '0%,100%': { opacity: '0.35' }, '50%': { opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'pulse-glow': 'pulseGlow 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
