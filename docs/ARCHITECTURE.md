# TMJ AI Agent Architecture

## Identity
TMJ AI Agent is an education-only assistant built for NWU students. Developer: TJ Mailula (mailulajosep@gmail.com).

## NWU source hierarchy
1. Official NWU resources.
2. Current student-provided module documents.
3. Reputable academic sources.
4. General web sources only when needed.

NWU's official eFundi platform is the LMS used for module resources, communication and assessments. TMJ AI must complement—not impersonate or replace—official NWU systems.

## Retrieval roadmap
The current MVP establishes the agent boundary. The next production phase should add retrieval-augmented generation (RAG):
- approved NWU public pages
- NWU module resources legally available to the application
- user-uploaded PDFs/slides/notes
- indexed metadata: module code, faculty, year, study unit, source type, date
- citations in answers
- freshness checks for time-sensitive academic rules

Do not scrape private eFundi accounts or ask students for their NWU password. Any private-content integration must use an authorised mechanism.

## Authentication
Supabase Auth handles accounts. Supabase Postgres stores conversations/messages. Row Level Security ensures a user can only access their own data.

## AI boundary
The server-side prompt is the primary scope guard. Production should add a lightweight academic-scope classifier before expensive model calls and enforce rate limits.

## Production roadmap
1. Configure Supabase and authentication.
2. Add AI provider secret to Netlify.
3. Implement conversation persistence in the server function.
4. Add document upload and extraction.
5. Build NWU knowledge base/RAG.
6. Add source citations.
7. Add module selection/profile.
8. Add monitoring, abuse controls and rate limits.
