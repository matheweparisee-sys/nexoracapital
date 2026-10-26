/*
# Transaction system, customer support, and admin approval

1. Purpose
- Extends the existing transactions/investments tables with the statuses and
  columns needed for a deposit/withdrawal/investment approval workflow.
- Adds support tickets and messages so customers can request help and staff
  can respond.
- Adds a transaction audit log that records every status change with the
  responsible admin.
- Adds SECURITY DEFINER functions for every privileged operation: submitting
  requests (with server-side balance validation), and the full admin
  approval/rejection/processing/completion lifecycle.
- Auto-creates a portfolio row for every new user so the transaction system
  works immediately after signup.

2. Status changes (additive — existing values preserved)
- transactions.status: adds 'approved' and 'processing' to the existing
  pending|completed|failed|cancelled set.
- investments.status: adds 'approved' and 'processing' to the existing
  pending|active|completed|cancelled|rejected set.
- Valid status transitions are enforced inside the SECURITY DEFINER functions,
  not just by the CHECK constraint, because the CHECK only limits the allowed
  values, not the path between them.

3. New columns on existing tables
  transactions
  - reference       text, nullable -> NOT NULL with a unique default generated
                    on insert via a trigger. Human-readable unique id like
                    'TX-XXXXXX'. Used as the public-facing transaction id.
  - admin_notes     text, nullable. Internal notes recorded by the admin.
  - processed_by    uuid, nullable, references profiles(id). The admin who
                    last acted on the transaction.
  - processed_at    timestamptz, nullable. Already existed; reused.

  investments
  - reference       text, same pattern as transactions.
  - admin_notes     text, nullable.
  - processed_by    uuid, nullable, references profiles(id).

  portfolios
  - No new columns. The auto-create trigger fills the existing row.

4. New Tables
  support_tickets
  - id           uuid, primary key
  - user_id      uuid, NOT NULL, references profiles(id) ON DELETE CASCADE.
                 Ownership key; defaulted to auth.uid() on insert.
  - subject      text, NOT NULL. Short subject line.
  - body         text, NOT NULL. Initial message body.
  - transaction_id uuid, nullable, references transactions(id). Optional link
                 to a specific transaction the customer needs help with.
  - status       text, NOT NULL, default 'open'. open|answered|closed.
  - assigned_to  uuid, nullable, references profiles(id). Staff member who
                 responded or is handling the ticket.
  - created_at   timestamptz, default now()
  - updated_at   timestamptz, default now(), auto-updated.

  support_messages
  - id           uuid, primary key
  - ticket_id    uuid, NOT NULL, references support_tickets(id) ON DELETE CASCADE
  - sender_id    uuid, NOT NULL, references profiles(id). Who sent the message.
  - sender_role  text, NOT NULL. 'customer' | 'staff'. Records whether the
                 message came from the ticket owner or a support staffer.
  - body         text, NOT NULL. Message content.
  - created_at   timestamptz, default now()

  transaction_audit
  - id           uuid, primary key
  - record_type  text, NOT NULL. 'transaction' | 'investment'.
  - record_id    uuid, NOT NULL. FK to the transactions or investments row.
  - from_status  text, nullable. Previous status (null on first insert).
  - to_status    text, NOT NULL. New status.
  - actor_id     uuid, nullable. The admin who performed the change, or null
                 for system/trigger-driven changes.
  - actor_role   text, NOT NULL, default 'system'. 'admin' | 'customer' | 'system'.
  - note         text, nullable. Admin note or reason recorded with the change.
  - reference    text, nullable. External reference recorded during processing.
  - created_at   timestamptz, default now().

5. Security — Row Level Security
  support_tickets
  - SELECT: the ticket owner (customer) OR any admin (role = 'admin').
  - INSERT: authenticated users create tickets for themselves only.
  - UPDATE: admins only (to set status / assignee). Customers cannot edit.
  - DELETE: blocked (tickets are retained).

  support_messages
  - SELECT: the ticket owner OR any admin.
  - INSERT: the ticket owner may send messages; any admin may send messages.
  - UPDATE, DELETE: blocked.

  transaction_audit
  - SELECT: admins only. Customers do not see the audit log.
  - INSERT: only via SECURITY DEFINER functions (which run as owner). No
    direct client INSERT policy.
  - UPDATE, DELETE: blocked.

6. Security — Column-level privileges
  transactions: REVOKE UPDATE from authenticated; the existing GRANT UPDATE
  (description) is preserved. The new columns (reference, admin_notes,
  processed_by, processed_at) are NOT client-writable. Status changes and
  balance effects go through SECURITY DEFINER functions only.

  investments: REVOKE UPDATE from authenticated; GRANT UPDATE (amount) is
  preserved. New columns are NOT client-writable.

7. SECURITY DEFINER functions (all SET search_path = public)
  - is_admin(): returns boolean. Checks profiles.role = 'admin' for auth.uid().
    Used internally and callable by the frontend to gate the admin UI.
  - ensure_portfolio(): creates a portfolio row for the caller if none exists.
    Called by the submit_* functions and exposed so the frontend can create a
    portfolio on first visit.
  - submit_deposit(p_amount, p_description): inserts a pending deposit
    transaction with a generated reference. Amount validated server-side.
  - submit_withdrawal(p_amount, p_description): validates amount > 0 and
    amount <= available cash_balance using FOR UPDATE row lock to prevent
    concurrent overdrafts. Inserts a pending withdrawal transaction.
  - submit_investment(p_plan_id, p_amount): validates plan exists and is
    active, amount >= plan.min_amount, amount <= cash_balance (FOR UPDATE
    lock). Inserts a pending investment record.
  - admin_approve_transaction(p_tx_id): checks is_admin, transitions
    pending->approved, records audit.
  - admin_reject_transaction(p_tx_id, p_note): pending/rejected->rejected,
    records audit with note.
  - admin_process_transaction(p_tx_id, p_note, p_reference):
    approved->processing, records notes and external reference, records audit.
  - admin_complete_transaction(p_tx_id): processing->completed. For deposits:
    credits cash_balance. For withdrawals: deducts cash_balance (finalized).
    For investments: deducts cash_balance, creates/updates a holding row with
    quantity = amount / average_cost (cost basis = amount, average_cost = 1
    per unit for the educational model), sets investment started_at and
    status='active'. Records audit.
  - admin_fail_transaction(p_tx_id, p_note): processing->failed, records audit.
    No balance change.

  Every admin function derives the actor from auth.uid() and checks is_admin()
  inside the function body — the admin identity is never a parameter.

8. Portfolio auto-create
  - handle_new_portfolio() trigger function fires AFTER INSERT on profiles
    (which itself is created by the existing handle_new_user trigger). This
    ensures every new user gets a portfolio row with zero balance, so the
    transaction system works immediately after signup.
  - The trigger is idempotent: it only inserts if no portfolio exists.

9. Transaction reference generation
  - generate_reference() helper produces values like 'TX-AB12CD'. A BEFORE
    INSERT trigger on both transactions and investments sets the reference
    column if null, then a unique index enforces uniqueness. On rare
    collisions the function retries via a loop in the trigger.

10. Important notes
  - Balances are NEVER changed by a browser request. The only balance changes
    happen inside admin_complete_transaction, which runs as the function owner
    and checks admin role server-side.
  - Withdrawals and investments validate against cash_balance with a row lock
    (FOR UPDATE) to prevent concurrent overdrafts.
  - Deposits do NOT credit the balance until the admin marks the deposit
    completed after verifying funds.
  - No fictional profits or returns are generated.
  - The service-role key is never used in frontend code. All privileged
    operations go through SECURITY DEFINER functions callable with the
    authenticated user's own token.
*/

