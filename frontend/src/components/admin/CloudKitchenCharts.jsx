// Cross-kitchen comparison charts for the admin's Cloud Kitchen overview.
//
// Three charts, each answering a different question, and nothing that merely
// restates the cards above them:
//
//   1. Spend over time   — is one kitchen's buying pattern unlike the others'?
//   2. Inventory value   — where is the capital actually sitting?
//   3. Stock-outs        — which kitchen is moving the most stock out?
//
// COLOR
//
// Every chart encodes the same thing — which cloud kitchen — so all three share
// one set of hues: categorical slots 1–3, which validate all-pairs against this
// app's card surface (#1a1d23), worst CVD ΔE 9.4 and normal-vision ΔE 20.9.
// Colour follows the kitchen, never its rank, so a kitchen keeps its hue across
// all three charts and the reader only learns the mapping once. No status
// colours here: nothing on these charts means "good" or "bad" on its own.
//
// The two bar charts carry a value at each bar tip, so their numbers are
// readable without hovering. The line chart's per-period values are only in the
// tooltip — detailed analytics screens come later.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Dark-surface steps. This app has no light theme — the Tailwind config carries
// fixed dark tokens — so one selected set is correct rather than a pair.
const SERIES = ['#3987e5', '#d95926', '#199e70']

const INK = {
  grid: '#2e3138', // border token: one step off the card surface
  axis: '#a6a6a6', // muted-foreground
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const money = (value) => currency.format(Math.round(value || 0))

// Axis ticks need to stay short or they collide; ₹19.9L beats ₹19,85,775.
const compactMoney = (value) => {
  const amount = Math.abs(value || 0)
  if (amount >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`
  if (amount >= 100000) return `₹${(value / 100000).toFixed(1)}L`
  if (amount >= 1000) return `₹${Math.round(value / 1000)}K`
  return `₹${Math.round(value || 0)}`
}

const bucketLabel = (bucket, bucketDays) => {
  const date = new Date(`${bucket}T00:00:00Z`)
  const label = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return bucketDays > 1 ? `w/c ${label}` : label
}

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

const ChartCard = ({ title, description, children }) => (
  <section className="bg-card border border-border rounded-xl p-5">
    <header className="mb-4">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </header>
    {children}
  </section>
)

// Values wear text tokens; the swatch beside them carries the series identity.
const TooltipBody = ({ heading, rows }) => (
  <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
    <p className="text-xs font-semibold text-foreground mb-1.5">{heading}</p>
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: row.color }}
          />
          <span className="text-muted-foreground">{row.label}</span>
          <span className="ml-auto font-semibold text-foreground tabular-nums">{row.value}</span>
        </li>
      ))}
    </ul>
  </div>
)

const LegendKeys = ({ items }) => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
    {items.map((item) => (
      <li key={item.label} className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="w-2.5 h-2.5 rounded-sm"
          style={{ backgroundColor: item.color }}
        />
        <span className="text-xs text-muted-foreground">{item.label}</span>
      </li>
    ))}
  </ul>
)

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

const SpendOverTime = ({ kitchens, series, colorOf }) => {
  const bucketDays = series[0]?.bucketDays ?? 1
  // One or two buckets give a line nothing to draw between, so show the points.
  const showDots = series.length <= 2

  return (
    <ChartCard
      title="Spend over time"
      description="Stock-in value received, by cloud kitchen, over the selected range."
    >
      <LegendKeys
        items={kitchens.map((kitchen) => ({ label: kitchen.name, color: colorOf(kitchen.id) }))}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(bucket) => bucketLabel(bucket, bucketDays)}
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: INK.grid }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={compactMoney}
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ stroke: INK.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBody
                    heading={bucketLabel(label, bucketDays)}
                    rows={payload.map((entry) => ({
                      label: kitchens.find((kitchen) => kitchen.id === entry.dataKey)?.name ?? '',
                      color: entry.stroke,
                      value: money(entry.value),
                    }))}
                  />
                ) : null
              }
            />
            {kitchens.map((kitchen) => (
              <Line
                key={kitchen.id}
                type="monotone"
                dataKey={kitchen.id}
                stroke={colorOf(kitchen.id)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={showDots ? { r: 4, strokeWidth: 0 } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#1a1d23' }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

const InventoryValueByKitchen = ({ kitchens, colorOf }) => {
  const data = kitchens.map((kitchen) => ({
    id: kitchen.id,
    name: kitchen.name,
    value: kitchen.inventoryValue,
  }))

  return (
    <ChartCard
      title="Inventory value"
      description="Stock on hand at cost, as of now — where working capital is sitting."
    >
      {/* Identity comes from the y-axis labels, so this single measure needs no
          legend box — the colours only tie each bar back to the chart above. */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} strokeWidth={1} horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={compactMoney}
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: INK.grid }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={116}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBody
                    heading={payload[0].payload.name}
                    rows={[
                      {
                        label: 'Inventory value',
                        color: colorOf(payload[0].payload.id),
                        value: money(payload[0].value),
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="value"
              barSize={20}
              radius={[0, 4, 4, 0]}
              label={{
                position: 'right',
                formatter: compactMoney,
                fill: INK.axis,
                fontSize: 11,
              }}
            >
              {data.map((row) => (
                <Cell key={row.id} fill={colorOf(row.id)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

const StockOutsByKitchen = ({ kitchens, colorOf }) => {
  const data = kitchens.map((kitchen) => ({
    id: kitchen.id,
    name: kitchen.name,
    value: kitchen.stockOutCount,
  }))

  return (
    <ChartCard
      title="Stock-outs"
      description="Stock-out movements recorded, by cloud kitchen, over the selected range."
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} strokeWidth={1} horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: INK.grid }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={116}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBody
                    heading={payload[0].payload.name}
                    rows={[
                      {
                        label: 'Stock-outs',
                        color: colorOf(payload[0].payload.id),
                        value: payload[0].value.toLocaleString('en-IN'),
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="value"
              barSize={20}
              radius={[0, 4, 4, 0]}
              label={{ position: 'right', fill: INK.axis, fontSize: 11 }}
            >
              {data.map((row) => (
                <Cell key={row.id} fill={colorOf(row.id)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

/* ------------------------------------------------------------------ *
 * Block
 * ------------------------------------------------------------------ */

const CloudKitchenCharts = ({ kitchens, spendSeries, costDataAvailable }) => {
  if (kitchens.length === 0) return null

  // Keyed by kitchen id, not by position, so a hue belongs to a kitchen rather
  // than to a row number.
  const colors = new Map(kitchens.map((kitchen, index) => [kitchen.id, SERIES[index % SERIES.length]]))
  const colorOf = (kitchenId) => colors.get(kitchenId) ?? SERIES[0]

  return (
    <div className="space-y-4">
      {costDataAvailable && (
        <SpendOverTime kitchens={kitchens} series={spendSeries} colorOf={colorOf} />
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {costDataAvailable && <InventoryValueByKitchen kitchens={kitchens} colorOf={colorOf} />}
        <StockOutsByKitchen kitchens={kitchens} colorOf={colorOf} />
      </div>
    </div>
  )
}

export default CloudKitchenCharts
