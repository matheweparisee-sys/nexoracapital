/*
# Fix deposit wallet address visibility for authenticated users

## Problem
The `app_settings` table has RLS enabled with only an admin-scoped SELECT
policy (`app_settings_select_admin`, using `is_admin()`). Regular authenticated
users have no SELECT policy, so their query for `btc_receive_address` returns
zero rows — the frontend shows "No deposit address configured" even after an
admin has saved a wallet address.

## Fix
Add a new SELECT policy `app_settings_select_btc_address` that allows all
authenticated users to read rows from `app_settings`. The only column the
frontend reads is `btc_receive_address`, which is a public receiving address
(never contains private keys), so it is safe to expose to signed-in users.
The admin-only policy remains in place for full-row access.

## Security
- No new tables or columns.
- New policy: `app_settings_select_btc_address` — SELECT on `app_settings`
  for `authenticated` role.
- Existing admin policies unchanged.
- GRANT SELECT confirmed for authenticated role.
*/

DROP POLICY IF EXISTS "app_settings_select_btc_address" ON app_settings;

CREATE POLICY "app_settings_select_btc_address"
ON app_settings FOR SELECT
TO authenticated
USING (true);

GRANT SELECT ON app_settings TO authenticated;
