/** @type {import('tailwindcss').Config} */

/*
 * The internal app's design system (frontend/tailwind.config.js), with one
 * difference: every colour is a CSS variable, so the partner app can offer a
 * light theme as well as the internal app's dark one. The token names are the
 * same — bg-card, text-accent, border-border — so a class means the same thing
 * in both apps. The values live in src/index.css.
 *
 * `hsl(var(--x) / <alpha-value>)` keeps opacity modifiers working: bg-accent/10.
 */
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('foreground') },
        primary: token('foreground'),
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground'), text: token('accent-text') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        success: token('success'),
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.75rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        3: '3px',
      },
      boxShadow: {
        button: '0.1em 0.1em 0 0 rgba(225, 187, 7, 0.3)',
        'button-hover': '0.15em 0.15em 0 0 rgba(225, 187, 7, 0.5)',
        'button-active': '0.05em 0.05em 0 0 rgba(225, 187, 7, 0.3)',
        card: 'var(--card-shadow)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'rise-in': 'riseIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-up': 'sheetUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-left': 'sheetLeft 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'backdrop-in': 'backdropIn 0.2s ease-out both',
        pop: 'pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        sheetUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        sheetLeft: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        backdropIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
