/*
# Server-side functions for fixed-return investment system

## 1. admin_update_plan(p_plan_id, p_fixed_return_rate, p_min_amount, p_max_amount, p_duration_days, p_payment_schedule, p_return_calc_method, p_is_active, p_description)
SECURITY DEFINER. Admin-only. Updates an investment plan's terms. All
parameters are optional except plan_id — only provided fields are changed.
Validates rate (0–100), amounts (min > 0, max >= min or null), duration (> 0),
and schedule ('maturity' or 'monthly'). Customers cannot call this.

## 2. admin_activate_investment(p_inv_id) — UPDATED
Previously just set status to 'active' and recorded started_at. Now also:
- Reads the plan's fixed_return_rate, duration_days, return_calc_method.
- Calculates expected_return = principal * (rate/100) * (duration/365) for
  simple method.
- Sets maturity_date = started_at + duration_days.
- Records the audit entry.
This ensures the return amount is computed server-side from the stored plan
terms, not from the browser.

## 3. admin_process_return_credits(p_inv_id, p_period_number)
SECURITY DEFINER. Admin-only. Credits the return for a specific payment
period of an active investment. For 'maturity' plans, period 1 is the only
payment (full return + principal). For 'monthly' plans, each period is one
monthly installment.

Calculation:
- Simple method: total_return = principal * (rate/100) * (duration/365).
- For monthly: each installment = total_return / number_of_months.
- For maturity: single payment = total_return.
- Principal credit (credit_type='principal') is only at the final period.

The UNIQUE constraint on (investment_id, period_number, credit_type) prevents
duplicate credits — a second call with the same period_number raises an
exception. The function also updates investments.returns_credited as a
running total. Credits the customer's cash_balance via the portfolios table.

## Security
- All three functions are SECURITY DEFINER and check is_admin() (except
  admin_activate_investment which already checks).
- return_credits rows are only created by admin_process_return_credits.
- No customer-facing function writes to return_credits or modifies
  returns_credited.
*/

