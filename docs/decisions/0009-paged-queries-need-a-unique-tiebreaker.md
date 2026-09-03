# 0009. A paged query needs a unique tiebreaker in its ORDER BY

Date: 2026-09-03 (recorded)
Status: Accepted

## Context

PostgREST caps a response at a server-configured row count. `fetchAllRows()`
pages past that cap so totals stay correct wherever the cap sits — reports
routinely exceed it.

Paging is `.range(offset, offset + 999)` repeated. That is only well defined if
the sort order is **total**. If rows tie on the sort key, Postgres may order the
tied group differently between two requests, and a row can be returned twice, or
skipped entirely, at a page boundary.

This is not theoretical here. Requisitions are ordered by `request_date`, and
many share one — that is the normal case, not an edge case. A skipped row is a
silently wrong report total, with nothing to notice.

## Decision

Every query passed to `fetchAllRows()` orders by a **unique** column last,
normally `id`:

```js
.order('request_date', { ascending: false })
.order('id', { ascending: true })   // unique tiebreaker — not decoration
```

`build` must also return a **fresh** query builder each call: a supabase-js
builder executes when awaited and cannot be reused.

## Consequences

- Removing the trailing `.order('id')` from a paged query looks like a harmless
  cleanup and corrupts report totals in a way that no error surfaces.
- The rule applies to anything paged, not only `fetchAllRows` — including
  `.range()` used directly.
- A query that genuinely cannot exceed one page does not need it, but the cap is
  server configuration, not something the code can see. Add the tiebreaker.

## Where it lives

- `frontend/src/lib/fetchAllRows.js`
- `frontend/src/lib/requisitionReports.js` — both paged queries carry it
