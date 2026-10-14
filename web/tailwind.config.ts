import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Shared with IEMS: industrial slate chrome, one blue action color.
        // See design-system/hadirops/MASTER.md.
        brand: {
          light: '#93C5FD',   // icon fills, focus rings; never text
          DEFAULT: '#2563EB', // actions and links; white text 5.2:1
          dark: '#1D4ED8',    // hover on brand.DEFAULT
        },
        accent: '#F59E0B',    // warnings and highlights only; dark text on it
        surface: '#F4F6FA',   // page canvas, hovered rows
        chrome: '#0B1220',    // sidebar and login brand panel
        divider: '#E2E8F0',   // borders, separators
        text: {
          primary: '#0F172A',
          secondary: '#475569',
          disabled: '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // Soft UI depth, shared with IEMS: hairline plus a wide, faint ambient shadow.
        sm: '0 1px 2px rgb(15 23 42 / 0.04), 0 2px 8px -2px rgb(15 23 42 / 0.06)',
        md: '0 1px 2px rgb(15 23 42 / 0.05), 0 8px 24px -6px rgb(15 23 42 / 0.12)',
        lg: '0 2px 4px rgb(15 23 42 / 0.05), 0 16px 40px -8px rgb(15 23 42 / 0.18)',
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)',
        lift: '0 2px 4px rgb(15 23 42 / 0.05), 0 12px 32px -8px rgb(15 23 42 / 0.16)',
        glow: '0 8px 24px -6px rgb(37 99 235 / 0.45)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'route-progress': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(300%)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        rise: 'rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'route-progress': 'route-progress 900ms ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
}

export default config
