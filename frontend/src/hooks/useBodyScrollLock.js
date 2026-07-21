import { useLayoutEffect } from 'react'

// Ref-counted so stacked modals (e.g. a confirm dialog over a form) don't
// clobber each other's restore values — the body only unlocks once the last
// lock is released.
let lockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

/**
 * Prevents the background page from scrolling while `locked` is true.
 *
 * Locks `document.body` overflow (and compensates for the vanishing scrollbar
 * width to avoid a layout shift), restoring the previous values when unlocked
 * or unmounted. Use this on any full-screen modal so scrolling inside the modal
 * never leaks to the page behind it.
 *
 * @param {boolean} locked whether the background should be locked right now
 */
export function useBodyScrollLock(locked) {
  useLayoutEffect(() => {
    if (!locked) return undefined

    if (lockCount === 0) {
      const body = document.body
      savedOverflow = body.style.overflow
      savedPaddingRight = body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`
      }
      body.style.overflow = 'hidden'
    }
    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        const body = document.body
        body.style.overflow = savedOverflow
        body.style.paddingRight = savedPaddingRight
      }
    }
  }, [locked])
}

export default useBodyScrollLock
