-- =====================================================================
-- Recipes: what a product is made of, so its cost can be rolled up
--
-- The FOFO dashboard (docs/fofo-dashboard-spec.md) sells semi-finished and
-- finished materials to franchises. Those have no purchase price — we make
-- them — so their price has to be built from what goes into them, and
-- rebuilt whenever a vendor's raw material price moves.
--
-- WHAT THIS IS NOT. service_kits is the OTHER thing a kitchen calls a
-- recipe: the butter a chaap is cooked in and the chutney served beside it,
-- auto-filled into a dispatch plan. That is a packing rule, per unit SOLD.
-- This table is per unit PRODUCED and feeds money calculations. Decision
-- 0012 renamed the old `recipes` table to `service_kits` specifically so
-- this feature could have the word. Read it before touching either.
--
-- WHAT CHANGES. Two tables:
--
--   public.recipes       one row per material we make
--   public.recipe_items  what goes into it, and how much
--
-- YIELD, BECAUSE KITCHENS WORK IN BATCHES. A marinade run might consume 4
-- kg of components and produce 5 kg of marinade. Cost per kg is the
-- component total divided by yield_quantity, not the component total. A
-- recipe written per single unit leaves yield_quantity at 1 and the
-- division changes nothing.
--
-- ONLY MADE THINGS HAVE RECIPES. material_type must be 'semi_finished' or
-- 'finished'. A raw material is bought, not made, and a non-food item is
-- neither. Enforced by trigger rather than CHECK, because the rule reads a
-- second table and a CHECK constraint cannot.
--
-- RECIPES NEST, AND THE CYCLE GUARD IS IN THE DATABASE. A chaap's recipe
-- contains marinade; marinade has its own recipe; the cost roll-up walks
-- down through both. Nothing in the table shape stops someone building A
-- contains B contains A, and such a loop would hang or blow the stack of
-- every consumer forever after. The guard is a trigger that walks the graph
-- before each write, so bad data cannot be created in the first place —
-- from the admin screen, a script, or psql. Callers should still cap their
-- own recursion depth: this trigger protects rows written after it exists,
-- not a graph someone builds by disabling it.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipes (
  id             uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  material_id    uuid NOT NULL REFERENCES public.raw_materials(id),
  yield_quantity numeric NOT NULL DEFAULT 1,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT recipes_yield_quantity_positive CHECK (yield_quantity > 0)
);

