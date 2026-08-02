// Column sorting for the admin ledger tables.
//
// Clicking a column sorts by it ascending; clicking the same column again
// flips direction. Switching columns always starts ascending, so a click never
// lands you in a direction you did not ask for.

import { useCallback, useMemo, useState } from 'react'

// Blanks sort last in both directions — a missing supplier is not "before A",
// it is absent, and burying it keeps the populated rows together.
const compare = (a, b) => {
  const aMissing = a === null || a === undefined || a === ''
  const bMissing = b === null || b === undefined || b === ''
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en-IN')
}

export const useTableSort = (defaultKey, defaultDirection = 'asc') => {
  const [sortBy, setSortBy] = useState(defaultKey)
  const [direction, setDirection] = useState(defaultDirection)

  const toggle = useCallback(
    (key) => {
      if (key === sortBy) {
        setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
        return
      }
      setSortBy(key)
      setDirection('asc')
    },
    [sortBy]
  )

  /**
   * @param rows       the rows to sort (not mutated)
   * @param accessors  { [columnKey]: (row) => comparable value }
   */
  const sortRows = useCallback(
    (rows, accessors) => {
      const accessor = accessors[sortBy]
      if (!accessor) return rows

      const sorted = [...rows].sort((a, b) => compare(accessor(a), accessor(b)))
      return direction === 'asc' ? sorted : sorted.reverse()
    },
    [sortBy, direction]
  )

  return useMemo(
    () => ({ sortBy, direction, toggle, sortRows }),
    [sortBy, direction, toggle, sortRows]
  )
}
