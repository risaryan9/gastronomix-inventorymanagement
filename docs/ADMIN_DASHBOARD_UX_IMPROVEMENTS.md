# Admin Dashboard — Usability & Engineering Improvements

**Created:** 2 August 2026
**Scope:** Everything *except* Reports & Analytics. Sales, Performance and Trends are deliberately left out — they are waiting on data and are covered in `ADMIN_DASHBOARD_GAP_ANALYSIS.md` §4.
**Method:** Code read of all eight admin sections plus the dashboard shell, checked against the production build output.

Everything below is a real finding with a file to look at, not general advice. Each item says **what is wrong**, **why it matters**, and **what to do**.

---

## The short version

If you only do five things, do these:

| # | Improvement | Why it wins |
|---|---|---|
| 1 | **Split the JavaScript bundle** | One 1.76 MB file loads on every login, for every role. Biggest single speed win available. |
| 2 | **Make the dashboard work on a phone** | The admin shell has no mobile layout at all. Right now it is desktop-only. |
| 3 | **Replace `window.confirm` with a real dialog + toasts** | Three sections use raw browser popups. Nothing tells you an action succeeded. |
| 4 | **One shared table component** | Eight sections each hand-roll their own table. Fixing anything means fixing it eight times. |
| 5 | **Search + pagination on every list** | Only two of eight sections have either. |

---

## A. Navigation and finding your way

### A1. There is no mobile or tablet layout — **high priority**

`pages/AdminDashboard.jsx` lays the page out as a fixed 288px sidebar next to the content (`w-72 shrink-0` inside a `flex`). There is no breakpoint, no hamburger button, no drawer. On a phone the sidebar takes most of the screen and the content is squeezed into what is left.

The Purchase Manager dashboard already solves this properly — it has a mobile header, a slide-in drawer, and an overlay (`pages/PurchaseManagerDashboard.jsx`). The admin dashboard was simply never given the same treatment.

**Term:** *responsive layout* — the page rearranging itself to fit the screen instead of scaling down.

**Do:** copy the Purchase Manager's drawer pattern into the admin shell. Sidebar becomes a slide-in panel below `lg:`, with a hamburger in the header. Half a day, and it makes the dashboard usable away from a desk.

### A2. The browser tab never says where you are

No screen anywhere in the app sets `document.title`. Every tab reads the same thing. Now that all 17 sections have their own URL, having five admin tabs open is realistic — and they are indistinguishable.

**Do:** set the title from the nav config, e.g. `Users · Admin · Gastronomix`. Ten lines in `AdminDashboard.jsx`, since `adminNavigation.js` already knows every section's label.

### A3. No breadcrumb or page heading in the content area

The sidebar shows which section is active, but the content area starts straight into the section's own card. If you deep-link into `/admin/people/operators`, nothing at the top of the page tells you that you are in **People → Operators**.

**Do:** a small breadcrumb line above the content, generated from the nav config. It also gives keyboard and screen-reader users something to land on (see E2).

### A4. The Session Information card takes permanent sidebar space

The sidebar's lower half is a card showing full name, role, email, login type and **cloud kitchen ID** — a raw UUID. This is reference information you look at roughly never, occupying prime screen space on every page.

**Do:** move it into a small avatar/menu in the header, with Logout. Drop the UUID entirely, or keep it behind a "copy" button for support purposes.

### A5. No quick jump between sections

With 17 sections, reaching Dispatch Brands from Audits is: click group, click section. There is no search-and-jump.

**Term:** *command palette* — the `Ctrl/Cmd + K` search box that jumps to any page by typing part of its name.

**Do:** worth it once the section count grows, low priority now. The nav config already contains everything a palette needs.

---

## B. Consistency between sections

The eight admin sections were built at different times and do the same jobs differently. This is the single biggest drag on both usability and maintenance.

### B1. Four different ways to show a dialog

| Pattern | Where |
|---|---|
| Custom in-app confirm | `AdminOutlets.jsx` (`confirmDialog` state) |
| **Raw `window.confirm()`** | `AdminUsers.jsx:283`, `AdminServiceKits.jsx:267,289`, `AdminOperators.jsx:112` |
| Plain overlay `div`, no dialog semantics | `AdminRequisitionsReports.jsx` |
| Proper accessible modal | `components/admin/kitchen/KitchenRecordModal.jsx` (new) |

`window.confirm` is the worst of these: it is a browser popup that ignores your styling entirely, blocks all JavaScript while open, cannot be tested, and some browsers let users suppress it permanently — in which case **the action silently never happens**.

**Do:** promote the new modal into a shared `AdminModal` + `ConfirmDialog` pair and replace all three `window.confirm` calls. This also fixes the accessibility gap in `AdminRequisitionsReports` in the same pass.

