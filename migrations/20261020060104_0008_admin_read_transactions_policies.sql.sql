/*
# Fix: Admin cannot see customer transactions/investments in the admin dashboard

## Root cause
The SELECT RLS policies on `transactions` and `investments` only allow
`p.user_id = auth.uid()` — i.e. a user can only see records tied to their
own portfolio. There was no admin override, so an admin querying these
tables directly (as the admin dashboard does) would see zero rows for
every other user's transactions.

The `support_tickets` table already had the correct pattern:
`(user_id = auth.uid() OR is_admin())`.

## Fix
Replace the existing SELECT policies on `transactions` and `investments`
with policies that also allow admins (`is_admin()`) to read all rows.
This mirrors the support_tickets pattern. No other policies (INSERT,
UPDATE, DELETE) are touched — they remain ownership-scoped.

## Security note
`is_admin()` checks `profiles.role = 'admin'` for the calling user
(`auth.uid()`), so only genuine admins gain access. No service-role
keys are exposed and no existing protection is weakened.
*/

DROP POLICY IF EXISTS transactions_select_own ON transactions;
CREATE POLICY transactions_select_own_or_admin ON transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = transactions.portfolio_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  );

DROP POLICY IF EXISTS investments_select_own ON investments;
CREATE POLICY investments_select_own_or_admin ON investments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = investments.portfolio_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  );