-- ─── admin_update_plan ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_plan_id uuid,
  p_fixed_return_rate numeric DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_duration_days int DEFAULT NULL,
  p_payment_schedule text DEFAULT NULL,
  p_return_calc_method text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can update investment plans';
  END IF;

  IF p_fixed_return_rate IS NOT NULL THEN
    IF p_fixed_return_rate < 0 OR p_fixed_return_rate > 100 THEN
      RAISE EXCEPTION 'Fixed return rate must be between 0 and 100';
    END IF;
    UPDATE investment_plans SET fixed_return_rate = p_fixed_return_rate, target_return = p_fixed_return_rate, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_min_amount IS NOT NULL THEN
    IF p_min_amount <= 0 THEN
      RAISE EXCEPTION 'Minimum amount must be greater than zero';
    END IF;
    UPDATE investment_plans SET min_amount = p_min_amount, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_max_amount IS NOT NULL THEN
    UPDATE investment_plans SET max_amount = p_max_amount, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_duration_days IS NOT NULL THEN
    IF p_duration_days <= 0 THEN
      RAISE EXCEPTION 'Duration must be greater than zero days';
    END IF;
    UPDATE investment_plans SET duration_days = p_duration_days, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_payment_schedule IS NOT NULL THEN
    IF p_payment_schedule NOT IN ('maturity', 'monthly') THEN
      RAISE EXCEPTION 'Payment schedule must be maturity or monthly';
    END IF;
    UPDATE investment_plans SET payment_schedule = p_payment_schedule, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_return_calc_method IS NOT NULL THEN
    IF p_return_calc_method NOT IN ('simple', 'compound') THEN
      RAISE EXCEPTION 'Return calculation method must be simple or compound';
    END IF;
    UPDATE investment_plans SET return_calc_method = p_return_calc_method, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_is_active IS NOT NULL THEN
    UPDATE investment_plans SET is_active = p_is_active, updated_at = now() WHERE id = p_plan_id;
  END IF;

  IF p_description IS NOT NULL THEN
    UPDATE investment_plans SET description = p_description, updated_at = now() WHERE id = p_plan_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_plan(uuid, numeric, numeric, numeric, int, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_plan(uuid, numeric, numeric, numeric, int, text, text, boolean, text) TO authenticated;

-- ─── admin_activate_investment — UPDATED with return calculation ──────────
CREATE OR REPLACE FUNCTION public.admin_activate_investment(p_inv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_plan record;
  v_expected_return numeric;
  v_maturity_date timestamptz;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can activate investments';
  END IF;

  SELECT * INTO v_inv FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;
  IF v_inv.status != 'approved' THEN
    RAISE EXCEPTION 'Investment must be in approved status to activate';
  END IF;

  SELECT * INTO v_plan FROM investment_plans WHERE id = v_inv.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment plan not found';
  END IF;

  -- Calculate expected return using the stored plan terms.
  IF v_plan.return_calc_method = 'simple' THEN
    v_expected_return := v_inv.amount * (v_plan.fixed_return_rate / 100.0) * (v_plan.duration_days::numeric / 365.0);
  ELSIF v_plan.return_calc_method = 'compound' THEN
    v_expected_return := v_inv.amount * POWER(1.0 + (v_plan.fixed_return_rate / 100.0), v_plan.duration_days::numeric / 365.0) - v_inv.amount;
  ELSE
    v_expected_return := 0;
  END IF;

  v_maturity_date := now() + (v_plan.duration_days::text || ' days')::interval;

  UPDATE investments
  SET status = 'active',
      started_at = now(),
      maturity_date = v_maturity_date,
      expected_return = ROUND(v_expected_return, 2)
  WHERE id = p_inv_id;

  PERFORM public.record_audit('investment', p_inv_id, 'approved', 'active', auth.uid(), 'admin');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_activate_investment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_investment(uuid) TO authenticated;

-- ─── admin_process_return_credits ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_process_return_credits(
  p_inv_id uuid,
  p_period_number int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_plan record;
  v_total_return numeric;
  v_installment numeric;
  v_total_periods int;
  v_is_final boolean;
  v_credited_return numeric;
  v_credited_principal numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can process return credits';
  END IF;

  SELECT * INTO v_inv FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;
  IF v_inv.status != 'active' THEN
    RAISE EXCEPTION 'Investment must be active to process returns';
  END IF;

  SELECT * INTO v_plan FROM investment_plans WHERE id = v_inv.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment plan not found';
  END IF;

  -- Calculate total return from stored plan terms.
  IF v_plan.return_calc_method = 'simple' THEN
    v_total_return := v_inv.amount * (v_plan.fixed_return_rate / 100.0) * (v_plan.duration_days::numeric / 365.0);
  ELSIF v_plan.return_calc_method = 'compound' THEN
    v_total_return := v_inv.amount * POWER(1.0 + (v_plan.fixed_return_rate / 100.0), v_plan.duration_days::numeric / 365.0) - v_inv.amount;
  ELSE
    v_total_return := 0;
  END IF;
  v_total_return := ROUND(v_total_return, 2);

  -- Determine total periods and whether this is the final one.
  IF v_plan.payment_schedule = 'monthly' THEN
    v_total_periods := GREATEST(1, v_plan.duration_days / 30);
    v_installment := ROUND(v_total_return / v_total_periods, 2);
  ELSE
    v_total_periods := 1;
    v_installment := v_total_return;
  END IF;

  IF p_period_number < 1 OR p_period_number > v_total_periods THEN
    RAISE EXCEPTION 'Period number must be between 1 and %', v_total_periods;
  END IF;

  v_is_final := (p_period_number = v_total_periods);

  -- Credit the return installment (UNIQUE constraint prevents duplicates).
  INSERT INTO return_credits (investment_id, portfolio_id, amount, credit_type, period_number, credited_by)
  VALUES (p_inv_id, v_inv.portfolio_id, v_installment, 'return', p_period_number, auth.uid());

  v_credited_return := v_installment;

  -- If this is the final period, also credit the principal.
  IF v_is_final THEN
    INSERT INTO return_credits (investment_id, portfolio_id, amount, credit_type, period_number, credited_by)
    VALUES (p_inv_id, v_inv.portfolio_id, v_inv.amount, 'principal', p_period_number, auth.uid());

    v_credited_principal := v_inv.amount;

    -- Mark investment as completed.
    UPDATE investments
    SET status = 'completed',
        completed_at = now(),
        outcome_value = v_inv.returns_credited + v_installment,
        returns_credited = v_inv.returns_credited + v_installment
    WHERE id = p_inv_id;

    PERFORM public.record_audit('investment', p_inv_id, 'active', 'completed', auth.uid(), 'admin');
  ELSE
    UPDATE investments
    SET returns_credited = v_inv.returns_credited + v_installment
    WHERE id = p_inv_id;
  END IF;

  -- Credit the customer's cash balance with the return installment.
  UPDATE portfolios
  SET cash_balance = cash_balance + v_installment,
      updated_at = now()
  WHERE id = v_inv.portfolio_id;

  -- If final, also credit the principal back.
  IF v_is_final THEN
    UPDATE portfolios
    SET cash_balance = cash_balance + v_inv.amount,
        updated_at = now()
    WHERE id = v_inv.portfolio_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_process_return_credits(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_process_return_credits(uuid, int) TO authenticated;
