# A foundation proportional to the project

Reuse existing conventions. Separate the first user-facing entry point, domain behavior and external I/O where that creates a useful test seam; a small project does not require a layered framework.

Document real run/test commands and one meaningful behavior check. Use the selected language's normal formatter, type checking where applicable and test runner. Include secret/environment handling only where needed. Keep architecture and test rationale beside the code or in a concise README/AGENTS.md; create dedicated documents as they earn their place.

Templates are optional fragments. Do not copy every template or require a feature flag, shared abstraction, UI registry, catalog, monorepo or release pipeline for a prototype.
