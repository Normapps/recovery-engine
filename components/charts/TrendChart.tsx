"use client";

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";

export interface DataPoint {
  date: string;
  [key: string]: number | string | null | undefined;
}

export interface SeriesConfig {
  key: string;
  color: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
}

interface Props {
  data: DataPoint[];
  series: SeriesConfig[];
  showReferences?: boolean;         // score zone lines at 41 / 71
  yDomain?: [number | "auto", number | "auto"];
  height?: number;
  referenceRange?: { lo: number; hi: number; color: string };
  optimalRange?: { lo: number; hi: number; color: string };
  unit?: string;
  hideLegend?: boolean;
}

function CustomTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { color: string; name: string; value: number | null; dataKey: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-elevated border border-bg-border rounded-xl px-4 py-3 shadow-2xl min-w-[130px]">
      <p className="text-2xs text-text-muted mb-2 uppercase tracking-wider">{label}</p>
      {payload.filter((e) => e.value !== null && e.value !== undefined).map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-xs text-text-secondary">{entry.name}:</span>
          <span className="text-xs font-bold text-text-primary tabular-nums">
            {typeof entry.value === "number" ? entry.value.toFixed(1) : "—"}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({
  data,
  series,
  showReferences = false,
  yDomain = ["auto", "auto"],
  height = 200,
  referenceRange,
  optimalRange,
  unit,
  hideLegend = false,
}: Props) {
  const formattedData = data.map((d) => ({
    ...d,
    displayDate: (() => {
      try { return format(parseISO(d.date), "MMM d"); } catch { return d.date; }
    })(),
  }));

  const showLegend = !hideLegend && series.length > 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={formattedData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid strokeDasharray="2 4" stroke="#1E2D3D" vertical={false} />

        <XAxis
          dataKey="displayDate"
          tick={{ fill: "#4A5568", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          domain={yDomain}
          tick={{ fill: "#4A5568", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} />

        {showLegend && (
          <Legend
            iconType="circle"
            iconSize={6}
            wrapperStyle={{ fontSize: "10px", paddingTop: "8px", color: "#718096" }}
          />
        )}

        {/* Reference bands */}
        {referenceRange && (
          <ReferenceArea
            y1={referenceRange.lo} y2={referenceRange.hi}
            fill={referenceRange.color} fillOpacity={0.06}
            strokeOpacity={0}
          />
        )}
        {optimalRange && (
          <ReferenceArea
            y1={optimalRange.lo} y2={optimalRange.hi}
            fill={optimalRange.color} fillOpacity={0.10}
            strokeOpacity={0}
          />
        )}

        {/* Zone lines for recovery score */}
        {showReferences && (
          <>
            <ReferenceArea y1={71} y2={100} fill="#22C55E" fillOpacity={0.04} strokeOpacity={0} />
            <ReferenceArea y1={41} y2={70} fill="#F59E0B" fillOpacity={0.04} strokeOpacity={0} />
            <ReferenceArea y1={0} y2={40} fill="#EF4444" fillOpacity={0.04} strokeOpacity={0} />
            <ReferenceLine y={71} stroke="#22C55E" strokeDasharray="3 3" strokeOpacity={0.25} />
            <ReferenceLine y={41} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.25} />
          </>
        )}

        {/* Gradient area fill for primary series */}
        {series.map((s, i) => (
          i === 0 ? (
            <Area
              key={`area-${s.key}`}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke="none"
              fill={`url(#grad-${s.key})`}
              connectNulls
            />
          ) : null
        ))}

        {/* Lines */}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            dot={s.dot ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
            activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
