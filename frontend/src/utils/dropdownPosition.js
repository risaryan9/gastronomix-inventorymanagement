/**
 * Viewport-aware placement for a portal dropdown anchored to a trigger element.
 *
 * Returns an inline-style fragment (fixed positioning) for a dropdown that:
 *  - opens downward when there is room below the trigger,
 *  - flips above the trigger when the space below is too small (e.g. the last
 *    item row near the bottom of the screen), and
 *  - always caps its height to the space actually available, so the panel is
 *    never clipped by the edge of the screen — the list inside scrolls instead.
 *
 * Spread the result onto the panel's `style`. The panel should be a flex column
 * (`display:flex; flexDirection:column`) with a fixed header/search element and
 * a `flex-1 min-h-0 overflow-y-auto` list so it scrolls within `maxHeight`.
 *
 * @param {DOMRect} rect trigger bounding rect (from getBoundingClientRect)
 * @param {object} [opts]
 * @param {number} [opts.gap=4]             gap between trigger and panel
 * @param {number} [opts.margin=8]          min gap from the viewport edges
 * @param {number} [opts.minWidth=280]      minimum panel width
 * @param {number} [opts.preferredHeight=320] cap when there's ample room
 * @returns {{left:number,width:number,maxHeight:number,top?:number,bottom?:number}}
 */
export function getAnchoredDropdownStyle(rect, opts = {}) {
  const { gap = 4, margin = 8, minWidth = 280, preferredHeight = 320 } = opts
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth

  const spaceBelow = viewportH - rect.bottom - gap - margin
  const spaceAbove = rect.top - gap - margin

  const width = Math.max(rect.width, minWidth)
  let left = rect.left
  if (left + width + margin > viewportW) {
    left = Math.max(margin, viewportW - width - margin)
  }
  if (left < margin) left = margin

  // Flip up only when there isn't a usable amount of room below and there is
  // genuinely more room above — avoids jitter when both sides are similar.
  const openUp = spaceBelow < Math.min(preferredHeight, 220) && spaceAbove > spaceBelow

  if (openUp) {
    return {
      bottom: viewportH - rect.top + gap,
      left,
      width,
      maxHeight: Math.max(140, Math.min(preferredHeight, spaceAbove)),
    }
  }
  return {
    top: rect.bottom + gap,
    left,
    width,
    maxHeight: Math.max(140, Math.min(preferredHeight, spaceBelow)),
  }
}

export default getAnchoredDropdownStyle
