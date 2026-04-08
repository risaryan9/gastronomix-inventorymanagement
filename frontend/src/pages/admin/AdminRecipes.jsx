import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const AdminRecipes = () => {
  const [recipes, setRecipes] = useState([])
  const [finishedProducts, setFinishedProducts] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listSearch, setListSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    finished_product_id: '',
    recipe_name: '',
    is_active: true,
    ingredients: []
  })

  const resetForm = () => {
    setEditingRecipe(null)
    setFormData({
      finished_product_id: '',
      recipe_name: '',
      is_active: true,
      ingredients: []
    })
    setFormError('')
  }

  const fetchFinishedProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit')
        .eq('material_type', 'finished')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setFinishedProducts(data || [])
    } catch (err) {
      console.error('Error fetching finished products:', err)
    }
  }

  const fetchAllMaterials = async () => {
    try {
      const { data, error } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit, material_type')
        .in('material_type', ['raw_material', 'semi_finished'])
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setAllMaterials(data || [])
    } catch (err) {
      console.error('Error fetching materials:', err)
    }
  }

  const fetchRecipes = async () => {
    try {
      setLoading(true)
      setError('')
      
      const { data: recipesData, error: recipesError } = await supabase
        .from('recipes')
        .select(`
          *,
          finished_product:raw_materials!recipes_finished_product_fk(id, name, code, unit)
        `)
        .order('created_at', { ascending: false })

      if (recipesError) throw recipesError

      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('recipe_ingredients')
        .select(`
          *,
          ingredient:raw_materials!recipe_ingredients_material_fk(id, name, code, unit, material_type)
        `)
        .order('sort_order')

      if (ingredientsError) throw ingredientsError

      const recipesWithIngredients = (recipesData || []).map(recipe => ({
        ...recipe,
        ingredients: (ingredientsData || []).filter(ing => ing.recipe_id === recipe.id)
      }))

      setRecipes(recipesWithIngredients)
    } catch (err) {
      console.error('Error fetching recipes:', err)
      setError('Failed to load recipes. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecipes()
    fetchFinishedProducts()
    fetchAllMaterials()
  }, [])

  const filteredRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      if (!listSearch.trim()) return true
      const q = listSearch.toLowerCase()
      const name = (recipe.recipe_name || '').toLowerCase()
      const productName = (recipe.finished_product?.name || '').toLowerCase()
      const productCode = (recipe.finished_product?.code || '').toLowerCase()
      return name.includes(q) || productName.includes(q) || productCode.includes(q)
    })
  }, [recipes, listSearch])

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (recipe) => {
    setEditingRecipe(recipe)
    setFormData({
      finished_product_id: recipe.finished_product_id || '',
      recipe_name: recipe.recipe_name || '',
      is_active: recipe.is_active !== false,
      ingredients: recipe.ingredients.map(ing => ({
        id: ing.id,
        ingredient_material_id: ing.ingredient_material_id,
        quantity_per_unit: ing.quantity_per_unit
      }))
    })
    setFormError('')
    setIsModalOpen(true)
  }

  const addIngredientRow = () => {
    setFormData(prev => ({
      ...prev,
      ingredients: [
        ...prev.ingredients,
        {
          ingredient_material_id: '',
          quantity_per_unit: ''
        }
      ]
    }))
  }

  const removeIngredientRow = (index) => {
    setFormData(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index)
    }))
  }

  const updateIngredient = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      ingredients: prev.ingredients.map((ing, i) =>
        i === index ? { ...ing, [field]: value } : ing
      )
    }))
  }

  const validateAndSave = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!formData.finished_product_id) {
      setFormError('Finished product is required')
      return
    }
    if (!formData.recipe_name.trim()) {
      setFormError('Recipe name is required')
      return
    }
    if (formData.ingredients.length === 0) {
      setFormError('At least one ingredient is required')
      return
    }

    for (let i = 0; i < formData.ingredients.length; i++) {
      const ing = formData.ingredients[i]
      if (!ing.ingredient_material_id) {
        setFormError(`Ingredient ${i + 1}: Material is required`)
        return
      }
      if (!ing.quantity_per_unit || parseFloat(ing.quantity_per_unit) <= 0) {
        setFormError(`Ingredient ${i + 1}: Quantity must be greater than 0`)
        return
      }
    }

    try {
      setSaving(true)

      const recipePayload = {
        finished_product_id: formData.finished_product_id,
        recipe_name: formData.recipe_name.trim(),
        is_active: formData.is_active,
        updated_at: new Date().toISOString()
      }

      let recipeId = editingRecipe?.id

      if (editingRecipe) {
        const { error: updateError } = await supabase
          .from('recipes')
          .update(recipePayload)
          .eq('id', editingRecipe.id)

        if (updateError) throw updateError

        const { error: deleteIngredientsError } = await supabase
          .from('recipe_ingredients')
          .delete()
          .eq('recipe_id', editingRecipe.id)

        if (deleteIngredientsError) throw deleteIngredientsError
      } else {
        const { data: newRecipe, error: insertError } = await supabase
          .from('recipes')
          .insert(recipePayload)
          .select()
          .single()

        if (insertError) throw insertError
        recipeId = newRecipe.id
      }

      const ingredientsPayload = formData.ingredients.map((ing) => ({
        recipe_id: recipeId,
        ingredient_material_id: ing.ingredient_material_id,
        quantity_per_unit: parseFloat(ing.quantity_per_unit)
      }))

      const { error: ingredientsError } = await supabase
        .from('recipe_ingredients')
        .insert(ingredientsPayload)

      if (ingredientsError) throw ingredientsError

      setIsModalOpen(false)
      await fetchRecipes()
    } catch (err) {
      console.error('Error saving recipe:', err)
      if (err.code === '23505') {
        setFormError('A recipe already exists for this finished product. Only one active recipe per product is allowed.')
      } else {
        setFormError(err.message || 'Failed to save recipe. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (recipe) => {
    if (!window.confirm(`Deactivate recipe "${recipe.recipe_name}"?`)) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('recipes')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', recipe.id)

      if (error) throw error
      await fetchRecipes()
    } catch (err) {
      console.error('Error deactivating recipe:', err)
      setError(err.message || 'Failed to deactivate recipe.')
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (recipe) => {
    if (!window.confirm(`Activate recipe "${recipe.recipe_name}"?`)) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('recipes')
        .update({
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', recipe.id)

      if (error) throw error
      await fetchRecipes()
    } catch (err) {
      console.error('Error activating recipe:', err)
      setError(err.message || 'Failed to activate recipe.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Recipes</h1>
            <p className="text-sm text-muted-foreground">
              Define ingredient compositions for finished products. When a finished product is added to a dispatch plan, its ingredients will be automatically populated.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Recipe
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search by recipe name or finished product..."
            className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading recipes…</div>
          ) : filteredRecipes.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No recipes found. Try adjusting your search or add a new recipe.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Recipe Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Finished Product
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Ingredients
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecipes.map((recipe) => (
                    <tr
                      key={recipe.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm">
                        <div className="font-semibold text-foreground">{recipe.recipe_name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{recipe.finished_product?.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {recipe.finished_product?.code}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {recipe.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openEditModal(recipe)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                          >
                            Edit
                          </button>
                          {recipe.is_active ? (
                            <button
                              onClick={() => handleDeactivate(recipe)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivate(recipe)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-colors disabled:opacity-50"
                            >
                              Activate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingRecipe ? 'Edit Recipe' : 'Add Recipe'}
                  </h2>
                  <button
                    onClick={() => !saving && setIsModalOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    disabled={saving}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={validateAndSave} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Finished Product <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={formData.finished_product_id}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, finished_product_id: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving || editingRecipe}
                      >
                        <option value="">Select finished product</option>
                        {finishedProducts.map((fp) => (
                          <option key={fp.id} value={fp.id}>
                            {fp.name} ({fp.code})
                          </option>
                        ))}
                      </select>
                      {editingRecipe && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Cannot change finished product when editing. Create a new recipe instead.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Recipe Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.recipe_name}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, recipe_name: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        placeholder="e.g. Peri Peri Kabab Recipe"
                        disabled={saving}
                      />
                    </div>
                  </div>


                  <div className="flex items-center gap-2">
                    <input
                      id="recipe-is-active"
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, is_active: e.target.checked }))
                      }
                      className="rounded border-border"
                      disabled={saving}
                    />
                    <label htmlFor="recipe-is-active" className="text-sm text-foreground">
                      Active (only one active recipe per finished product allowed)
                    </label>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-foreground">
                        Ingredients <span className="text-destructive">*</span>
                      </h3>
                      <button
                        type="button"
                        onClick={addIngredientRow}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors disabled:opacity-50"
                      >
                        + Add Ingredient
                      </button>
                    </div>

                    {formData.ingredients.length === 0 ? (
                      <div className="bg-muted/30 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
                        No ingredients added yet. Click &quot;+ Add Ingredient&quot; to start.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {formData.ingredients.map((ing, idx) => (
                          <div
                            key={idx}
                            className="bg-muted/30 border border-border rounded-lg p-4"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <span className="text-sm font-semibold text-foreground">
                                Ingredient {idx + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeIngredientRow(idx)}
                                disabled={saving}
                                className="text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-foreground mb-1">
                                  Material <span className="text-destructive">*</span>
                                </label>
                                <select
                                  value={ing.ingredient_material_id}
                                  onChange={(e) =>
                                    updateIngredient(idx, 'ingredient_material_id', e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                                  disabled={saving}
                                >
                                  <option value="">Select raw material or semi-finished</option>
                                  {allMaterials.map((mat) => (
                                    <option key={mat.id} value={mat.id}>
                                      {mat.name} ({mat.code}) - {mat.unit}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-foreground mb-1">
                                  Quantity per Unit <span className="text-destructive">*</span>
                                </label>
                                <input
                                  type="number"
                                  step="0.001"
                                  value={ing.quantity_per_unit}
                                  onChange={(e) =>
                                    updateIngredient(idx, 'quantity_per_unit', e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                                  disabled={saving}
                                />
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  Amount needed per 1 unit of finished product
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
                      {formError}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => !saving && setIsModalOpen(false)}
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
                      {saving ? 'Saving…' : editingRecipe ? 'Update Recipe' : 'Create Recipe'}
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

export default AdminRecipes
