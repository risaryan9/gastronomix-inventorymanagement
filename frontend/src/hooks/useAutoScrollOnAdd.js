import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Keeps a scrollable item list pinned to the newest row.
 *
 * Attach the returned ref to a scroll container (a div with `overflow-y-auto`
 * and a bounded max-height). Whenever `count` grows, the container smoothly
 * scrolls to the bottom so the freshly added row is visible — so the user can
 * keep adding items without ever having to scroll the container (or the modal)
 * by hand.
 *
 * The first render is skipped, so opening a form that already has rows does not
 * trigger a jump.
 *
 * @param {number} count           current number of items
 * @param {boolean} [enabled=true] pass the modal's open state so scrolling only
 *                                 happens while the list is actually visible
 * @returns {import('react').RefObject<HTMLDivElement>}
 */
export function useAutoScrollOnAdd(count, enabled = true) {
  const ref = useRef(null)
  const prevCount = useRef(count)

  // useLayoutEffect so we measure/scroll after the new row is in the DOM but
  // before paint — avoids a visible flash of the un-scrolled state.
  useLayoutEffect(() => {
    if (!enabled) {
      prevCount.current = count
      return
    }
    const el = ref.current
    if (el && count > prevCount.current) {
      // Defer one frame so layout (including the new row's height) is settled.
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      })
    }
    prevCount.current = count
  }, [count, enabled])

  // When the container first mounts already open, keep prevCount in sync so a
  // later open→add cycle behaves correctly.
  useEffect(() => {
    if (!enabled) prevCount.current = count
  }, [enabled, count])

  return ref
}

export default useAutoScrollOnAdd
