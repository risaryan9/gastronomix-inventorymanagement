# Decision log

Why the code is the way it is, when the code itself cannot say so.

Each file here records one decision: what we chose, what we chose against, and
what would have to change for the answer to be different. They are written for
whoever picks this up next — a new engineer, or a coding agent with no memory of
the conversation that produced the code.

## What belongs here

This codebase already explains itself well in place. `lib/businessDate.js` spends
thirty lines on why the business day is derived from UTC; `lib/requisitionReports.js`
opens by defining what "consumed" means. That is the right home for a reason that
lives inside one file, because it is read at the moment it matters and it cannot
drift away from the code it describes.

Write a record here instead when the reason does **not** fit in one file:

- **It spans places.** A rule enforced in the frontend and mirrored in a Postgres
  function. A convention every export follows. Something a reader would have to
  already know to find.
- **It rules something out.** We tried it, it broke, here is the traffic that
  proves it. Without the record the next person re-tries it — this has already
  happened once, see `businessDate.js`.
- **It is a judgement, not a fact.** Two defensible options, one picked for
  reasons that are not recoverable by reading the result.
- **It constrains future work.** "Do not add X until Y" — advice that has no
  natural line of code to sit on.

## What does not

- A reason that fits above a function. Put it above the function.
- Anything git already answers: what changed, when, by whom.
- Restating what a record already says. Amend that record instead.
- Task notes, plans, or progress. Those belong in the PR.

## Format

Files are `NNNN-kebab-case-title.md`, numbered in the order they were written.
Numbers are never reused, and a superseded record is not deleted — it is marked
Superseded and points at the one that replaced it, because the fact that we once
decided otherwise is itself worth knowing.

**Accepted (temporary)** marks a decision taken knowing it is a staging post.
Such a record says where the thing is going and what must be true before it gets
there, so the next person extends a plan instead of rediscovering one. When it
does change, supersede it rather than editing it: how the system behaved during
the interim is part of how data from that period should be read.

Keep them short. A record nobody finishes reading protects nothing.

```markdown
# NNNN. Title in plain words

Date: YYYY-MM-DD
Status: Accepted | Accepted (temporary) | Superseded by NNNN | Reversed

## Context
What was true that forced a choice.

## Decision
What we chose, in the active voice.

## Alternatives
What else was on the table, and the specific reason it lost.

## Consequences
What this makes easy, what it makes hard, and what would have to be true
for us to revisit it.

## Where it lives
The files that implement it, so the record and the code can be checked
against each other.
```

## Records

| # | Decision | Read before touching | Status |
|---|----------|----------------------|--------|
| [0001](0001-single-outlet-requisition-reports.md) | Requisition reports narrow to one outlet, and change shape when they do | the admin requisition reports | Accepted |
| [0002](0002-business-day-is-the-utc-date.md) | **The business day is the UTC date** — deliberate, and reverted once already | any date column, anything "today" | Accepted |
| [0003](0003-inventory-value-is-gst-inclusive.md) | Stock is valued GST-inclusive; a deactivated material is not stock | any screen reporting an inventory figure | Accepted |
| [0004](0004-audit-writes-are-server-side-only.md) | Audit events are written only by server-side functions | audit writes, any `SECURITY DEFINER` function's grants | Accepted |
| [0005](0005-requisition-cutoff-is-a-database-trigger.md) | The requisition cutoff is a database trigger; the frontend is a courtesy | the cutoff, requisition creation | Accepted |
| [0006](0006-requisitionable-materials.md) | Whether an outlet can requisition a material is three questions, not one | the requisition picker, the material catalog | Accepted |
| [0007](0007-pdf-money-goes-through-pdfcurrency.md) | Money in a PDF goes through `pdfCurrency` — jsPDF cannot print ₹ | any jsPDF export | Accepted |
| [0008](0008-no-browser-alerts-or-confirms.md) | No `window.alert` or `window.confirm` — toasts and one dialog | any user-facing message or prompt | Accepted |
| [0009](0009-paged-queries-need-a-unique-tiebreaker.md) | A paged query needs a unique tiebreaker in its ORDER BY | any query passed to `fetchAllRows` | Accepted |
| [0010](0010-dispatch-and-closing-do-not-move-stock.md) | The dispatch plan and the closing sheet are records; they do not move stock — **for now**; the intended end state is lock-plan → stock-out, return → stock-in | dispatch planning, the closing sheet, returns | Accepted (temporary) |
| [0011](0011-stock-thresholds-are-per-cloud-kitchen.md) | A low-stock threshold is per cloud kitchen; `raw_materials.low_stock_threshold` is the default | any low-stock figure, the material form | Accepted |
| [0012](0012-service-kits-are-not-bills-of-materials.md) | A service kit is what goes out *with* a finished product — it is not a bill of materials, and is no longer called a recipe | service kits, dispatch auto-fill, the coming BOM | Accepted |
| [0013](0013-store-credit-is-a-payment-not-a-discount.md) | **Store credit is a payment, not a discount** — applying it never changes an invoice; it is spent in parts, oldest first, and no balance is ever stored | FOFO store credit, credit notes, anything that settles an invoice | Accepted |
| [0014](0014-fofo-prices-mark-up-the-gst-inclusive-cost.md) | **FOFO prices mark up the GST-inclusive cost** — reads as tax on tax, and is correct because there is no input tax credit | FOFO pricing, the BOM cost roll-up | Accepted |
| [0015](0015-fofo-data-is-reached-only-through-the-partner-server.md) | FOFO data is reached only through the partner app's server — no Supabase key in that app, and internal staff go through the server too | any FOFO endpoint, staff access to `fofo`, partner-app env vars | Accepted |
| [0016](0016-a-fofo-invoice-is-never-edited.md) | A FOFO invoice is never edited — a trim issues a credit note | invoices, the accept flow, trims | Accepted |

Records 0002–0009 were backfilled on 2026-09-03 from commit messages and code
comments that already carried the reasoning. Where a date is given as
"recorded", the decision itself is older — see the commit named at the foot of
the record.
