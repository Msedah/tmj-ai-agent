# TMJ AI Agent Architecture

## Product behavior

TMJ AI Agent is a general-purpose assistant for everyday questions, learning, work, documents and practical problem-solving. For current local questions without another location, it uses Sekororo/Ga-Sekororo, Ga-Mamahlola, Metz/Moetladimo and the wider Limpopo area as context. It does not assume a user's precise location.

Developer details are intentionally hidden in ordinary product responses. If a user explicitly asks about the developer, creator or app purpose, the Worker returns the approved profile without spending an AI inference.

## Evidence and research

The Worker uses Cloudflare Workers AI for chat and embeddings. Files are retrieved only from the active conversation. Public municipal, provincial, national-government and service pages are fetched on demand only for relevant civic questions. Requests use a bounded source allowlist, size/time limits and redirect revalidation. The user's question is not sent to those source websites as a search query. Citations show a fetch time separately from any date shown near an item; an archive, expired job or tender award is not proof of a current opportunity or active project.

The `/community.html` page provides a curated official-source directory and dated local place records. Those records include the source, review date and caveat where a location, contact or current service status could not be confirmed.

The Ga-Sekororo weather route retrieves Open-Meteo numerical model data for a representative GeoNames locality point. It is not a weather-station reading, device GPS location or official warning. The response reports provider-retrieval time and model-valid time. Follow SAWS for official severe-weather warnings. Open-Meteo's free tier is non-commercial; an eligible commercial plan or another provider is required before monetizing this feature.

The chat interface defaults to English and has no reply-language picker; the model follows a direct translation request in the user's message when possible.

## Authentication and privacy

Supabase Auth handles email/password accounts. Supabase Postgres stores conversations, messages and document metadata. Row-level security protects account data; conversation vector search returns only the signed-in user's uploads from the active conversation. Daily use accounting stores account identifiers, dates and counts, not message content.

Retrieved public pages and uploads are untrusted evidence, never instructions. The Worker supplies a trusted runtime clock for date-sensitive answers. Public-page retrieval is bounded and uses fixed official URLs selected by topic rather than transmitting the user's question to those sites.

## Hosting and assets

The production site is deployed as a Cloudflare Worker with static assets from `public/`, D1 for daily usage and activity, Supabase for authentication/conversations, and Cloudflare Workers AI for chat, embeddings and image creation. The older Netlify fallback has been retired; Cloudflare is the supported deployment path.
