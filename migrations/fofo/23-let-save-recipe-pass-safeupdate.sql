-- =====================================================================
-- save_recipe works when called through the API
--
-- 20's save_recipe failed for every save from the Recipes page with
--
--   UPDATE requires a WHERE clause   (SQLSTATE 21000, HTTP 400)
--
-- Supabase starts every API connection with the `safeupdate` library loaded
-- (it is in the `authenticator` role's session_preload_libraries). safeupdate
-- refuses any UPDATE or DELETE that has no WHERE clause, and it applies inside
-- a SECURITY DEFINER function too, temp tables included. 20 turned grams into
-- shares with
--
--   UPDATE _recipe_lines SET share = round(grams / v_total, 8);
--
-- which updates every line on purpose and so has no WHERE. It was verified
-- from the SQL editor, which connects as `postgres` without safeupdate, so the
-- failure only showed up once the page called it.
--
-- WHAT CHANGES. That one statement gains `WHERE grams > 0`. Every line already
-- has grams above 0 (checked earlier in the function, which raises otherwise),
-- so it still updates every line; the predicate is there for safeupdate, and
-- also says what the division needs. Nothing else in the function differs from
-- 20. Its other UPDATE and DELETEs already had a WHERE, as does everything in
-- remove_recipe, which is not touched.
--
-- Grants are unchanged: CREATE OR REPLACE keeps the ones 20 set.
--
-- Requires: 20.
-- =====================================================================

BEGIN;

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
  -- Every line, but safeupdate needs a WHERE (see the header of 23).
  UPDATE _recipe_lines SET share = round(grams / v_total, 8) WHERE grams > 0;

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

COMMIT;

-- Verification: should return true.
--   SELECT position('WHERE grams > 0' in pg_get_functiondef('public.save_recipe(uuid, uuid, jsonb, numeric, numeric, text)'::regprocedure)) > 0;
