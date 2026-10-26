/*
# KYC / Identity Verification system

## Purpose
Create a dedicated table for KYC applications, a private storage bucket for
identity documents, and RLS policies. Customers submit verification with
legal name, date of birth, country, document type, and an uploaded document.
Admins review, approve, reject, or request resubmission.

## 1. New table: kyc_applications
- `id` (uuid PK)
- `user_id` (uuid, NOT NULL, DEFAULT auth.uid(), references auth.users ON DELETE CASCADE)
- `legal_name` (text, NOT NULL) — customer's full legal name
- `date_of_birth` (date, NOT NULL) — customer's date of birth
- `country` (text, NOT NULL) — country of residence (ISO 3166-1 alpha-2 code)
- `document_type` (text, NOT NULL) — type of ID: 'passport', 'drivers_license', 'national_id', 'residence_permit'
- `document_path` (text, NOT NULL) — path to the uploaded document in the kyc-documents storage bucket
- `status` (text, NOT NULL, DEFAULT 'pending') — 'pending', 'approved', 'rejected', 'resubmission_required'
- `admin_feedback` (text, nullable) — reason for rejection or resubmission request
- `reviewed_by` (uuid, nullable, references auth.users) — admin who reviewed
- `reviewed_at` (timestamptz, nullable) — when the review happened
- `created_at` (timestamptz, NOT NULL, DEFAULT now())
- `updated_at` (timestamptz, NOT NULL, DEFAULT now())

## 2. New column on profiles
- `kyc_status` already exists (text, default 'unverified'). We update it via
  the admin review function to sync with the latest application status.
  Values used: 'unverified' (never submitted), 'pending' (submitted, awaiting
  review), 'verified' (approved), 'rejected' (rejected), 'resubmission' (admin
  requested resubmission).

## 3. Storage bucket: kyc-documents
- Private bucket (public = false). Identity documents are never publicly
  accessible. Access is controlled via storage RLS policies:
  - Owner can upload to and read from their own path prefix: `kyc-documents/<user_id>/...`
  - Admins can read any document in the bucket.
  - No one can list the bucket root or another user's files.
  - Signed URLs (60-second expiry) are used for document viewing.

## 4. RLS on kyc_applications
- Customers can SELECT only their own applications.
- Customers can INSERT only for themselves (prevents duplicate pending via a
  partial unique index — only one row with status='pending' per user).
- Customers can UPDATE only their own application and only the submission
  fields (not admin review fields) — enforced by the submit function.
- Admins can SELECT all applications.
- No customer can UPDATE status, admin_feedback, reviewed_by, or reviewed_at
  directly — those are only set by the SECURITY DEFINER admin review function.

## 5. Partial unique index
- `uniq_one_pending_kyc_per_user` on (user_id) WHERE status = 'pending'.
  Prevents a user from having multiple pending applications simultaneously.
  After rejection or resubmission, the user can submit a new one.
*/
