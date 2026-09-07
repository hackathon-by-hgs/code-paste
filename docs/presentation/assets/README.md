# Presentation assets

Drop finished image files in this folder using the exact filenames below. The deck references them
by these names, so a correctly named file is the only step needed — see
`../README.md` → "Replacing the image placeholders" for the markup swap.

This folder is intentionally committed with only this file. It is the shot list.

## Shot list

| Filename | Slide | Crop | Format | What it must show |
|---|---|---|---|---|
| `agent-synced.png` | 4 | 720 × 960 @2x | PNG | Desktop agent popover at its real 360 × 480 size, two devices listed, one `Synced` and one `Paused`, pause toggle visible on the card face |
| `web-devices.png` | 4 | 2240 × 1400 @2x | PNG | Web app device list, four devices across mixed platforms, one showing `Revoked` at 60% opacity |
| `mobile-share.png` | 4 | 828 × 1792 @3x | PNG | OS share sheet with code-paste as a share target, mid-gesture |
| `qr-repo.svg` | 13 | 600 × 600 | SVG | QR code for `github.com/hackathon-by-hgs/code-paste`, quiet zone included |

## Rules

**Never screenshot real clipboard content.** Use synthetic fixtures only — no real passwords, API
keys, personal data, or anything from your own clipboard history. `docs/SECURITY.md` bans clipboard
data from support material and analytics, and a deck travels further than either.

Safe fixture content for screenshots:

```text
text/plain    "Meeting moved to Thursday 14:00"
text/plain    "https://example.com/design-review"
image/png     a solid-colour test card, or a UI screenshot of this project
```

Other requirements:

- **Light theme** for all product screenshots. The deck slides they sit on are light, and a dark
  screenshot on a light slide reads as a rendering error from the back of the room.
- **Real rendering only.** No mockup frames, no perspective transforms, no device bezels — the
  product is the subject, and a bezel costs 30% of the pixels.
- **Redact nothing after the fact.** If a shot needs a black bar, re-take it with fixture data.
  Blurred redaction in a slide is a tell that the process was wrong.
- Device names in screenshots should be generic: `MacBook Pro`, `Pixel 8`, `Studio Desktop`.
- Keep files under 1 MB each. A deck that is slow to open gets presented from a stale export.
