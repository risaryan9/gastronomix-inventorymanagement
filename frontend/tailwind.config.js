/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(222, 15%, 8%)',
        foreground: 'hsl(0, 0%, 95%)',
        card: {
          DEFAULT: 'hsl(222, 14%, 12%)',
          foreground: 'hsl(0, 0%, 95%)',
        },
        popover: {
          DEFAULT: 'hsl(222, 14%, 11%)',
          foreground: 'hsl(0, 0%, 95%)',
        },
        primary: 'hsl(0, 0%, 95%)',
        secondary: 'hsl(49, 95%, 46%)',
        muted: {
          DEFAULT: 'hsl(222, 12%, 18%)',
          foreground: 'hsl(0, 0%, 65%)',
        },
        accent: 'hsl(49, 95%, 46%)', // Brand Gold #E1BB07
        destructive: {
          DEFAULT: 'hsl(0, 70%, 45%)',
          foreground: 'hsl(0, 0%, 100%)',
        },
        border: 'hsl(222, 10%, 20%)',
        input: 'hsl(222, 12%, 16%)',
        ring: 'hsl(49, 95%, 46%)',
        sidebar: {
          background: 'hsl(222, 14%, 10%)',
          foreground: 'hsl(0, 0%, 90%)',
          primary: 'hsl(0, 0%, 95%)',
          accent: 'hsl(222, 12%, 18%)',
          border: 'hsl(222, 10%, 20%)',
          ring: 'hsl(49, 95%, 46%)',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.75rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        '3': '3px',
      },
      boxShadow: {
        'button': '0.1em 0.1em 0 0 rgba(225, 187, 7, 0.3)',
        'button-hover': '0.15em 0.15em 0 0 rgba(225, 187, 7, 0.5)',
        'button-active': '0.05em 0.05em 0 0 rgba(225, 187, 7, 0.3)',
        'card': '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
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
