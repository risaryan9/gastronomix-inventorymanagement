import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

/**
 * Loads one GET endpoint for a screen.
 *
 *   const { data, error, loading, reload } = useApi(`franchise/catalog?outlet_id=${id}`)
 *
 * A null path loads nothing. Changing the path discards the old answer, so a
 * screen never shows one outlet's data under another outlet's heading.
 */
export function useApi(path) {
  const [state, setState] = useState({ path, data: null, error: null, loading: Boolean(path) })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!path) return undefined
    let cancelled = false
    setState((current) => ({ path, data: current.path === path ? current.data : null, error: null, loading: true }))
    api(path)
      .then((data) => { if (!cancelled) setState({ path, data, error: null, loading: false }) })
      .catch((error) => { if (!cancelled) setState({ path, data: null, error, loading: false }) })
    return () => { cancelled = true }
  }, [path, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const current = state.path === path
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: path ? !current || state.loading : false,
    reload,
  }
}
