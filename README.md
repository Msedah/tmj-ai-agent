# TMJ AI Agent

Education-only AI assistant built specifically for North-West University (NWU) students.

## Current build

- Email/password sign-up and sign-in through Supabase Auth.
- Saved conversations per authenticated user.
- Secure private document uploads through Supabase Storage.
- PDF, DOCX, TXT and Markdown extraction.
- RAG using OpenAI embeddings + Supabase pgvector.
- Student-uploaded module material is searchable for that student.
- Protected ingestion endpoint for public NWU pages.
- Official NWU sources can be stored as shared `nwu_official` knowledge.
- Academic-only scope guard.
- Netlify Functions backend.
- Developer: TJ Mailula — mailulajosep@gmail.com.

NWU's public library resources include eFundi guidance, support guides, research support and academic-integrity resources. Private eFundi course material is not scraped or accessed using student passwords. Students upload material they are authorised to use.

## Required services

1. Supabase project
2. OpenAI API key
3. Netlify site connected to this GitHub repository

## Supabase setup

Open the Supabase SQL Editor and run:

`supabase/schema.sql`

This creates the conversation tables, document/RAG tables, pgvector search function, Storage bucket and RLS policies.

## Netlify environment variables

Add these in Netlify:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only; never put this in browser code.
- `OPENAI_API_KEY`
- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`
- `OPENAI_EMBEDDING_MODEL` — optional, defaults to `text-embedding-3-small`
- `NWU_INGEST_SECRET` — long random secret for the protected NWU source ingestion endpoint

Also replace the placeholders in `app.js`:

- `YOUR_SUPABASE_URL`
- `YOUR_SUPABASE_ANON_KEY`

The anon/publishable key is safe for browser use when RLS is correctly configured. The service-role key must remain a Netlify server environment variable.

## Deploy

Connect `Msedah/tmj-ai-agent` to Netlify and deploy from the `main` branch. Netlify automatically detects functions in `netlify/functions` according to the repository configuration.

After deployment:

1. Create a test account.
2. Confirm sign-in.
3. Upload a small PADM/POLI module PDF or DOCX.
4. Wait for the indexing confirmation.
5. Ask a question that is clearly answered by the uploaded material.
6. Confirm the conversation appears in Saved conversations.
7. Sign out and confirm private conversations are no longer visible.
8. Sign in again and confirm the saved conversation returns.

## Indexing official NWU pages

The protected function is:

`/.netlify/functions/index-nwu`

It accepts a POST body:

```json
{"url":"https://library.nwu.ac.za/","moduleCode":""}
```

Send the secret in:

`x-tmj-ingest-secret: YOUR_NWU_INGEST_SECRET`

Only use public NWU pages that the application is authorised to retrieve. Do not submit private eFundi URLs or passwords.

## Scope

TMJ AI Agent is not a general-purpose assistant. Non-academic questions should be declined. Module-specific questions should prefer retrieved NWU/student material over generic model knowledge.

## Production roadmap

- Add NWU module catalogue and module-code metadata.
- Add better document page/section extraction and citations.
- Add PPTX extraction.
- Add source freshness/versioning.
- Add abuse/rate limiting and usage monitoring.
- Add admin dashboard for NWU source management.
- Add automated tests and deployment checks.

Developer: TJ Mailula
Email: mailulajosep@gmail.com
