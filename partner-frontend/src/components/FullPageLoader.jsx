export default function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <img src="/gastronomix-logo.png" alt="" className="h-14 w-14 animate-pulse object-contain" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    </div>
  )
}
