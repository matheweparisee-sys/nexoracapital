/*
# KYC / Identity Verification system — table, storage, policies

## 1. New table: kyc_applications
- `id` (uuid PK)
- `user_id` (uuid, NOT NULL, DEFAULT auth.uid(), references auth.users ON DELETE CASCADE)
- `legal_name` (text, NOT NULL)
- `date_of_birth` (date, NOT NULL)
- `country` (text, NOT NULL) — ISO 3166-1 alpha-2 country code
- `document_type` (text, NOT NULL) — 'passport', 'drivers_license', 'national_id', 'residence_permit'
- `document_path` (text, NOT NULL) — path in the kyc-documents storage bucket
- `status` (text, NOT NULL, DEFAULT 'pending') — 'pending', 'approved', 'rejected', 'resubmission_required'
- `admin_feedback` (text, nullable)
- `reviewed_by` (uuid, nullable, references auth.users)
- `reviewed_at` (timestamptz, nullable)
- `created_at` (timestamptz, NOT NULL, DEFAULT now())
- `updated_at` (timestamptz, NOT NULL, DEFAULT now())

## 2. Storage bucket: kyc-documents (private)
- Owner can upload/read their own files.
- Admins can read any file.
- Signed URLs for viewing.

## 3. RLS on kyc_applications
- Customers: SELECT/INSERT own only.
- Admins: SELECT all.
- No customer writes to status/review fields.

## 4. Partial unique index on (user_id) WHERE status='pending' prevents
   duplicate pending applications.
*/

-- ─── kyc_applications table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  date_of_birth date NOT NULL,
  country text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('passport', 'drivers_license', 'national_id', 'residence_permit')),
  document_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'resubmission_required')),
  admin_feedback text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kyc_applications ENABLE ROW LEVEL SECURITY;

-- Customer can read their own applications
DROP POLICY IF EXISTS "kyc_select_own" ON kyc_applications;
CREATE POLICY "kyc_select_own" ON kyc_applications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admin can read all applications
DROP POLICY IF EXISTS "kyc_select_admin" ON kyc_applications;
CREATE POLICY "kyc_select_admin" ON kyc_applications
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Customer can insert their own application
DROP POLICY IF EXISTS "kyc_insert_own" ON kyc_applications;
CREATE POLICY "kyc_insert_own" ON kyc_applications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Customer can update their own application (only submission fields, enforced
-- by the submit function which sets status='pending')
DROP POLICY IF EXISTS "kyc_update_own" ON kyc_applications;
CREATE POLICY "kyc_update_own" ON kyc_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Partial unique index: only one pending application per user ───────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_pending_kyc_per_user
  ON kyc_applications (user_id)
  WHERE status = 'pending';

-- ─── Storage bucket: kyc-documents (private) ──────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: owner can upload to their own path prefix
DROP POLICY IF EXISTS "kyc_docs_upload_own" ON storage.objects;
CREATE POLICY "kyc_docs_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: owner can read their own files
DROP POLICY IF EXISTS "kyc_docs_read_own" ON storage.objects;
CREATE POLICY "kyc_docs_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: admins can read any KYC document
DROP POLICY IF EXISTS "kyc_docs_read_admin" ON storage.objects;
CREATE POLICY "kyc_docs_read_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND public.is_admin()
  );

-- ─── Indexes for lookups ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kyc_applications_user ON kyc_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_applications_status ON kyc_applications(status);
