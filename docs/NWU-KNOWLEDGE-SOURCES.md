# NWU public knowledge retrieval

TMJ AI searches publicly available NWU pages live for each academic question, then fetches relevant official pages and linked PDFs when they are publicly readable. Search results and document content are refreshed at request time; the assistant does not depend on a pre-populated NWU-only vector table. Existing Supabase vectors remain available for student-authorised uploads and any separately indexed official material.

## Verified public NWU entry points

- [NWU multisite search](https://www.nwu.ac.za/multisite-search?search_api_fulltext=academic%20integrity) — the public site form uses `GET /multisite-search?search_api_fulltext=<keywords>`. Its HTML contains result titles, direct page URLs, snippets, and search-index dates. The application sends a short normalized topic query, not authentication credentials.
- [NWU Academic Policies](https://www.nwu.ac.za/governance-and-management/academic-policies) — public page listing current official academic-policy documents. As checked on 2026-09-30, it linked to a 2025 Academic Integrity Policy, 2026 Senate Rules on Academic Integrity (including rules on ethical AI use), a 2025 AI policy, 2025 Admissions Policy, 2024 General Academic Rules, and Student Discipline documents. These links are discovered from the live page rather than frozen into the answer.
- [NWU Policies and Rules portal](https://www.nwu.ac.za/gov_man/policy/index.html) — public classified policy portal and links to its alphabetical policy listing.
- [NWU Library: Research and Open Scholarship Policies](https://library.nwu.ac.za/research-policies) — public links to the NWU Open Access Policy, Research Data Management Policy and associated rules, plus current research-support material.
- [NWU Library Support Guides](https://library.nwu.ac.za/support-guides) — public library guides and study/research support material.

## Safety and citation policy

- Only HTTPS NWU-owned hosts ending in `.nwu.ac.za` are eligible; known private/authenticated hosts such as eFundi and the staff intranet are explicitly excluded. Redirects are revalidated. No NWU password, cookie, or session is requested or used.
- PDF/page downloads are bounded by size and timeout. Retrieved pages and their snippets are untrusted evidence, not instructions.
- The assistant returns structured source titles/URLs; the UI renders clickable citations separately from the generated answer. It must not invent a citation or show a “no sources” block. General academic concepts may still be explained, while unsupported current NWU policy or module-specific claims must be identified as unverified.
- The user's normalized topic keywords are sent to NWU's public search page to obtain live results. Users should not include passwords or sensitive personal information in academic questions.
- Student uploads remain private, user-owned material and must not be described as official NWU policy.

## Protected manual indexing

`POST /api/index-nwu` remains available for an administrator's authorized, public NWU source URL. It requires the existing `x-tmj-ingest-secret`, accepts only public NWU URLs, and can index readable HTML, text, or PDF sources. It never accesses private eFundi content. It is optional; query-time live search does not require this ingestion route or a populated official-document table.
