// PostgREST caps a response at a server-configured row count. Paging keeps
// totals correct regardless of where that cap sits.
//
// `build` must return a fresh query builder each call — a supabase-js builder
// executes when awaited and cannot be reused.

const PAGE_SIZE = 1000

export const fetchAllRows = async (build) => {
  const rows = []

  for (let page = 0; ; page += 1) {
    const { data, error } = await build().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw error

    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}
