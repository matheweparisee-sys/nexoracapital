/*
# Create profiles table

1. Purpose
- Stores per-user profile information linked one-to-one to the authenticated user.
- Holds user-editable fields (display name, avatar, bio) alongside authoritative
  fields that the browser must never set directly (role, kyc_status).

2. New Tables
- `profiles`
  - `id`           uuid, primary key, references auth.users(id) ON DELETE CASCADE.
                   Acts as both the primary key and the ownership key.
  - `display_name` text, nullable. User-chosen display name.
  - `avatar_url`   text, nullable. URL to the user's avatar image.
  - `bio`          text, nullable. Free-form user biography.
  - `role`         text, NOT NULL, default 'member'. One of 'member' | 'admin'.
                   Authoritative — set only by trusted backend logic.
  - `kyc_status`   text, NOT NULL, default 'unverified'. One of
                   'unverified' | 'pending' | 'verified' | 'rejected'.
                   Authoritative — set only by trusted backend logic.
  - `created_at`   timestamptz, default now().
  - `updated_at`   timestamptz, default now(), updated on row change.

3. Automation
- `handle_new_user()` trigger function: runs on INSERT to auth.users and creates
  a matching profiles row with the new user's id. Ensures every authenticated
  user has a profile without relying on the frontend.
- Trigger `on_auth_user_created` fires AFTER INSERT on auth.users.

4. Security — Row Level Security
- RLS enabled on `profiles`.
- SELECT: authenticated users can read only their own profile.
- INSERT: blocked via RLS (profiles are created by the trigger only).
- UPDATE: authenticated users can update only their own profile.
- DELETE: blocked via RLS (profile removed via auth.users CASCADE only).

5. Security — Column-level privileges
- `role` and `kyc_status` are authoritative columns. The UPDATE policy allows the
  row, but column-level GRANT restricts the authenticated role to editing only
  `display_name`, `avatar_url`, and `bio`. Changes to `role` or `kyc_status`
  must go through a privileged SECURITY DEFINER function (added in a later phase).

6. Important notes
- The trigger makes profile creation automatic; the frontend never inserts into
  profiles directly.
- `role` and `kyc_status` are NOT client-writable even though the UPDATE policy
  allows the row. Column privileges are checked before policies.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url   text,
  bio          text,
  role         text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'admin')),
  kyc_status   text NOT NULL DEFAULT 'unverified'
    CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Update updated_at on row change
DROP FUNCTION IF EXISTS update_updated_at_column();
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create a profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- No INSERT or DELETE policies: profiles are managed by the trigger / CASCADE.

-- ── Column-level privileges ──────────────────────────────────────────────────
-- Revoke broad UPDATE, then grant only user-editable columns.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url, bio) ON profiles TO authenticated;
