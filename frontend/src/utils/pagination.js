/**
 * Builds a compact page list: [1, 'ellipsis', 4, 5, 6, 'ellipsis', 27]
 * Avoids rendering dozens of page buttons when totalPages is large.
 */
export function getVisiblePaginationItems(currentPage, totalPages, siblingCount = 1) {
  if (totalPages <= 1) return []
  const maxAll = 7
  if (totalPages <= maxAll) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages = new Set([1, totalPages, currentPage])
  for (let i = currentPage - siblingCount; i <= currentPage + siblingCount; i++) {
    if (i >= 1 && i <= totalPages) pages.add(i)
  }

  const sorted = [...pages].sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('ellipsis')
    out.push(p)
    prev = p
  }
  return out
}