### B2. Only two of eight sections paginate

`Materials` (in admin mode) and `Requisitions Reports` paginate. Users, Outlets, Vendors, Service Kits, Brand Dispatch and Operators render every row.

Volumes are small today — 72 outlets, 23 users, 11 vendors — so nothing is broken. But Outlets is already a 72-row wall of text with no page breaks, and this gets worse silently as the business grows.

**Do:** the new `KitchenPanel` component already does toolbar + table + pagination + empty states. Promote it to a shared admin table and adopt it section by section.

### B3. Filters look different on every page

Outlets uses multi-select chips; Requisitions Reports uses a plain dropdown plus a text box; the new overviews use segmented buttons. Same job, three appearances.

**Do:** settle on one filter bar. `components/audits/AuditFilterBar.jsx` is the most complete one already written and is a reasonable base.

### B4. Every section re-implements its table markup

There is no shared table. Each of the eight sections writes its own `<thead>`/`<tbody>` with its own padding, hover behaviour and header styling. Sorting exists only in the two newest tabs.

**Why it matters:** a change like "add sorting" or "make rows keyboard-focusable" currently costs eight edits and will be done inconsistently.

**Do:** one `AdminTable` covering header, sortable columns, row hover, empty state, loading state and pagination.

---

## C. The tables themselves

### C1. No export anywhere in the admin dashboard

`xlsx` and `jspdf` are already dependencies and are used in the Purchase Manager and Supervisor screens. **No admin section uses either.** The person most likely to need a spreadsheet — the one who can see all three kitchens — is the only one who cannot get one.

**Do:** an "Export" button on the shared table, giving Excel from whatever is currently filtered. Small job, immediately useful.

### C2. Search has no debounce

Search boxes filter on every keystroke. Fine at current volumes because filtering happens in memory, but it will stutter once any list is fetched from the server per keystroke.

**Term:** *debounce* — waiting until the user stops typing (say 250ms) before acting.

**Do:** debounce when search moves server-side. Not urgent now — noted so it is not forgotten.

### C3. Wide tables scroll with no anchor

Tables scroll sideways on narrow screens, but the first column scrolls away with everything else, so you lose track of which row you are reading.

**Do:** make the first column sticky (`position: sticky; left: 0`) in the shared table.

### C4. No row-level busy state

Actions like deactivate reload the whole table. Between click and refresh there is no indication that anything is happening, and the row you clicked jumps as the list re-sorts.

**Term:** *optimistic update* — showing the expected result immediately and quietly correcting if the server disagrees.

**Do:** disable and spin the affected row, and update that row in place rather than refetching the list.

---

## D. Feedback and safety

### D1. Nothing confirms that anything worked

There is no toast/notification system in the entire app. Save a user, deactivate an outlet — the modal closes and the list refreshes. If the refresh is quick, you cannot tell whether it worked.

**Term:** *toast* — a small temporary message in a corner confirming what just happened.

**Do:** one small toast provider used app-wide. This is the single highest-value UX addition on this list; it makes every existing action feel trustworthy.

### D2. Errors are dead ends

Failures render as a line of red text. There is no Retry button, and the message is usually generic ("Failed to load…"). A network blip means the user must find their way back and re-navigate.

**Do:** give the shared error state a Retry that re-runs the same fetch.

### D3. Destructive actions have no undo

Deactivating a user, outlet or service kit is reversible in the database, but the interface offers no immediate way back — you must find the record and reverse it manually. Operators are worse: `AdminOperators.jsx:112` does a genuine **delete** ("This cannot be undone").

**Do:** an "Undo" action inside the success toast covers reversible cases cheaply. For the operator delete, consider a soft delete (`deleted_at`) to match every other table in the schema.

### D4. No sign of when data was loaded

The overviews show live figures with no timestamp and no refresh button. Left open on a wall screen, they quietly go stale.

**Do:** "Updated 14:32" plus a refresh button in the overview headers.

---

## E. Accessibility

### E1. Modal accessibility is still outstanding in one place

`AdminRequisitionsReports.jsx` modals have no `role="dialog"`, no `aria-modal`, no Escape-to-close, no focus trap and no scroll lock. The newer modals do all of this. *(Also tracked as §5.5 in the gap analysis.)*

**Term:** *focus trap* — keeping keyboard focus inside a dialog while it is open, so Tab cannot wander onto the page behind it.

### E2. Changing section does not move focus

Clicking a sidebar link swaps the content, but keyboard focus stays on the link and screen readers announce nothing. A screen-reader user has no idea the page changed.

**Do:** move focus to the content heading on navigation, and add a polite live region announcing the section name. Pairs naturally with the breadcrumb in A3.

### E3. Colour is sometimes the only signal

