/*
# BTC-only deposit system

## Purpose
Add support for Bitcoin-only deposits with admin-configured receiving address,
customer receipt upload, and Bitcoin transaction hash tracking. Integrates with
the existing transaction approval workflow — no balance is credited until an
admin verifies and completes the deposit.

## 1. New table: app_settings
A single-row, admin-controlled configuration table. Holds the Bitcoin receiving
wallet address that customers send to. Only admins can read/update this.
- `id` (int, primary key, always 1 — singleton)
- `btc_receive_address` (text, nullable — null means admin hasn't configured it yet)
- `updated_at` (timestamptz)
- `updated_by` (uuid, references auth.users)

## 2. New columns on transactions
- `tx_hash` (text, nullable) — Bitcoin transaction hash the customer provides
  as evidence of their BTC transfer. Optional (customer may not have it yet).
- `receipt_path` (text, nullable) — storage path to the uploaded receipt image
  in the `deposit-receipts` bucket.

These are nullable additions (no data loss, no type changes to existing columns).
Both columns are only meaningful for deposit-type transactions.

## 3. Storage bucket: deposit-receipts
A private bucket (public = false) for customer-uploaded deposit receipts.
Access is controlled by storage RLS policies:
- Customers can upload (create) objects only under a path starting with their
  own user id: `<user_id>/<filename>`.
- Customers can read (download) only their own receipts.
- Admins can read (download) any receipt for review.
- No one can list the bucket root — only prefixed paths.

## 4. Security
- `app_settings`: RLS enabled. SELECT and UPDATE restricted to admins via
  is_admin(). No customer can read or change the BTC address.
- `transactions` existing RLS: the new columns inherit the table's existing
  policies — no new transaction policies needed. Customer inserts go through
  the existing submit_deposit SECURITY DEFINER function (bypasses RLS for the
  insert, validates ownership internally).
- Storage policies on `deposit-receipts` enforce per-user path isolation.
- No private keys or seed phrases are stored — only the public receiving address.

## 5. Notes
- The admin must set `btc_receive_address` before customers can deposit. If it
  is null, the deposit form shows a notice instead of an address.
- Receipts are validated client-side (file type + size) before upload, and the
  storage path is constructed from the authenticated user's id so a customer
  cannot overwrite another user's receipt.
- Balance is only credited by the existing admin_complete_transaction function,
  unchanged. Uploading a receipt or clicking submit does NOT credit anything.
*/

-- ─── app_settings (singleton, admin-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  btc_receive_address text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_admin" ON app_settings;
CREATE POLICY "app_settings_select_admin" ON app_settings
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "app_settings_update_admin" ON app_settings;
CREATE POLICY "app_settings_update_admin" ON app_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─── New columns on transactions ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'transactions'
                   AND column_name = 'tx_hash') THEN
    ALTER TABLE transactions ADD COLUMN tx_hash text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'transactions'
                   AND column_name = 'receipt_path') THEN
    ALTER TABLE transactions ADD COLUMN receipt_path text;
  END IF;
END $$;

-- ─── Storage bucket: deposit-receipts (private) ──────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('deposit-receipts', 'deposit-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Customers can upload receipts only under their own user-id prefix.
DROP POLICY IF EXISTS "receipts_insert_own" ON storage.objects;
CREATE POLICY "receipts_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deposit-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Customers can read only their own receipts.
DROP POLICY IF EXISTS "receipts_select_own" ON storage.objects;
CREATE POLICY "receipts_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read any receipt for review.
DROP POLICY IF EXISTS "receipts_select_admin" ON storage.objects;
CREATE POLICY "receipts_select_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-receipts'
    AND public.is_admin()
  );

-- No UPDATE or DELETE policies: receipts are immutable once uploaded.
