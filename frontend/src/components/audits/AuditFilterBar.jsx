// Filter bar for an audit subsection.
//
// The filters are the subsection's point of view: which action, whose action,
// which kitchen, how severe, and — because these events are the financial
// record — whether the event carries cost data at all.

import MultiSelectFilter from '../MultiSelectFilter'

const SegmentedControl = ({ options, value, onChange, ariaLabel }) => (
  <div role="group" aria-label={ariaLabel} className="inline-flex rounded-lg border border-border bg-input p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        title={option.title}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
          value === option.value
            ? 'bg-accent text-background'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        }`}
      >
        {option.label}
        {option.count !== undefined && (
          <span className={`ml-1.5 ${value === option.value ? 'text-background/70' : 'text-muted-foreground/70'}`}>
            {option.count}
          </span>
        )}
      </button>
    ))}
  </div>
)

const selectClass =
  'px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent'

const AuditFilterBar = ({
  filters,
  onChange,
  onReset,
  rangeOptions,
  familyOptions,
  severityOptions,
  actionOptions,
  kitchens,
  actors,
  isFiltered,
  resultCount,
  totalCount,
}) => {
  const set = (patch) => onChange({ ...filters, ...patch })

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-col lg:flex-row gap-3">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search material, supplier, invoice, reason, or person…"
          className="flex-1 px-4 py-2 border border-border rounded-lg bg-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <SegmentedControl
          ariaLabel="Date range"
          options={rangeOptions}
          value={filters.range}
          onChange={(range) => set({ range })}
        />
      </div>

      {filters.range === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) => set({ from: e.target.value })}
              className={selectClass}
            />
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => set({ to: e.target.value })}
              className={selectClass}
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Event family"
          options={familyOptions}
          value={filters.family}
          onChange={(family) => set({ family, actions: ['all'] })}
        />
        <SegmentedControl
          ariaLabel="Severity"
          options={severityOptions}
          value={filters.severity}
          onChange={(severity) => set({ severity })}
        />

        <MultiSelectFilter
          className="w-56"
          group="audit"
          label={
            filters.actions.includes('all')
              ? 'All actions'
              : `${filters.actions.length} action${filters.actions.length === 1 ? '' : 's'}`
          }
          allLabel="All actions"
          options={actionOptions}
          selectedValues={filters.actions}
          onChange={(actions) => set({ actions })}
        />

        <select
          value={filters.kitchenId}
          onChange={(e) => set({ kitchenId: e.target.value })}
          className={selectClass}
        >
          <option value="all">All cloud kitchens</option>
          {kitchens.map((kitchen) => (
            <option key={kitchen.id} value={kitchen.id}>
              {kitchen.name}
            </option>
          ))}
        </select>

        <select
          value={filters.actorId}
          onChange={(e) => set({ actorId: e.target.value })}
          className={selectClass}
        >
          <option value="all">Anyone</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.withCost}
            onChange={(e) => set({ withCost: e.target.checked })}
            className="w-4 h-4 accent-[#E1BB07]"
          />
          With cost data
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {resultCount} of {totalCount} event{totalCount === 1 ? '' : 's'}
          </span>
          {isFiltered && (
            <button
              type="button"
              onClick={onReset}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {filters.kitchenId !== 'all' && (
        <p className="text-xs text-muted-foreground">
          Catalog changes are global — <span className="font-mono">raw_materials</span> has no cloud kitchen — so
          they stay visible under every kitchen, tagged <span className="text-accent font-semibold">Global</span>.
        </p>
      )}
    </div>
  )
}

export default AuditFilterBar
