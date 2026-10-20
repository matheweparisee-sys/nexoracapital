/*
# Harden database functions

1. Purpose
- Addresses three security-advisor warnings found after the schema migrations:
  a) `update_updated_at_column()` has a mutable search_path.
  b) `handle_new_user()` (SECURITY DEFINER) is executable by `anon`.
  c) `handle_new_user()` (SECURITY DEFINER) is executable by `authenticated`.

2. Changes
- `update_updated_at_column()`: recreated with `SET search_path = public` via
  CREATE OR REPLACE (no DROP, to preserve the existing triggers that depend on
  it). A caller-controlled search_path can no longer shadow the objects it
  references.
- `handle_new_user()`: already had `SET search_path = public`. It is a
  SECURITY DEFINER trigger function that creates a profile row when a new auth
  user is created. It is meant to run ONLY via the `on_auth_user_created`
  trigger on `auth.users`, never as an RPC call from any client. We REVOKE
  EXECUTE from `anon`, `authenticated`, and `PUBLIC` so the function is not
  reachable through the Data API, while the trigger (which runs as the
  function owner) continues to work.

3. Security
- No new tables or policies.
- Closes an externally-exposed RPC endpoint (`/rest/v1/rpc/handle_new_user`)
  that any unauthenticated caller could previously invoke.

4. Important notes
- The `on_auth_user_created` trigger still fires on new auth.users inserts and
  calls `handle_new_user()` internally; revoking EXECUTE from client roles does
  not affect trigger execution.
- Existing updated_at triggers on all tables are preserved because the
  function is replaced, not dropped.
- This migration is idempotent and safe to re-run.
*/

-- Replace the timestamp helper with a search_path-pinned version.
-- CREATE OR REPLACE preserves dependent triggers.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- handle_new_user is already SECURITY DEFINER SET search_path = public.
-- Revoke all client-role EXECUTE grants so it cannot be called via RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
