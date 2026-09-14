// The partner app's theme: dark by default, like the internal app, with light
// as the user's choice. Remembered per browser. index.html applies the saved
// choice before first paint so a light-mode user never sees a dark flash.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'gastronomix-partners-theme'

export function savedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'   // storage blocked: fall back to the default
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(savedTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // not remembered, but still applied
    }
  }, [theme])

  const toggle = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  return { theme, toggle }
}
