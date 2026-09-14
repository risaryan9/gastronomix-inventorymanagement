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
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