Status chips in the older sections rely on colour with a word next to them (fine), but some numeric cells still lean on colour alone. The newer screens use status pills with explicit text — worth standardising on that.

### E4. Icon-only buttons need labels

Several close and action buttons are a bare `×` or an SVG with no `aria-label`, so a screen reader announces "button" with no indication of what it does.

**Do:** audit for `aria-label` on every icon-only control. Mechanical, quick.

---

## F. Performance

### F1. One giant bundle — **highest technical priority**

The production build emits a single **1,758 kB** JavaScript file (479 kB gzipped) and Vite explicitly warns about it. Nothing is split.

**Term:** *code splitting* — breaking the app into pieces the browser downloads only when needed.

Two specific costs:

1. `adminNavigation.js` imports all eight admin screens at the top of the file, so opening the dashboard downloads every section even if you only ever visit one.
2. Because everything is in one bundle, **a supervisor logging in on a phone downloads the entire admin dashboard, Recharts included**, and never uses any of it.

**Do:** `React.lazy()` each section in the nav config, wrap the router `Outlet` in `<Suspense>`, and split by role at the top-level routes. The nav config makes this a contained change — it is the one file that decides what gets imported. Expect a large drop in initial load.

### F2. Charts are heavy and load for everyone

Recharts is only used on the two overview screens but ships to every user, in that same bundle. Solved by F1, worth naming separately because it is a big chunk on its own.

### F3. Everything refetches on every visit

There is no caching. Leaving Users and coming back re-runs the same queries. Switching kitchen or date range on an overview throws away everything already fetched.

**Term:** *client cache* — remembering a recent result so revisiting a screen is instant, then quietly refreshing in the background.

**Do:** either a small in-memory cache keyed by query, or adopt a data-fetching library. Not urgent at current data sizes; increasingly noticeable as history grows.

### F4. Some aggregation could move into the database

The overviews pull rows and total them in the browser. This is a deliberate, documented choice — the row counts are small and it avoids database views that would need migrating and maintaining. Worth revisiting only if these tables grow by an order of magnitude; the aggregation is isolated in `lib/adminOverview.js` and `lib/adminKitchenDetail.js` specifically so it can be moved without touching the screens.

---

## G. Smaller things worth doing

- **Remember the user's last filter.** Date range resets to 30 days on every visit. Persist per-section choices in `localStorage`.
- **Bulk actions.** Deactivating six outlets is six modals. Checkboxes plus one bulk action would help — this is the kind of thing where accidental mass changes hurt, so pair it with D3's undo.
- **Make table rows keyboard-reachable.** Rows that open a modal are `<tr onClick>`, which the keyboard cannot reach. Needs `tabIndex`, Enter/Space handling, or a focusable cell.
- **Better empty states.** The newest tables explain the difference between "nothing recorded" and "nothing matches your filters". Older sections just say "No data".
- **Kill the raw UUID in the sidebar** (see A4).
- **Consider a soft delete for operators** (see D3).

---

## H. Suggested order

**Round 1 — foundations that everything else builds on**
1. Code splitting by role and section (F1, F2)
2. Toast/notification system (D1)
3. Shared `AdminTable` + `AdminModal` + `ConfirmDialog` (B1, B4)

**Round 2 — roll the foundations out**
4. Mobile drawer for the admin shell (A1)
5. Replace all three `window.confirm` calls; fix the Requisitions Reports modals (B1, E1)
6. Adopt the shared table across the remaining six sections, bringing search, sorting and pagination with it (B2, B3)
7. Export to Excel from the shared table (C1)

**Round 3 — polish**
8. Page titles and breadcrumbs (A2, A3)
9. Focus management and live region on navigation (E2)
10. Retry on errors; row-level busy states; undo in toasts (C4, D2, D3)
11. Refresh button and "last updated" on the overviews (D4)
12. Remembered filters, sticky first column, icon labels (G, C3, E4)

**Later, if the app grows**
13. Command palette (A5)
14. Client-side caching (F3)
15. Bulk actions (G)

---

## What I left out on purpose

- **Reports & Analytics** — Sales, Performance, Trends. Waiting on data, per your instruction.
- **New data capture** — purchase orders, expiry dates, cycle counts. These need schema work and are covered in `ADMIN_DASHBOARD_ANALYTICS.md` §7.
- **The outlet detail view** on the Kitchen Wise Overview — still waiting on what you want it to contain.

---

## One caveat on all of this

None of the admin dashboard work has been checked visually in a browser during development — lint, production builds and SQL cross-checks all pass, but layout, spacing and overflow are unverified. **A manual pass through every admin section on a real screen would likely add several concrete items to this list**, particularly in sections A and C. That pass is worth doing before committing to the order above.
