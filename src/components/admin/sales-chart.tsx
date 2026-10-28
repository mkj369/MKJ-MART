import { formatBDT } from '@/lib/money';

/** Dependency-free SVG area chart of daily sales (server-rendered, accessible summary). */
export function SalesChart({ series }: { series: { day: string; sales: number; orders: number }[] }) {
  const width = 760;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 12 };
  const max = Math.max(...series.map((s) => s.sales), 1);
  const stepX = (width - pad.left - pad.right) / Math.max(series.length - 1, 1);
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);
  const points = series.map((s, i) => [pad.left + i * stepX, y(s.sales)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1]![0].toFixed(1)},${height - pad.bottom} L${pad.left},${height - pad.bottom} Z`;
  const total = series.reduce((s, d) => s + d.sales, 0);
  const best = series.reduce((a, b) => (b.sales > a.sales ? b : a), series[0]!);
  const labelEvery = Math.ceil(series.length / 6);
  const fmtDay = (d: string) => new Date(`${d}T00:00:00+06:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' });

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Daily sales over ${series.length} days, total ${formatBDT(total)}`}>
        <defs>
          <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#a88454" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#a88454" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke="#e7e3db" strokeDasharray="3 4" />
        ))}
        <path d={area} fill="url(#salesFill)" />
        <path d={line} fill="none" stroke="#84653a" strokeWidth="1.6" strokeLinejoin="round" />
        {points.map(([px, py], i) =>
          series[i]!.sales > 0 ? <circle key={i} cx={px} cy={py} r="2.2" fill="#0e0e0e"><title>{`${fmtDay(series[i]!.day)}: ${formatBDT(series[i]!.sales)} · ${series[i]!.orders} orders`}</title></circle> : null,
        )}
        {series.map((s, i) =>
          i % labelEvery === 0 || i === series.length - 1 ? (
            <text key={s.day} x={pad.left + i * stepX} y={height - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} fontSize="10" fill="#9a958c">
              {fmtDay(s.day)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 text-[12px] text-muted">
        Peak day {fmtDay(best.day)} · {formatBDT(best.sales)}
      </figcaption>
    </figure>
  );
}
