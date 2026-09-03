import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * A single-select dropdown with a search box, for lists too long to scan in a
 * native <select> — outlets, materials, anything that runs past a screenful.
 *
 * Options are `{ value, label, hint }`; `hint` is a second line shown under the
 * label and is searched alongside it, so an outlet can be found by its cloud
 * kitchen. Passing `emptyLabel` puts an "everything" choice at the top of the
 * list that reports back as `''`.
 */
const SearchableSelect = ({
  id,
  value = '',
  onChange,
  options = [],
  emptyLabel = '',
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  noResultsLabel = 'No matches.',
  className = '',
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const searchRef = useRef(null)

  const selected = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  )

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) =>
      `${option.label} ${option.hint || ''}`.toLowerCase().includes(term)
    )
  }, [options, search])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  // Cleared on the way in rather than on the way out: a term left over from
  // last time would open onto an already-filtered list.
  const toggle = () => {
    setSearch('')
    setOpen((prev) => !prev)
  }

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const select = (nextValue) => {
    onChange?.(nextValue)
    setOpen(false)
  }

  const buttonLabel = selected?.label || (value ? placeholder : emptyLabel || placeholder)

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 border border-border rounded-lg bg-input text-foreground text-left focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <span className="truncate">
          {buttonLabel}
          {selected?.hint && (
            <span className="text-muted-foreground font-normal"> · {selected.hint}</span>
          )}
        </span>
        <span className="text-muted-foreground text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-[200] mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {emptyLabel && !search.trim() && (
              <li>
                <button
                  type="button"
                  onClick={() => select('')}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${
                    value ? 'text-foreground' : 'text-accent font-semibold'
                  }`}
                >
                  {emptyLabel}
                </button>
              </li>
            )}
            {matches.length === 0 ? (
              <li className="px-3 py-4 text-sm text-center text-muted-foreground">{noResultsLabel}</li>
            ) : (
              matches.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => select(option.value)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${
                      option.value === value ? 'bg-muted/40 text-accent font-semibold' : 'text-foreground'
                    }`}
                  >
                    <span className="block truncate">{option.label}</span>
                    {option.hint && (
                      <span className="block text-xs text-muted-foreground truncate">{option.hint}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export default SearchableSelect
