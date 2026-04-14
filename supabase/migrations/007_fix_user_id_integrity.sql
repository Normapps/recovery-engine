-- ============================================================
-- Migration 007: Fix user_id / athlete_id data integrity
--
-- SCHEMA CONTEXT (important before reading this file):
--
--   auth.users           — Supabase managed auth table
--   public.users         — app-level profile table
--                          id       uuid PK  (the "athlete id" in product terms)
--                          auth_id  uuid UNIQUE → auth.users.id
--   public.performance_profiles
--                          user_id  uuid FK → public.users(id)
--                          (no physical athlete_id column exists as of migration 006;
--                           athlete_id is exposed only via the performance_profiles_v VIEW)
--
-- RELATIONSHIP CHAIN:
--   auth.users.id  ←→  public.users.auth_id  (1:1 Supabase auth link)
--   public.users.id  ←  performance_profiles.user_id  (1:many)
--
-- PROBLEMS BEING FIXED:
--   1. performance_profiles rows whose user_id does not exist in public.users
--      (orphaned rows — FK violation if constraints are in enforced mode)
--   2. public.users rows whose auth_id does not exist in auth.users
--      (dead auth links — user can never log in)
--   3. physical athlete_id column may exist in performance_profiles (from a
--      manual migration) and contain NULLs that need backfilling
--   4. Guarantee every remaining performance_profile has a valid, reachable
--      user in both public.users AND auth.users
--
-- SAFETY GUARANTEES:
--   - No tables are dropped
--   - No FK constraints are disabled
--   - No rows are inserted into auth.users (Supabase-managed, hands off)
--   - Orphaned rows are moved to a quarantine table before deletion
--   - Every destructive step runs AFTER a validation query you can check
--   - All steps are wrapped in explicit transactions
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- STEP 0 — Quarantine table for soft-deleted orphaned rows
-- ════════════════════════════════════════════════════════════
-- Orphaned performance_profile rows are moved here, not hard-deleted.
-- You can inspect them after the migration and permanently delete when confident.

create table if not exists public._orphaned_performance_profiles (
  original_id         uuid,
  original_user_id    uuid,
  reason              text,
  row_data            jsonb,
  quarantined_at      timestamptz not null default now()
);

comment on table public._orphaned_performance_profiles is
  'Soft-deleted performance_profiles rows whose user_id had no valid parent. '
  'Inspect before permanently deleting. Created by migration 007.';


-- ════════════════════════════════════════════════════════════
-- STEP 1 — DIAGNOSE: find all orphaned performance_profile rows
-- ════════════════════════════════════════════════════════════
-- Run this SELECT before the fixes to understand what will be affected.
-- This is a READ-ONLY diagnostic query — nothing is changed here.

/*  ── DIAGNOSTIC QUERY (run manually to review before proceeding) ──

-- 1a. performance_profiles whose user_id has no matching row in public.users
SELECT
  pp.id                         as profile_id,
  pp.user_id                    as invalid_user_id,
  pp.primary_goal,
  pp.created_at,
  'no matching public.users row' as problem
FROM public.performance_profiles pp
WHERE pp.user_id NOT IN (SELECT id FROM public.users)
   OR pp.user_id IS NULL;

-- 1b. public.users rows whose auth_id has no matching row in auth.users
--     (these users can never log in — their profiles are effectively orphaned too)
SELECT
  u.id          as user_id,
  u.auth_id,
  u.display_name,
  u.email,
  'auth_id not in auth.users' as problem
FROM public.users u
WHERE u.auth_id IS NULL
   OR u.auth_id NOT IN (SELECT id FROM auth.users);

-- 1c. performance_profiles whose public.users row exists but has no auth link
SELECT
  pp.id           as profile_id,
  pp.user_id,
  u.auth_id,
  u.display_name,
  'user exists but has no auth.users link' as problem
FROM public.performance_profiles pp
JOIN public.users u ON u.id = pp.user_id
WHERE u.auth_id IS NULL
   OR u.auth_id NOT IN (SELECT id FROM auth.users);

*/


-- ════════════════════════════════════════════════════════════
-- STEP 2 — QUARANTINE orphaned performance_profile rows
-- ════════════════════════════════════════════════════════════
-- Moves rows whose user_id does not exist in public.users into the quarantine
-- table. No data is permanently lost — you can restore from _orphaned_*.

begin;

  -- 2a. Copy orphaned rows (no valid public.users parent) into quarantine
  insert into public._orphaned_performance_profiles
    (original_id, original_user_id, reason, row_data)
  select
    pp.id,
    pp.user_id,
    'user_id not found in public.users',
    to_jsonb(pp)
  from public.performance_profiles pp
  where pp.user_id is null
     or pp.user_id not in (select id from public.users);

  -- 2b. Remove those orphaned rows from the live table
  --     (safe: we just backed them up to quarantine)
  delete from public.performance_profiles
  where user_id is null
     or user_id not in (select id from public.users);

