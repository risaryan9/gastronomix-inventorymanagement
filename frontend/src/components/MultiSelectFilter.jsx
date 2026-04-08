import { useEffect, useMemo, useRef } from 'react'

const MultiSelectFilter = ({
  options = [],
  allLabel = 'All',
  selectedValues = ['all'],
  onChange,
  className = '',
  label = 'Filter',
  group = 'default'
}) => {
  const detailsRef = useRef(null)
  const optionValues = useMemo(() => options.map(option => option.value), [options])
  const hasAllSelected = selectedValues.includes('all')

  const selectedCount = useMemo(() => {
    if (hasAllSelected || selectedValues.length === 0) return 0
    return selectedValues.length
  }, [hasAllSelected, selectedValues])

  const emitChange = (nextValues) => {
    if (typeof onChange === 'function') onChange(nextValues)
  }

  const toggleAll = () => {
    emitChange(['all'])
  }

  const toggleOption = (value) => {
    let nextValues = hasAllSelected
      ? [value]
      : selectedValues.includes(value)
        ? selectedValues.filter(item => item !== value)
        : [...selectedValues, value]

    if (nextValues.length === 0) {
      nextValues = ['all']
    } else if (optionValues.every(optionValue => nextValues.includes(optionValue))) {
      nextValues = ['all']
    }

    emitChange(nextValues)
  }

  const handleToggle = () => {
    const current = detailsRef.current
    if (!current || !current.open) return

    const selector = `details[data-filter-group="${group}"][open]`
    document.querySelectorAll(selector).forEach((element) => {
      if (element !== current) {
        element.open = false
      }
    })
  }

  useEffect(() => {
    const handleDocumentPointerDown = (event) => {
      const current = detailsRef.current
      if (!current || !current.open) return
      if (!current.contains(event.target)) {
        current.open = false
      }
    }

    document.addEventListener('mousedown', handleDocumentPointerDown)
    document.addEventListener('touchstart', handleDocumentPointerDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown)
      document.removeEventListener('touchstart', handleDocumentPointerDown)
    }
  }, [])

  return (
    <details
      ref={detailsRef}
      data-filter-group={group}
      onToggle={handleToggle}
      className={`relative z-10 open:z-[200] ${className}`}
    >
      <summary className="list-none cursor-pointer select-none bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300 flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        {selectedCount > 0 && (
          <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-background text-xs font-bold">
            {selectedCount}
          </span>
        )}
      </summary>
      <div className="absolute left-0 top-full z-[300] mt-2 min-w-full bg-card border-2 border-border rounded-lg shadow-xl p-2 max-h-72 overflow-y-auto">
        <button
          type="button"
          onClick={toggleAll}
          className={`w-full text-left px-3 py-2 rounded-md text-sm ${
            hasAllSelected ? 'bg-accent/20 text-foreground' : 'hover:bg-muted'
          }`}
        >
          {allLabel}
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => toggleOption(option.value)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              !hasAllSelected && selectedValues.includes(option.value)
                ? 'bg-accent/20 text-foreground'
                : 'hover:bg-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  )
}

export default MultiSelectFilter
