# TMJ Brand and Product Polish

## Product and design direction

**Brand essence:** TMJ AI is an independent, practical study companion for NWU students that helps make course material clearer and current university information easier to find. Personality: calm, clear, supportive.

**Design movement:** quiet academic editorial—an uncluttered study workspace rather than a futuristic AI dashboard.

**Core principles:** trustworthy sourcing; clear next steps; privacy-aware defaults; readable mobile-first hierarchy.

**Color philosophy:** retain forest green (`#153E32`) and teal (`#087A68`) for grounded confidence, with lime (`#D9F17C`) as a small recognition accent and mint (`#8DE0C1`) for secondary details. Avoid adding unrelated colors or gradients that dilute the palette.

**Layout paradigm:** preserve the existing chat-first, responsive workspace and compact sidebar. Improve the empty state with a few action-first prompt chips rather than adding decorative panels.

**Signature elements:** one shared TMJ mark; restrained book/page detail in the mark; compact rounded study prompt chips.

**Interaction and motion:** prompt chips fill the composer without auto-sending. Copy and rating actions stay attached to the answer they affect. Use short transitions, obvious focus states, and honor reduced-motion settings. Ratings are local UI state only in this version; no user answer or rating is sent to a new analytics service.

**Typography:** keep the current system sans-serif stack for reliable Android/WebView rendering; use a strong heading/body hierarchy rather than introducing an external font dependency.

**Wordmark and logo:** a crisp white `T` whose lower stem resolves into two open-book page strokes, with one small lime accent, on a forest-green rounded square. Use the same geometry for the website wordmark icon, favicon, Android adaptive icon, and splash screen; keep `TMJ AI Agent` as live text, not text embedded in the icon. Do not use NWU's official logo or imply endorsement.

**Brand voice:** direct and reassuring. Examples: “What are you working through today?” and “Find a current NWU rule.”

## Implementation approach

The website remains static HTML/CSS/vanilla JavaScript served through the existing Cloudflare Worker Assets binding; the authenticated chat keeps its existing behavior while adding D1-backed daily usage status and atomic quota claims. A source-controlled SVG becomes the website's single mark file; a matching Android VectorDrawable supplies legacy, adaptive, and splash presentations. Starter prompts populate the existing composer. Answer controls provide copying plus an honest, session-local useful/not-useful selection without creating a database dependency.

The About/privacy copy will say the product is independent and not an official NWU service; conversations are saved under the signed-in account and can be deleted by conversation; uploaded documents are stored/indexed separately and are not removed by deleting a conversation; relevant question/context may be processed by Cloudflare Workers AI; public NWU search receives topic keywords; and a minimal account-linked daily counter records date and usage counts, not message text or AI-points balance. It will avoid promising a retention period or security property not established by the code.

The Android package remains the existing Java WebView wrapper; add adaptive icon resources and a branded loading/launch panel. Deployment uses the existing GitHub pull-request checks and Cloudflare Workers Build on `main`. Rebuild and verify the debug APK after the web changes are deployed, increasing the Android version code so existing test installs can upgrade.

## Daily usage and upload protection

The pilot will use a hidden per-account cap of 35 chat submissions per UTC day and a shared cap of 350 submissions per UTC day, sized for up to 10 testers with equal per-account access. At most 10 distinct signed-in accounts may start usage in a UTC day, preventing a larger audience from using the intended pilot allocation first. Unused daily capacity is intentionally left unused rather than raising an individual cap; this keeps the allocation predictable. The app will not reveal counts or a points balance. The authenticated Worker will use an atomic Cloudflare D1 counter for per-account, active-account, and shared enforcement; only eligibility and a reset timestamp are returned. Limits reset at 00:00 UTC (02:00 South African time). The frontend disables the send control and shows a return-tomorrow notice at the cap, rechecking at reset and on return to the page. Provider-side Workers AI availability is separate: under the currently documented 10,000-Neuron free allocation, the app's limits cannot guarantee that all 35 daily chats will be served.

Document indexing has a cumulative 40 MiB per-user daily byte budget, independent of the chat request limits, with no file-count cap or separate 2 MiB cap; one file may be as large as the remaining daily upload budget. Multiple files can be selected together and are uploaded/indexed sequentially. The Worker validates format and byte size, extracts text before embedding, enforces extracted-text/chunk limits, atomically claims bytes, and refunds the claim if embedding or persistence fails. Text extraction covers PDF, legacy and OOXML Office (including PPTX/XLSX), OpenDocument, RTF, CSV, plain text, Markdown, HTML, EPUB, and TeX; scanned PDFs without an embedded text layer are not OCR-processed. The student interface hides technical size and format guidance. D1 stores UTC day, pseudonymous Supabase user ID, chat/upload counts, and cumulative upload bytes.

The cap is intentionally a request allotment, not exact per-user Neuron telemetry: Workers AI Neurons vary with generated/input tokens and other workloads may use the same Cloudflare account allocation. The previous estimate for 80 chats was roughly 5,886 Neurons; scaling that profile to 350 chats, plus the prior 174-Neuron upload/embedding estimate, gives an illustrative total of about 25,925 Neurons. Cloudflare's official pricing page, updated 2026-10-01, documents 10,000 Neurons/day free; usage above it requires Workers Paid and is priced at $0.011 per 1,000 Neurons. This is not a billing guarantee, and other account workloads add usage. Do not promise that every chat-cap allotment is available on the free AI quota or that the application cap guarantees the Cloudflare account cannot be exhausted externally.
