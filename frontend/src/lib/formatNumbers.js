// Number formatting shared by the admin analytics screens, so a rupee looks the
// same on every one of them.

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export const money = (value) => currency.format(Math.round(value || 0))

// Axis ticks and tight cells need this short: ₹19.9L beats ₹19,85,775.
export const compactMoney = (value) => {
  const amount = Math.abs(value || 0)
  if (amount >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`
  if (amount >= 100000) return `₹${(value / 100000).toFixed(1)}L`
  if (amount >= 1000) return `₹${Math.round(value / 1000)}K`
  return `₹${Math.round(value || 0)}`
}

export const count = (value) => (value || 0).toLocaleString('en-IN')

// Stock quantities carry up to three decimals; trailing zeros are noise.
export const quantity = (value) =>
  (parseFloat(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })

export const formatDay = (value) => {
  if (!value) return '—'
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
