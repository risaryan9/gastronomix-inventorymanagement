# CLAUDE.md

Gastronomix inventory management: a React + Vite frontend (`frontend/`) on
Supabase/Postgres, with schema and RPC changes as numbered SQL files in
`migrations/`.

## Read `docs/decisions/` first

That directory records why parts of this system are the way they are, for
reasons that cannot live in any one file. **Several of them describe things that
look like bugs and are not.** Check the index in
[`docs/decisions/README.md`](docs/decisions/README.md) before changing:

| If you are touching… | Read |
|---|---|
| a date column, or anything meaning "today" | [0002 — the business day is the UTC date](docs/decisions/0002-business-day-is-the-utc-date.md) |
| a screen that reports an inventory value | [0003 — GST-inclusive valuation](docs/decisions/0003-inventory-value-is-gst-inclusive.md) |
| audit writes, or a `SECURITY DEFINER` function's grants | [0004 — audit writes are server-side only](docs/decisions/0004-audit-writes-are-server-side-only.md) |
| requisition creation or the daily cutoff | [0005 — the cutoff is a trigger](docs/decisions/0005-requisition-cutoff-is-a-database-trigger.md) |
| the requisition picker or the material catalog | [0006 — requisitionable materials](docs/decisions/0006-requisitionable-materials.md) |
| a jsPDF export | [0007 — PDF money](docs/decisions/0007-pdf-money-goes-through-pdfcurrency.md) |
| a user-facing message or prompt | [0008 — no browser alerts](docs/decisions/0008-no-browser-alerts-or-confirms.md) |
| a query passed to `fetchAllRows` | [0009 — paged queries need a tiebreaker](docs/decisions/0009-paged-queries-need-a-unique-tiebreaker.md) |
| dispatch planning, the closing sheet, or returns | [0010 — dispatch and closing do not move stock](docs/decisions/0010-dispatch-and-closing-do-not-move-stock.md) |

The two that most often get "fixed" back into bugs: **the business day is UTC on
purpose** (0002), and **`REVOKE … FROM PUBLIC` does not make a function internal
in this database** (0004).

### Add to it

When you make a decision that the code cannot explain on its own — a rule
mirrored in two places, something you ruled out and why, a judgement between two
defensible options — add a record. `docs/decisions/README.md` sets out what
belongs there and what does not, and the format.

## Conventions

- **Explain the why in place.** This codebase documents its reasoning in file
  and function headers, at some length where it matters
  (`lib/businessDate.js`, `lib/inventoryValuation.js`). Match that. A reason
  that fits above a function goes above the function, not in the decision log.
- **Shared rules live in one module.** `lib/inventoryValuation.js`,
  `lib/businessDate.js`, `lib/pdfCurrency.js`, `lib/formatNumbers.js` exist
  because the same rule computed inline on four screens produced four answers.
  Read from them rather than recomputing.
- **Migrations are additive files** in `migrations/`, named for what they do.
  They open with a comment block explaining the change and its reasoning. Note
  that a migration is not necessarily applied — say so if it needs running.
- Screen, CSV and Excel output use `₹`; PDFs cannot (see 0007).

## Commands

```bash
cd frontend
npm run dev      # Vite dev server
npm run build    # must pass before committing
npm run lint     # eslint; a small number of pre-existing errors exist
```

There is no test suite. Verify report and export logic by exercising the pure
builders directly with representative data, and confirm UI changes build clean.
