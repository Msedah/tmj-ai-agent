# TMJ Community AI — Product and Implementation Plan

## Product and design direction

**Brand essence:** TMJ AI Agent is a general-purpose AI companion for everyday questions and useful public information, with a home-community focus on Sekororo/Ga-Sekororo, Metz, Tzaneen and Limpopo. It should make practical knowledge easier to reach for local residents without pretending to be a government service. Personality: grounded, clear and helpful.

**Design movement:** civic-service editorial—an uncluttered, mobile-first chat with the clarity of a well-organized local information desk, not a futuristic AI dashboard.

**Core principles:** general-purpose usefulness; official-source transparency; local relevance without overclaiming; private-by-default handling of personal questions.

**Color philosophy:** retain forest green (`#153E32`) and teal (`#087A68`) for grounded confidence, with lime (`#D9F17C`) as a small recognition accent and mint (`#8DE0C1`) for secondary details. Keep the palette calm and accessible rather than adding unrelated bright colors.

**Layout paradigm:** keep the existing chat-first responsive workspace and compact sidebar. Add a separate community-information page for local forecast and official service/job/notice sources, and use the existing conversation flow for research summaries and explanations. On mobile, keep the composer compact and let its controls wrap without covering the message field.

**Signature elements:** a shared TMJ mark; compact prompt chips centered on practical community questions; visible source and freshness labels beside researched answers.

**Interaction and motion:** prompt chips fill the composer without auto-sending. A reply-language selector controls the next answer without a separate translation call. Local information remains a link away in the sidebar. Copy and rating actions stay attached to the answer they affect. Use short transitions, clear keyboard focus and honor reduced-motion preferences.

**Typography:** keep the current system sans-serif stack for reliable Android/WebView rendering; use a strong heading/body hierarchy rather than adding an external font dependency.

**Wordmark and logo:** keep the crisp white `T` whose lower stem resolves into two open-book page strokes, with one small lime accent, on a forest-green rounded square. Use the same geometry for website and Android assets; keep `TMJ AI Agent` as live text. Do not use another institution's or public agency's logo or imply endorsement.

**Signature brand color:** forest green (`#153E32`), paired with the existing teal for actions.

**Brand voice:** direct, respectful and practical. Examples: “Ask anything. We’ll help you find the next step.” and “Check the official notice and closing date.” Avoid promising that an item exists before an official source has been checked.

## Implementation approach

The website remains static HTML/CSS/vanilla JavaScript served by the existing Cloudflare Worker Assets binding. The Worker keeps Supabase authentication, conversation persistence, document indexing, D1 daily quota enforcement, Cloudflare Workers AI and the existing admin security. On relevant time-sensitive local questions, it should consult a curated, allowlisted set of public official sources, extract concise evidence and return clickable citations; it must say when a source cannot be verified instead of inventing current information. The source registry and supported weather provider are documented in the repository so they can be maintained as official pages change.

A same-origin forecast route serves the approximate Ga-Sekororo area without requesting phone GPS or accepting arbitrary coordinates. The community page attributes its forecast provider and makes clear that a model forecast is not an official severe-weather warning. A response-language preference for English, Sepedi, Xitsonga or Tshivenda is passed to the existing chat call, not to a second translation service. The About page discloses cloud processing, public-source queries, approximate location, and that AI-generated local-language translations may need correction.

The About/privacy copy continues to explain that conversations are saved under the signed-in account and can be deleted by conversation; user files and extracted text are associated with their conversation; questions and relevant retrieved passages may be processed by Cloudflare Workers AI; and the minimal D1 daily counter stores account-linked usage metadata rather than message content or an AI-points balance. Do not promise retention periods or security guarantees not established by the code.

The separate Android APK remains the existing Java WebView wrapper pointed at production. Changes to the served web app are visible through that wrapper after deployment; do not rebuild the APK unless native wrapper assets or behavior change. Deployment continues through the existing GitHub pull-request checks and Cloudflare Worker build.

## Existing access, AI and upload constraints

- The default account chat limit remains 60 requests per UTC day. The shared pilot remains limited to 350 daily chat requests across at most 10 active accounts. The app does not proactively show users a points balance or the separate image allowance.
- The TMJ-managed Workers AI budget remains 9,000 estimated Neurons/day for shared users and 1,000 reserved for the allowlisted owner. The shared budget reserves 1,000 Neurons for image creation and 8,000 for chat/embeddings. One successful image per account is allowed each UTC day, enforced by the existing atomic daily claim and cross-midnight completion lock.
- AI-Neuron estimates are TMJ-only usage controls; other Cloudflare workloads can consume the same account allocation. Do not imply the application can guarantee the account's remaining provider-side allowance.
- Document indexing retains its 40 MiB per-user daily byte budget, with no file-count cap or separate 2 MiB cap; one file may be as large as the remaining daily budget. Multiple files may be selected together. Preserve the existing format validation, extraction, quota claims and refund-on-failure behavior.
- Admin access remains restricted to the configured UUID allowlist and exact verified email. Do not relax admin checks or expose email/message content in general community APIs.

## Project structure

- `public/`: chat, About, community-information page, styles, frontend behavior and static brand assets.
- `src/index.js`: Worker routing, authentication, quotas, chat, uploads, citations, image generation and admin APIs.
- `src/community-sources.js`: official public-source registry, query routing and safe on-demand retrieval for local research.
- `src/ai-usage.js`: daily Neuron accounting, reservation and settlement.
- `migrations/`: Supabase schema changes and the ordered D1 usage/activity/image migrations; applied migration history must remain immutable.
- `tests/`: Worker quota/security/retrieval tests and browser-UI interaction tests.

No production deployment is complete until the relevant regression tests and required GitHub/Cloudflare checks pass and the public Worker is verified with safe, non-consuming smoke tests.
