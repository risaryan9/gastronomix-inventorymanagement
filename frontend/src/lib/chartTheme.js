// Chart colours and chrome, shared so a cloud kitchen keeps the same hue on
// every screen that draws it.
//
// This app is dark-only — the Tailwind config carries fixed dark tokens with no
// `darkMode` variants — so one selected set is correct rather than a light/dark
// pair. These three slots were validated against the real card surface
// (#1a1d23 = hsl(222,14%,12%)): worst all-pairs CVD ΔE 9.4, normal-vision 20.9,
// all clearing 3:1 contrast.
//
// Note there are no status colours here on purpose. An earlier stock-risk chart
// paired healthy-green against critical-red, which measures ΔE 4.1 under
// deuteranopia — indistinguishable to a red-green colourblind reader. If you add
// a status-coloured chart, validate the pair before shipping it.

export const SERIES = ['#3987e5', '#d95926', '#199e70']

export const CHART_SURFACE = '#1a1d23'

export const INK = {
  grid: '#2e3138', // border token: one step off the card surface
  axis: '#a6a6a6', // muted-foreground
}

/**
 * Maps kitchen id → hue by position in the kitchen list.
 *
 * Colour follows the kitchen, never its rank within a filtered view: callers
 * pass the same name-ordered list everywhere, so a kitchen's hue is stable
 * across screens and a reader learns the mapping once.
 */
export const buildKitchenColors = (kitchens) => {
  const colors = new Map(
    kitchens.map((kitchen, index) => [kitchen.id, SERIES[index % SERIES.length]])
  )
  return (kitchenId) => colors.get(kitchenId) ?? SERIES[0]
}
