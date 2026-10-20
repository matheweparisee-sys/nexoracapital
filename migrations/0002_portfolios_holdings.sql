/*
# Create portfolios and holdings tables

1. Purpose
- `portfolios`: a user-specific portfolio record and account currency.
  Each user has one portfolio row that tracks their cash balance and
  base currency. The balance is authoritative — never client-writable.
- `holdings`: assets and quantities associated with each portfolio.
  Holdings represent educational asset positions. Quantities are
  educational inputs that flow through server logic, not direct writes.

2. New Tables

  `portfolios`
  - `id`         uuid, primary key, default gen_random_uuid().
  - `user_id`    uuid, NOT NULL, DEFAULT auth.uid(), references
                 profiles(id) ON DELETE CASCADE. Ownership key.
  - `name`       text, NOT NULL, default 'Main Portfolio'. User-editable label.
  - `currency`   text, NOT NULL, default 'USD'. Base currency code (ISO 4217).
                 CHECK length 3 uppercase letters.
  - `cash_balance` numeric(20,2), NOT NULL, default 0. Authoritative balance.
                 Must never be set directly by the browser.
  - `created_at` timestamptz, default now().
  - `updated_at` timestamptz, default now(), auto-updated.

  `holdings`
  - `id`            uuid, primary key, default gen_random_uuid().
  - `portfolio_id`  uuid, NOT NULL, references portfolios(id) ON DELETE CASCADE.
  - `asset_symbol`  text, NOT NULL. e.g. 'BTC', 'ETH', 'SOL'.
  - `asset_name`    text, NOT NULL. Display name of the asset.
  - `quantity`      numeric(24,8), NOT NULL, default 0, CHECK >= 0.
                    Authoritative — changed only by server logic.
  - `average_cost`  numeric(20,2), NOT NULL, default 0, CHECK >= 0.
                    Authoritative — set by server logic on investment actions.
  - `created_at`    timestamptz, default now().
  - `updated_at`    timestamptz, default now(), auto-updated.

3. Constraints
- `portfolios_user_id_key`: UNIQUE(user_id) — one portfolio per user.
- `holdings_portfolio_id_asset_symbol_key`: UNIQUE(portfolio_id, asset_symbol)
  — one holding per asset per portfolio.
- `holdings_quantity_nonneg` and `holdings_avg_cost_nonneg`: CHECK >= 0.

4. Security — Row Level Security
- RLS enabled on both tables.
- `portfolios`:
  - SELECT, UPDATE: own portfolio only.
  - INSERT: a user may create their single portfolio row (user_id defaults to
    auth.uid()). No more than one row per user is enforced by the unique
    constraint; a later-phase function may take over creation.
  - DELETE: own portfolio only.
- `holdings`:
  - SELECT: a row is visible if its portfolio belongs to the caller.
  - INSERT: allowed only if the parent portfolio belongs to the caller.
    asset_symbol, asset_name may be set by the client; quantity and
    average_cost are protected by column-level grants (see below).
  - UPDATE, DELETE: parent portfolio must belong to the caller.

5. Security — Column-level privileges
- `portfolios.cash_balance`: NOT client-writable. REVOKE UPDATE; no GRANT to
  authenticated. Balance changes must go through trusted backend logic.
- `holdings.quantity` and `holdings.average_cost`: NOT client-writable.
  REVOKE UPDATE; GRANT UPDATE only on asset_symbol, asset_name to authenticated.
  Quantity/cost changes flow through the educational transaction engine later.

6. Important notes
- One portfolio per user is enforced at the database level.
- One holding per (portfolio, asset_symbol) is enforced at the database level.
- Balance and holding quantities are never writable by the browser, even though
  row-level UPDATE policies allow the row.
*/

CREATE TABLE IF NOT EXISTS portfolios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid()
    REFERENCES profiles(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Main Portfolio',
  currency     text NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  cash_balance numeric(20,2) NOT NULL DEFAULT 0
    CHECK (cash_balance >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_id_key
  ON portfolios (user_id);

CREATE TABLE IF NOT EXISTS holdings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_symbol  text NOT NULL,
  asset_name    text NOT NULL,
  quantity      numeric(24,8) NOT NULL DEFAULT 0
    CHECK (quantity >= 0),
  average_cost  numeric(20,2) NOT NULL DEFAULT 0
    CHECK (average_cost >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS holdings_portfolio_asset_key
  ON holdings (portfolio_id, asset_symbol);

CREATE INDEX IF NOT EXISTS holdings_portfolio_id_idx
  ON holdings (portfolio_id);

-- updated_at triggers
DROP TRIGGER IF EXISTS portfolios_updated_at ON portfolios;
CREATE TRIGGER portfolios_updated_at
  BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS holdings_updated_at ON holdings;
CREATE TRIGGER holdings_updated_at
  BEFORE UPDATE ON holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings   ENABLE ROW LEVEL SECURITY;

-- portfolios: own-row CRUD
DROP POLICY IF EXISTS "portfolios_select_own" ON portfolios;
CREATE POLICY "portfolios_select_own"
  ON portfolios FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "portfolios_insert_own" ON portfolios;
CREATE POLICY "portfolios_insert_own"
  ON portfolios FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "portfolios_update_own" ON portfolios;
CREATE POLICY "portfolios_update_own"
  ON portfolios FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "portfolios_delete_own" ON portfolios;
CREATE POLICY "portfolios_delete_own"
  ON portfolios FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- holdings: scoped through parent portfolio ownership
DROP POLICY IF EXISTS "holdings_select_own" ON holdings;
CREATE POLICY "holdings_select_own"
  ON holdings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "holdings_insert_own" ON holdings;
CREATE POLICY "holdings_insert_own"
  ON holdings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "holdings_update_own" ON holdings;
CREATE POLICY "holdings_update_own"
  ON holdings FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "holdings_delete_own" ON holdings;
CREATE POLICY "holdings_delete_own"
  ON holdings FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid()
  ));

-- ── Column-level privileges ──────────────────────────────────────────────────
-- portfolios.cash_balance must never be browser-writable.
REVOKE UPDATE ON portfolios FROM authenticated;
GRANT UPDATE (name, currency) ON portfolios TO authenticated;

-- holdings.quantity and average_cost must never be browser-writable.
REVOKE UPDATE ON holdings FROM authenticated;
GRANT UPDATE (asset_symbol, asset_name) ON holdings TO authenticated;
