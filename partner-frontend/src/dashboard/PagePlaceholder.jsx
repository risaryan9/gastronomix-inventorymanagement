// Stand-in for a dashboard section that has a route and a nav entry but no
// screen yet.
export default function PagePlaceholder({ title }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
      <div className="mt-6 flex min-h-[16rem] items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/40 p-8">
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  )
}
