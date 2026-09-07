# Frontend Agent Rules

For all general operating contracts, rules, system design, and AI agent instructions, **see `CLAUDE.md` on the `main` branch**. 

This file is a thin pointer as mandated by the `DEV_GUIDE.md`.

## Domain-Specific Rules (Frontend)
- The frontend is built using Next.js (App Router), TailwindCSS, and pnpm.
- Only web application logic goes here. Do not build background OS clipboard monitors here.
- Strict conformance to the internal folder boundaries (`src/routes/`, `src/features/`, `src/components/`, `src/api/`, `src/lib/`) is required.
