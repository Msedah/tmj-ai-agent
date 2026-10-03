# TMJ AI Agent

General-purpose AI assistant with a focus on North-West University (NWU) student support. The active deployment is a **Cloudflare Worker with static assets**, backed by Supabase Auth/Postgres/Storage and Cloudflare Workers AI.

## Features

- Email/password authentication through Supabase Auth; email is the account label and is shortened in the sidebar when long.
- User-scoped saved conversations and private document uploads.
- PDF, DOCX, TXT, and Markdown text extraction.
- General-purpose answers plus retrieval-augmented, conversation-scoped document support using Cloudflare Workers AI and Supabase pgvector.
- Trusted runtime date/time context for current-date questions and date calculations; South African local time is the default unless a timezone is specified.
- Optional ingestion of public NWU resources through a protected endpoint.
- NWU-focused help that complements rather than replaces official university instructions; general questions are also in scope.
- Responsive chat interface with keyboard focus states and accessible live status messages.

NWU's eFundi platform remains the official learning management system for module resources, communication, and assessments. Do not scrape private eFundi courses or ask students for NWU passwords. Students should only upload material they are authorised to use.

## Architecture

- Worker entry point: `src/index.js`
- Static site assets: `public/`
- Supabase schema and row-level security: `supabase/schema.sql`
- Cloudflare config and Workers AI binding: `wrangler.jsonc`
- CI: `.github/workflows/ci.yml`
- Legacy Netlify Functions remain in `netlify/functions/`; they are not the active Cloudflare deployment path.

The active Worker uses `@cf/meta/llama-3.2-3b-instruct` for chat and `@cf/baai/bge-small-en-v1.5` for embeddings. No OpenAI API key is used by the Cloudflare Worker. The vector search stores Cloudflare's 384-dimensional vectors separately in `embedding_cloudflare`; an older `embedding` column and its data, if present, are left untouched. Previously indexed documents need to be uploaded and indexed again before their content is searchable with Cloudflare embeddings.

## Required services and setup

1. In the Supabase SQL Editor, run `supabase/schema.sql`. It creates the conversation, message, document, and chunk tables, the Cloudflare vector-search function, the private Storage bucket, and row-level security policies. The script is safe to rerun and preserves any pre-existing OpenAI embedding column/data. Existing installations must also run the next numbered Supabase migration under `migrations/` when a new migration is released.
2. In Supabase **Authentication → Sign In / Providers**, keep **Allow new users to sign up** enabled and turn **Confirm email** off. Email and password remain required; no display-name field is collected. Turning off confirmation allows account creation/sign-in without proving control of the email address, so users should still use an address they own.
3. Set the Worker values in **Cloudflare Dashboard → Workers & Pages → `tmj-ai-agent` → Settings → Variables and Secrets**. The Workers AI binding named `AI` is declared in `wrangler.jsonc`; it does not need an AI provider API key.

