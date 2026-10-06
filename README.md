# TMJ AI Agent

TMJ AI Agent is a general-purpose AI assistant with a community-information focus on Sekororo/Ga-Sekororo, Ga-Mamahlola, Metz/Moetladimo, Maruleng, Mopani District and wider Limpopo. It is an independent service—not a government, municipality, employer or weather authority.

## Features

- Email/password authentication through Supabase Auth; email is the account label and is shortened in the sidebar when long.
- User-scoped saved conversations and private document uploads.
- General-purpose AI chat, with conversation-scoped document retrieval. English is the default; users can request a translation directly in their message.
- On-request public-source retrieval for relevant official vacancies, notices, municipal pages, services, tenders and public-works information. Results are linked and the fetch time is reported separately from dates shown near a listing.
- Curated community directory with official-source links and a dated snapshot of verified local place names and contacts.
- Ga-Sekororo forecast model snapshot from Open-Meteo, including provider retrieval time and model-valid time. It uses a representative locality point, not the device's GPS or a measurement at a named facility.
- On-demand image creation through Cloudflare Workers AI.
- Responsive chat interface and separate community, About and admin pages.
- Android WebView wrappers are maintained separately from the Worker website; they load the production web application.

## Local names and information quality

The location context distinguishes **Sekororo, Maruleng Local Municipality, Mopani District, Limpopo** from Tzaneen; it does not label Sekororo as part of Tzaneen municipality. Official records reviewed for this release use names including **Sekororo hospital**, **SEKORORO clinic**, and **Moetladimo Branch**. The reviewed Post Office source does not identify an official branch called “Metz Post Office.” **Mahlakung Shopping Centre** is the documented project name. The directory shows its source and a 5 October 2026 review date; contacts, addresses and operating status must be confirmed with the linked provider.

Current official pages are fetched only when a user's question is relevant to current jobs, notices, projects or public services. The question itself is not added to outgoing source-site URLs or request parameters. Source pages can be undated, delayed or contain historical archives. The assistant must not describe an old advert, tender award or notice as current without checking its date and status. A citation's “fetched by TMJ” time is not the source's publication date.

The weather endpoint uses Open-Meteo numerical forecast data for a representative GeoNames locality point. Model values are not a live station observation, and forecasts may be edge-cached for up to 15 minutes. Follow the South African Weather Service for official warnings. Open-Meteo's free tier is for non-commercial use; switch to an eligible commercial plan or another provider before monetizing this feature. Attribution and CC BY 4.0 links are shown in the UI.

## Architecture

- Worker entry point: `src/index.js`
- Community public-source registry and bounded retrieval: `src/community-sources.js`
- Forecast provider adapter: `src/local-weather.js`
- Static site assets: `public/`
- Supabase schema and row-level security: `supabase/schema.sql`
- Cloudflare config and Workers AI binding: `wrangler.jsonc`
- CI: `.github/workflows/ci.yml`
- The older Netlify fallback has been retired; Cloudflare is the supported deployment path.

The active Worker uses `@cf/meta/llama-3.2-3b-instruct` for chat and `@cf/baai/bge-small-en-v1.5` for embeddings. No OpenAI API key is used by the Cloudflare Worker. The vector search stores Cloudflare's 384-dimensional vectors separately in `embedding_cloudflare`; an older `embedding` column and its data, if present, are left untouched.

## Required services and setup

1. In the Supabase SQL Editor, run `supabase/schema.sql`. It creates the conversation, message, document, and chunk tables, the Cloudflare vector-search function, the private Storage bucket and row-level security policies. The script is safe to rerun and preserves any pre-existing OpenAI embedding column/data. Apply later Supabase migrations under `migrations/` when released.
2. In Supabase **Authentication → Sign In / Providers**, configure email/password sign-in as intended. Turning off email confirmation permits account creation without proving control of the address; users should use an address they own.
3. Set Worker values in **Cloudflare Dashboard → Workers & Pages → `tmj-ai-agent` → Settings → Variables and Secrets**. The Workers AI binding named `AI` is declared in `wrangler.jsonc`; it does not need a separate AI provider API key.

