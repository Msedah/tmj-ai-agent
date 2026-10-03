-- Keep documents attached to the active chat from being crowded out by global NWU results.
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
  WITH upload_matches AS (
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
    LIMIT LEAST(match_count, 8)
  ),
  official_matches AS (
    SELECT c.id, c.document_id, c.content,
           1 - (c.embedding_cloudflare <=> query_embedding) AS similarity,
           d.file_name AS source_name, d.module_code, d.source_type, d.source_url
    FROM public.document_chunks c
    JOIN public.documents d ON d.id = c.document_id
    WHERE d.source_type = 'nwu_official'
      AND c.embedding_cloudflare IS NOT NULL
    ORDER BY c.embedding_cloudflare <=> query_embedding
    LIMIT GREATEST(match_count - LEAST(match_count, 8), 0)
  ),
  combined AS (
    SELECT * FROM upload_matches
    UNION ALL
    SELECT * FROM official_matches
  )
  SELECT * FROM combined
  ORDER BY CASE WHEN source_type = 'student_upload' THEN 0 ELSE 1 END, similarity DESC
  LIMIT match_count;
$$;

NOTIFY pgrst, 'reload schema';
