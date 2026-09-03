# 0001. Requisition reports narrow to one outlet, and change shape when they do

Date: 2026-09-03
Status: Accepted

## Context

The two admin requisition reports — item-wise consumption, and requested vs
allocated — could only be downloaded for every outlet at once, over a fixed
last-30-days window. The question actually being asked of them is usually about
one outlet over the last week: "why is Indiranagar's onion always short?"

Answering that meant downloading every outlet and filtering in Excel.

## Decision

Reports can be scoped to a single outlet, and the range presets are a list so
7 days sits beside 30.

The single-outlet reports are **not** the wide reports with rows removed. With
one outlet, the Cloud Kitchen and Outlet columns become a constant repeated down
every row, so they move into the workbook header and the freed space goes to
cuts that only one outlet makes possible:

- **Consumption** gains a per-material requisition count and share of spend, and
  a dated requisition-by-requisition sheet.
- **Difference** gains a By Material sheet totalling requested against allocated
  across the whole period, and the same differences dated by requisition.

Two scoping rules follow from picking an outlet explicitly:

- **The cloud kitchen filter is ignored.** An outlet belongs to exactly one
  kitchen, so naming the outlet already pins it. The fetch filters on
  `outlet_id` alone.
- **Inactive outlets are included.** The wide reports skip them, and should:
  that filter keeps dead outlets out of a list nobody asked for. But here the
  outlet was named, and its history is a fair thing to pull. The workbook says
  so on its Summary sheet rather than silently returning nothing.

## Alternatives

**One report with an outlet column, filtered in Excel.** What we had. It works,
and it is why nobody used these reports for a single-outlet question — the
useful cuts (by requisition, by material over time) are not reachable by
filtering a by-outlet table, because that table has already aggregated the
dimension you want.

**A separate "Outlet Report" button.** Rejected: two buttons that produce the
same report at different scopes teach the reader that scope is a property of the
button rather than of the period card, which is where every other scope control
already lives.

**Reusing the wide builders and slicing the result.** The wide builders drop
inactive outlets and fold away the requisition dimension before returning. Both
are correct for their report and wrong for this one, so the single-outlet
builders fold the same rows independently. They share the fetch and the cost map.

## Consequences

- Two more builders and two more Excel writers to keep in step with the wide
  pair. The shared pieces — the cost map, the cost note, the summary header —
  are shared in code, so a change to how money is calculated still lands in one
  place.
- Adding a third preset (90 days, say) is one entry in `RANGE_PRESETS`.
- `SearchableSelect` was written for the outlet picker but is generic. Reach for
  it for any list too long to scan in a native `<select>` — materials, vendors.
- The sheets show the first eight characters of a requisition's UUID, matching
  `StockOut.jsx` and the outlet detail pages. If requisitions ever get a real
  human-readable number, these exports are one of the places to update.

## Where it lives

- `frontend/src/lib/requisitionReports.js` — `reportRangeForDays`,
  `buildOutletConsumption`, `buildOutletRequestedVsAllocated`
- `frontend/src/lib/requisitionReportExports.js` — the single-outlet writers
- `frontend/src/pages/admin/AdminRequisitionsReports.jsx` — presets and scope UI
- `frontend/src/components/SearchableSelect.jsx`
