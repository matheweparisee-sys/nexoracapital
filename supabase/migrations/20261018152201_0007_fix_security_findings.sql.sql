/*
# Fix security advisor findings from Category 4

1. generate_reference() — pin search_path to public (mutable search_path warning).
2. handle_new_portfolio() — revoke EXECUTE from anon so the SECURITY DEFINER
   trigger function cannot be called via the public RPC endpoint. The
   on_profile_created trigger still runs it internally.
3. set_transaction_reference() / set_investment_reference() — already have
   SET search_path = public, no change needed.

These are hardening fixes only — no schema, policy, or data changes.
*/

CREATE OR REPLACE FUNCTION generate_reference(prefix text DEFAULT 'TX')
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT upper(prefix) || '-' ||
    lpad(floor(random() * 1000000)::text, 6, '0') ||
    chr(65 + floor(random() * 26)::int) ||
    chr(65 + floor(random() * 26)::int)
$$;

REVOKE EXECUTE ON FUNCTION handle_new_portfolio() FROM anon, PUBLIC;
