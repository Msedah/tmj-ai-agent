# TMJ AI Agent Architecture

## Identity
TMJ AI Agent is a general-purpose assistant with a focus on North-West University (NWU) students. Developer contact details are intentionally not displayed in the interface. If a user explicitly asks about the developer, creator, or why the app was built, the assistant shows the approved developer profile with a concise, professional summary of TJ Mailula's progressive-programming and practical-automation interests and the app's student-support purpose.

## NWU source hierarchy
1. Current public official NWU pages and documents discovered through NWU's live multisite search.
2. Current student-provided module documents, clearly labeled as user uploads rather than official policy.
3. Reputable academic sources or general academic knowledge when useful; distinguish this from NWU-specific evidence.

NWU's eFundi platform remains the official learning management system for module resources, communication, and assessments. TMJ AI complements—not impersonates or replaces—official NWU systems. It does not scrape private eFundi courses or ask students for their NWU password.

## Retrieval
The Worker runs NWU's public multisite search for normalized question keywords, checks public official results, and fetches relevant public pages and linked PDFs within size/time bounds. Current policy pages can expose newly published or revised PDFs without a manual database reindex. Supabase pgvector remains available for user-authorized uploads and separately indexed materials. Answers return structured source links so the interface, not the language model, renders citations.

Unsupported current NWU policy or module-specific claims must not be invented. The assistant answers general questions even when no NWU or document source is relevant. Date-sensitive questions receive the current UTC clock and South African local time at runtime; when no source verifies a current NWU-specific rule, it still gives useful guidance while making the unverified detail explicit and providing a link to NWU's live public search.

## Authentication and privacy
Supabase Auth handles email/password accounts. Supabase Postgres stores conversations/messages. Row Level Security ensures a user can only access their own data. Private conversation history and uploads stay hidden from signed-out users. Live source discovery sends only normalized question keywords to NWU's public search endpoint; users are advised not to include passwords or sensitive personal data.

## AI boundary
Cloudflare Workers AI provides chat and embeddings. Retrieved public pages and uploads are untrusted evidence and are never instructions. The assistant handles general user questions as well as NWU study support, and uses a trusted runtime clock for date-sensitive answers.
