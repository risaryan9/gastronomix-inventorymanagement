# 0022. A recipe is stored as shares of the mix and a yield fraction, by weight

Date: 2026-10-06
Status: Accepted

## Context

`public.recipes` and `public.recipe_items` existed, empty, with a `quantity` per
ingredient and a `yield_quantity` described as "how much one run produces"
(migration 02, spec §5). Nothing wrote to them. Building the page that does
raised what those numbers should mean.

Kitchens write a recipe as one batch in grams, with a yield as a fraction: the
spreadsheet's Chicken Basic Marination is 1,533.5 g of seven ingredients at a
yield of 0.62. Stored as typed, the same recipe weighed at a different batch
size is a different row, and "is this the same recipe" cannot be answered.

Three more things had no answer in the tables:

- Most made materials are counted in pieces (`nos`): 34 of 46 semi-finished and
  all 23 finished. A recipe by weight gives a cost per kilogram.
- Some bought materials are not weighed either: 5 by the litre, 9 by the piece.
- Purchase managers were to enter recipes, and the database cannot verify a
  key-logged-in purchase manager (decision 0017), which is why recipe writes
  were admin-only.

## Decision

**A recipe is a ratio by weight.** `recipe_items.quantity` is the ingredient's
share of the mix, 0 to 1, and one recipe's shares add up to exactly 1.
`recipes.yield_quantity` is the yield fraction: 0.62 means 1 kg of mix makes
620 g. The batch that was typed is not kept.

**The cost rule is the spec's, read per kilogram:**

```
cost of 1 kg of output = Σ share × cost of 1 kg of ingredient ÷ yield
```

**The database turns grams into shares** (`save_recipe`, migration 20), to eight
places, with the rounding difference put on the largest ingredient. The browser
previews them and never sends one.

**Everything is weighed in grams.** A material bought in kg has a cost per kg.
A litre is taken as 1,000 g. A material bought by the piece cannot go into a
recipe. A made material can, whatever it is counted in.

**A made material counted in pieces carries `piece_weight_grams`** on its
recipe: cost per piece is cost per kg × that ÷ 1000.

**Purchase managers and admins both save recipes**, through `save_recipe` and
`remove_recipe`, which take the acting user's id and check its role. RLS on the
tables stays admin-only.

## Alternatives

**Keep the batch as typed, with `yield_quantity` as the output weight.** What
migration 02 pictured. Rejected: the same recipe has as many representations as
batch sizes, and every edit rewrites all of it.

**Store quantity per one unit of output** (1.5155 kg of chicken per kg of
marination). One number fewer, but the yield is then folded into every line and
cannot be read back or changed on its own, and yield is the figure a kitchen
actually revises.

**A grams-per-litre and grams-per-piece figure on each material.** Correct, and
the way to let oil be costed properly and pieces be used at all. Deferred by
choice on 2026-10-06 to get recipes entered.

**Verify purchase managers with the partner server's staff pass (decision
0015).** The secure way to let them write. Deferred by choice on the same day;
see Consequences.

## Consequences

- **The rule is written in three places** that share no code: `save_recipe`
  (what is stored), `partner-frontend/api/_lib/pricing.js` (what a franchise
  pays) and `frontend/src/lib/recipeCost.js` (the Recipes page's preview).
  Change the cost rule in both JavaScript modules or the page and the catalogue
  disagree.
- **Anyone holding the internal app's public key can save a recipe as a
  purchase manager**, because the acting user's id is supplied by the caller.
  A recipe sets a live FOFO price. This is the exposure `raw_materials` already
  has, extended knowingly. It closes with the staff pass. Every save and removal
  is an audit event carrying the recipe before and after.
- **Oil is costed about 8% low**, since a litre of oil weighs about 920 g.
- **A product whose recipe needs a piece-bought ingredient cannot be entered**
  until materials carry a weight per piece.
- **A saved recipe opens as a 1,000 g batch**, not the batch that was typed.
- Removing a recipe leaves the product, and everything made from it, without a
  cost, so franchises see them as unavailable.

## Where it lives

- `migrations/fofo/20-save-recipes-as-shares-of-the-mix.sql`
- `partner-frontend/api/_lib/pricing.js`, `api/_lib/catalog.js`
- `frontend/src/lib/recipeCost.js`, `src/pages/purchase-manager/Recipes.jsx`
- Audit: `catalog:recipe_saved`, `catalog:recipe_removed` in
  `frontend/src/lib/auditEvents.js`