commit;

-- ── Validate Step 2 ──────────────────────────────────────────────────────────
-- After commit, this should return 0 rows.
-- SELECT count(*) FROM public.performance_profiles
-- WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM public.users);


-- ════════════════════════════════════════════════════════════
-- STEP 3 — QUARANTINE performance_profiles linked to dead auth accounts
-- ════════════════════════════════════════════════════════════
-- A public.users row can exist but have no valid auth.users link (auth_id is
-- NULL or points to a deleted auth account). Those athletes can never log in.
-- Their profiles are quarantined separately so you can decide what to do with them.
--
-- WARNING: This step identifies users who CANNOT authenticate.
--          If you have test users created with manual UUIDs, they will appear here.
--          Review the diagnostic query in Step 1b before committing this block.

begin;

  -- 3a. Copy profiles of users with dead auth links to quarantine
  insert into public._orphaned_performance_profiles
    (original_id, original_user_id, reason, row_data)
  select
    pp.id,
    pp.user_id,
    'linked public.users row has no valid auth.users entry (auth_id = ' ||
      coalesce(u.auth_id::text, 'NULL') || ')',
    to_jsonb(pp)
  from public.performance_profiles pp
  join public.users u on u.id = pp.user_id
  where u.auth_id is null
     or u.auth_id not in (select id from auth.users)
  -- Safety guard: skip rows already quarantined in step 2
  and pp.id not in (select original_id from public._orphaned_performance_profiles);

  -- 3b. Remove profiles whose owner can never authenticate
  --     IMPORTANT: Only delete performance_profiles here, NOT the public.users rows.
  --                Deleting public.users rows would cascade to ALL their other data.
  --                Let a human decide what to do with those user records.
  delete from public.performance_profiles
  where user_id in (
    select id from public.users
    where auth_id is null
       or auth_id not in (select id from auth.users)
  )
  -- Skip rows already deleted in step 2 (defensive guard)
  and id not in (select original_id from public._orphaned_performance_profiles
                 where reason like 'user_id not found%');

commit;

-- ── Validate Step 3 ──────────────────────────────────────────────────────────
-- After commit, all remaining profiles belong to users who can authenticate.
/*
SELECT count(*)
FROM public.performance_profiles pp
JOIN public.users u ON u.id = pp.user_id
WHERE u.auth_id IS NULL
   OR u.auth_id NOT IN (SELECT id FROM auth.users);
-- Expected: 0
*/


-- ════════════════════════════════════════════════════════════
-- STEP 4 — Ensure public.users exists for every valid auth.users account
-- ════════════════════════════════════════════════════════════
-- auth.users is Supabase-managed. If an auth account exists but has no
-- public.users row, that account is invisible to the app (RLS policies fail,
-- no profile data, etc.). This creates the missing public.users rows.

begin;

  insert into public.users (auth_id, display_name, email)
  select
    a.id                         as auth_id,
    coalesce(
      (a.raw_user_meta_data->>'full_name'),
      (a.raw_user_meta_data->>'name'),
      split_part(a.email, '@', 1)
    )                            as display_name,
    a.email
  from auth.users a
  where a.id not in (
    select auth_id from public.users where auth_id is not null
  )
  on conflict (auth_id) do nothing;   -- idempotent

commit;

-- ── Validate Step 4 ──────────────────────────────────────────────────────────
/*
SELECT count(*)
FROM auth.users a
WHERE a.id NOT IN (
  SELECT auth_id FROM public.users WHERE auth_id IS NOT NULL
);
-- Expected: 0
*/


-- ════════════════════════════════════════════════════════════
-- STEP 5 — Backfill athlete_id in performance_profiles
-- ════════════════════════════════════════════════════════════
-- In our schema, athlete_id is exposed as a VIEW column alias over user_id
-- (migration 006, performance_profiles_v). However, if a physical athlete_id
-- column was added manually (or via a separate migration) and contains NULLs,
-- this step backfills it.
--
-- Safe to run even if the column does not exist — the DO block catches the error.

do $$
begin
  -- Only attempt backfill if the physical column exists
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'performance_profiles'
      and column_name  = 'athlete_id'
  ) then
    -- Backfill: set athlete_id = user_id for all rows where athlete_id is NULL.
    -- In our model, user_id IS the athlete identifier (public.users.id).
    update public.performance_profiles
    set    athlete_id = user_id
    where  athlete_id is null
      and  user_id is not null;

    raise notice 'athlete_id backfill complete.';
  else
    raise notice 'No physical athlete_id column found — backfill skipped. '
                 'athlete_id is available via the performance_profiles_v view.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════
