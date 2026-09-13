# FOFO — an accountant's read of the spec and schema

A review of [`fofo-dashboard-spec.md`](fofo-dashboard-spec.md) and
[`fofo-schema.md`](fofo-schema.md), from the point of view of the person who has
to file the returns and explain the numbers afterwards.

Both documents are careful, and most of what is written down is right. Almost
everything below is something **missing**, not something wrong. Written before
anything was built; the database has since been applied, with the ✅ findings
fixed in it. The rest are still cheaper to fix before the first real invoice
than after.

Ordered by what hurts most. Findings marked ✅ have since been fixed in the
migrations; the rest are open.

---

## A. The invoice is not yet a legal GST invoice

**1. There is no CGST / SGST / IGST split, and no place of supply.**
`fofo.invoices` has one `gst_amount` column. A tax invoice must show either
CGST + SGST (buyer in the same state as the supplying branch) or IGST (buyer in
another state), and must state the place of supply. Which one applies depends on
two states — and we store neither. `fofo.franchises` has `city` but no state,
and `cloud_kitchens` has no state either. Add state to both, and add
`place_of_supply`, `cgst_amount`, `sgst_amount`, `igst_amount` to the invoice.

**2. Our own GSTIN is nowhere.** Three kitchens in different states means three
GST registrations. The invoice must carry the GSTIN of the branch that supplied
it. Nothing holds it.

**3. The buyer's details are joined live, not frozen.** ✅ **Fixed** (name,
address, city, GSTIN; state waits for finding 1). The spec is right that
`invoice_items` must be a copy — but the invoice still reads the franchise's
name, address and GSTIN from `fofo.franchises`. If a franchise registers for GST
next year, or moves, every old invoice quietly changes. Copy billing name,
address, state and GSTIN onto the invoice row, for the same reason the lines are
copied.

**4. GSTR-1 cannot be produced from these tables.** That follows from 1–3. The
monthly return needs, per invoice: buyer GSTIN, place of supply, and taxable
value split by rate. Fixing 1–3 fixes this.

**5. No e-invoice or e-way bill fields.** Above the e-invoicing turnover
threshold, a B2B invoice is not valid until the government portal returns an IRN
and signed QR code. And goods worth over ₹50,000 leaving the kitchen need an
e-way bill — generated at exactly the dispatch step in section 8.4. Neither
appears anywhere. Even if neither applies today, decide it on purpose and leave
the columns.

---

## B. Holes in the money flow

**6. Store credit could never be spent on goods.** ✅ **Fixed.** Credit is
applied to *an invoice*, but a goods invoice is only created after the payment
lands (8.2, step 5) — so by the time it exists it is already paid, leaving the
logistics invoice as the only thing a franchise could still settle. With
"no cash-out" and "no partial spending" on top, credit from a trim was close to
unusable, and unusable credit is a liability that sits on our books forever.

Partial spending now works, which removes the dead end: any credit can be put
against any unpaid invoice, up to what is owed. See decision 0013 and
`08-create-fofo-store-credit-rpcs.sql`. The related question in **7** — whether the
goods invoice should be issued at accept rather than at payment — is still
open.

**7. We bill for goods before we know we can supply them.** Today: pay →
invoice for everything ordered → PM trims → credit note. So the first invoice is
knowingly wrong whenever stock is short. The ordinary way round this: treat the
Razorpay payment as an **advance receipt** (no tax invoice is needed on an
advance for goods) and issue the tax invoice at **accept**, for the quantity
actually accepted. The invoice then matches what left the building, and most
credit notes stop existing. The difference in money is settled as credit or
refund on its own.

**8. Nothing records whether an invoice has been paid.** Section 8.2 says
unpaid dues block a checkout — but `fofo.invoices` has no status, no settled
amount and no due date. The logistics invoice creates a due that nobody can
query without rebuilding it from `payments` and the ledger. Add a settled amount
or a view, and payment terms.

**9. The store credit balance could go negative.** ✅ **Fixed.** Two redemptions
arriving together both read "₹600 available" and both write ₹600, spending
₹1,200 of a ₹600 credit — a unique key on the invoice does not stop it, because
the two applications are against different invoices.

A `BEFORE INSERT` trigger on `store_credit_applications` now locks the invoice
row and then the credit row before summing, so the second request queues and
then fails rather than reading a stale total. This was reproduced against a real
Postgres and confirmed blocked; the two-session check is written into the
migration's verification block so it can be re-run.

**10. A credit note can be larger than the invoice it corrects.** The only check
is `amount > 0`. Nothing compares the total credited against an invoice to the
invoice total. An arithmetic slip in the trim becomes free money. Check it
inside the accept RPC.

**11. The logistics invoice has no rate and no SAC code.** Freight is a service:
its own SAC code, its own GST rate, and if a transport agency is used possibly
reverse charge — where we pay the tax, not them. The only rate in the system is
`raw_materials.sale_gst_percent`, which is for goods. Decide the freight rate
and where it lives before building 8.4.

---

## C. The numbers themselves

**12. Every money column is bare `numeric`** ✅ **Fixed.** — unlimited precision.
`cost × (1 + margin) × (1 + gst)` produces long decimals that then get added up,
so two screens can show two different totals for the same invoice. Use
`numeric(14,2)` for money and a fixed precision for rates.