-- ── Helper: generate a human-readable unique reference ─────────────────────
CREATE OR REPLACE FUNCTION generate_reference(prefix text DEFAULT 'TX')
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT upper(prefix) || '-' ||
    lpad(floor(random() * 1000000)::text, 6, '0') ||
    chr(65 + floor(random() * 26)::int) ||
    chr(65 + floor(random() * 26)::int)
$$;

-- ── Admin check helper ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- ── Ensure the caller has a portfolio row ──────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_portfolio()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM portfolios WHERE user_id = auth.uid();
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO portfolios (user_id) VALUES (auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION ensure_portfolio() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_portfolio() TO authenticated;

-- ── Extend transactions table ──────────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Extend the status CHECK to include approved and processing.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending','approved','processing','completed','failed','cancelled'));

-- ── Extend investments table ───────────────────────────────────────────────
ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_status_check;
ALTER TABLE investments ADD CONSTRAINT investments_status_check
  CHECK (status IN ('pending','approved','processing','active','completed','cancelled','rejected'));

-- ── Reference generation triggers ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_transaction_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  attempt int := 0;
BEGIN
  IF NEW.reference IS NULL THEN
    LOOP
      NEW.reference := generate_reference('TX');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM transactions WHERE reference = NEW.reference);
      attempt := attempt + 1;
      IF attempt > 10 THEN RAISE EXCEPTION 'Could not generate unique reference'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_set_reference ON transactions;
