-- =====================================================================
-- Recipes are saved as shares of the mix, with a yield fraction
--
-- 02 created public.recipes and public.recipe_items and left them empty.
-- This is the first thing that writes to them: the Recipes page in the
-- purchase manager and admin dashboards. It also settles what the numbers
-- in those tables MEAN, which 02 left as "a quantity" and "how much one
-- run produces". Decision 0022 is the record; this is the database half.
--
-- WHAT CHANGES.
--
--   public.recipes       + piece_weight_grams
--   public.recipe_items  + quantity can be at most 1 (it is a share)
--   functions            + save_recipe     the only way a recipe is written
--                        + remove_recipe
--
-- ---------------------------------------------------------------------
-- 1. A RECIPE IS A RATIO, NOT A BATCH
-- ---------------------------------------------------------------------
-- The kitchen writes a recipe as one batch, in grams:
--
--   Chicken Basic Marination
--     Chicken Breast Boneless   1440.9 g
--     Ginger Garlic Paste         51.9 g
--     ... five more ...
--     total                     1533.5 g      yield 0.62
--
-- What is kept is not the batch. It is:
--
--   recipe_items.quantity   the ingredient's SHARE of the mix by weight:
--                           1440.9 / 1533.5 = 0.93961526. The shares of a
--                           recipe add up to exactly 1.
--   recipes.yield_quantity  the YIELD FRACTION: how much of what goes in
--                           comes out. 0.62 means 1 kg of mix makes 620 g.
--
-- So the recipe is true for any batch size, and two people who weighed
-- different batches of the same thing save the same recipe.
--
-- THE COST RULE IS THE ONE THE SPEC ALREADY HAD (§6.3), read per kilogram:
--
--   cost of 1 kg of output = SUM(share x cost of 1 kg of ingredient)
--                            / yield fraction
--
-- For the batch above: Rs 385.21 of ingredients per kg of mix, / 0.62 =
-- Rs 621.31 per kg of marinated chicken, which is the spreadsheet's figure.
--
-- THE SHARES ARE WORKED OUT HERE, NOT IN THE BROWSER. save_recipe takes
-- grams and divides. Rounding to eight places can leave the shares a hair
-- off 1, so the difference is put on the largest ingredient:
-- they always add up to exactly 1, and a cost built from them does not
-- drift with how the batch happened to be weighed.
--
-- ---------------------------------------------------------------------
-- 2. EVERYTHING IS WEIGHED IN GRAMS
-- ---------------------------------------------------------------------
-- A share by weight only means something if every ingredient is weighed.
-- So, by what the material is bought or counted in:
--
--   kg                       weighed. Its cost is already per kg.
--   liter                    weighed, and A LITRE IS TAKEN AS 1,000 g. Oil
--                            is nearer 920 g, so oil in a recipe is costed
--                            about 8% low. Accepted for now (0022).
--   nos, packets (bought)    CANNOT be put in a recipe. Its cost is per
--                            piece and nothing says what a piece weighs.
--   nos, packets (made)      can, because its own recipe says what a piece
--                            weighs (below).
--
-- ---------------------------------------------------------------------
-- 3. THINGS SOLD BY THE PIECE: piece_weight_grams
-- ---------------------------------------------------------------------
-- A recipe gives a cost per kg, but most made items are counted in pieces:
-- a kabab, a dough ball. piece_weight_grams says what one piece weighs, so
--
--   cost of one piece = cost per kg x piece_weight_grams / 1000
--
-- and, used as an ingredient in something else, the piece converts back to
-- weight the same way. It is required when the material's unit is nos or
-- packets, and must be empty when the unit is kg or liter: a figure that
-- nothing reads is a figure someone will trust.
--
-- ---------------------------------------------------------------------
-- 4. RECIPES NEST
-- ---------------------------------------------------------------------
-- An ingredient may itself be made: a kabab's recipe contains marinated
-- chicken, which has its own recipe. Nothing here needs to know. The cost
-- roll-up recurses (partner-frontend/api/_lib/pricing.js), and the cycle
-- guard from 02 (trg_recipe_items_reject_cycle) still refuses a recipe
-- that would contain itself, on every line this function inserts.
--
-- ---------------------------------------------------------------------
-- 5. WHO MAY SAVE ONE, AND WHAT THAT IS WORTH
-- ---------------------------------------------------------------------
-- 02 made recipe writes admin-only through RLS, because a purchase manager
-- signs in by key and the database cannot tell one from an anonymous
-- caller (decision 0017). The policies are unchanged. Recipes are now
-- written through save_recipe and remove_recipe, which take
-- p_acting_user_id the same way set_raw_material_active and the other
-- catalog functions do, and require that user to be an active purchase
-- manager or admin.
--
-- THAT CHECK IS NOT AUTHENTICATION. The id is whatever the caller sends,
-- and staff ids are readable. Anyone holding the internal app's public key
-- can call save_recipe as a purchase manager, and a recipe sets a live FOFO
-- price. This is the same exposure raw_materials already has (its margin
-- and sellable flag), chosen knowingly on 2026-10-06 so purchase managers
-- can enter recipes now. It closes when staff requests are verified by the
-- partner server's staff pass (decision 0015). Until then every save is an
-- audit event, with the recipe before and after.
--
-- Both functions write their own audit event (decision 0004): category
-- catalog, action recipe_saved or recipe_removed.
--
-- Requires: 02. Reads public.users and public.log_audit_event.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. What the columns mean
-- ---------------------------------------------------------------------

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS piece_weight_grams numeric;

