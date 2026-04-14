"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppState, DailyEntry, RecoveryScore, BloodworkEntry, CoachingPreferences, TrainingPlan, PerformanceProfile, DailyTaskCompletion, PlanTaskItem } from "./types";
import { format } from "date-fns";
import { computeRecoveryScore } from "./recovery-engine";

const todayKey = () => format(new Date(), "yyyy-MM-dd");

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      todayEntry: null,
      todayScore: null,
      entries: {},
      scores: {},
      bloodwork: [],
      trainingPlan: null,
      moodLog: {},
      taskLog: {},
      planTaskLog: {},
      performanceProfile: null,
      coachingPrefs: { mode: "balanced" },

      setTodayEntry: (entry) => set({ todayEntry: entry }),
      setTodayScore: (score) => set({ todayScore: score }),

      upsertEntry: (entry) =>
        set((state) => ({
          entries: { ...state.entries, [entry.date]: entry },
          todayEntry: entry.date === todayKey() ? entry : state.todayEntry,
        })),

      upsertScore: (score) =>
        set((state) => ({
          scores: { ...state.scores, [score.date]: score },
          todayScore: score.date === todayKey() ? score : state.todayScore,
        })),

      addBloodwork: (entry) =>
        set((state) => ({
          bloodwork: [entry, ...state.bloodwork],
        })),

      upsertBloodwork: (entry) =>
        set((state) => {
          const idx = state.bloodwork.findIndex((e) => e.date === entry.date);
          if (idx >= 0) {
            const updated = [...state.bloodwork];
            updated[idx] = entry;
            return { bloodwork: updated };
          }
          return { bloodwork: [entry, ...state.bloodwork] };
        }),

      deleteBloodwork: (id) =>
        set((state) => ({
          bloodwork: state.bloodwork.filter((e) => e.id !== id),
        })),

      setTrainingPlan: (plan) => set({ trainingPlan: plan }),
      setMood: (date, rating) =>
        set((state) => ({ moodLog: { ...state.moodLog, [date]: rating } })),

      toggleTask: (date, task) =>
        set((state) => {
          const existing: DailyTaskCompletion = state.taskLog[date] ?? {
            date,
            training_completed:  false,
            recovery_completed:  false,
            nutrition_completed: false,
            rehab_completed:     false,
          };
          const updated: DailyTaskCompletion = {
            ...existing,
            [task]: !existing[task],
          };
          return { taskLog: { ...state.taskLog, [date]: updated } };
        }),

      setPlanTaskLog: (date, tasks) =>
        set((state) => ({ planTaskLog: { ...state.planTaskLog, [date]: tasks } })),

      togglePlanTask: (date, taskId) =>
        set((state) => {
          const tasks = state.planTaskLog[date];
          if (!tasks) return state;
          return {
            planTaskLog: {
              ...state.planTaskLog,
              [date]: tasks.map((t: PlanTaskItem) =>
                t.id === taskId ? { ...t, completed: !t.completed } : t
              ),
            },
          };
        }),

      setPerformanceProfile: (profile: PerformanceProfile | null) =>
        set({ performanceProfile: profile }),
      setCoachingPrefs: (prefs) => set({ coachingPrefs: prefs }),

      setAdjustedScore: (date, adjustedScore) =>
        set((state) => {
          const score = state.scores[date];
          if (!score) return state;
          const updated = { ...score, adjustedScore };
          return {
            scores: { ...state.scores, [date]: updated },
            todayScore:
              date === todayKey() ? updated : state.todayScore,
          };
        }),
    }),
    {
      name: "recovery-engine-store",
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Record<string, unknown>;
        if (version < 2) {
          // BloodworkEntry structure changed in v2 — clear legacy data
          return { ...state, bloodwork: [], planTaskLog: {} };
        }
        if (version < 3) {
          // planTaskLog added in v3 — initialise to empty
          return { ...state, planTaskLog: {} };
        }
        return state;
      },
    }
  )
);

// ─── Derived selectors ────────────────────────────────────────────────────────

export function useScoreHistory(days = 30) {
  const scores = useStore((s) => s.scores);
  const entries: Array<{ date: string; score: number; calculated: number }> = [];

  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = format(d, "yyyy-MM-dd");
    const score = scores[key];
    if (score) {
      entries.push({
        date: key,
        score: score.adjustedScore ?? score.calculatedScore,
        calculated: score.calculatedScore,
      });
    }
  }
  return entries;
}

/** Returns the most recent bloodwork entry within the last `daysCutoff` days, or null. */
export function useLatestBloodwork(daysCutoff = 90) {
  const bloodwork = useStore((s) => s.bloodwork);
  if (bloodwork.length === 0) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysCutoff);
  const recent = bloodwork
    .filter((b) => new Date(b.date) >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date));
  return recent[0] ?? null;
}

export function useCorrelationInsights() {
  const scores = useStore((s) => s.scores);
  const entries = useStore((s) => s.entries);

  const insights: string[] = [];

  // Sauna correlation
  const saunaDays = Object.values(scores).filter(
    (s) => entries[s.date]?.recovery?.sauna
  );
  const nonSaunaDays = Object.values(scores).filter(
    (s) => !entries[s.date]?.recovery?.sauna
  );
  if (saunaDays.length >= 3 && nonSaunaDays.length >= 3) {
    const saunaAvg =
      saunaDays.reduce((a, b) => a + (b.adjustedScore ?? b.calculatedScore), 0) /
      saunaDays.length;
    const noSaunaAvg =
      nonSaunaDays.reduce((a, b) => a + (b.adjustedScore ?? b.calculatedScore), 0) /
      nonSaunaDays.length;
    const diff = Math.round(saunaAvg - noSaunaAvg);
    if (Math.abs(diff) >= 5) {
      insights.push(
        diff > 0
          ? `Recovery score averages ${diff}% higher on days you use sauna.`
          : `Recovery score averages ${Math.abs(diff)}% lower on days you use sauna — monitor training load on those days.`
      );
    }
  }

  // Strength training correlation
  const strengthDays = Object.values(scores).filter(
    (s) => entries[s.date]?.training?.strengthTraining
  );
  const nonStrengthDays = Object.values(scores).filter(
    (s) => !entries[s.date]?.training?.strengthTraining
  );
  if (strengthDays.length >= 3 && nonStrengthDays.length >= 3) {
    const nextDayScores = strengthDays
      .map((s) => {
        const nextDate = format(
          new Date(new Date(s.date).getTime() + 86400000),
          "yyyy-MM-dd"
        );
        return scores[nextDate];
      })
      .filter(Boolean);
    if (nextDayScores.length >= 2) {
      const avg =
        nextDayScores.reduce(
          (a, b) => a + (b!.adjustedScore ?? b!.calculatedScore),
          0
        ) / nextDayScores.length;
      insights.push(
        `Your average recovery score the day after strength training is ${Math.round(avg)}.`
      );
    }
  }

  return insights;
}
