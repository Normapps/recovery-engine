"use client";

import DailyLogForm from "@/components/forms/DailyLogForm";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function LogPage() {
  const today = format(new Date(), "EEEE, MMMM d");

  return (
    <div className="flex flex-col gap-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Daily Log</h1>
          <p className="text-xs text-text-secondary mt-0.5">{today}</p>
        </div>
      </div>

      <p className="text-xs text-text-secondary leading-relaxed">
        Enter your data for today. Incomplete entries will be scored with a lower confidence level.
        You can always update this data later.
      </p>

      <DailyLogForm />
    </div>
  );
}
