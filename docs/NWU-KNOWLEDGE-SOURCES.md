# NWU RAG source registry

These are public NWU sources intended for the official-knowledge ingestion process. Private eFundi course material is not scraped or copied by TMJ AI. Students can upload their own authorised module material.

## Initial official sources
- https://efundi.nwu.ac.za/
- https://library.nwu.ac.za/
- https://library.nwu.ac.za/library-services-efundi
- https://library.nwu.ac.za/support-guides
- https://services.nwu.ac.za/centre-teaching-and-learning/academic-integrity
- https://library.nwu.ac.za/research-support-services

## Policy
Official NWU material should be labelled `nwu_official`. Student uploads remain `student_upload` and are not presented as official NWU sources.

## Ingestion
After deployment, use the protected `index-nwu` Netlify function with `x-tmj-ingest-secret` to index one public URL at a time. Do not provide private eFundi credentials or attempt to bypass NWU authentication.
