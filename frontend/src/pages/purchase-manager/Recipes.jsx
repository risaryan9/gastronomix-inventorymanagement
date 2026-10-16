// Recipes: what each made material is made of, so it can be costed.
//
// A semi-finished or finished material is not bought, so it has no purchase
// price. Its cost is rolled up from its ingredients, and that cost is what a
// FOFO franchise price is built on (docs/fofo-dashboard-spec.md §5–6).
//
// This is NOT a service kit. A service kit is what goes out alongside a
// finished product when it is served; a recipe is what the product is made
// from. Decision 0012 keeps the two apart.
//
// HOW A RECIPE IS ENTERED AND WHAT IS KEPT (decision 0022). The kitchen types
// one batch: each ingredient in grams, then the yield as a fraction. What is
// saved is the ratio, each ingredient's share of the mix, never the batch, so
// the recipe holds for any batch size. Opening a saved recipe shows it as a
// 1,000 g batch for that reason. The shares are worked out by the database
// (save_recipe, migration 20); this screen only previews them.
//
// RECIPES NEST. An ingredient can itself be made, and is then costed from its
// own recipe. A product can never contain itself, directly or down a chain:
// such an ingredient is left out of the picker, and the database refuses it.
//
// THE COSTS SHOWN ARE A PREVIEW for one kitchen (lib/recipeCost.js). Costs
// differ by kitchen because stock does. In admin mode the kitchen is chosen;
// otherwise it is the signed-in user's own.
//
// Shown only on the admin dashboard (with `isAdminMode`). It was on the
// purchase manager dashboard too until 2026-10-15; the non-admin path is kept
// because save_recipe still accepts purchase managers (decision 0022).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { moneyExact } from '../../lib/formatNumbers'
import {
  canBeWeighed,
  fetchKitchenCosts,
  isCounted,
  isMade,
  previewRecipe,
  recipeCostResolver,
  wouldContainItself,
} from '../../lib/recipeCost'
import SearchableSelect from '../../components/SearchableSelect'
import { useToast } from '../../context/toastContext'
import { useConfirm } from '../../context/confirmContext'

const TYPE_LABEL = {
  raw_material: 'Raw material',
  semi_finished: 'Semi-finished',
  finished: 'Finished',
  non_food: 'Non-food',
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'with', label: 'Has a recipe' },
  { value: 'without', label: 'No recipe yet' },
]

const inputClass =
  'w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all'

const percent = (share) => `${(share * 100).toFixed(2)}%`
const grams = (value) => `${(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} g`
// A saved share as the grams it is in a 1,000 g batch. Five places, so saving
// an unchanged recipe gives back the same eight-place share.
const gramsPerKgOfMix = (share) => String(Number((Number(share) * 1000).toFixed(5)))

const emptyRow = () => ({ key: crypto.randomUUID(), componentId: '', grams: '' })
const isBlank = (row) => !row.componentId && row.grams === ''

// The ingredient list always ends in one blank line, so the next ingredient is
// typed straight in rather than added with a button first. Filling that line in
// opens a new one below it. Blank lines are never saved (see `save`).
const withTrailingBlank = (rows) =>
  rows.length && isBlank(rows[rows.length - 1]) ? rows : [...rows, emptyRow()]

