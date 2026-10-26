/*
# Fix (real root cause): Admin still couldn't see transactions

## What was actually broken
The previous migration (0008) added `OR is_admin()` to the SELECT policies on
`transactions` and `investments`, but the predicate was structured as:

  EXISTS (SELECT 1 FROM portfolios p
          WHERE p.id = transactions.portfolio_id
            AND (p.user_id = auth.uid() OR is_admin()))

The inner `SELECT ... FROM portfolios` is itself subject to portfolios RLS
(`auth.uid() = user_id`). An admin does NOT own other users' portfolios, so
RLS filters those portfolio rows out of the subquery before the
`OR is_admin()` branch can ever be evaluated. Net effect: admins still saw
zero transactions/investments.

Confirmed by simulating the admin JWT under `SET LOCAL role = 'authenticated'`:
`is_admin()` returns true, but `SELECT count(*) FROM transactions` returns 0.

## Fix
Rewrite the policies so the admin check does NOT depend on reading a
portfolios row. Two separate branches via `OR`:

  1. Owner branch: EXISTS (SELECT 1 FROM portfolios p
     WHERE p.id = <table>.portfolio_id AND p.user_id = auth.uid())
     -> still subject to portfolios RLS, which correctly lets the owner
        see their own rows.

  2. Admin branch: is_admin() -> SECURITY DEFINER, bypasses RLS, lets
     admins see all rows regardless of portfolio ownership.

The admin no longer needs to read the portfolio row to authorize.

## Security
`is_admin()` is SECURITY DEFINER and checks `profiles.role = 'admin'` for
the calling user. No protection is weakened — ordinary users still only see
their own records via the owner branch.
*/

DROP POLICY IF EXISTS transactions_select_own_or_admin ON transactions;
CREATE POLICY transactions_select_own_or_admin ON transactions
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = transactions.portfolio_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS investments_select_own_or_admin ON investments;
CREATE POLICY investments_select_own_or_admin ON investments
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = investments.portfolio_id
        AND p.user_id = auth.uid()
    )
  );
