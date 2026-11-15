import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { Stats } from '@/api/types'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { hourLabel } from '@/lib/format'

const chartConfig = { orders: { label: 'Orders', color: 'var(--chart-1)' } } satisfies ChartConfig

export default function HourlyChart({ data }: { data: Stats['orders_by_hour'] }) {
  const rows = [...data].sort((a, b) => a.hour.localeCompare(b.hour)).map((r) => ({ ...r, label: hourLabel(r.hour) }))
  // Trim the quiet hours before the first order so the chart shows the service.
  const first = rows.findIndex((r) => r.orders > 0)
  const shown = first === -1 ? [] : rows.slice(Math.max(0, first - 1))
  if (!shown.length) {
    return (
      <div className="mt-4 grid h-48 place-content-center rounded-2xl bg-linen text-center">
        <p className="text-ink-soft">No orders yet today.</p>
        <Button asChild variant="outline" size="sm" className="mx-auto mt-3">
          <Link to="/dashboard/playground">Place a test order</Link>
        </Button>
      </div>
    )
  }
  return (
    <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-56 w-full">
      <BarChart data={shown} margin={{ left: -18, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={{ fill: 'var(--linen)' }} content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartContainer>
  )
}