ALTER TABLE public.recipes
  DROP CONSTRAINT IF EXISTS recipes_piece_weight_positive;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_piece_weight_positive
  CHECK (piece_weight_grams IS NULL OR piece_weight_grams > 0);

-- Both tables are empty, so this cannot reject a row that exists.
ALTER TABLE public.recipe_items
  DROP CONSTRAINT IF EXISTS recipe_items_quantity_is_a_share;
ALTER TABLE public.recipe_items
  ADD CONSTRAINT recipe_items_quantity_is_a_share CHECK (quantity <= 1);

COMMENT ON COLUMN public.recipe_items.quantity IS
'The ingredient''s share of the mix by weight, 0 to 1. The shares of one recipe add up to exactly 1. Not a batch quantity: save_recipe takes grams and stores the ratio. See 20-save-recipes-as-shares-of-the-mix.sql.';

COMMENT ON COLUMN public.recipes.yield_quantity IS
'The yield fraction: how much of what goes in comes out. 0.62 means 1 kg of mix makes 620 g. Cost per kg of output is the mix''s cost per kg divided by this.';

COMMENT ON COLUMN public.recipes.piece_weight_grams IS
'What one piece weighs, in grams, for a material counted in pieces (unit nos or packets). Cost per piece is cost per kg x this / 1000. NULL for a material measured in kg or liter.';

