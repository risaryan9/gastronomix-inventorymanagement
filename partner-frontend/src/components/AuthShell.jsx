import ThemeToggle from './ThemeToggle.jsx'

/*
 * The frame for pages a person reaches before they are signed in — registration
 * now, sign-in and password reset later. Built like the internal app's login
 * screen: a centred card on the page background, the brand above it.
 */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-end p-4">
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-12 sm:items-center">
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-6 flex flex-col items-center text-center">
            <img src="/gastronomix-logo.png" alt="Gastronomix" className="h-20 w-20 object-contain" />
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Gastronomix Partners
            </p>
          </div>

          <div className="rounded-2xl border-2 border-border bg-card/90 p-8 shadow-card backdrop-blur-md">
            {title && <h1 className={`${subtitle ? 'mb-1' : 'mb-4'} text-2xl font-bold text-foreground`}>{title}</h1>}
            {subtitle && <div className="mb-6 text-sm text-muted-foreground">{subtitle}</div>}
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
