-- ============================================================
-- Migration 002: add recommendations column to recovery_scores
-- ============================================================

alter table public.recovery_scores
  add column if not exists recommendations jsonb not null default '[]'::jsonb;

comment on column public.recovery_scores.recommendations is
  'Array of ModalityRecommendation objects: { id, name, duration, reason }[]';
