import { useTheme } from '../theme.js'

// Dark by default (the internal app's look); light on request.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const toLight = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toLight ? 'Switch to light mode' : 'Switch to dark mode'}
      title={toLight ? 'Light mode' : 'Dark mode'}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/80 px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur-md transition-colors hover:border-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {toLight ? (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      <span className="hidden sm:inline">{toLight ? 'Light' : 'Dark'}</span>
    </button>
  )
}