const Recipes = ({ isAdminMode = false }) => {
  const toast = useToast()
  const confirm = useConfirm()
  const session = getSession()

  const [materials, setMaterials] = useState([])
  const [recipes, setRecipes] = useState(new Map())
  const [kitchens, setKitchens] = useState([])
  const [kitchenId, setKitchenId] = useState(isAdminMode ? '' : session?.cloud_kitchen_id || '')
  const [costs, setCosts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [editing, setEditing] = useState(null) // the product being edited
  const [rows, setRows] = useState([])
  const [yieldFraction, setYieldFraction] = useState('')
  const [pieceWeight, setPieceWeight] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setError('')
      const [materialRows, recipeRows, itemRows] = await Promise.all([
        // name is not unique, so id breaks ties between pages (decision 0009).
        fetchAllRows(() =>
          supabase
            .from('raw_materials')
            .select('id, name, code, unit, material_type, category')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name')
            .order('id')
        ),
        fetchAllRows(() =>
          supabase
            .from('recipes')
            .select('id, material_id, yield_quantity, piece_weight_grams, updated_at')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('id')
        ),
        fetchAllRows(() =>
          supabase
            .from('recipe_items')
            .select('id, recipe_id, component_material_id, quantity, sort_order')
            .order('recipe_id')
            .order('sort_order')
            .order('id')
        ),
      ])

      const byRecipe = new Map(recipeRows.map((recipe) => [recipe.id, {
        id: recipe.id,
        yield: Number(recipe.yield_quantity),
        pieceWeightGrams: recipe.piece_weight_grams === null ? null : Number(recipe.piece_weight_grams),
        updatedAt: recipe.updated_at,
        materialId: recipe.material_id,
        items: [],
      }]))
      for (const item of itemRows) {
        byRecipe.get(item.recipe_id)?.items.push({ componentId: item.component_material_id, share: Number(item.quantity) })
      }
      setMaterials(materialRows)
      setRecipes(new Map([...byRecipe.values()].map((recipe) => [recipe.materialId, recipe])))
    } catch (err) {
      console.error('Error loading recipes:', err)
      setError(err.message || 'Could not load recipes. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Admins have no kitchen of their own, so they choose whose costs to see.
  useEffect(() => {
    if (!isAdminMode) return
    supabase
      .from('cloud_kitchens')
      .select('id, name, code')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .then(({ data, error: kitchensError }) => {
        if (kitchensError) return
        setKitchens(data || [])
        setKitchenId((current) => current || data?.[0]?.id || '')
      })
  }, [isAdminMode])

  useEffect(() => {
    let cancelled = false
    if (!kitchenId) { setCosts(new Map()); return undefined }
    fetchKitchenCosts(kitchenId)
      .then((next) => { if (!cancelled) setCosts(next) })
      .catch((err) => {
        console.error('Error loading kitchen costs:', err)
        if (!cancelled) setCosts(new Map())
      })
    return () => { cancelled = true }
  }, [kitchenId])

  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const resolve = useMemo(
    () => recipeCostResolver({ materials: materialMap, costs, recipes }),
    [materialMap, costs, recipes]
  )

  const products = useMemo(() => {
    const term = search.trim().toLowerCase()
    return materials
      .filter(isMade)
      .filter((m) => filter === 'all' || (filter === 'with') === recipes.has(m.id))
      .filter((m) => !term || `${m.name} ${m.code}`.toLowerCase().includes(term))
  }, [materials, recipes, search, filter])

  const madeCount = useMemo(() => materials.filter(isMade).length, [materials])

  /* ------------------------------ the editor ------------------------------ */

  const openEditor = (product) => {
    const recipe = recipes.get(product.id)
    setEditing(product)
    setRows(withTrailingBlank(recipe
      ? recipe.items.map((item) => ({ key: crypto.randomUUID(), componentId: item.componentId, grams: gramsPerKgOfMix(item.share) }))
      : []))
    setYieldFraction(recipe ? String(recipe.yield) : '')
    setPieceWeight(recipe?.pieceWeightGrams ? String(recipe.pieceWeightGrams) : '')
    setFormError('')
  }

  const closeEditor = () => { if (!saving) setEditing(null) }

  const updateRow = (key, patch) =>
    setRows((current) => withTrailingBlank(current.map((row) => (row.key === key ? { ...row, ...patch } : row))))

  const removeRow = (key) =>
    setRows((current) => withTrailingBlank(current.filter((row) => row.key !== key)))

  // What can go into this product: anything weighed or made, except the
  // product itself, anything that already contains it, and anything already on
  // another line.
  const ingredientOptions = useCallback((row) => {
    if (!editing) return []
    const taken = new Set(rows.filter((other) => other.key !== row.key).map((other) => other.componentId))
    return materials
      .filter((m) => m.id !== editing.id && canBeWeighed(m) && !taken.has(m.id))
      .filter((m) => !wouldContainItself(recipes, editing.id, m.id))
      .map((m) => ({
        value: m.id,
        label: m.name,
        hint: [
          m.code,
          TYPE_LABEL[m.material_type] || m.material_type,
          isMade(m) ? (recipes.has(m.id) ? 'made here, has a recipe' : 'made here, no recipe yet') : null,
        ].filter(Boolean).join(' · '),
      }))
  }, [editing, rows, materials, recipes])

  const preview = useMemo(() => previewRecipe({
    rows,
    yieldFraction,
    pieceWeightGrams: pieceWeight,
    counted: isCounted(editing),
    resolve,
  }), [rows, yieldFraction, pieceWeight, editing, resolve])

  const save = async (event) => {
    event.preventDefault()
    setFormError('')

    const filled = rows.filter((row) => row.componentId || row.grams !== '')
    if (!filled.length) return setFormError('Add at least one ingredient.')
    if (filled.some((row) => !row.componentId)) return setFormError('Choose a material for every ingredient, or remove the empty line.')
    if (filled.some((row) => !(Number(row.grams) > 0))) return setFormError('Every ingredient needs a weight in grams above 0.')
    const yieldValue = Number(yieldFraction)
    if (!(yieldValue > 0)) return setFormError('Enter the yield as a fraction, such as 0.62.')
    if (yieldValue > 10) return setFormError('The yield is a fraction: enter 62% as 0.62.')
    const counted = isCounted(editing)
    if (counted && !(Number(pieceWeight) > 0)) {
      return setFormError(`${editing.name} is counted in pieces, so enter what one piece weighs in grams.`)
    }
    if (!session?.id) return setFormError('Your session has expired. Please sign in again.')

    try {
      setSaving(true)
      const { error: saveError } = await supabase.rpc('save_recipe', {
        p_acting_user_id: session.id,
        p_material_id: editing.id,
        p_items: filled.map((row) => ({ component_material_id: row.componentId, grams: Number(row.grams) })),
        p_yield: yieldValue,
        p_piece_weight_grams: counted ? Number(pieceWeight) : null,
      })
      if (saveError) throw saveError
      toast.success('Recipe saved', `${editing.name}: ${filled.length} ingredient${filled.length === 1 ? '' : 's'}, yield ${yieldValue}.`)
      setEditing(null)
      await load()
    } catch (err) {
      console.error('Error saving recipe:', err)
      setFormError(err.message || 'Could not save the recipe.')
      toast.error('Could not save the recipe', err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (product) => {
    const usedIn = materials.filter((m) => recipes.get(m.id)?.items.some((item) => item.componentId === product.id))
    const confirmed = await confirm({
      title: `Remove the recipe for ${product.name}?`,
      message: usedIn.length
        ? `It will have no cost, and neither will what is made from it: ${usedIn.map((m) => m.name).join(', ')}. Franchises will see those as unavailable until a recipe is saved again.`
        : 'It will have no cost, so franchises will see it as unavailable until a recipe is saved again.',
      confirmLabel: 'Remove recipe',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      setSaving(true)
      const { error: removeError } = await supabase.rpc('remove_recipe', {
        p_acting_user_id: session?.id,
        p_material_id: product.id,
      })
      if (removeError) throw removeError
      toast.success('Recipe removed', `${product.name} no longer has a recipe.`)
      await load()
    } catch (err) {
      console.error('Error removing recipe:', err)
      toast.error('Could not remove the recipe', err.message)
    } finally {
      setSaving(false)
    }
  }

  /* -------------------------------- render -------------------------------- */

  const costCell = (product) => {
    if (!recipes.has(product.id)) return <span className="text-muted-foreground">—</span>
    if (!kitchenId) return <span className="text-muted-foreground">Choose a kitchen</span>
    const cost = resolve(product.id)
    if (cost.cost === null) {
      return <span className="text-xs text-amber-300">Cannot be costed here: {cost.reason}</span>
    }
    return (
      <div>
        <div className="font-semibold text-foreground">{moneyExact(cost.perKg)} / kg</div>
        {isCounted(product) && (
          <div className="text-[11px] text-muted-foreground">{moneyExact(cost.cost)} a piece</div>
        )}
      </div>
    )
  }

  const editingCounted = isCounted(editing)
  const editingHasRecipe = editing ? recipes.has(editing.id) : false

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Recipes</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            What each semi-finished and finished product is made from. Type one batch in grams and its yield; the
            recipe is saved as a ratio, so it holds for any batch size. An ingredient can itself be a made product.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name or code..."
            className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={filter === option.value}
                className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  filter === option.value
                    ? 'bg-accent/15 text-accent border-accent/60'
                    : 'bg-muted/30 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {isAdminMode && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Costs in
              <select
                value={kitchenId}
                onChange={(e) => setKitchenId(e.target.value)}
                className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {kitchens.map((kitchen) => (
                  <option key={kitchen.id} value={kitchen.id}>{kitchen.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {!loading && (
          <p className="mb-3 text-xs text-muted-foreground">
            {recipes.size} of {madeCount} made products have a recipe. Costs are a preview for{' '}
            {isAdminMode ? 'the kitchen chosen above' : 'your kitchen'} and include GST paid to vendors.
          </p>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading recipes…</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No products match. Only semi-finished and finished materials can have a recipe.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    {['Product', 'Type', 'Recipe', 'Cost to make', 'Actions'].map((heading) => (
                      <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const recipe = recipes.get(product.id)
                    return (
                      <tr key={product.id} className="border-b border-border/70 hover:bg-background/50 transition-colors align-top">
                        <td className="px-4 py-3 text-sm">
                          <div className="font-semibold text-foreground">{product.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{product.code} · {product.unit}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{TYPE_LABEL[product.material_type]}</td>
                        <td className="px-4 py-3 text-sm">
                          {recipe ? (
                            <div>
                              <div className="text-foreground">
                                {recipe.items.length} ingredient{recipe.items.length === 1 ? '' : 's'} · yield {recipe.yield}
                                {recipe.pieceWeightGrams ? ` · ${grams(recipe.pieceWeightGrams)} a piece` : ''}
                              </div>
                              <div className="text-[11px] text-muted-foreground max-w-md">
                                {recipe.items
                                  .map((item) => `${materialMap.get(item.componentId)?.name || 'Inactive material'} ${percent(item.share)}`)
                                  .join(', ')}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                              No recipe
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{costCell(product)}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => openEditor(product)}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                            >
                              {recipe ? 'Edit recipe' : 'Add recipe'}
                            </button>
                            {recipe && (
                              <button
                                onClick={() => remove(product)}
                                disabled={saving}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {editing && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-5xl max-h-[92vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl lg:text-2xl font-bold text-foreground">Recipe for {editing.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {editing.code} · {TYPE_LABEL[editing.material_type]} · counted in {editing.unit}
                    </p>
                  </div>
                  <button onClick={closeEditor} disabled={saving} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={save} className="space-y-5">
                  {editingHasRecipe && (
                    <p className="text-xs rounded-lg border border-border bg-muted/40 text-muted-foreground px-3 py-2">
                      This recipe is saved as a ratio, so it is shown here as a 1,000 g batch. Type the weights of any batch and the ratio is worked out again.
                    </p>
                  )}

                  <div>
                    <div className="flex items-baseline justify-between gap-3 mb-3">
                      <h3 className="text-lg font-bold text-foreground">Ingredients</h3>
                      <p className="text-[11px] text-muted-foreground">Fill in the last line and a new one opens below it.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_8rem_5.5rem_7rem_7rem_2rem] gap-3 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        <span>Material</span>
                        <span className="text-right">Weight (g)</span>
                        <span className="text-right">Share</span>
                        <span className="text-right">Cost / kg</span>
                        <span className="text-right">In this batch</span>
                        <span />
                      </div>
                      {preview.lines.map((line, index) => (
                        <div key={line.key} className="bg-muted/30 border border-border rounded-lg p-3 lg:p-2">
                          <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_8rem_5.5rem_7rem_7rem_2rem] gap-3 items-center">
                            <div className="col-span-2 lg:col-span-1">
                              <SearchableSelect
                                value={line.componentId}
                                onChange={(value) => updateRow(line.key, { componentId: value })}
                                options={ingredientOptions(line)}
                                placeholder="Choose a material"
                                searchPlaceholder="Search materials…"
                                noResultsLabel="No material can be added. Pieces bought by count cannot be weighed."
                              />
                            </div>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={line.grams}
                              onChange={(e) => updateRow(line.key, { grams: e.target.value })}
                              placeholder="grams"
                              aria-label="Weight in grams"
                              disabled={saving}
                              className={`${inputClass} text-right`}
                            />
                            <span className="text-sm text-right text-foreground">{line.share > 0 ? percent(line.share) : '—'}</span>
                            <span className="text-sm text-right text-muted-foreground">{line.perKg === null ? '—' : moneyExact(line.perKg)}</span>
                            <span className="text-sm text-right text-foreground">{line.batchCost === null ? '—' : moneyExact(line.batchCost)}</span>
                            {/* The trailing blank line has nothing to remove. */}
                            {index === preview.lines.length - 1 && isBlank(line) ? <span /> : (
                              <button
                                type="button"
                                onClick={() => removeRow(line.key)}
                                disabled={saving}
                                aria-label="Remove ingredient"
                                className="justify-self-end text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {line.reason && <p className="mt-1.5 text-[11px] text-amber-300">No cost: {line.reason}.</p>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-4">
                    <div>
                      <label htmlFor="recipe-yield" className="block text-sm font-semibold text-foreground mb-1">
                        Yield <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="recipe-yield"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={yieldFraction}
                        onChange={(e) => setYieldFraction(e.target.value)}
                        placeholder="e.g. 0.62"
                        disabled={saving}
                        className={inputClass}
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        A fraction: how much of the mix comes out. Enter 1 if nothing is lost, as in a marinade.
                        {Number(yieldFraction) > 0 && ` ${percent(Number(yieldFraction))}, so 1,000 g of mix makes ${grams(Number(yieldFraction) * 1000)}.`}
                      </p>
                      {Number(yieldFraction) > 1 && Number(yieldFraction) <= 10 && (
                        <p className="text-[11px] text-amber-300 mt-1">More comes out than goes in. Check this is meant.</p>
                      )}
                    </div>
                    {editingCounted && (
                      <div>
                        <label htmlFor="recipe-piece-weight" className="block text-sm font-semibold text-foreground mb-1">
                          Weight of one piece (g) <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="recipe-piece-weight"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={pieceWeight}
                          onChange={(e) => setPieceWeight(e.target.value)}
                          placeholder="e.g. 80"
                          disabled={saving}
                          className={inputClass}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {editing.name} is counted in {editing.unit}, so its cost per piece comes from this.
                        </p>
                      </div>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 border-t border-border pt-4">
                    {[
                      { label: 'Total weight', value: grams(preview.totalGrams) },
                      { label: 'Cost of the mix / kg', value: preview.mixPerKg === null ? '—' : moneyExact(preview.mixPerKg) },
                      { label: 'Cost after yield / kg', value: preview.outputPerKg === null ? '—' : moneyExact(preview.outputPerKg), strong: true },
                      editingCounted
                        ? { label: 'Cost of one piece', value: preview.perPiece === null ? '—' : moneyExact(preview.perPiece), strong: true }
                        : { label: 'Cost of this batch', value: preview.batchCost === null ? '—' : moneyExact(preview.batchCost) },
                    ].map((figure) => (
                      <div key={figure.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{figure.label}</dt>
                        <dd className={`text-base ${figure.strong ? 'font-black text-accent' : 'font-semibold text-foreground'}`}>{figure.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {preview.missing.length > 0 && (
                    <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 px-3 py-2">
                      The recipe can be saved, but it cannot be costed in this kitchen yet: {preview.missing.join('; ')}.
                    </p>
                  )}

                  {formError && (
                    <div className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
                      {formError}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeEditor}
                      disabled={saving}
                      className="px-5 py-2.5 bg-muted text-foreground border border-border rounded-lg hover:bg-muted/80 transition-all disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-accent text-background font-black rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? 'Saving…' : 'Save recipe'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Recipes
