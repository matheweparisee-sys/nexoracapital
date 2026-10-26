/*
# Admin BTC address config + updated submit_deposit

## 1. admin_update_btc_address(p_address text)
SECURITY DEFINER. Allows an admin to set or clear the Bitcoin receiving
wallet address shown to customers on the deposit form. Rejects non-admins.
Validates that the address looks like a Bitcoin address (basic length +
character set check for legacy/SegWit/Bech32). Stores the address in
app_settings and records who updated it.

## 2. submit_deposit(p_amount, p_description, p_tx_hash, p_receipt_path)
Updated version of the existing submit_deposit function. Adds two optional
parameters for the BTC transaction hash and the storage path of an uploaded
receipt. Behavior is otherwise identical to the existing function: validates
amount, resolves the caller's portfolio via ensure_portfolio(), inserts a
'pending' transaction, and records an audit entry. No balance is credited.

The old signature (p_amount, p_description) is preserved by giving the new
parameters NULL defaults, so existing callers that omit them still work.
*/

-- ─── Admin: set BTC receiving address ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_btc_address(p_address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_addr text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can update the BTC receiving address';
  END IF;

  -- Normalize: trim, collapse internal spaces. NULL or empty string clears it.
  v_addr := NULLIF(TRIM(p_address), '');

  -- Basic Bitcoin address validation: 26-62 chars, base58 or bech32 charset.
  -- Legacy (1/3): base58, 26-35 chars. SegWit (bc1): bech32, up to 62 chars.
  IF v_addr IS NOT NULL THEN
    IF NOT (
      v_addr ~ '^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$'
      OR v_addr ~ '^bc1[a-z0-9]{6,58}$'
    ) THEN
      RAISE EXCEPTION 'That does not look like a valid Bitcoin address';
    END IF;
  END IF;

  UPDATE app_settings
  SET btc_receive_address = v_addr,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_btc_address(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_btc_address(text) TO authenticated;

-- ─── Updated submit_deposit with tx_hash + receipt_path ───────────────────
CREATE OR REPLACE FUNCTION public.submit_deposit(
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_tx_hash text DEFAULT NULL,
  p_receipt_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_tx_id uuid;
  v_tx_hash text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be greater than zero';
  END IF;
  IF p_amount > 100000000 THEN
    RAISE EXCEPTION 'Deposit amount is too large';
  END IF;

  -- Normalize tx_hash: trim, lowercase. Null/empty -> NULL.
  v_tx_hash := NULLIF(LOWER(TRIM(p_tx_hash)), '');
  IF v_tx_hash IS NOT NULL AND LENGTH(v_tx_hash) > 128 THEN
    RAISE EXCEPTION 'Transaction hash is too long';
  END IF;
  IF v_tx_hash IS NOT NULL AND v_tx_hash !~ '^[0-9a-f]+$' THEN
    RAISE EXCEPTION 'Transaction hash may only contain hexadecimal characters';
  END IF;

  v_portfolio_id := public.ensure_portfolio();

  INSERT INTO transactions (portfolio_id, type, amount, description, tx_hash, receipt_path, status)
  VALUES (v_portfolio_id, 'deposit', p_amount, p_description, v_tx_hash, p_receipt_path, 'pending')
  RETURNING id INTO v_tx_id;

  PERFORM public.record_audit('transaction', v_tx_id, NULL, 'pending', auth.uid(), 'customer');

  RETURN v_tx_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_deposit(numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_deposit(numeric, text, text, text) TO authenticated;
