// Stand-in for admin sections that have a route and a nav entry but no screen
// yet. Labels are passed in by the route generator so this stays a dumb view.

const AdminSectionPlaceholder = ({ groupLabel, sectionLabel }) => (
  <div className="bg-card border border-border rounded-xl p-8 flex flex-col gap-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {groupLabel} / {sectionLabel}
    </p>
    <h2 className="text-2xl font-bold text-foreground">
      {sectionLabel} <span className="text-muted-foreground text-base">section</span>
    </h2>
    <p className="text-sm text-muted-foreground max-w-xl">
      This is a placeholder for the{' '}
      <span className="font-semibold text-foreground">
        {groupLabel} &gt; {sectionLabel}
      </span>{' '}
      area of the admin dashboard. We&apos;ll build out this section in detail next.
    </p>
  </div>
)

export default AdminSectionPlaceholder
