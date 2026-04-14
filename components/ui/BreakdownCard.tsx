"use client";

interface Props {
  label: string;
  score: number;
  details: string[];
  icon: React.ReactNode;
  className?: string;
}

function MiniBar({ score }: { score: number }) {
  const color =
    score >= 71 ? "#22C55E" : score >= 41 ? "#F59E0B" : "#EF4444";
  return (
    <div className="h-1 w-full rounded-full bg-bg-border overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function BreakdownCard({
  label,
  score,
  details,
  icon,
  className = "",
}: Props) {
  const color =
    score >= 71 ? "#22C55E" : score >= 41 ? "#F59E0B" : "#EF4444";

  return (
    <div
      className={`bg-bg-card border border-bg-border rounded-2xl p-4 flex flex-col gap-3 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary">{icon}</span>
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span
          className="text-lg font-bold tabular-nums leading-none"
          style={{ color }}
        >
          {Math.round(score)}
        </span>
      </div>

      {/* Bar */}
      <MiniBar score={score} />

      {/* Details */}
      <div className="flex flex-col gap-1">
        {details.map((d, i) => (
          <span key={i} className="text-xs text-text-muted leading-relaxed">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}