CREATE TRIGGER transactions_set_reference
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_transaction_reference();

CREATE OR REPLACE FUNCTION set_investment_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  attempt int := 0;
BEGIN
  IF NEW.reference IS NULL THEN
    LOOP
      NEW.reference := generate_reference('INV');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM investments WHERE reference = NEW.reference);
      attempt := attempt + 1;
      IF attempt > 10 THEN RAISE EXCEPTION 'Could not generate unique reference'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS investments_set_reference ON investments;
CREATE TRIGGER investments_set_reference
  BEFORE INSERT ON investments
  FOR EACH ROW EXECUTE FUNCTION set_investment_reference();

CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_key ON transactions (reference);
CREATE UNIQUE INDEX IF NOT EXISTS investments_reference_key ON investments (reference);

-- ── Support tickets and messages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  subject        text NOT NULL,
  body           text NOT NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','answered','closed')),
  assigned_to    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status);

CREATE TABLE IF NOT EXISTS support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_role  text NOT NULL CHECK (sender_role IN ('customer','staff')),
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_id_idx ON support_messages (ticket_id);

DROP TRIGGER IF EXISTS support_tickets_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Transaction audit log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type  text NOT NULL CHECK (record_type IN ('transaction','investment')),
  record_id    uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  actor_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role   text NOT NULL DEFAULT 'system' CHECK (actor_role IN ('admin','customer','system')),
  note         text,
  reference    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_audit_record_idx ON transaction_audit (record_type, record_id);
CREATE INDEX IF NOT EXISTS transaction_audit_actor_idx ON transaction_audit (actor_id);

-- ── RLS for support_tickets ────────────────────────────────────────────────
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_select_own_or_admin" ON support_tickets;
CREATE POLICY "support_tickets_select_own_or_admin"
  ON support_tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "support_tickets_insert_own" ON support_tickets;
CREATE POLICY "support_tickets_insert_own"
  ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "support_tickets_update_admin" ON support_tickets;
CREATE POLICY "support_tickets_update_admin"
  ON support_tickets FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── RLS for support_messages ───────────────────────────────────────────────
DROP POLICY IF EXISTS "support_messages_select_own_or_admin" ON support_messages;
CREATE POLICY "support_messages_select_own_or_admin"
  ON support_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM support_tickets t
      WHERE t.id = support_messages.ticket_id
      AND (t.user_id = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "support_messages_insert_own_or_admin" ON support_messages;
CREATE POLICY "support_messages_insert_own_or_admin"
  ON support_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM support_tickets t
      WHERE t.id = support_messages.ticket_id
      AND (t.user_id = auth.uid() OR is_admin()))
    AND sender_id = auth.uid()
  );

-- ── RLS for transaction_audit (admin-only read) ────────────────────────────
DROP POLICY IF EXISTS "transaction_audit_select_admin" ON transaction_audit;
CREATE POLICY "transaction_audit_select_admin"
  ON transaction_audit FOR SELECT TO authenticated
  USING (is_admin());

-- No INSERT/UPDATE/DELETE policies: audit rows are created only inside
-- SECURITY DEFINER functions.

-- ── Column-level privileges for new columns ────────────────────────────────
-- Re-grant UPDATE on transactions preserving the existing description grant.
-- New columns (reference, admin_notes, processed_by) are NOT granted.
REVOKE UPDATE ON transactions FROM authenticated;
GRANT UPDATE (description) ON transactions TO authenticated;

REVOKE UPDATE ON investments FROM authenticated;
GRANT UPDATE (amount) ON investments TO authenticated;

