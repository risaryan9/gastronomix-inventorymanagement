import { useCallback, useEffect, useState } from 'react'
import { fofoStaffApi } from '../lib/fofoStaffApi'
import { StaffPassRequired } from '../lib/staffPass'

// A franchise has already paid by the time its order is waiting, so the notice
// should not lag far behind. A minute is frequent enough to feel live and is
// one small query per open dashboard.
const POLL_MS = 60 * 1000

/**
 * How many franchise orders are waiting on this kitchen, kept fresh while the
 * dashboard is open: on mount, every minute, and whenever the tab is looked at
 * again.
 *
 *   const { waiting, toPack, needsPass, refresh } = useFranchiseOrdersSummary()
 *
 * `waiting` is paid orders the purchase manager has yet to accept; `toPack` is
 * accepted orders the kitchen executive has yet to pack. Each dashboard shows
 * the one that is its own to act on.
 *
 * `needsPass` is true when the browser holds no working staff pass, in which
 * case nothing is known and both counts are 0. It is not an error: the Franchise
 * Orders page asks for the key. Any other failure (the partner app is down,
 * the network dropped) keeps the last known count, since a notice that vanishes
 * on a blip is worse than one that is a minute old.
 *
 * Call `refresh()` after something changes the answer: a pass was just issued,
 * or an order was accepted or packed.
 */
export function useFranchiseOrdersSummary() {
  const [summary, setSummary] = useState({ waiting: 0, toPack: 0, needsPass: false })

  const refresh = useCallback(async () => {
    try {
      const result = await fofoStaffApi.ordersSummary()
      setSummary({
        waiting: result.waitingForAcceptance || 0,
        toPack: result.waitingToPack || 0,
        needsPass: false,
      })
    } catch (err) {
      if (err instanceof StaffPassRequired) {
        setSummary({ waiting: 0, toPack: 0, needsPass: true })
      }
    }
  }, [])

  useEffect(() => {
    // Deferred a tick so the first answer lands after mount, not during it.
    const first = setTimeout(refresh, 0)
    const timer = setInterval(refresh, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return { ...summary, refresh }
}

export default useFranchiseOrdersSummary
