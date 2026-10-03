-- Associate each student upload with one conversation and prevent cross-chat retrieval.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS documents_conversation_idx
  ON public.documents (user_id, conversation_id, created_at)
  WHERE source_type = 'student_upload';

-- Remove the old two-argument RPC so no caller can keep using unscoped retrieval.
DROP FUNCTION IF EXISTS public.match_document_chunks_cloudflare(vector, integer, uuid);
DROP FUNCTION IF EXISTS public.match_document_chunks_cloudflare(vector, integer);

CREATE FUNCTION public.match_document_chunks_cloudflare(
  query_embedding vector(384),
  match_count integer DEFAULT 8,
  target_conversation_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  document_id uuid,
  content text,
  similarity float,
  source_name text,
  module_code text,
  source_type text,
  source_url text
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.document_id, c.content,
         1 - (c.embedding_cloudflare <=> query_embedding) AS similarity,
         d.file_name, d.module_code, d.source_type, d.source_url
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE (
      d.source_type = 'nwu_official'
      OR (
        c.user_id = auth.uid()
        AND d.user_id = auth.uid()
        AND d.source_type = 'student_upload'
        AND d.conversation_id = target_conversation_id
      )
    )
    AND c.embedding_cloudflare IS NOT NULL
  ORDER BY c.embedding_cloudflare <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks_cloudflare(vector, integer, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
