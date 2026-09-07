# Project presentation

The deck used to present code-paste. Single self-contained file, no build step, no network
dependency — `index.html` opens directly in any modern browser, including offline and from a USB
stick.

```bash
# macOS
open docs/presentation/index.html
# Windows
start docs\presentation\index.html
# Linux
xdg-open docs/presentation/index.html
```

## Presenting

| Key | Action |
|---|---|
| `→` `Space` `PageDown` | Next slide |
| `←` `PageUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `F` | Toggle fullscreen |

The slide number is written to the URL, so `index.html#7` opens straight to slide 7 — useful when
you need to jump to the security slide in a Q&A.

## Exporting to PDF

Click **Export PDF** in the bottom bar, or print the page.

- Paper size: the deck sets `@page { size: 1280px 720px }`, so it exports 16:9 with no margins.
- In the browser print dialog, enable **Background graphics**. Without it the dark slides print
  white and the status chips lose their fills.
- One slide per page is enforced by `break-after: page`.

## Slides

| # | Slide | Source of truth |
|---|---|---|
| 1 | Title | — |
| 2 | The problem | — |
| 3 | The promise | `docs/PRODUCT_PRINCIPLES.md` |
| 4 | What it looks like | product screenshots (placeholders) |
| 5 | The constraint | `docs/ADR-002-NATIVE-BACKGROUND-AGENT.md` |
| 6 | Architecture | `docs/ADR-001-LAN-FIRST.md`, `docs/SYSTEM_DESIGN.md` §3 |
| 7 | Discovery is not authorisation | `docs/SECURITY.md`, `docs/SYSTEM_DESIGN.md` §7 |
| 8 | Sharing | `docs/DESIGN_SYSTEM.md` §8.2 |
| 9 | Design system | `docs/DESIGN_SYSTEM.md` §0–3 |
| 10 | Privacy | `docs/SECURITY.md` |
| 11 | Where the project stands | `contracts/`, counted at time of writing |
| 12 | Roadmap | `docs/SYSTEM_DESIGN.md` §24 |
| 13 | Close | — |

Every figure on slide 11 was counted from the repository, not estimated. If you re-present after
the contracts change, recount:

```bash
ls contracts/vectors/valid | wc -l          # must-accept vectors
ls contracts/vectors/invalid | wc -l        # must-reject vectors
grep -cE '^  /' contracts/openapi/control-plane.yaml   # endpoints
ls docs/ADR-*.md | wc -l                    # ADRs
```

## Replacing the image placeholders

Four placeholders ship with the deck. Each states the exact crop, format and filename it expects.
See `assets/README.md` for the full shot list.

To swap one in, replace the `<figure class="ph">…</figure>` block with:

```html
<img src="assets/agent-synced.png" alt="Desktop agent showing two devices in the synced state"
     style="width:100%;height:280px;object-fit:cover;border-radius:8px;border:1px solid #DFE3E8">
```

Keep the `height` matching the placeholder's `--ph-h` so the row stays aligned, and always write a
real `alt` description.

**Do not screenshot real clipboard content.** `docs/SECURITY.md` forbids clipboard data in
analytics and support material, and a slide deck is the most widely copied artefact a project has.
Use synthetic fixtures — the same rule `docs/TEST_STRATEGY.md` applies to test data.

## Design notes

The deck consumes the tokens in `docs/DESIGN_SYSTEM.md` verbatim — the same hex values, the 4px
spacing grid, the radius and elevation scales, and the 1600ms live-share pulse.

Type is the one deliberate departure. Product UI is built on a 14px body, which is unreadable from
the back of a room, so the deck uses a **projection scale** — 64px titles, 24px lead, 18px body —
while keeping the system's families, weights (400/500/600 only) and tracking rules. This is a
presentation-only scale and must not be copied back into the product.

The deck is a fixed 1280 × 720 stage scaled to fit the viewport, so every slide has identical
margins and optical rhythm at any window size, and the PDF export is pixel-identical to the screen.

Accessibility: the pulse animation is disabled under `prefers-reduced-motion`, every decorative SVG
is `aria-hidden`, the architecture diagram carries a full text description in its `role="img"`
label, and focus rings on the navigation controls meet the 3:1 floor from `docs/DESIGN_SYSTEM.md`
§14.
