# TMJ AI Agent

Education-only academic assistant for North-West University (NWU) students. The active deployment is a **Cloudflare Worker with static assets**, backed by Supabase and OpenAI.

## Features

- Email/password authentication through Supabase Auth.
- User-scoped saved conversations and private document uploads.
- PDF, DOCX, TXT, and Markdown text extraction.
- Retrieval-augmented answers using OpenAI embeddings and Supabase pgvector.
- Optional ingestion of public NWU resources through a protected endpoint.
- Academic-only scope guard; the assistant complements rather than replaces NWU instructions.
- Responsive chat interface with keyboard focus states and accessible live status messages.

NWU's eFundi platform remains the official learning management system for module resources, communication, and assessments. Do not scrape private eFundi courses or ask students for NWU passwords. Students should only upload material they are authorised to use.

## Architecture

- Worker entry point: `src/index.js`
- Static site assets: `public/`
- Supabase schema and RLS: `supabase/schema.sql`
- Cloudflare config: `wrangler.jsonc`
- CI: `.github/workflows/ci.yml`
- Legacy Netlify Functions remain in `netlify/functions/`; they are not the active Cloudflare deployment path.

## Required services and setup

1. Create or use a Supabase project.
2. In the Supabase SQL Editor, run `supabase/schema.sql`. This creates the conversations, document/RAG tables, vector search function, Storage bucket, and RLS policies.
3. Create or use an OpenAI API key for server-side chat and embeddings.
4. Set the Worker values below in **Cloudflare Dashboard → Workers & Pages → `tmj-ai-agent` → Settings → Variables and Secrets**. Use encrypted **Secrets** for API keys and service-role credentials.

| Name | Required | Handling |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL; keep it consistent with the client config in `public/app.js`. |
| `SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key; safe for browser use with correct RLS, but must also be present in the Worker for token validation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for document/NWU indexing | **Secret; server only. Never put this in browser code or commit it.** |
| `OPENAI_API_KEY` | Yes for chat and embeddings | **Secret.** |
| `NWU_INGEST_SECRET` | Only for `/api/index-nwu` | **Secret.** Use a long random value and send it only in the `x-tmj-ingest-secret` header. |
| `OPENAI_MODEL` | Optional | Defaults to `gpt-4o-mini`. |
| `OPENAI_EMBEDDING_MODEL` | Optional | Defaults to `text-embedding-3-small`. |

The browser intentionally uses only the Supabase URL and publishable/anon key. Keep the service-role key and OpenAI key exclusively in Worker secrets. `.env.example` is a blank template; it contains no credentials.

## Local development and tests

```bash
npm install
cp .env.example .dev.vars
# Fill .dev.vars locally; never commit it.
npx wrangler dev --config wrangler.jsonc
```

In another terminal, run:

```bash
npm run check
npm test
```

`.dev.vars` is ignored by Git. For production deployment from a developer machine, authenticate Wrangler with the intended Cloudflare account, set secrets with `npx wrangler secret put NAME`, then run `npm run deploy`. Alternatively, connect this repository to Cloudflare's Git deployment flow and deploy the intended branch there.

## API routes

- `GET /api/health` — reports readiness booleans only; never returns secret values. `ready` requires chat and document indexing configuration. NWU ingestion is reported separately.
- `POST /api/chat` — authenticated academic question and conversation persistence.
- `POST /api/index-document` — authenticated indexing of a previously uploaded user document.
- `POST /api/index-nwu` — protected ingestion for public NWU source pages; provide `x-tmj-ingest-secret`.

## Deployment verification

After setting the Worker values and deploying:

1. Open `/api/health` and confirm `services.chat` and `services.documentIndexing` are `true`. Confirm `services.nwuIngestion` is `true` only if that optional secret is set.
2. Create an account, sign in, and sign out again. Confirm the dialog controls respond.
3. Start a new conversation and submit an academic question.
4. Upload a small PDF, DOCX, TXT, or MD file and confirm indexing succeeds.
5. Confirm a saved conversation can be reopened and is not visible after signing out.
6. Test at desktop and mobile widths, and check the browser console for runtime errors.

## Scope and privacy

TMJ AI Agent is not a general-purpose assistant. Non-academic questions should be declined. Module-specific answers should prioritize retrieved NWU and student-provided material, and should not invent course requirements, citations, or official policy. Verify consequential academic requirements against current NWU module instructions and lecturer guidance.

Developer: TJ Mailula — mailulajosep@gmail.com.
