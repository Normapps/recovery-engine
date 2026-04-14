/**
 * uploadAvatar
 *
 * Uploads a profile photo to Supabase Storage and saves the resulting
 * public URL to public.users.avatar_url.
 *
 * Storage path: athlete-avatars/{userId}/profile.jpg
 *   - One file per athlete — uploading replaces the previous image.
 *   - The path intentionally never changes so old URLs are automatically
 *     invalidated. A cache-bust query param (?v=<epoch>) is appended to
 *     force browsers and CDNs to re-fetch after an update.
 *
 * Returns:
 *   { success: true,  avatarUrl: string }   — public URL with cache-bust param
 *   { success: false, error:     string }   — human-readable error message
 */

import { supabaseClient } from "@/lib/supabaseClient";

const BUCKET = "athlete-avatars";

/**
 * Resolve the current Supabase auth session → public.users.id
 *
 * Chain: auth.getSession() → auth_id → SELECT id FROM users WHERE auth_id = ?
 *
 * Returns null when:
 *   - Supabase is not configured
 *   - No active session (user not signed in)
 *   - No public.users row for this auth account yet
 */
export async function resolveCurrentUserId(): Promise<string | null> {
  if (!supabaseClient) return null;

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const authId = sessionData?.session?.user?.id;
  if (!authId) return null;

  const { data } = await supabaseClient
    .from("users")
    .select("id")
    .eq("auth_id", authId)
    .maybeSingle();

  return data?.id ?? null;
}

export type UploadAvatarResult =
  | { success: true;  avatarUrl: string }
  | { success: false; error:     string };

/**
 * Upload a profile image file and persist the URL.
 *
 * @param userId  - The athlete's public.users.id (UUID)
 * @param file    - File selected from an <input type="file"> element
 */
export async function uploadAvatar(
  userId: string,
  file:   File,
): Promise<UploadAvatarResult> {
  if (!supabaseClient) {
    return { success: false, error: "Supabase is not configured." };
  }

  if (!userId?.trim()) {
    return { success: false, error: "userId is required." };
  }

  // ── Validate file ──────────────────────────────────────────────────────────
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: "Only JPEG, PNG, WebP, or GIF images are allowed." };
  }

  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_BYTES) {
    return { success: false, error: "Image must be under 5 MB." };
  }

  // ── Upload to Storage ─────────────────────────────────────────────────────
  // Always write to the same path — upsert: true overwrites the existing file.
  // Use .jpg extension regardless of input type to keep the path stable.
  const storagePath = `${userId}/profile.jpg`;

  const { error: uploadError } = await supabaseClient.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert:      true,       // replace existing; never creates duplicates
      cacheControl: "3600",    // CDN caches for 1h; cache-bust param handles staleness
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  // ── Get public URL ────────────────────────────────────────────────────────
  const { data: urlData } = supabaseClient.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  const baseUrl    = urlData.publicUrl;
  const cacheBust  = Date.now();
  const avatarUrl  = `${baseUrl}?v=${cacheBust}`;

  // ── Persist URL to public.users ──────────────────────────────────────────
  const { error: dbError } = await supabaseClient
    .from("users")
    .update({
      avatar_url:        baseUrl,         // store clean URL without ?v= param
      avatar_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (dbError) {
    return { success: false, error: `DB update failed: ${dbError.message}` };
  }

  // Return URL with cache-bust so UI immediately shows new image
  return { success: true, avatarUrl };
}

/**
 * Update only the athlete's name fields (first_name, last_name).
 * Called when the user edits their name on the profile screen.
 *
 * Also refreshes display_name to "First Last" for backward compatibility
 * with code that still reads display_name.
 */
export async function updateAthleteName(
  userId:    string,
  firstName: string,
  lastName:  string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseClient) {
    return { success: false, error: "Supabase is not configured." };
  }

  const first = firstName.trim();
  const last  = lastName.trim();

  const { error } = await supabaseClient
    .from("users")
    .update({
      first_name:   first   || null,
      last_name:    last    || null,
      display_name: [first, last].filter(Boolean).join(" ") || null,
    })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Fetch the athlete identity fields from public.users.
 * Returns null when Supabase is not configured or user is not found.
 */
export async function fetchAthleteIdentity(
  userId: string,
): Promise<{
  first_name:        string | null;
  last_name:         string | null;
  display_name:      string | null;
  avatar_url:        string | null;
  avatar_updated_at: string | null;
} | null> {
  if (!supabaseClient || !userId?.trim()) return null;

  const { data } = await supabaseClient
    .from("users")
    .select("first_name, last_name, display_name, avatar_url, avatar_updated_at")
    .eq("id", userId)
    .maybeSingle();

  return data ?? null;
}
