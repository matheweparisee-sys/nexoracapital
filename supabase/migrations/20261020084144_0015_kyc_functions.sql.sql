/*
# KYC functions and enforcement

## 1. submit_kyc(p_legal_name, p_date_of_birth, p_country, p_document_type, p_document_path)
SECURITY DEFINER. Called by the authenticated customer. Inserts a new KYC
application with status='pending'. If the user already has a pending
application, the partial unique index raises an error which the function
catches and re-raises as a clear message. Also updates profiles.kyc_status
to 'pending'.

## 2. admin_review_kyc(p_application_id, p_decision, p_feedback)
SECURITY DEFINER. Admin-only. p_decision is 'approved', 'rejected', or
'resubmission_required'. Updates the application's status, sets reviewed_by
and reviewed_at, stores admin_feedback. Also syncs profiles.kyc_status:
- approved -> 'verified'
- rejected -> 'rejected'
- resubmission_required -> 'resubmission'

## 3. Updated submit_investment — KYC check
Adds a check: the caller's profile.kyc_status must be 'verified'. If not,
raises an exception 'KYC verification required before investing. Please
complete identity verification.' This is enforced server-side so customers
cannot bypass it by calling the function directly.

## 4. Updated submit_withdrawal — KYC check
Same check: kyc_status must be 'verified' or raises an exception.

## Security
- submit_kyc is not SECURITY DEFINER — it runs as the caller, so RLS applies.
  The partial unique index prevents duplicates.
- admin_review_kyc is SECURITY DEFINER and checks is_admin().
- The KYC check in submit_investment/submit_withdrawal reads profiles.kyc_status
  directly from the database — not from the client.
*/

-- ─── submit_kyc ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_kyc(
  p_legal_name text,
  p_date_of_birth date,
  p_country text,
  p_document_type text,
  p_document_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id uuid;
BEGIN
  IF p_legal_name IS NULL OR trim(p_legal_name) = '' THEN
    RAISE EXCEPTION 'Legal name is required';
  END IF;
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'Date of birth is required';
  END IF;
  IF p_country IS NULL OR trim(p_country) = '' THEN
    RAISE EXCEPTION 'Country of residence is required';
  END IF;
  IF p_document_type NOT IN ('passport', 'drivers_license', 'national_id', 'residence_permit') THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;
  IF p_document_path IS NULL OR trim(p_document_path) = '' THEN
    RAISE EXCEPTION 'Identity document is required';
  END IF;

  INSERT INTO kyc_applications (user_id, legal_name, date_of_birth, country, document_type, document_path, status)
  VALUES (auth.uid(), p_legal_name, p_date_of_birth, p_country, p_document_type, p_document_path, 'pending')
  RETURNING id INTO v_app_id;

  -- Sync profile kyc_status
  UPDATE profiles SET kyc_status = 'pending', updated_at = now() WHERE id = auth.uid();

  RETURN v_app_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_kyc(text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_kyc(text, date, text, text, text) TO authenticated;

-- ─── admin_review_kyc ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_review_kyc(
  p_application_id uuid,
  p_decision text,
  p_feedback text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app record;
  v_profile_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can review KYC applications';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'resubmission_required') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  SELECT * INTO v_app FROM kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KYC application not found';
  END IF;
  IF v_app.status != 'pending' THEN
    RAISE EXCEPTION 'This application has already been reviewed';
  END IF;

  v_profile_status := CASE p_decision
    WHEN 'approved' THEN 'verified'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'resubmission_required' THEN 'resubmission'
  END;

  UPDATE kyc_applications
  SET status = p_decision,
      admin_feedback = p_feedback,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE profiles
  SET kyc_status = v_profile_status,
      updated_at = now()
  WHERE id = v_app.user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_kyc(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_kyc(uuid, text, text) TO authenticated;

-- ─── Updated submit_investment with KYC check ─────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_investment(p_plan_id uuid, p_amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_inv_id uuid;
  v_balance numeric;
  v_plan record;
  v_kyc_status text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Investment amount must be greater than zero';
  END IF;
  SELECT kyc_status INTO v_kyc_status FROM profiles WHERE id = auth.uid();
  IF v_kyc_status IS NULL OR v_kyc_status != 'verified' THEN
    RAISE EXCEPTION 'KYC verification required before investing. Please complete identity verification.';
  END IF;
  SELECT * INTO v_plan FROM investment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected investment plan was not found';
  END IF;
  IF NOT v_plan.is_active THEN
    RAISE EXCEPTION 'This investment plan is not currently available';
  END IF;
  IF p_amount < v_plan.min_amount THEN
    RAISE EXCEPTION 'Amount is below the plan minimum of %', v_plan.min_amount;
  END IF;
  v_portfolio_id := ensure_portfolio();
  SELECT cash_balance INTO v_balance FROM portfolios
  WHERE id = v_portfolio_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance for this investment';
  END IF;
  INSERT INTO investments (portfolio_id, plan_id, amount, status)
  VALUES (v_portfolio_id, p_plan_id, p_amount, 'pending')
  RETURNING id INTO v_inv_id;
  PERFORM record_audit('investment', v_inv_id, NULL, 'pending', auth.uid(), 'customer');
  RETURN v_inv_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_investment(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_investment(uuid, numeric) TO authenticated;

-- ─── Updated submit_withdrawal with KYC check ─────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_withdrawal(p_amount numeric, p_description text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_tx_id uuid;
  v_balance numeric;
  v_kyc_status text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
  END IF;
  SELECT kyc_status INTO v_kyc_status FROM profiles WHERE id = auth.uid();
  IF v_kyc_status IS NULL OR v_kyc_status != 'verified' THEN
    RAISE EXCEPTION 'KYC verification required before withdrawing. Please complete identity verification.';
  END IF;
  v_portfolio_id := ensure_portfolio();
  SELECT cash_balance INTO v_balance FROM portfolios
  WHERE id = v_portfolio_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance for this withdrawal';
  END IF;
  INSERT INTO transactions (portfolio_id, type, amount, description, status)
  VALUES (v_portfolio_id, 'withdrawal', p_amount, p_description, 'pending')
  RETURNING id INTO v_tx_id;
  PERFORM record_audit('transaction', v_tx_id, NULL, 'pending', auth.uid(), 'customer');
  RETURN v_tx_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_withdrawal(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_withdrawal(numeric, text) TO authenticated;
