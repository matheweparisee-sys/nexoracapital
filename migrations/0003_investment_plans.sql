/*
# Create investment_plans table

1. Purpose
- Stores the catalog of available educational investment plans and their
  displayed terms (target return, duration, risk level, description).
- These are reference/data rows shown to users in the Investments area.
- Plan terms are defined by operators, not by users. Only an admin should
  create or modify plans; in this phase we enforce read access for everyone
  who is signed in and block browser writes entirely (writes will go through
  an admin SECURITY DEFINER function in a later phase).

2. New Table
- `investment_plans`
  - `id`             uuid, primary key, default gen_random_uuid().
  - `name`           text, NOT NULL. Plan name.
  - `description`    text, nullable. Educational description.
  - `target_return`  numeric(5,2), nullable. Annualized target return %.
                     CHECK between -100 and 1000.
  - `duration_days`  integer, nullable. Suggested educational duration.
                     CHECK > 0.
  - `risk_level`     text, NOT NULL, default 'moderate'. One of
                     'conservative' | 'moderate' | 'aggressive'.
  - `min_amount`     numeric(20,2), NOT NULL, default 0, CHECK >= 0.
                     Minimum educational allocation amount.
  - `is_active`      boolean, NOT NULL, default true. Operator toggle.
  - `created_at`     timestamptz, default now().
  - `updated_at`     timestamptz, default now(), auto-updated.

3. Security — Row Level Security
- RLS enabled on `investment_plans`.
- SELECT: any authenticated user can read active and inactive plans (the
  frontend can choose to filter inactive rows). Plans are reference data.
- INSERT / UPDATE / DELETE: no policies are created in this phase, so browser
  writes are blocked by RLS. Plan management will be handled by an admin
  SECURITY DEFINER function in the admin-dashboard phase.

4. Important notes
- Plans are educational reference data, not tradable instruments.
- No client-writable path exists for plan terms.
- Seed data is intentionally NOT added in this phase to avoid fabricating
  financial products before the admin workflow exists.
*/

CREATE TABLE IF NOT EXISTS investment_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  description    text,
  target_return  numeric(5,2)
    CHECK (target_return IS NULL OR (target_return >= -100 AND target_return <= 1000)),
  duration_days  integer
    CHECK (duration_days IS NULL OR duration_days > 0),
  risk_level     text NOT NULL DEFAULT 'moderate'
    CHECK (risk_level IN ('conservative', 'moderate', 'aggressive')),
  min_amount     numeric(20,2) NOT NULL DEFAULT 0
    CHECK (min_amount >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS investment_plans_updated_at ON investment_plans;
CREATE TRIGGER investment_plans_updated_at
  BEFORE UPDATE ON investment_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE investment_plans ENABLE ROW LEVEL SECURITY;

-- Read-only for all authenticated users. No write policies in this phase.
DROP POLICY IF EXISTS "investment_plans_select_all" ON investment_plans;
CREATE POLICY "investment_plans_select_all"
  ON investment_plans FOR SELECT TO authenticated
  USING (true);
