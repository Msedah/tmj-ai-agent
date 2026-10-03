-- Server-only allowlist for TMJ administration. Do not seed by email; add only a confirmed Auth UUID.
CREATE TABLE IF NOT EXISTS public.tmj_admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tmj_admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tmj_admin_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tmj_admin_users TO service_role;