**13. There is no rounding rule.** ✅ **Fixed**, per line, to the paisa, enforced
by CHECKs on invoice lines. No rupee round-off line. Round the unit price then multiply by
quantity, or multiply then round? They disagree, and the difference lands in the
tax figure. The normal answer: compute each **line's** taxable value and GST,
round each to two decimals, then add. Round the invoice total to the nearest
rupee and show the difference as its own "round off" line. Write this down once.

**14. The margin is not the real margin.** The price is built from a **weighted
average of the batches on the shelf**; the stock actually relieved is **FIFO —
the oldest batch**. When prices are rising the oldest batch is cheaper, so the
real gross profit is not the 15% we intended. That is fine for pricing and wrong
for reporting: measure profit from `stock_out_batch_consumption` (what actually
left) rather than from `order_items.unit_base_cost` (what we priced from).

**15. The financial year will be cut in the wrong place.** Invoice numbers are
gapless per financial year, and ours starts 1 April. But "today" here is the UTC
date (decision 0002). An invoice issued at 04:00 IST on 1 April is 22:30 UTC on
31 March, and falls into last year's series. The same slip happens at every
month end for GSTR-1. For anything tax-dated, work out the date in IST, and say
why in the decision record.

**16. Gapless numbering needs a locked counter, not a sequence.** A Postgres
sequence leaves gaps whenever a transaction rolls back, and a gap in a GST
series is a question at assessment time. It has to be a counter row locked for
update inside the same transaction that writes the invoice. Nothing in the
migrations does this yet. Also settle whether goods invoices, logistics invoices
and credit notes share one series or use three — three is allowed, but the
choice has to be fixed and written down.

---

## D. Edge cases in the order flow

**17. The webhook cannot find the order.** ✅ **Fixed.** `fofo.orders` has no
`razorpay_order_id`, and `fofo.payments.invoice_id` is `NOT NULL` while the
invoice does not exist until the webhook has already done its work. Razorpay
hands us a razorpay order id and a payment id, and nothing maps either to a FOFO
order. Add `razorpay_order_id` (unique) to `fofo.orders`.

**18. One outlet can end up with two paid orders.** Checkout A opens the popup.
They leave it open, go back, check out again — B kills A. Then they pay in A's
still-open popup. "Paid beats expired" is the right rule, so A becomes paid too,
and we have been paid twice for one intended order. Cancel the Razorpay order
when killing a pending one, and give a replaced order its own status
(`superseded`) so the webhook can refuse it without weakening the expiry rule.

**19. The webhook must check the amount, not only the signature.** ✅ **Fixed**
as a tested check module; the webhook endpoint itself is not built yet. Razorpay
allows partial capture, and a valid signature on ₹1 is still a valid signature.
Assert that the captured amount equals `grand_total` before marking the order
paid.

**20. The price can move between looking and paying.** Prices are live on every
read and frozen server-side at checkout, so someone who loaded the cart an hour
ago pays a figure they never saw. Show the frozen total and make them confirm it
before the popup opens.

**21. An order that cannot be fulfilled at all has no exit.** The PM cannot
cancel and can only trim, so his only move is to trim every line to zero: a
stock-out with nothing in it, a credit note for the whole invoice, and a
franchise holding credit worth a full order that they can neither cash out nor
(see 6) spend. A full failure needs a real Razorpay refund, as the one exception
to "refunds are always store credit".

**22. Cart lines can stop being sellable.** A material can be deactivated, lose
`is_fofo_sellable`, or become unpriceable in that kitchen while it sits in a
cart. Checkout has to revalidate every line and say what dropped out — not
freeze a price for something we will not sell.

---

## E. Smaller notes

- **Order totals go stale after a trim.** `subtotal`, `gst_total` and
  `grand_total` are the ordered amounts. Every screen should be explicit about
  which number it is showing: ordered, accepted, invoiced or credited.
- **Cost can leak through the orders endpoint.** `order_items` holds
  `unit_base_cost` and `margin_percent`. `GET /api/orders/:id` must strip them
  too, not just the catalogue.
- **A wrong GSTIN will not be caught.** The first two digits of a GSTIN are the
  state code. With no state stored, we cannot check it against the address —
  the buyer's auditor finds it instead.
- **A large franchisee may pay slightly less than the invoice**, deducting TDS
  under section 194Q. There is no way to record a short payment. Unlikely at one
  outlet, but worth knowing it exists.
- **Goods in transit belong to nobody.** Stock leaves at accept, delivery is
  days later. Acceptable, but at a year end it is an unlabelled gap.

---

## What I would fix first

1. Add state and GSTIN to both sides, and the tax split and place of supply to
   the invoice (**1–4**). Everything else in section A follows.
2. Move the goods invoice to **accept** instead of payment (**7**). This removes
   most credit notes and fixes the store credit dead end (**6**) at the same time.
3. Add `razorpay_order_id` to `fofo.orders` and check the amount in the webhook
   (**17, 19**). Nothing works without the first and nothing is safe without the
   second.
4. Fix the money columns and write the rounding rule down (**12, 13**).
5. Decide the financial-year and numbering mechanics (**15, 16**) before the
   first invoice is issued, because they cannot be corrected afterwards.