-- ---------------------------------------------------------------------
-- 2. A recipe as the audit trail records it
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recipe_audit_snapshot(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Names, not ids: an audit event must still read correctly after a
  -- material is renamed or removed.
  SELECT jsonb_build_object(
           'name',               m.name,
           'code',               m.code,
           'unit',               m.unit,
           'yield',              r.yield_quantity,
           'piece_weight_grams', r.piece_weight_grams,
           'notes',              r.notes,
           'items',              COALESCE((
             SELECT jsonb_agg(jsonb_build_object('name', c.name, 'code', c.code, 'share', ri.quantity)
                              ORDER BY ri.sort_order, ri.id)
               FROM public.recipe_items ri
               JOIN public.raw_materials c ON c.id = ri.component_material_id
              WHERE ri.recipe_id = r.id), '[]'::jsonb)
         )
    FROM public.recipes r
    JOIN public.raw_materials m ON m.id = r.material_id
   WHERE r.id = p_recipe_id;
$$;

COMMENT ON FUNCTION public.recipe_audit_snapshot(uuid) IS
'A recipe as an audit event keeps it: the product, the yield, and each ingredient by name with its share. Internal to save_recipe and remove_recipe.';

-- ---------------------------------------------------------------------
-- 3. Saving a recipe
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_recipe(
  p_acting_user_id     uuid,
  p_material_id        uuid,
  p_items              jsonb,
  p_yield              numeric,
  p_piece_weight_grams numeric DEFAULT NULL,
  p_notes              text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       public.users%ROWTYPE;
  v_material    public.raw_materials%ROWTYPE;
  v_recipe_id   uuid;
  v_created     boolean := false;
  v_old         jsonb;
  v_total       numeric;
  v_count       integer;
  v_bad         text;
  v_piece       numeric;
  v_event_id    uuid;
BEGIN
  -- Who. See the header: this is a role check on an id the caller supplied,
  -- not proof of who is calling.
  SELECT * INTO v_actor FROM public.users WHERE id = p_acting_user_id;
  IF NOT FOUND OR v_actor.deleted_at IS NOT NULL OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('purchase_manager', 'admin') THEN
    RAISE EXCEPTION 'Only an active purchase manager or admin can save a recipe';
  END IF;

  -- Locked, so two people saving the same product's recipe queue.
  SELECT * INTO v_material FROM public.raw_materials WHERE id = p_material_id FOR UPDATE;
  IF NOT FOUND OR v_material.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That product was not found';
  END IF;
  IF v_material.material_type NOT IN ('semi_finished', 'finished') THEN
    RAISE EXCEPTION '% is bought, not made, so it cannot have a recipe', v_material.name;
  END IF;

  IF p_yield IS NULL OR p_yield <= 0 THEN
    RAISE EXCEPTION 'The yield must be more than 0. Enter it as a fraction, such as 0.62';
  END IF;
  -- A fraction, so 62 is a slip for 0.62. Above 1 is real (water taken up in
  -- cooking, when the water is not an ingredient) but not ten times over.
  IF p_yield > 10 THEN
    RAISE EXCEPTION 'A yield of % is not a fraction. Enter 62%% as 0.62', p_yield;
  END IF;

  -- What one piece weighs: needed exactly when the product is counted.
  IF v_material.unit IN ('nos', 'packets') THEN
    IF p_piece_weight_grams IS NULL OR p_piece_weight_grams <= 0 THEN
      RAISE EXCEPTION '% is counted in pieces, so the recipe needs the weight of one piece in grams', v_material.name;
    END IF;
    v_piece := p_piece_weight_grams;
  ELSE
    v_piece := NULL;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A recipe needs at least one ingredient';
  END IF;

  -- The lines as typed: an ingredient and its weight in grams.
  CREATE TEMP TABLE _recipe_lines ON COMMIT DROP AS
  SELECT (item->>'component_material_id')::uuid AS component_id,
         (item->>'grams')::numeric              AS grams,
         position::integer                       AS sort_order,
         NULL::numeric                           AS share
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(item, position);

  IF EXISTS (SELECT 1 FROM _recipe_lines WHERE component_id IS NULL OR grams IS NULL OR grams <= 0) THEN
    RAISE EXCEPTION 'Every ingredient needs a material and a weight in grams above 0';
  END IF;

  SELECT c.name INTO v_bad
    FROM _recipe_lines l JOIN public.raw_materials c ON c.id = l.component_id
   GROUP BY c.id, c.name HAVING count(*) > 1 LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is in the recipe twice. Add the two weights together', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM _recipe_lines WHERE component_id = p_material_id) THEN
    RAISE EXCEPTION '% cannot be an ingredient of itself', v_material.name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM _recipe_lines l
      LEFT JOIN public.raw_materials c ON c.id = l.component_id
     WHERE c.id IS NULL OR c.deleted_at IS NOT NULL OR c.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'An ingredient is not in the materials list, or is no longer active';
  END IF;

  -- A bought material counted in pieces has a cost per piece and no weight.
  SELECT c.name INTO v_bad
    FROM _recipe_lines l JOIN public.raw_materials c ON c.id = l.component_id
   WHERE c.unit IN ('nos', 'packets') AND c.material_type NOT IN ('semi_finished', 'finished')
   ORDER BY l.sort_order LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is bought by the piece, so it cannot be weighed into a recipe yet', v_bad;
  END IF;

  -- A recipe that would contain itself, said with names. The trigger from 02
  -- refuses the same thing line by line, but can only quote ids.
  WITH RECURSIVE reachable(root, material_id, depth) AS (
    SELECT l.component_id, l.component_id, 1 FROM _recipe_lines l
    UNION ALL
    SELECT r.root, ri.component_material_id, r.depth + 1
      FROM reachable r
      JOIN public.recipes rc ON rc.material_id = r.material_id AND rc.deleted_at IS NULL
      JOIN public.recipe_items ri ON ri.recipe_id = rc.id
     WHERE r.depth < 50
  )
  SELECT c.name INTO v_bad
    FROM reachable x JOIN public.raw_materials c ON c.id = x.root
   WHERE x.material_id = p_material_id LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is itself made from %, so it cannot be one of its ingredients', v_bad, v_material.name;
  END IF;

  -- Grams to shares. Eight places; then the rounding difference goes on the
  -- largest ingredient, so the shares add up to exactly 1.
  SELECT sum(grams), count(*) INTO v_total, v_count FROM _recipe_lines;
  UPDATE _recipe_lines SET share = round(grams / v_total, 8);

  SELECT c.name INTO v_bad
    FROM _recipe_lines l JOIN public.raw_materials c ON c.id = l.component_id
   WHERE l.share <= 0 ORDER BY l.sort_order LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is too small a part of this batch to record', v_bad;
  END IF;

  UPDATE _recipe_lines l
     SET share = l.share + (1 - (SELECT sum(share) FROM _recipe_lines))
   WHERE l.sort_order = (SELECT sort_order FROM _recipe_lines ORDER BY grams DESC, sort_order LIMIT 1);

  -- One live recipe per material (02): change it, or make it.
  SELECT id INTO v_recipe_id
    FROM public.recipes WHERE material_id = p_material_id AND deleted_at IS NULL;

  IF v_recipe_id IS NULL THEN
    INSERT INTO public.recipes (material_id, yield_quantity, piece_weight_grams, notes, is_active)
    VALUES (p_material_id, p_yield, v_piece, NULLIF(btrim(p_notes), ''), true)
    RETURNING id INTO v_recipe_id;
    v_created := true;
  ELSE
    v_old := public.recipe_audit_snapshot(v_recipe_id);
    UPDATE public.recipes
       SET yield_quantity = p_yield, piece_weight_grams = v_piece,
           notes = NULLIF(btrim(p_notes), ''), is_active = true, updated_at = now()
     WHERE id = v_recipe_id;
    DELETE FROM public.recipe_items WHERE recipe_id = v_recipe_id;
  END IF;

  -- trg_recipe_items_reject_cycle (02) checks each line as it goes in.
  INSERT INTO public.recipe_items (recipe_id, component_material_id, quantity, sort_order)
  SELECT v_recipe_id, component_id, share, sort_order FROM _recipe_lines ORDER BY sort_order;

  DROP TABLE _recipe_lines;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor.role,
    p_cloud_kitchen_id => NULL,     -- a recipe is one list for the whole company
    p_category         => 'catalog',
    p_action           => 'recipe_saved',
    p_severity         => 'review',
    p_entity_type      => 'recipe',
    p_entity_id        => v_recipe_id,
    p_old_values       => v_old,
    p_new_values       => public.recipe_audit_snapshot(v_recipe_id)
  );

  RETURN json_build_object(
    'success',        true,
    'recipe_id',      v_recipe_id,
    'created',        v_created,
    'ingredients',    v_count,
    'total_grams',    v_total,
    'audit_event_id', v_event_id
  );
END;
$$;

COMMENT ON FUNCTION public.save_recipe(uuid, uuid, jsonb, numeric, numeric, text) IS
'Saves the recipe for a made material. p_items is [{component_material_id, grams}] for one batch; what is stored is each ingredient''s share of the mix (adding up to exactly 1) and the yield fraction, never the batch. Replaces the material''s live recipe if it has one. Requires an active purchase manager or admin as p_acting_user_id, which is a role check and not authentication. See 20-save-recipes-as-shares-of-the-mix.sql.';

-- ---------------------------------------------------------------------
-- 4. Removing a recipe
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_recipe(
  p_acting_user_id uuid,
  p_material_id    uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     public.users%ROWTYPE;
  v_recipe_id uuid;
  v_old       jsonb;
  v_event_id  uuid;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id = p_acting_user_id;
  IF NOT FOUND OR v_actor.deleted_at IS NOT NULL OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('purchase_manager', 'admin') THEN
    RAISE EXCEPTION 'Only an active purchase manager or admin can remove a recipe';
  END IF;

  SELECT id INTO v_recipe_id
    FROM public.recipes WHERE material_id = p_material_id AND deleted_at IS NULL
     FOR UPDATE;

  -- Nothing to remove: a double-clicked confirm, not an error.
  IF v_recipe_id IS NULL THEN
    RETURN json_build_object('success', true, 'changed', false);
  END IF;

  v_old := public.recipe_audit_snapshot(v_recipe_id);

  -- Soft, like the rest of the catalog. The lines go with it: a removed
  -- recipe must not keep a product reachable through the cycle guard, and
  -- the audit event keeps what they were.
  DELETE FROM public.recipe_items WHERE recipe_id = v_recipe_id;
  UPDATE public.recipes
     SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE id = v_recipe_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor.role,
    p_cloud_kitchen_id => NULL,
    p_category         => 'catalog',
    p_action           => 'recipe_removed',
    p_severity         => 'critical',
    p_entity_type      => 'recipe',
    p_entity_id        => v_recipe_id,
    p_old_values       => v_old,
    p_new_values       => NULL
  );

  RETURN json_build_object('success', true, 'changed', true, 'recipe_id', v_recipe_id, 'audit_event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION public.remove_recipe(uuid, uuid) IS
'Removes a made material''s recipe (soft delete, lines dropped). The material then has no cost and cannot be priced, and neither can anything made from it. Critical in the audit trail for that reason.';

-- ---------------------------------------------------------------------
-- 5. Grants (decision 0004)
-- ---------------------------------------------------------------------
-- save_recipe and remove_recipe are meant to be called by the internal app,
-- which holds only the anon key, like the other catalog functions. The
-- snapshot helper is internal: revoked by name, because this database
-- grants every new function to anon and authenticated when it is created.

REVOKE ALL ON FUNCTION public.recipe_audit_snapshot(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.save_recipe(uuid, uuid, jsonb, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_recipe(uuid, uuid)                              FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_recipe(uuid, uuid, jsonb, numeric, numeric, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_recipe(uuid, uuid)                              TO anon, authenticated, service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The new column and constraint:
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'piece_weight_grams';
-- SELECT conname FROM pg_constraint
--  WHERE conname IN ('recipes_piece_weight_positive', 'recipe_items_quantity_is_a_share');   -- 2 rows
--
-- Grants. save_recipe and remove_recipe: anon, authenticated, service_role.
-- recipe_audit_snapshot: no anon, no authenticated.
--
-- SELECT proname, proacl FROM pg_proc
--  WHERE pronamespace = 'public'::regnamespace
--    AND proname IN ('save_recipe', 'remove_recipe', 'recipe_audit_snapshot')
--  ORDER BY proname;
--
-- After saving a recipe from the Recipes page, its shares add up to 1:
--
-- SELECT m.name, r.yield_quantity, r.piece_weight_grams, sum(ri.quantity) AS shares, count(*) AS ingredients
--   FROM public.recipes r
--   JOIN public.raw_materials m ON m.id = r.material_id
--   JOIN public.recipe_items ri ON ri.recipe_id = r.id
--  WHERE r.deleted_at IS NULL
--  GROUP BY m.name, r.yield_quantity, r.piece_weight_grams;      -- shares = 1.00000000 on every row

-- =====================================================================
-- Rollback
-- =====================================================================
-- Only while no recipe has been saved, or after removing them: the share
-- constraint and piece weights describe rows this migration's functions wrote.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.remove_recipe(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.save_recipe(uuid, uuid, jsonb, numeric, numeric, text);
-- DROP FUNCTION IF EXISTS public.recipe_audit_snapshot(uuid);
-- ALTER TABLE public.recipe_items DROP CONSTRAINT IF EXISTS recipe_items_quantity_is_a_share;
-- ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_piece_weight_positive;
-- ALTER TABLE public.recipes DROP COLUMN IF EXISTS piece_weight_grams;
-- COMMIT;