| Name | Required | Handling |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL; keep consistent with the public client config in `public/app.js`. |
| `SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key; safe for browser use with correct RLS, and used by the Worker for user-token validation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for document indexing and admin authorization | **Secret; server only. Never put this in browser code or commit it.** |

### TMJ ADMIN

The separate, mobile-friendly admin page is available at `/admin` and in the TMJ ADMIN Android wrapper. It uses TMJ email/password sign-in and does not offer account creation. Dashboard access is denied unless the Supabase Auth UUID is explicitly present in `public.tmj_admin_users`; the table has RLS enabled and service-role-only access. The migration `migrations/0005_tmj_admin_users.sql` intentionally grants no account automatically. Do not authorize an account by email or put an admin password in the app.

The D1 binding uses `migrations/d1` as its dedicated migration directory. It stores daily usage, upload-byte accounting, per-account chat allocations, a pseudonymous AI Neuron ledger, authenticated activity, image-generation event records, and the account-wide image-claim/success lock. The lock prevents an inference crossing UTC midnight from opening a second daily image slot; image usage and admin totals are dated at successful completion. Use `npx wrangler d1 migrations list tmj-ai-agent-usage --remote` to inspect pending changes and `npx wrangler d1 migrations apply tmj-ai-agent-usage --remote` to apply them.

### Quotas and limits

- Default: **60 chats per account per UTC day**; global hard ceiling: **350 chats/day** and the existing **10-account pilot cap**.
- Daily image allowance is enforced server-side per account, and image claims are race-protected across UTC midnight.
- Of the TMJ-managed daily AI budget, **9,000 estimated Neurons** are shared for non-owner accounts and **1,000** are reserved for the allowlisted owner. Within the shared pool, 1,000 Neurons are separately reserved for image generation and 8,000 for chat/embeddings.
- Chat calls settle using Workers AI-reported token counts; embeddings and image calls use conservative estimates. These are TMJ-only estimates, not Cloudflare account-wide billed usage. Other Cloudflare workloads can consume the same account-level 10,000-Neuron free allocation.
- The Cloudflare Workers AI free allowance is 10,000 Neurons/day; Neurons are not a fixed number of tokens or chats. Requests can fail after the allowance is reached; Paid-plan overage may incur charges. Check Cloudflare's [current pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) before changing limits or models.
- A single document upload is bounded to 40 MiB. Upload indexing consumes the same AI budget as other Worker inference.

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

- `GET /api/health` — reports readiness booleans and whether the community/weather routes are included. It does not probe upstream weather service availability or remaining daily quota.
- `GET /api/community/sources` — read-only curated source directory and dated place records.
- `GET /api/weather` — Ga-Sekororo Open-Meteo forecast snapshot; upstream response may be edge-cached for up to 15 minutes.
- `POST /api/chat` — authenticated question or task, relevant conversation-specific evidence, optional official-source/forecast retrieval, and conversation persistence.
- `POST /api/generate-image` — authenticated prompt-based image generation; D1 stores account/claim/completion timestamps, not prompt or image bytes.
- `GET /api/admin/dashboard` — daily aggregates and account activity, accessible only to the UUID-allowlisted owner with the required exact verified email.
- `PUT /api/admin/users/{id}/chat-limit` — admin-allowlisted daily account limit, bounded to 0–350 and audited by administrator ID.
- `DELETE /api/conversations/{id}` — authenticated deletion of the signed-in user's conversation and related messages.
- `POST /api/index-document` — authenticated indexing of an uploaded user document.

Student uploads stay associated with the conversation where they were indexed. Reopening a recent conversation restores its document cards, and retrieval can use that conversation's uploads only. Deleting a conversation removes its associated document records and private storage files.

The admin dashboard unions authenticated sign-in activity with daily usage rows, so sign-ins without chats and usage-only rows remain visible. D1 activity stores only account UUIDs and first/last authenticated timestamps—not email addresses or message content; email is resolved only for the authorized admin view.

## Deployment verification

After applying the Supabase schema and setting Worker variables:

1. Open `/api/health`; confirm chat, AI and document-indexing services are ready. The community/weather booleans confirm route wiring only; the first real weather request is the upstream availability check.
2. Open `/api/community/sources`; confirm the groups, official links and dated place records load.
3. Open `/api/weather`; confirm provider data, `retrievedAt`, `validTime`, and the representative location point are present.
4. Sign in and ask for a current local vacancy or public notice. Confirm citations open official domains, check times are separate from source dates, and expired/undated records are not described as open/current.
5. Ask a few general and current-information questions; verify official titles, locations and dates against the linked source pages.
6. Test document upload, image creation, and the chat interface at desktop and mobile widths; check the browser console for runtime errors.
