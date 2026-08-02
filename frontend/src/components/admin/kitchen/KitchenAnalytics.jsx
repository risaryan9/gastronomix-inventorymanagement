// Analytics scoped to one cloud kitchen.
//
// Every chart here plots a single measure, so every chart is one colour — the
// kitchen's own hue, carried over from the cross-kitchen overview so the two
// screens read as the same system. Colouring bars by their own value would
// double-encode length as hue and spend the only free channel on information
// the bar already shows.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_SURFACE, INK } from '../../../lib/chartTheme'
import { compactMoney, count, money } from '../../../lib/formatNumbers'

const bucketLabel = (bucket, bucketDays) => {
  const label = new Date(`${bucket}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return bucketDays > 1 ? `w/c ${label}` : label
}

const ChartCard = ({ title, description, children }) => (
  <section className="bg-card border border-border rounded-xl p-5">
    <header className="mb-4">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </header>
    {children}
  </section>
)

const TooltipBody = ({ heading, label, value, color }) => (
  <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
    <p className="text-xs font-semibold text-foreground mb-1.5">{heading}</p>
    <div className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className="w-2.5 h-2.5 rounded-sm shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  </div>
)

const EmptyChart = ({ message }) => (
  <div className="h-56 flex items-center justify-center">
    <p className="text-xs text-muted-foreground">{message}</p>
  </div>
)

const SpendTrend = ({ series, color }) => {
  const bucketDays = series[0]?.bucketDays ?? 1
  const hasSpend = series.some((row) => row.value > 0)

  return (
    <ChartCard
      title="Spend trend"
      description="Stock-in value received by this kitchen over the selected range."
    >
      {!hasSpend ? (
        <EmptyChart message="No stock received in this range." />
      ) : (
        <div className="h-56">
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
                      label="Spend"
                      value={money(payload[0].value)}
                      color={color}
                    />
                  ) : null
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={series.length <= 2 ? { r: 4, strokeWidth: 0 } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_SURFACE }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

const TopMaterials = ({ materials, color }) => (
  <ChartCard
    title="Top materials by value"
    description="The stock on hand tying up the most money, as of now."
  >
    {materials.length === 0 ? (
      <EmptyChart message="No stock on hand." />
    ) : (
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={materials}
            layout="vertical"
            margin={{ top: 4, right: 64, bottom: 0, left: 0 }}
          >
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
              width={140}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBody
                    heading={payload[0].payload.name}
                    label="Value on hand"
                    value={money(payload[0].value)}
                    color={color}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="value"
              fill={color}
              barSize={14}
              radius={[0, 4, 4, 0]}
              label={{ position: 'right', formatter: compactMoney, fill: INK.axis, fontSize: 11 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}
  </ChartCard>
)

const ReasonMix = ({ reasons, color }) => (
  <ChartCard
    title="Internal use by reason"
    description="Why stock left this kitchen without going to an outlet, over the selected range."
  >
    {reasons.length === 0 ? (
      <EmptyChart message="No internal stock-outs in this range." />
    ) : (
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={reasons}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 0, left: 0 }}
          >
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
              dataKey="label"
              tick={{ fill: INK.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={140}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBody
                    heading={payload[0].payload.label}
                    label="Movements"
                    value={count(payload[0].value)}
                    color={color}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="value"
              fill={color}
              barSize={14}
              radius={[0, 4, 4, 0]}
              label={{ position: 'right', fill: INK.axis, fontSize: 11 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}
  </ChartCard>
)

const KitchenAnalytics = ({ analytics, color }) => (
  <div className="space-y-4">
    <SpendTrend series={analytics.spendSeries} color={color} />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <TopMaterials materials={analytics.topMaterials} color={color} />
      <ReasonMix reasons={analytics.reasonMix} color={color} />
    </div>
  </div>
)

export default KitchenAnalytics
