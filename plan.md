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

The website remains static HTML/CSS/vanilla JavaScript served through the existing Cloudflare Worker Assets binding; the current authenticated chat and APIs remain unchanged. A source-controlled SVG becomes the website's single mark file; a matching Android VectorDrawable supplies legacy, adaptive, and splash presentations. Starter prompts populate the existing composer. Answer controls provide copying plus an honest, session-local useful/not-useful selection without creating a database dependency.

The About/privacy copy will say the product is independent and not an official NWU service; conversations are saved under the signed-in account and can be deleted by conversation; uploaded documents are stored/indexed separately and are not removed by deleting a conversation; relevant question/context may be processed by Cloudflare Workers AI; public NWU search receives topic keywords. It will avoid promising a retention period or security property not established by the code.

The Android package remains the existing Java WebView wrapper; add adaptive icon resources and a branded loading/launch panel. Deployment uses the existing GitHub pull-request checks and Cloudflare Workers Build on `main`. Rebuild and verify the debug APK after the web changes are deployed, increasing the Android version code so existing test installs can upgrade.
