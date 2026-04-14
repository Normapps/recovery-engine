-- ============================================================
-- Migration 008: Athlete identity — name + avatar
--
-- Adds first_name, last_name, avatar_url, avatar_updated_at to
-- public.users (the app-level athlete record).
--
-- Rationale:
--   - display_name already exists but is a single freeform string
--   - Splitting into first/last enables personalised salutations,
--     formal display, and future coach-facing roster views
--   - avatar_url stores the Supabase Storage public URL only —
--     the binary is never stored in the DB
--   - avatar_updated_at lets the frontend bust any CDN/browser
--     cache by appending ?v=<timestamp> to the image URL
-- ============================================================

alter table public.users
  add column if not exists first_name         text,
  add column if not exists last_name          text,
  add column if not exists avatar_url         text,
  add column if not exists avatar_updated_at  timestamptz;

comment on column public.users.first_name        is 'Athlete first name — entered on profile screen';
comment on column public.users.last_name         is 'Athlete last name — entered on profile screen';
comment on column public.users.avatar_url        is 'Supabase Storage public URL for profile photo. Path: athlete-avatars/{user_id}/profile.jpg';
comment on column public.users.avatar_updated_at is 'Set on every avatar upload to bust browser/CDN cache';

-- ─── Backfill first_name / last_name from display_name ───────────────────────
-- display_name may already contain "First Last". Split on the first space.
-- Rows where display_name is NULL or has no space are left as NULL — safe.

update public.users
set
  first_name = case
    when display_name is not null and display_name ~ '\s'
    then split_part(display_name, ' ', 1)
    else null
  end,
  last_name = case
    when display_name is not null and display_name ~ '\s'
    then substring(display_name from position(' ' in display_name) + 1)
    else null
  end
where first_name is null
  and last_name  is null
  and display_name is not null;

-- ─── Refresh the athletes view to expose new columns ─────────────────────────
-- athletes is a view over public.users (created in migration 006).
-- Recreate it so it surfaces the new columns.

create or replace view public.athletes as
select
  id              as athlete_id,
  id              as user_id,
  auth_id,
  display_name,
  first_name,
  last_name,
  -- Computed full name: prefer first+last, fall back to display_name
  coalesce(
    nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''),
    display_name
  )               as full_name,
  email,
  coach_mode,
  avatar_url,
  avatar_updated_at,
  created_at,
  updated_at
from public.users;

comment on view public.athletes is
  'Domain view of users: exposes athlete_id alias, full_name computed column, '
  'and avatar fields. Use this for reads; write to public.users directly.';

-- ─── Supabase Storage: athlete-avatars bucket ─────────────────────────────────
-- Storage bucket creation cannot be done in SQL migrations — use the Supabase
-- dashboard or the management API. Instructions:
--
--   Dashboard path:
--     Storage → New bucket
--     Name: athlete-avatars
--     Public: YES  (images are served via public URL, no auth token needed)
--
--   OR via Supabase CLI:
--     supabase storage create-bucket athlete-avatars --public
--
-- File naming convention (enforced in application code):
--   athlete-avatars/{user_id}/profile.jpg
--
-- New uploads overwrite the existing file at that path (same key = replace).
-- No versioning or subfolder rotation needed — avatar_updated_at in the DB
-- serves as a cache-bust signal via ?v=<epoch> query param on the image URL.

-- ─── RLS policy for Storage (run in Supabase dashboard → Storage → Policies) ─
-- After creating the bucket, add these policies in the Supabase dashboard:
--
-- Policy 1: Allow authenticated users to upload their own avatar
--   Name:    "Athletes can upload their own avatar"
--   Table:   storage.objects
--   Op:      INSERT, UPDATE
--   Using:   (bucket_id = 'athlete-avatars')
--            AND (auth.uid()::text = split_part(name, '/', 1))
--
-- Policy 2: Allow public reads (bucket is public — this may be automatic)
--   Name:    "Avatar images are publicly readable"
--   Table:   storage.objects
--   Op:      SELECT
--   Using:   (bucket_id = 'athlete-avatars')