-- One live recipe per material. A soft-deleted row must not block a new
-- one, so the uniqueness is a partial index rather than a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS recipes_material_id_live_key
  ON public.recipes (material_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.recipe_items (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  recipe_id             uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  component_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity              numeric NOT NULL,
  sort_order            integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT recipe_items_unique_component UNIQUE (recipe_id, component_material_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe
  ON public.recipe_items (recipe_id);

-- The roll-up walks upward from a component to find what uses it, so this
-- direction is queried as often as the other.
CREATE INDEX IF NOT EXISTS idx_recipe_items_component
  ON public.recipe_items (component_material_id);

COMMENT ON TABLE public.recipes IS
'Bill of materials: what one production run of a material consumes, and how much it yields. Feeds the FOFO food-cost roll-up. NOT service_kits, which is what an outlet needs alongside a finished product to serve it (decision 0012).';

COMMENT ON COLUMN public.recipes.material_id IS
'The material this recipe produces. Must be semi_finished or finished — enforced by trigger, since the rule reads raw_materials.';

COMMENT ON COLUMN public.recipes.yield_quantity IS
'How much of material_id one run of this recipe produces, in the material''s own unit. Cost per unit is the component total divided by this. 1 for recipes written per single unit.';

COMMENT ON TABLE public.recipe_items IS
'The components of one recipe, at the quantity consumed per production run (not per unit produced — divide by recipes.yield_quantity for that).';

-- ---------------------------------------------------------------------
-- 2. Only semi-finished and finished materials may have a recipe
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recipes_validate_material()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_type text;
BEGIN
  SELECT material_type INTO v_type
  FROM public.raw_materials
  WHERE id = NEW.material_id;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Material % does not exist', NEW.material_id;
  END IF;

  IF v_type NOT IN ('semi_finished', 'finished') THEN
    RAISE EXCEPTION
      'Only semi_finished and finished materials can have a recipe; % is %',
      NEW.material_id, v_type;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recipes_validate_material ON public.recipes;
CREATE TRIGGER trg_recipes_validate_material
  BEFORE INSERT OR UPDATE OF material_id ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.recipes_validate_material();

-- ---------------------------------------------------------------------
-- 3. A recipe may not contain itself, at any depth
-- ---------------------------------------------------------------------
-- Walks down from the component being added. If the product this recipe
-- makes is reachable from that component, the edge would close a loop.
-- A component equal to the product is caught by the same walk at depth 1.

CREATE OR REPLACE FUNCTION public.recipe_items_reject_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product_id uuid;
  v_cycle      boolean;
BEGIN
  SELECT material_id INTO v_product_id
  FROM public.recipes
  WHERE id = NEW.recipe_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Recipe % does not exist', NEW.recipe_id;
  END IF;

  WITH RECURSIVE reachable(material_id, depth) AS (
    SELECT NEW.component_material_id, 1
    UNION ALL
    SELECT ri.component_material_id, r.depth + 1
    FROM reachable r
    JOIN public.recipes rc
      ON rc.material_id = r.material_id
     AND rc.deleted_at IS NULL
    JOIN public.recipe_items ri
      ON ri.recipe_id = rc.id
    WHERE r.depth < 50
  )
  SELECT EXISTS (
    SELECT 1 FROM reachable WHERE material_id = v_product_id
  ) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION
      'Adding material % to this recipe would make the product % contain itself',
      NEW.component_material_id, v_product_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recipe_items_reject_cycle ON public.recipe_items;
CREATE TRIGGER trg_recipe_items_reject_cycle
  BEFORE INSERT OR UPDATE OF recipe_id, component_material_id ON public.recipe_items
  FOR EACH ROW EXECUTE FUNCTION public.recipe_items_reject_cycle();

-- These two helpers are internal. Decision 0004: this database grants
-- EXECUTE by name at CREATE time, so REVOKE ... FROM PUBLIC does nothing —
-- anon and authenticated must be revoked by name. service_role keeps
-- access deliberately; that key is server-side only.
REVOKE EXECUTE ON FUNCTION public.recipes_validate_material()     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recipe_items_reject_cycle()     FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS — the same shape as service_kits, deliberately
-- ---------------------------------------------------------------------
-- READS are open, like service_kits and the catalogue they describe: staff
-- log in by key, arrive with auth.uid() NULL, and must still see recipes.
--
-- WRITES ARE ADMIN-ONLY, AND DO NOT USE is_purchase_manager_or_admin().
-- That helper returns TRUE whenever auth.uid() IS NULL — it exists so
-- key-login staff can work — which means a policy built on it lets anyone
-- holding the anon key write. The anon key ships in the internal app's
-- bundle, so it is public. For most tables that is a known, accepted risk;
-- for recipes it is a money risk, because a recipe is what a made product's
-- FOFO price is built from: shrink one component quantity and the price
-- drops. So writes require a real Supabase Auth session belonging to an
-- active admin, exactly as service_kits requires (verified against the live
-- policies before this file was run).
--
-- Consequence: a purchase manager on key login cannot edit recipes. At the
-- database level a key-login PM is indistinguishable from an anonymous
-- caller, so "PMs may edit" and "anyone may edit" are the same policy.
-- Recipe editing is an admin screen (docs/fofo-dashboard-spec.md §5).

ALTER TABLE public.recipes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

-- Replaced policies from an earlier draft of this file, in case it was
-- ever applied somewhere.
DROP POLICY IF EXISTS "Purchase managers and admins manage recipes" ON public.recipes;
DROP POLICY IF EXISTS "Purchase managers and admins manage recipe items" ON public.recipe_items;

DROP POLICY IF EXISTS "All users can view recipes" ON public.recipes;
CREATE POLICY "All users can view recipes" ON public.recipes
  FOR SELECT USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "recipes_insert_admin_only" ON public.recipes;
CREATE POLICY "recipes_insert_admin_only" ON public.recipes
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "recipes_update_admin_only" ON public.recipes;
CREATE POLICY "recipes_update_admin_only" ON public.recipes
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "recipes_delete_admin_only" ON public.recipes;
CREATE POLICY "recipes_delete_admin_only" ON public.recipes
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "All users can view recipe items" ON public.recipe_items;
CREATE POLICY "All users can view recipe items" ON public.recipe_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "recipe_items_insert_admin_only" ON public.recipe_items;
CREATE POLICY "recipe_items_insert_admin_only" ON public.recipe_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "recipe_items_update_admin_only" ON public.recipe_items;
CREATE POLICY "recipe_items_update_admin_only" ON public.recipe_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "recipe_items_delete_admin_only" ON public.recipe_items;
CREATE POLICY "recipe_items_delete_admin_only" ON public.recipe_items
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
      AND u.is_active = true AND u.deleted_at IS NULL
  ));

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Both tables exist and are empty:
--
-- SELECT 'recipes' AS t, COUNT(*) FROM public.recipes
-- UNION ALL SELECT 'recipe_items', COUNT(*) FROM public.recipe_items;
--
-- A raw material cannot have a recipe — this must FAIL:
--
-- INSERT INTO public.recipes (material_id)
-- SELECT id FROM public.raw_materials WHERE material_type = 'raw_material' LIMIT 1;
--
-- A recipe cannot contain itself — this must FAIL:
--
-- WITH r AS (
--   INSERT INTO public.recipes (material_id)
--   SELECT id FROM public.raw_materials WHERE material_type = 'semi_finished' LIMIT 1
--   RETURNING id, material_id
-- )
-- INSERT INTO public.recipe_items (recipe_id, component_material_id, quantity)
-- SELECT id, material_id, 1 FROM r;
--
-- Every material that still needs a recipe before it can be sold:
--
-- SELECT m.name, m.code, m.material_type
-- FROM public.raw_materials m
-- LEFT JOIN public.recipes r
--   ON r.material_id = m.id AND r.deleted_at IS NULL
-- WHERE m.deleted_at IS NULL
--   AND m.is_active = true
--   AND m.material_type IN ('semi_finished', 'finished')
--   AND r.id IS NULL
-- ORDER BY m.material_type, m.name;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP TRIGGER IF EXISTS trg_recipe_items_reject_cycle ON public.recipe_items;
-- DROP TRIGGER IF EXISTS trg_recipes_validate_material ON public.recipes;
-- DROP FUNCTION IF EXISTS public.recipe_items_reject_cycle();
-- DROP FUNCTION IF EXISTS public.recipes_validate_material();
-- DROP TABLE IF EXISTS public.recipe_items;
-- DROP TABLE IF EXISTS public.recipes;