| Name | Required | Handling |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL; keep consistent with the public client config in `public/app.js`. |
| `SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key; safe for browser use with correct RLS, but also required by the Worker for user-token validation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for document/NWU indexing and admin authorization | **Secret; server only. Never put this in browser code or commit it.** |
| `NWU_INGEST_SECRET` | Only for `/api/index-nwu` | **Secret.** Use a long random value and send it only in the `x-tmj-ingest-secret` header. |

### TMJ ADMIN

The separate, mobile-friendly admin page is available at `/admin` and in the TMJ ADMIN Android wrapper. It uses the existing TMJ email/password sign-in and does not offer account creation. Dashboard access is denied unless that Supabase Auth UUID is explicitly present in `public.tmj_admin_users`; the table has RLS enabled and service-role-only access. The migration `migrations/0005_tmj_admin_users.sql` intentionally grants no account automatically. Do not authorize an account by email or put an admin password in the app.

The D1 binding uses `migrations/d1` as its dedicated migration directory; this keeps the root folder's mixed historical SQL—including PostgreSQL migrations—out of Wrangler's SQLite migration runner. The D1 directory contains the complete sequence for a new database: daily usage, upload-byte accounting, and per-account chat allocations. Production already has all three schema changes recorded in Wrangler's D1 migration ledger. Use `npx wrangler d1 migrations list tmj-ai-agent-usage --remote` to inspect pending changes and `npx wrangler d1 migrations apply tmj-ai-agent-usage --remote` to apply them. New accounts keep the default of 35 chat requests per UTC day; an authorized admin can set an active account's limit from 0 to 350. The existing 350 shared daily requests and 10 active-account pilot cap remain hard ceilings. The dashboard reports TMJ app request limits—not exact Cloudflare Neurons or account-wide AI usage. Only an owner-confirmed Auth UUID should be inserted into `tmj_admin_users`.

### Free-tier limits

Cloudflare Workers AI currently includes **10,000 Neurons per day** on Free and Paid Workers plans. Neurons are not a fixed number of tokens or chats. If a Free-plan account reaches its daily allocation, AI requests fail until reset; Paid-plan usage beyond the allocation can incur charges. Upload indexing also consumes the AI allowance, so the Worker caps a single document at 80 chunks and one NWU page at 100 chunks. Check Cloudflare's [current pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) before increasing limits or changing models. Supabase and Cloudflare Worker limits also apply independently.

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

`.dev.vars` is ignored by Git. Local AI inference requires a working Cloudflare Workers AI binding and uses the same Cloudflare account allocation. For production, deploy through the connected Cloudflare Git build or authenticate Wrangler with the intended Cloudflare account and run `npm run deploy`.

## API routes

- `GET /api/health` — reports readiness booleans only; never returns secret values. `ready` requires chat and document-indexing configuration. NWU ingestion is reported separately. Health does not consume an AI request or guarantee remaining daily quota.
- `POST /api/chat` — authenticated user question or task, relevant evidence retrieval, and conversation persistence.
- `GET /api/admin/dashboard` — admin-allowlisted daily aggregates and active-account details.
- `PUT /api/admin/users/{id}/chat-limit` — admin-allowlisted daily account limit, bounded to 0–350 and audited by administrator ID.
- `DELETE /api/conversations/{id}` — authenticated deletion of the signed-in user's conversation; related messages are removed by the database cascade.

Student uploads are associated with the conversation in which they were indexed. Reopening a recent conversation restores its document cards, and semantic retrieval can use that conversation's uploads only. Uploading while no chat is open creates a conversation; adding another file in the same session attaches it to that chat. Deleting a conversation removes its associated document records and private storage files.
- `POST /api/index-document` — authenticated indexing of an uploaded user document.
- `POST /api/index-nwu` — protected ingestion for public NWU source pages; provide `x-tmj-ingest-secret`.

## Deployment verification

After applying the Supabase schema and setting Worker variables:

1. Open `/api/health` and confirm `services.ai`, `services.chat`, and `services.documentIndexing` are `true`. Confirm `services.nwuIngestion` is `true` only if that optional secret is set.
2. Create an account using a valid email and password; confirm it can sign in without an email-verification step.
3. Sign out and sign in again; confirm the sidebar shows the shortened email and hides saved history while signed out.
4. Start a new conversation and submit an academic question. Verify the response is saved and can be reopened.
5. Upload a small PDF, DOCX, TXT, or MD file and confirm indexing succeeds.
6. Test at desktop and mobile widths, and check the browser console for runtime errors.

## Scope and privacy

TMJ AI Agent is a general-purpose assistant that can help with everyday questions, dates, calculations, and study material, with a focus on NWU student support. For current NWU requirements, prioritize retrieved official NWU and student-provided material; never invent course requirements, citations, or policy. Verify consequential academic requirements against current NWU module instructions and lecturer guidance.


## Live NWU knowledge search

For each signed-in academic question, the Worker searches NWU's public multisite search using short topic keywords, follows relevant links on public NWU-owned HTTPS hosts, and reads relevant public pages and PDFs. Official results are cited as clickable links in the chat. NWU's public Academic Policies page and Library policy pages can expose newly published documents without manual reindexing. Private eFundi and staff-intranet pages are excluded; the app never asks for NWU login credentials. Users should not include passwords or sensitive personal information in questions because topic keywords are searched on NWU's public site.

Supabase vector search remains in place for the user's own uploaded module material. Uploads are labeled as student material, not official NWU policy. When no NWU-specific evidence can be retrieved, the assistant can still explain general academic concepts, but it must not invent current NWU requirements. It provides the NWU public search link and asks users to verify policy or module instructions with NWU/lecturers.
