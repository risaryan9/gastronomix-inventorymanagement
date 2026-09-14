const TONES = {
  error: 'border-destructive bg-destructive/15',
  success: 'border-success/40 bg-success/10',
  info: 'border-border bg-muted/60',
}

export default function Alert({ tone = 'error', children }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm text-foreground ${TONES[tone]}`}>
      {children}
    </div>
  )
}