-- STEP 6 — Add NOT NULL constraint on athlete_id (conditional)
-- ════════════════════════════════════════════════════════════
-- Only enforce NOT NULL if:
--   a) the physical athlete_id column exists, AND
--   b) no NULL values remain after step 5.
-- This block is safe to run: the DO wrapper skips silently if preconditions fail.

do $$
declare
  null_count int;
begin
  -- Only proceed if the column physically exists
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'performance_profiles'
      and column_name  = 'athlete_id'
  ) then
    raise notice 'athlete_id column not found — NOT NULL constraint skipped.';
    return;
  end if;

  -- Count remaining NULLs
  execute 'SELECT count(*) FROM public.performance_profiles WHERE athlete_id IS NULL'
    into null_count;

  if null_count > 0 then
    raise warning
      'Cannot set athlete_id NOT NULL: % row(s) still have NULL athlete_id. '
      'Investigate before re-running step 6.', null_count;
  else
    -- Safe to enforce
    alter table public.performance_profiles
      alter column athlete_id set not null;
    raise notice 'athlete_id NOT NULL constraint applied successfully.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════
-- STEP 7 — Add FK constraint on athlete_id (conditional)
-- ════════════════════════════════════════════════════════════
-- If a physical athlete_id column exists, it should reference public.users(id)
-- so the DB enforces referential integrity (not just the application layer).
-- Skipped gracefully if the constraint already exists or the column is absent.

do $$
begin
  -- Only proceed if the column physically exists
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'performance_profiles'
      and column_name  = 'athlete_id'
  ) then
    raise notice 'athlete_id column not found — FK constraint skipped.';
    return;
  end if;

  -- Add FK if not already present
  if not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
    where tc.table_schema    = 'public'
      and tc.table_name      = 'performance_profiles'
      and tc.constraint_type = 'FOREIGN KEY'
      and kcu.column_name    = 'athlete_id'
  ) then
    alter table public.performance_profiles
      add constraint fk_performance_profiles_athlete_id
      foreign key (athlete_id) references public.users(id)
      on delete cascade;
    raise notice 'FK constraint on athlete_id added successfully.';
  else
    raise notice 'FK constraint on athlete_id already exists — skipped.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════
-- STEP 8 — FINAL VALIDATION QUERIES
-- ════════════════════════════════════════════════════════════
-- Run these after the migration to confirm a clean state.
-- All should return 0 rows / 0 counts.

/*

-- 8a. No orphaned performance_profiles (invalid user_id)
SELECT count(*) as orphaned_profiles
FROM public.performance_profiles pp
WHERE pp.user_id IS NULL
   OR pp.user_id NOT IN (SELECT id FROM public.users);
-- Expected: 0

-- 8b. No profiles linked to un-authenticatable users
SELECT count(*) as dead_auth_profiles
FROM public.performance_profiles pp
JOIN public.users u ON u.id = pp.user_id
WHERE u.auth_id IS NULL
   OR u.auth_id NOT IN (SELECT id FROM auth.users);
-- Expected: 0

-- 8c. No auth.users without a public.users row
SELECT count(*) as missing_users
FROM auth.users a
WHERE a.id NOT IN (
  SELECT auth_id FROM public.users WHERE auth_id IS NOT NULL
);
-- Expected: 0

-- 8d. Check quarantine — review what was removed
SELECT original_user_id, reason, quarantined_at
FROM public._orphaned_performance_profiles
ORDER BY quarantined_at DESC;
-- Review these rows. If all are test data, run:
--   TRUNCATE public._orphaned_performance_profiles;

-- 8e. Full chain integrity — confirm all remaining profiles have a clean path
SELECT
  pp.id             as profile_id,
  u.id              as user_id,
  u.auth_id,
  u.display_name
FROM public.performance_profiles pp
JOIN public.users u ON u.id = pp.user_id
JOIN auth.users a  ON a.id  = u.auth_id
ORDER BY u.display_name;
-- Every row here has a complete, valid auth chain.

*/


-- ════════════════════════════════════════════════════════════
-- STEP 9 — Update RLS policies (if needed)
-- ════════════════════════════════════════════════════════════
-- The existing RLS policy on performance_profiles uses:
--   user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
-- This is correct and does NOT need to change.
--
-- If athlete_id was added as a physical column and you want RLS to
-- use it instead, swap the policy here.
-- For now: document only — no change needed.

/*  Current policy (from migration 001 — still correct):

  create policy "performance_profiles: own rows" on public.performance_profiles
    for all using (
      user_id in (select id from public.users where auth_id = auth.uid())
    );

  This works because:
    auth.uid()       → the logged-in Supabase auth user's UUID
    public.users.auth_id = auth.uid()  → finds this athlete's public.users row
    public.users.id  → equals performance_profiles.user_id
  Chain is correct. No change required.
*/
