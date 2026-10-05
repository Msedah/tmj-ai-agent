-- Supersede 0003/0004's shared public-document matches; retain old rows but do not expose or search them.
DROP POLICY IF EXISTS "users manage own documents" ON public.documents;
CREATE POLICY "users manage own documents" ON public.documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users read own chunks" ON public.document_chunks;
CREATE POLICY "users read own chunks" ON public.document_chunks FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.match_document_chunks_cloudflare(
  query_embedding vector(384),
  match_count integer DEFAULT 12,
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
         d.file_name AS source_name, d.module_code, d.source_type, d.source_url
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.user_id = auth.uid()
    AND d.user_id = auth.uid()
    AND d.source_type = 'student_upload'
    AND d.conversation_id = target_conversation_id
    AND c.embedding_cloudflare IS NOT NULL
  ORDER BY c.embedding_cloudflare <=> query_embedding
  LIMIT LEAST(match_count, 8);
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks_cloudflare(vector, integer, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