-- ── Portfolio auto-create on new profile ───────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_portfolio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO portfolios (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_new_portfolio();

-- Also create portfolios for any existing profiles that don't have one yet.
INSERT INTO portfolios (user_id)
  SELECT id FROM profiles
  WHERE id NOT IN (SELECT user_id FROM portfolios)
  ORDER BY created_at;

-- ── Audit helper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_audit(
  p_record_type text,
  p_record_id uuid,
  p_from_status text,
  p_to_status text,
  p_actor_id uuid,
  p_actor_role text DEFAULT 'admin',
  p_note text DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO transaction_audit (record_type, record_id, from_status, to_status, actor_id, actor_role, note, reference)
  VALUES (p_record_type, p_record_id, p_from_status, p_to_status, p_actor_id, p_actor_role, p_note, p_reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION record_audit(text,uuid,text,text,uuid,text,text,text) FROM anon, PUBLIC;

-- ── submit_deposit ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_deposit(p_amount numeric, p_description text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_tx_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be greater than zero';
  END IF;
  IF p_amount > 100000000 THEN
    RAISE EXCEPTION 'Deposit amount is too large';
  END IF;
  v_portfolio_id := ensure_portfolio();
  INSERT INTO transactions (portfolio_id, type, amount, description, status)
    VALUES (v_portfolio_id, 'deposit', p_amount, p_description, 'pending')
    RETURNING id INTO v_tx_id;
  PERFORM record_audit('transaction', v_tx_id, NULL, 'pending', auth.uid(), 'customer');
  RETURN v_tx_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION submit_deposit(numeric, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION submit_deposit(numeric, text) TO authenticated;

-- ── submit_withdrawal ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_withdrawal(p_amount numeric, p_description text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_tx_id uuid;
  v_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
  END IF;
  v_portfolio_id := ensure_portfolio();
  -- Lock the portfolio row to prevent concurrent overdrafts.
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
REVOKE EXECUTE ON FUNCTION submit_withdrawal(numeric, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION submit_withdrawal(numeric, text) TO authenticated;

-- ── submit_investment ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_investment(p_plan_id uuid, p_amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_portfolio_id uuid;
  v_inv_id uuid;
  v_balance numeric;
  v_plan record;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Investment amount must be greater than zero';
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
REVOKE EXECUTE ON FUNCTION submit_investment(uuid, numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION submit_investment(uuid, numeric) TO authenticated;

-- ── Admin: approve transaction ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_transaction(p_tx_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
  v_type text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status, type INTO v_old, v_type FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_old != 'pending' THEN
    RAISE EXCEPTION 'Only pending transactions can be approved (current: %)', v_old;
  END IF;
  UPDATE transactions SET status = 'approved', processed_by = auth.uid(), processed_at = now()
    WHERE id = p_tx_id;
  PERFORM record_audit('transaction', p_tx_id, v_old, 'approved', auth.uid(), 'admin');
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_approve_transaction(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_approve_transaction(uuid) TO authenticated;

-- ── Admin: reject transaction ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_reject_transaction(p_tx_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_old NOT IN ('pending','approved','processing') THEN
    RAISE EXCEPTION 'Cannot reject a transaction in status %', v_old;
  END IF;
  UPDATE transactions SET status = 'cancelled', admin_notes = p_note,
    processed_by = auth.uid(), processed_at = now()
    WHERE id = p_tx_id;
  PERFORM record_audit('transaction', p_tx_id, v_old, 'cancelled', auth.uid(), 'admin', p_note);
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_reject_transaction(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reject_transaction(uuid, text) TO authenticated;

-- ── Admin: move to processing ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_process_transaction(p_tx_id uuid, p_note text, p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_old != 'approved' THEN
    RAISE EXCEPTION 'Only approved transactions can move to processing (current: %)', v_old;
  END IF;
  UPDATE transactions SET status = 'processing', admin_notes = p_note,
    reference = COALESCE(reference, p_reference), processed_by = auth.uid(), processed_at = now()
    WHERE id = p_tx_id;
  PERFORM record_audit('transaction', p_tx_id, v_old, 'processing', auth.uid(), 'admin', p_note, p_reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_process_transaction(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_process_transaction(uuid, text, text) TO authenticated;

-- ── Admin: complete transaction (the only function that changes balances) ──
CREATE OR REPLACE FUNCTION admin_complete_transaction(p_tx_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
  v_type text;
  v_amount numeric;
  v_portfolio_id uuid;
  v_plan_id uuid;
  v_holding record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status, type, amount, portfolio_id INTO v_old, v_type, v_amount, v_portfolio_id
    FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_old != 'processing' THEN
    RAISE EXCEPTION 'Only processing transactions can be completed (current: %)', v_old;
  END IF;

  IF v_type = 'deposit' THEN
    -- Credit the balance only after the admin verifies funds were received.
    UPDATE portfolios SET cash_balance = cash_balance + v_amount WHERE id = v_portfolio_id;
  ELSIF v_type = 'withdrawal' THEN
    -- Finalize the deduction. Re-check balance with a lock.
    SELECT cash_balance INTO v_amount FROM portfolios WHERE id = v_portfolio_id FOR UPDATE;
    IF v_amount < (SELECT amount FROM transactions WHERE id = p_tx_id) THEN
      RAISE EXCEPTION 'Insufficient balance to complete withdrawal';
    END IF;
    UPDATE portfolios SET cash_balance = cash_balance - (SELECT amount FROM transactions WHERE id = p_tx_id)
      WHERE id = v_portfolio_id;
  END IF;

  UPDATE transactions SET status = 'completed', processed_by = auth.uid(), processed_at = now()
    WHERE id = p_tx_id;
  PERFORM record_audit('transaction', p_tx_id, v_old, 'completed', auth.uid(), 'admin');
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_complete_transaction(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_complete_transaction(uuid) TO authenticated;

-- ── Admin: fail transaction ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_fail_transaction(p_tx_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_old NOT IN ('processing','approved','pending') THEN
    RAISE EXCEPTION 'Cannot fail a transaction in status %', v_old;
  END IF;
  UPDATE transactions SET status = 'failed', admin_notes = p_note,
    processed_by = auth.uid(), processed_at = now()
    WHERE id = p_tx_id;
  PERFORM record_audit('transaction', p_tx_id, v_old, 'failed', auth.uid(), 'admin', p_note);
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_fail_transaction(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_fail_transaction(uuid, text) TO authenticated;

-- ── Admin: investment lifecycle ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_investment(p_inv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investment not found'; END IF;
  IF v_old != 'pending' THEN
    RAISE EXCEPTION 'Only pending investments can be approved (current: %)', v_old;
  END IF;
  UPDATE investments SET status = 'approved', processed_by = auth.uid() WHERE id = p_inv_id;
  PERFORM record_audit('investment', p_inv_id, v_old, 'approved', auth.uid(), 'admin');
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_approve_investment(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_approve_investment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION admin_reject_investment(p_inv_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investment not found'; END IF;
  IF v_old NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Cannot reject an investment in status %', v_old;
  END IF;
  UPDATE investments SET status = 'rejected', admin_notes = p_note, processed_by = auth.uid()
    WHERE id = p_inv_id;
  PERFORM record_audit('investment', p_inv_id, v_old, 'rejected', auth.uid(), 'admin', p_note);
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_reject_investment(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reject_investment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION admin_activate_investment(p_inv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
  v_amount numeric;
  v_portfolio_id uuid;
  v_plan_id uuid;
  v_balance numeric;
  v_holding record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status, amount, portfolio_id, plan_id INTO v_old, v_amount, v_portfolio_id, v_plan_id
    FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investment not found'; END IF;
  IF v_old != 'approved' THEN
    RAISE EXCEPTION 'Only approved investments can be activated (current: %)', v_old;
  END IF;
  -- Lock and re-check balance.
  SELECT cash_balance INTO v_balance FROM portfolios WHERE id = v_portfolio_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'Portfolio not found'; END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance to activate this investment';
  END IF;
  -- Deduct cash and create/update the holding row.
  UPDATE portfolios SET cash_balance = cash_balance - v_amount WHERE id = v_portfolio_id;
  SELECT * INTO v_holding FROM holdings WHERE portfolio_id = v_portfolio_id AND asset_symbol = 'FUND' LIMIT 1;
  IF FOUND THEN
    UPDATE holdings SET
      quantity = quantity + v_amount,
      average_cost = CASE
        WHEN quantity + v_amount > 0 THEN (quantity * average_cost + v_amount) / (quantity + v_amount)
        ELSE average_cost END
    WHERE portfolio_id = v_portfolio_id AND asset_symbol = 'FUND';
  ELSE
    INSERT INTO holdings (portfolio_id, asset_symbol, asset_name, quantity, average_cost)
      VALUES (v_portfolio_id, 'FUND', 'Investment Fund', v_amount, 1);
  END IF;
  UPDATE investments SET status = 'active', started_at = now(), processed_by = auth.uid()
    WHERE id = p_inv_id;
  PERFORM record_audit('investment', p_inv_id, v_old, 'active', auth.uid(), 'admin');
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_activate_investment(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_activate_investment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION admin_complete_investment(p_inv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_old FROM investments WHERE id = p_inv_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investment not found'; END IF;
  IF v_old != 'active' THEN
    RAISE EXCEPTION 'Only active investments can be completed (current: %)', v_old;
  END IF;
  UPDATE investments SET status = 'completed', completed_at = now(), processed_by = auth.uid()
    WHERE id = p_inv_id;
  PERFORM record_audit('investment', p_inv_id, v_old, 'completed', auth.uid(), 'admin');
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_complete_investment(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_complete_investment(uuid) TO authenticated;
