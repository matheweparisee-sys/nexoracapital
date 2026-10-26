/*
# Investment plans with guaranteed fixed returns

## Purpose
Add the four investment plans (Starter, Silver, Gold, Platinum) with fixed
return rates, duration, payment schedules, and maturity conditions. Add a
return-credits ledger table to record every return payment with full audit
information, preventing duplicate credits.

## 1. New columns on investment_plans
- `max_amount` (numeric, nullable) — maximum investment allowed.
- `fixed_return_rate` (numeric, NOT NULL, default 0) — annualized fixed return
  rate as a percentage (e.g. 12.0 = 12% APY).
- `payment_schedule` (text, NOT NULL, default 'maturity') — 'maturity' or
  'monthly'.
- `return_calc_method` (text, NOT NULL, default 'simple') — calculation method.

## 2. New table: return_credits
Ledger of every return payment. UNIQUE(investment_id, period_number,
credit_type) prevents duplicate credits. RLS: customers SELECT own, admins
SELECT all, no customer writes.

## 3. New columns on investments
- `expected_return` — calculated at activation.
- `maturity_date` — started_at + duration_days.
- `returns_credited` — running total of credits (server-maintained).

## 4. Unique constraint on investment_plans.name
Added so the seed can use ON CONFLICT (name) for idempotent upserts.

## 5. Seed four plans
- Starter:  $100–$1,000, 30 days, 8% APY, maturity, simple
- Silver:   $1,000–$10,000, 90 days, 12% APY, monthly, simple
- Gold:     $10,000–$50,000, 180 days, 18% APY, monthly, simple
- Platinum: $50,000–$500,000, 365 days, 24% APY, maturity, simple
*/

-- ─── Unique constraint on investment_plans.name ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'investment_plans_name_key'
                   AND conrelid = 'investment_plans'::regclass) THEN
    ALTER TABLE investment_plans ADD CONSTRAINT investment_plans_name_key UNIQUE (name);
  END IF;
END $$;

-- ─── New columns on investment_plans ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investment_plans'
                   AND column_name = 'max_amount') THEN
    ALTER TABLE investment_plans ADD COLUMN max_amount numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investment_plans'
                   AND column_name = 'fixed_return_rate') THEN
    ALTER TABLE investment_plans ADD COLUMN fixed_return_rate numeric NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investment_plans'
                   AND column_name = 'payment_schedule') THEN
    ALTER TABLE investment_plans ADD COLUMN payment_schedule text NOT NULL DEFAULT 'maturity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investment_plans'
                   AND column_name = 'return_calc_method') THEN
    ALTER TABLE investment_plans ADD COLUMN return_calc_method text NOT NULL DEFAULT 'simple';
  END IF;
END $$;

-- ─── New columns on investments ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investments'
                   AND column_name = 'expected_return') THEN
    ALTER TABLE investments ADD COLUMN expected_return numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investments'
                   AND column_name = 'maturity_date') THEN
    ALTER TABLE investments ADD COLUMN maturity_date timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'investments'
                   AND column_name = 'returns_credited') THEN
    ALTER TABLE investments ADD COLUMN returns_credited numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ─── return_credits ledger table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id uuid NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  credit_type text NOT NULL DEFAULT 'return' CHECK (credit_type IN ('return', 'principal')),
  period_number int NOT NULL DEFAULT 1,
  credit_date timestamptz NOT NULL DEFAULT now(),
  credited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(investment_id, period_number, credit_type)
);

ALTER TABLE return_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_credits_select_own" ON return_credits;
CREATE POLICY "return_credits_select_own" ON return_credits
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = return_credits.portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "return_credits_select_admin" ON return_credits;
CREATE POLICY "return_credits_select_admin" ON return_credits
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─── Seed the four plans (idempotent via ON CONFLICT) ─────────────────────
INSERT INTO investment_plans (name, description, target_return, fixed_return_rate, duration_days, risk_level, min_amount, max_amount, payment_schedule, return_calc_method, is_active)
VALUES
  ('Starter Plan',
   'A beginner-friendly plan with a short commitment and a guaranteed fixed return paid at maturity. Ideal for first-time investors looking to grow their capital with minimal risk over 30 days. Principal is returned at maturity alongside the earned return.',
   8.0, 8.0, 30, 'conservative', 100, 1000, 'maturity', 'simple', true),
  ('Silver Plan',
   'A balanced plan offering a competitive fixed return with monthly payments. Designed for investors ready to commit to a 90-day term with steady income throughout the period. Principal is returned at maturity.',
   12.0, 12.0, 90, 'moderate', 1000, 10000, 'monthly', 'simple', true),
  ('Gold Plan',
   'A premium plan with an enhanced fixed return rate and monthly payments over a 180-day term. Suited for experienced investors seeking higher yields with disciplined capital allocation. Principal is returned at maturity.',
   18.0, 18.0, 180, 'moderate', 10000, 50000, 'monthly', 'simple', true),
  ('Platinum Plan',
   'The flagship plan with the highest fixed return, paid as a lump sum at maturity. A 365-day commitment for substantial capital, designed for long-term wealth growth. Principal and full return are paid together at maturity.',
   24.0, 24.0, 365, 'aggressive', 50000, 500000, 'maturity', 'simple', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  target_return = EXCLUDED.target_return,
  fixed_return_rate = EXCLUDED.fixed_return_rate,
  duration_days = EXCLUDED.duration_days,
  risk_level = EXCLUDED.risk_level,
  min_amount = EXCLUDED.min_amount,
  max_amount = EXCLUDED.max_amount,
  payment_schedule = EXCLUDED.payment_schedule,
  return_calc_method = EXCLUDED.return_calc_method,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ─── Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_return_credits_investment ON return_credits(investment_id);
CREATE INDEX IF NOT EXISTS idx_return_credits_portfolio ON return_credits(portfolio_id);
