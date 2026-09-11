# 0012. A service kit is not a bill of materials, and no longer calls itself a recipe

Date: 2026-09-11
Status: Accepted

## Context

`service_kits` was called `recipes` from the day it was added
(`migrations/add-recipes-and-recipe-ingredients.sql`, "Master recipe table
linking finished products to their ingredient compositions"). The name was
wrong, and wrong in the direction that invites damage.

What the table holds is what an outlet needs **alongside** one unit of a
finished product in order to serve it: the butter a Peri Peri Soya Chaap is
cooked in, the chutney and onions that go out on the plate. Adding one unit of a
finished product to a dispatch plan auto-fills those companion materials at
their per-unit quantity. It is a packing rule.

What it does not hold is how the product is made. It says nothing about the
marinade that goes into the chaap, nothing about what any of it costs, and its
quantities are per unit **sold**, not per unit **produced**.

That distinction stopped being academic once a real bill of materials was
planned: finished and semi-finished materials each getting a component list with
the exact quantities needed to make them, so their cost can be rolled up from
raw material prices that move with every vendor invoice. Two features, both of
which a kitchen would naturally call "the recipe", cannot share the word.

## Decision

The existing feature is a **service kit**, everywhere:

    recipes                  ->  service_kits
      recipe_name            ->    kit_name
    recipe_ingredients       ->  service_kit_items
      recipe_id              ->    service_kit_id
      ingredient_material_id ->    material_id

Tables, columns, constraints, indexes, functions, triggers, policies, the admin
screen, the sidebar label and the URL all move together
(`migrations/rename-recipes-to-service-kits.sql`). No column changes type, no
default changes, no row is read or written — the shape is exactly what it was.

The word "recipe" is left free for the bill-of-materials feature, because that
is what the kitchen calls the thing that describes how a product is made.

## Alternatives

**Leave the name and call the new feature "BOM".** Cheaper by one migration, and
rejected because it puts the wrong word on the wrong table permanently: staff
would be told the screen called Recipes is not about recipes, and the screen
called BOM is. The confusion was already live — the name is why the table's own
comment described it as an "ingredient composition", which it is not.

**Rename later, after the BOM ships.** Rejected on cost. At the time of the
rename the tables held 1 kit and 5 items, and one screen read them. Every month
of delay adds rows, consumers and muscle memory, and the two features would have
overlapped under one name in the interim — exactly the window in which someone
wires the wrong table into a cost calculation.

**Rename only the UI, keep the schema.** Rejected: the schema is where the next
reader looks first, and a `recipes` table sitting next to a `recipes` feature
that is not it is the whole problem restated.

## Consequences

- **The admin URL changed.** `/admin/operations/recipes` is now
  `/admin/operations/service-kits`. Old bookmarks do not error — an unknown
  admin section falls back to `ADMIN_DEFAULT_PATH` via `resolveAdminSection` —
  but they do not land where they used to.
- **The migration and the app must deploy together.** The frontend embeds these
  tables by foreign-key constraint name
  (`raw_materials!service_kits_finished_product_fk`), so PostgREST resolves the
  embed against the constraint names this migration sets. Ship the app without
  the migration, or the migration without the app, and the service kit screen
  fails to load. This is the one genuinely fragile thing about the rename.
- **The original migration is kept, marked superseded.** It records what was
  actually applied to the database; rewriting it would make the file lie about
  history.
- **The BOM is still unbuilt, and the distinction is only written down here.**
  The obvious "fix" for a future reader is to notice that `service_kits` is
  finished-product → component materials with a `wastage_percent`, conclude it
  is already a BOM, and hang cost roll-ups off it. It is not one: its quantities
  are per unit sold, it cannot have a semi-finished head
  (`trg_service_kits_head_type` forbids it), and nothing it describes is
  consumed by production. A bill of materials needs its own tables.
- **`docs/ADMIN_DASHBOARD_ANALYTICS.md` still says "recipe"** in its
  theoretical-consumption and COGS sections. That is correct and was left alone:
  those passages describe the BOM feature that does not exist yet, not this one.

## Where it lives

- `migrations/rename-recipes-to-service-kits.sql` — the rename, and the long
  form of the reasoning above
- `migrations/add-recipes-and-recipe-ingredients.sql` — the original, marked
  superseded
- `migrations/test-service-kit-constraints.sql` — the constraint tests
- `frontend/src/pages/admin/AdminServiceKits.jsx` — the admin screen
- `frontend/src/pages/admin/adminNavigation.js` — the sidebar label and URL
- `frontend/src/pages/DispatchExecutiveDashboard.jsx` — the only consumer:
  `handleQuantityChange` expands a finished product into its kit
