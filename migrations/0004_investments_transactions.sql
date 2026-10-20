/*
# Create investments and transactions tables

1. Purpose
- `investments`: user investment records linked to an educational plan and
  the user's portfolio. Carries status, amount, and educational outcome.
  Status and outcome are authoritative — set only by trusted backend logic.
- `transactions`: educational deposits, withdrawals, transfers, and
  investment activity. Records cash movements against the portfolio balance.
  Status is authoritative — deposits/withdrawals must be processed by trusted
  backend logic, never by direct browser writes.

2. New Tables

  `investments`
  - `id`          uuid, primary key, default gen_random_uuid().
  - `portfolio_id` uuid, NOT NULL, references portfolios(id) ON DELETE CASCADE.
  - `plan_id`     uuid, NOT NULL, references investment_plans(id).
  - `amount`      numeric(20,2), NOT NULL, CHECK > 0. Educational allocation.
  - `status`      text, NOT NULL, default 'pending'. One of
                  'pending' | 'active' | 'completed' | 'cancelled' | 'rejected'.
                  Authoritative — set only by trusted backend logic.
  - `outcome_value` numeric(20,2), nullable. Educational projected/realized value.
                  Authoritative — set only by trusted backend logic.
  - `started_at`  timestamptz, nullable. When the investment became active.
  - `completed_at` timestamptz, nullable. When the investment completed.
  - `created_at`  timestamptz, default now().
  - `updated_at`  timestamptz, default now(), auto-updated.

  `transactions`
  - `id`           uuid, primary key, default gen_random_uuid().
  - `portfolio_id` uuid, NOT NULL, references portfolios(id) ON DELETE CASCADE.
  - `type`         text, NOT NULL. One of
                   'deposit' | 'withdrawal' | 'investment' | 'transfer'.
  - `amount`       numeric(20,2), NOT NULL, CHECK > 0. Always positive; the
                   direction is implied by `type`.
  - `status`       text, NOT NULL, default 'pending'. One of
                   'pending' | 'completed' | 'failed' | 'cancelled'.
                   Authoritative — set only by trusted backend logic.
  - `reference`    text, nullable. Optional operator/external reference.
  - `description`  text, nullable. User-visible memo.
  - `processed_at` timestamptz, nullable. When the transaction was completed.
  - `created_at`   timestamptz, default now().
  - `updated_at`   timestamptz, default now(), auto-updated.

3. Security — Row Level Security
- RLS enabled on both tables.
- SELECT: a row is visible if its portfolio belongs to the caller.
- INSERT: a user may create a pending investment or transaction row tied to
  their own portfolio. The amount and type may be set by the client; the
  status column is protected by column-level grants (see below) so a browser
  insert cannot force status='completed'.
- UPDATE, DELETE: scoped through parent portfolio ownership. Column-level
  grants restrict which columns can be updated.

4. Security — Column-level privileges
- `investments.status`, `investments.outcome_value`,
  `investments.started_at`, `investments.completed_at`: NOT client-writable.
  REVOKE UPDATE; GRANT UPDATE only on amount to authenticated (amount edits,
  if allowed at all, are still row-scoped; status changes flow through server
  logic). INSERT is restricted so a browser insert can only set amount, plan_id,
  portfolio_id — the database default 'pending' fills status.
- `transactions.status`, `transactions.reference`,
  `transactions.processed_at`: NOT client-writable.
  REVOKE UPDATE; GRANT UPDATE only on description to authenticated.
  INSERT is restricted so a browser insert can set type, amount, description,
  portfolio_id only — status defaults to 'pending'.

5. Important notes
- A browser can REQUEST a deposit, withdrawal, or investment by inserting a
  pending row, but it cannot mark that request completed, approved, or failed.
- Outcome values and completion timestamps are never set by the browser.
- No fabricated transaction history is inserted in this phase.
*/

CREATE TABLE IF NOT EXISTS investments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  plan_id       uuid NOT NULL REFERENCES investment_plans(id),
  amount        numeric(20,2) NOT NULL
    CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'rejected')),
  outcome_value numeric(20,2),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investments_portfolio_id_idx
  ON investments (portfolio_id);
CREATE INDEX IF NOT EXISTS investments_plan_id_idx
  ON investments (plan_id);

CREATE TABLE IF NOT EXISTS transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  type          text NOT NULL
    CHECK (type IN ('deposit', 'withdrawal', 'investment', 'transfer')),
  amount        numeric(20,2) NOT NULL
    CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  reference     text,
  description   text,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_portfolio_id_idx
  ON transactions (portfolio_id);
CREATE INDEX IF NOT EXISTS transactions_status_idx
  ON transactions (status);

-- updated_at triggers
DROP TRIGGER IF EXISTS investments_updated_at ON investments;
CREATE TRIGGER investments_updated_at
  BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS transactions_updated_at ON transactions;
CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE investments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- investments: scoped through parent portfolio ownership
DROP POLICY IF EXISTS "investments_select_own" ON investments;
CREATE POLICY "investments_select_own"
  ON investments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = investments.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "investments_insert_own" ON investments;
CREATE POLICY "investments_insert_own"
  ON investments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = investments.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "investments_update_own" ON investments;
CREATE POLICY "investments_update_own"
  ON investments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = investments.portfolio_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = investments.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "investments_delete_own" ON investments;
CREATE POLICY "investments_delete_own"
  ON investments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = investments.portfolio_id AND p.user_id = auth.uid()
  ));

-- transactions: scoped through parent portfolio ownership
DROP POLICY IF EXISTS "transactions_select_own" ON transactions;
CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = transactions.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "transactions_insert_own" ON transactions;
CREATE POLICY "transactions_insert_own"
  ON transactions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = transactions.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "transactions_update_own" ON transactions;
CREATE POLICY "transactions_update_own"
  ON transactions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = transactions.portfolio_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = transactions.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "transactions_delete_own" ON transactions;
CREATE POLICY "transactions_delete_own"
  ON transactions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = transactions.portfolio_id AND p.user_id = auth.uid()
  ));

-- ── Column-level privileges ──────────────────────────────────────────────────
-- investments: status, outcome, timestamps must never be browser-writable.
REVOKE UPDATE ON investments FROM authenticated;
GRANT UPDATE (amount) ON investments TO authenticated;

-- Restrict INSERT to non-authoritative columns so a browser cannot force
-- status='completed' on insert. status defaults to 'pending'.
REVOKE INSERT ON investments FROM authenticated;
GRANT INSERT (portfolio_id, plan_id, amount) ON investments TO authenticated;

-- transactions: status, reference, processed_at must never be browser-writable.
REVOKE UPDATE ON transactions FROM authenticated;
GRANT UPDATE (description) ON transactions TO authenticated;

-- Restrict INSERT to non-authoritative columns. status defaults to 'pending'.
REVOKE INSERT ON transactions FROM authenticated;
GRANT INSERT (portfolio_id, type, amount, description) ON transactions TO authenticated;
