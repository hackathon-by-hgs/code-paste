# Design System

**Status:** v0.1 — accepted starting point. Changes follow §15.
**Audience:** frontend, desktop and mobile implementers.
**Owner:** Product design.

This document is the visual and interaction contract for every client surface: the web app, the
desktop agent, and mobile.

It lives on `main` for the same reason `docs/PROTOCOL.md` does: three domain branches render the
same states, and they must render them identically. The status vocabulary (§8) and the copy rules
(§9) are contracts, not suggestions — treat a divergence the way you would treat a protocol
divergence.

Read alongside `docs/RULES.md` §1 (product) and §10 (UX), and `docs/SECURITY.md` (privacy UX).

---

## 0. The idea this system exists to serve

The hard problem in this product is not aesthetics. It is **legibility of trust**.

A user must know, without understanding networking:

1. Is my clipboard syncing right now?
2. Which of *my* devices can receive it?
3. Is anyone **else** able to receive it?
4. How do I stop that, immediately?

So the system is built on one hard split:

| Meaning | Family | Rule |
|---|---|---|
| My own devices, product chrome, normal interaction | **Blue** | Default for everything |
| **Someone else can receive this clipboard** | **Violet** | Reserved. Only while a share session has a non-self member |
| Irreversible or trust-reducing action | **Red** | Revoke, remove, end session |

Violet is never decorative and never a brand accent. If violet is on screen, someone outside the
account can receive the clipboard. Every implementer must hold this rule.

---

## 1. Color primitives

Primitives are raw values. **Components must never reference them directly** — use the semantic
tokens in §3.

### Blue — brand, primary action

```text
blue-50   #EAF2FF
blue-100  #D6E4FF
blue-200  #ADC8FF
blue-300  #7FA6FB    dark-mode link / text
blue-400  #4E82F2    dark-mode fill, focus ring
blue-500  #2563EB    primary fill, white label
blue-600  #1D4FD8    primary text / link on light
blue-700  #1A3FAD    pressed
blue-800  #17337F
blue-900  #132A5E
```

### Violet — live sharing only

```text
violet-50   #F3EEFE   banner background
violet-100  #E7DDFD
violet-300  #B69BF6   dark-mode text
violet-400  #9A6EF2   dark-mode fill
violet-500  #7C3AED   live indicator fill
violet-600  #6B21D4   live text on light
violet-900  #3B1178
```

### Neutral — cool tinted

```text
neutral-0    #FFFFFF
neutral-25   #FBFCFD
neutral-50   #F6F8FA   light canvas
neutral-100  #EDF0F3   hover fill, skeleton
neutral-200  #DFE3E8   subtle border
neutral-300  #C7CDD6   strong border, disabled text
neutral-400  #9AA3B0   placeholder, muted icon
neutral-500  #6E7887   tertiary text — metadata only
neutral-600  #545D6B   secondary text
neutral-700  #3D4552
neutral-800  #272D38
neutral-900  #171C24   primary text
neutral-950  #0D1117   dark canvas
```

### Status

```text
success-50 #E6F6EF   success-300 #4FD3A0   success-500 #12A473   success-600 #0E8A5F
warning-50 #FDF3E2   warning-300 #F5BE4A   warning-500 #D98A00   warning-600 #A66A00
danger-50  #FDEDEC   danger-300  #F58C87   danger-500  #E04640   danger-600  #C7302B
```

---

## 2. Color law

These are review-blocking rules.

1. **Green never means "same Wi-Fi."** Green means authenticated, authorized, connected. A peer
   that has been discovered but not verified renders **neutral**, never green. Discovery is not
   authorization (`docs/SECURITY.md`).
2. **Violet appears only while a share session is live with a non-self member.** Personal
   multi-device sync is blue. No violet in product chrome, empty states, or icons.
3. **Red is for irreversible or trust-reducing actions only** — revoke, remove, end session, sign
   out everywhere. Form validation is `status/error` text plus an icon, not a red button.
4. **Never color alone.** Every status carries an icon *and* a text label.
5. Contrast floors: **4.5:1** for body text, **3:1** for borders, icons and large text. The
   pairings below are chosen to meet this; verify in the token build rather than by eye.

---

## 3. Semantic tokens

This is the layer components consume.

| Token | Light | Dark |
|---|---|---|
| `bg/canvas` | `neutral-50` | `neutral-950` |
| `bg/surface` | `neutral-0` | `#151B23` |
| `bg/raised` | `neutral-0` | `#1C2430` |
| `bg/sunken` | `neutral-100` | `#0A0E14` |
| `bg/hover` | `neutral-100` | `#212A36` |
| `bg/selected` | `blue-50` | `#16233D` |
| `border/subtle` | `neutral-200` | `#2A3341` |
| `border/strong` | `neutral-300` | `#3A4553` |
| `border/focus` | `blue-500` | `blue-400` |
| `text/primary` | `neutral-900` | `#E8ECF1` |
| `text/secondary` | `neutral-600` | `#A5AFBD` |
| `text/tertiary` | `neutral-500` | `neutral-500` |
| `text/inverse` | `neutral-0` | `neutral-950` |
| `action/primary` | `blue-500` | `blue-400` |
| `action/primary-hover` | `blue-600` | `blue-300` |
| `action/link` | `blue-600` | `blue-300` |
| `status/synced` | `success-600` | `success-300` |
| `status/paused` | `warning-600` | `warning-300` |
| `status/offline` | `neutral-500` | `neutral-500` |
| `status/error` | `danger-600` | `danger-300` |
| `share/live` | `violet-600` | `violet-300` |
| `share/live-bg` | `violet-50` | `#241844` |
| `danger/fill` | `danger-500` | `danger-500` |

Ready-to-paste custom properties are in §13.

---

## 4. Typography

### 4.1 Families

The web app is a product. The desktop agent is a system utility and must feel like it shipped with
the OS — **do not load a webfont into the agent**.

| Surface | Stack |
|---|---|
| Web | `Inter var, Inter, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, system-ui, sans-serif` |
| Desktop agent | `-apple-system, "Segoe UI Variable Text", "Segoe UI", Ubuntu, system-ui, sans-serif` |
| Mobile | Platform native (SF Pro / Roboto) |
| Mono | `"JetBrains Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace` |

Mono is **required** for device IDs, key fingerprints and pairing codes, and the chosen mono must
visually disambiguate `0/O` and `1/l/I`. Users read pairing codes aloud across a room.

### 4.2 Scale

Body is 14px. This is a dense utility UI, not a marketing page.

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 32 / 38 | 600 | -0.02em | Onboarding, hero empty state |
| `title-1` | 24 / 30 | 600 | -0.015em | Page title |
| `title-2` | 20 / 26 | 600 | -0.01em | Section, modal title |
| `title-3` | 17 / 24 | 600 | 0 | Card header, device name |
| `body-lg` | 16 / 24 | 400 | 0 | Onboarding prose, mobile body |
| `body` | 14 / 20 | 400 | 0 | **Default** |
| `body-strong` | 14 / 20 | 600 | 0 | Button label, list primary |
| `body-sm` | 13 / 18 | 400 | 0 | Secondary rows, help text |
| `caption` | 12 / 16 | 500 | 0 | Metadata, timestamps |
| `micro` | 11 / 14 | 600 | 0.04em, UPPER | Status chips, eyebrows |
| `code` | 13 / 20 | 500 mono | 0 | Device ID, fingerprint |
| `pairing-code` | 28 / 32 | 600 mono | 0.12em | Pairing code, grouped `XXX-XXX` |

Weights: **400 / 500 / 600 / 700** only. No 300 — it fails contrast at small sizes on dark.

### 4.3 Rules

- Measure: max **68ch** for prose, **60ch** for settings descriptions.
- Never justify. Never letterspace lowercase body text.
- Device names are user input: truncate to one line with an ellipsis, full value in the accessible
  name. A device name must never wrap to three lines.
- Use `font-variant-numeric: tabular-nums` on all timestamps, sizes, latencies and counts, so live
  lists do not jitter as values update.
- Minimum product text size is **12px**. The 11px `micro` role is for uppercase labels only, never
  sentences.

---

## 5. Spacing

4px base grid. Every gap, pad and offset is a token.

```text
space-0   0     space-1   4     space-2   8     space-3  12
space-4  16     space-5  20     space-6  24     space-8  32
space-10 40     space-12 48     space-16 64     space-20 80
```

| Context | Value |
|---|---|
| Icon to label | `space-2` |
| Chip padding | `space-1 space-2` |
| Button padding (md) | `space-2 space-4` |
| Input padding | `space-2 space-3` |
| Card padding | `space-4` mobile / `space-5` desktop |
| List row vertical | `space-3` |
| Between related fields | `space-3` |
| Between form groups | `space-6` |
| Between page sections | `space-8` |
| Page gutter | `space-4` mobile / `space-8` desktop |
| Modal padding | `space-6` |

Vertical rhythm inside a card is 4 / 8 / 12 / 16 only. If you need 18 or 22, the component is
wrong, not the scale.

---

## 6. Shape, elevation, motion

### 6.1 Radius

```text
radius-xs    4    chips, tags, small inputs
radius-sm    6    inputs, buttons
radius-md    8    cards, list containers
radius-lg   12    modals, desktop agent window
radius-xl   16    mobile bottom sheets
radius-full 999   avatars, status dots, pills, toggles
```

### 6.2 Elevation — border first, shadow second

```text
elev-0   none
elev-1   0 1px 2px rgba(16,24,40,.06)   + 1px border/subtle   cards
elev-2   0 4px 12px rgba(16,24,40,.08)                        dropdown, popover
elev-3   0 12px 32px rgba(16,24,40,.14)                       modal, agent window
```

Dark mode does **not** scale up shadows. It lifts the surface (`bg/surface` to `bg/raised`) and
strengthens the border. Shadows on `#0D1117` are invisible and only muddy the edge.

### 6.3 Motion

```text
duration-instant   90ms   hover, checkbox, chip
duration-fast     140ms   button press, toggle, received flash
duration-base     180ms   popover, dropdown, toast in
duration-slow     240ms   modal, sheet, page transition

ease-standard  cubic-bezier(0.2, 0, 0, 1)
ease-enter     cubic-bezier(0, 0, 0.2, 1)
ease-exit      cubic-bezier(0.4, 0, 1, 1)
pulse-live     1600ms ease-in-out infinite
```

Rules:

- **Only one looping animation may exist on screen: the live-share pulse.** Spinners appear only
  for waits over 400ms; below that, show nothing.
- Received-clipboard feedback is a **140ms row flash**, not a slide-in. Sync should feel like it
  already happened, not like it is being performed.
- Under `prefers-reduced-motion: reduce`, all durations go to 0 and the live pulse becomes a
  **static filled violet dot with a "Live" label**. A security signal must never depend on
  animation.

---

## 7. Iconography

- Sizes: **20** default, **16** inline with `body`, **24** for touch and tray.
- Stroke **1.5**, round caps and joins, 2px optical padding inside the box.
- One icon set across all clients. Mixing sets is a review failure.
- Status icons use the fixed mapping in §8. A device row never picks its icon ad hoc.
- **The lock icon is reserved for encrypted-channel state.** Never use it for settings, privacy
  marketing, or decoration. If it is present, the channel is authenticated and encrypted.

---

## 8. Status vocabulary (cross-domain contract)

Web, desktop and mobile render these identically. The state names are the keys.

### 8.1 Device

| State | Color token | Icon | Dot | Label | Sub-label |
|---|---|---|---|---|---|
| `synced` | `status/synced` | check-circle | filled | **Synced** | "Just now" / "2m ago" |
| `connected` | `status/synced` | link | filled | **Connected** | "On this network" |
| `idle` | `status/offline` | clock | hollow | **Idle** | "Last seen 1h ago" |
| `paused` | `status/paused` | pause-circle | bar | **Paused** | "Not sending or receiving" |
| `offline` | `status/offline` | cloud-off | hollow | **Offline** | "Will resync when it's back" |
| `needs_setup` | `status/paused` | alert-circle | triangle | **Finish setup** | one-tap action |
| `revoked` | `status/error` | slash-circle | cross | **Revoked** | row at 60% opacity, no actions |
| `error` | `status/error` | alert-triangle | cross | **Can't connect** | plain-language cause |

### 8.2 Share session

| State | Treatment |
|---|---|
| `none` | No banner. Zero violet anywhere in the UI. |
| `live` | Persistent violet banner, pulsing dot, member count, **Stop sharing** always reachable without scrolling |
| `expiring` (under 5 min) | Banner border shifts to `status/paused`, countdown, **Extend** and **Stop** |
| `ended` | Collapses to a 4s neutral toast: "Sharing ended. No one else can receive your clipboard." All violet then disappears |

### 8.3 Transfer

`sending` → `sent` → `received` (140ms flash), plus `too_large`, `unsupported_type`, `rejected`,
`failed`.

Rejections show the limit, never the error code:

```text
good:  Image is 14 MB. The limit is 10 MB.
bad:   PAYLOAD_TOO_LARGE
```

---

## 9. Voice and copy

From `docs/RULES.md` §10 — users never need to understand ports, addresses or tokens.

| Never write | Write instead |
|---|---|
| port, socket, IP address, subnet, mDNS, UDP, NAT | "this network", "nearby" |
| peer, node, endpoint | "device" |
| public key, keypair, fingerprint | "device identity" (raw value only under an advanced disclosure) |
| token, credential, JWT | *never user-facing — pairing is a code that is shown, never pasted* |
| payload, envelope, event | "what you copied", "clipboard item" |
| relay, control plane, data plane | *never user-facing* |
| broadcast, propagate, replicate | "sends to your devices" |
| deauthorize, deprovision | "remove", "revoke access" |

Style:

- Sentence case everywhere — buttons, titles, menus.
- Verb-first buttons. **Stop sharing**, not "OK".
- Errors state the cause and the single action that fixes it. Never surface a code without a
  sentence. Never blame the user.
- Destructive confirmations name the consequence, not the object:
  *"Revoke MacBook Pro? It will stop receiving your clipboard immediately and will need to be set
  up again."*

---

## 10. Privacy in the UI

Clipboard content is sensitive by default (`docs/SECURITY.md`). These are component obligations,
not guidelines.

- Text previews truncate at **140 characters**, single line. Never expanded in a list view.
- Content matching a secret shape — long high-entropy strings, `sk-`, `ghp_`, `AKIA` prefixes —
  renders **masked** with a deliberate reveal affordance. Reveal is per item and never sticky.
- Image previews render as a **blurred thumbnail with dimensions and size**. Full render only on
  explicit user action.
- Clipboard content must never appear in: toasts, OS notifications, tooltips, page or window
  titles, tray tooltips, empty states, analytics, or support forms. A notification says
  *"Text copied from MacBook Pro"* — never the text.
- Any surface that displays content states its retention: *"Cleared after 5 minutes."*

---

## 11. Layout and density

| Surface | Spec |
|---|---|
| Web sidebar | 240px fixed, collapses under 1024px |
| Web content max | 1120px device grid, 720px settings and prose |
| Web grid | 12 column, 24px gutter desktop, 16px mobile |
| Desktop agent | **360 × 480 fixed**, `radius-lg`, `elev-3`. The default state must fit without scrolling |
| Mobile | 16px gutters, safe-area insets respected, sheets use `radius-xl` top corners |

Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`.

Hit targets: **44 × 44** mobile minimum, **32px** desktop row minimum, **28px** tray item.
Minimum **12px** between adjacent destructive and non-destructive controls.

---

## 12. Components

**Button** — heights 28 / 36 / 44 (sm / md / lg), `radius-sm`, `body-strong` label, 16px icon at
`space-2`. Variants: `primary` (`action/primary` fill), `secondary` (surface plus
`border/strong`), `ghost`, `danger` (`danger/fill`), `danger-quiet` (danger text, transparent —
use inside list rows). Hover steps one shade, active steps two with no transform, disabled is 40%
opacity, loading swaps the icon for a spinner and **keeps the label** — never collapse to a bare
spinner.

**Device card** — `radius-md`, `elev-1`, `space-5` padding. Platform glyph 24, device name
`title-3`, status chip, last-seen `caption`, overflow menu. The **pause toggle sits on the card
face, not in the menu** — `docs/RULES.md` §10 requires pause to be easy to find.

**Status chip** — `micro`, `radius-full`, height 20, `space-1 space-2` padding, status-50
background, status-600 text, 4px leading dot.

**Live-share banner** — full bleed, `share/live-bg`, 3px `violet-500` left border, pulsing dot,
`body-strong` summary ("Sharing with 2 people, ends in 14:32"), trailing **Stop sharing**
(`danger-quiet`). Sticky to the top. **Not dismissible.**

**Pairing modal** — `radius-lg`, single column, code in `pairing-code` grouped `XXX-XXX`, expiry
countdown, one primary action, no input fields. If a user must type a value we generated, the flow
has failed.

**Toggle** — 36 × 20 track, `radius-full`, `action/primary` when on, `neutral-300` when off,
`duration-fast`. Optimistic state, with rollback and a toast on failure.

**Toast** — bottom-right on desktop, top on mobile. `radius-md`, `elev-2`, 4s (8s for errors),
maximum 3 stacked, `role="status"`.

**Confirm dialog (destructive)** — `radius-lg`, `elev-3`. The title states the consequence. Danger
button trailing. Escape and backdrop cancel. Confirm and cancel must differ by more than color.

**Empty state** — 32px icon in `neutral-400`, `title-3`, one `body-sm` line, one primary action.
No illustration larger than the action it introduces.

**Skeleton** — `neutral-100` (dark `#212A36`), `radius-xs`, no shimmer for waits under 400ms.

---

## 13. Tokens

Three tiers. Components reference the **semantic or component tier only** — a raw primitive in
component code is a review failure, the same class of error as a hardcoded hex.

```text
primitive   --cp-blue-500              raw value, never used by a component
semantic    --cp-color-action-primary
component   --cp-button-primary-bg  ->  var(--cp-color-action-primary)
```

```css
:root {
  /* primitives — blue */
  --cp-blue-50:#EAF2FF;  --cp-blue-100:#D6E4FF; --cp-blue-200:#ADC8FF;
  --cp-blue-300:#7FA6FB; --cp-blue-400:#4E82F2; --cp-blue-500:#2563EB;
  --cp-blue-600:#1D4FD8; --cp-blue-700:#1A3FAD; --cp-blue-800:#17337F;
  --cp-blue-900:#132A5E;

  /* primitives — violet (live sharing only) */
  --cp-violet-50:#F3EEFE;  --cp-violet-100:#E7DDFD; --cp-violet-300:#B69BF6;
  --cp-violet-400:#9A6EF2; --cp-violet-500:#7C3AED; --cp-violet-600:#6B21D4;
  --cp-violet-900:#3B1178;

  /* primitives — neutral */
  --cp-neutral-0:#FFFFFF;   --cp-neutral-25:#FBFCFD;  --cp-neutral-50:#F6F8FA;
  --cp-neutral-100:#EDF0F3; --cp-neutral-200:#DFE3E8; --cp-neutral-300:#C7CDD6;
  --cp-neutral-400:#9AA3B0; --cp-neutral-500:#6E7887; --cp-neutral-600:#545D6B;
  --cp-neutral-700:#3D4552; --cp-neutral-800:#272D38; --cp-neutral-900:#171C24;
  --cp-neutral-950:#0D1117;

  /* primitives — status */
  --cp-success-50:#E6F6EF; --cp-success-300:#4FD3A0; --cp-success-500:#12A473; --cp-success-600:#0E8A5F;
  --cp-warning-50:#FDF3E2; --cp-warning-300:#F5BE4A; --cp-warning-500:#D98A00; --cp-warning-600:#A66A00;
  --cp-danger-50:#FDEDEC;  --cp-danger-300:#F58C87;  --cp-danger-500:#E04640;  --cp-danger-600:#C7302B;

  /* semantic — light */
  --cp-color-bg-canvas:var(--cp-neutral-50);
  --cp-color-bg-surface:var(--cp-neutral-0);
  --cp-color-bg-raised:var(--cp-neutral-0);
  --cp-color-bg-sunken:var(--cp-neutral-100);
  --cp-color-bg-hover:var(--cp-neutral-100);
  --cp-color-bg-selected:var(--cp-blue-50);
  --cp-color-border-subtle:var(--cp-neutral-200);
  --cp-color-border-strong:var(--cp-neutral-300);
  --cp-color-border-focus:var(--cp-blue-500);
  --cp-color-text-primary:var(--cp-neutral-900);
  --cp-color-text-secondary:var(--cp-neutral-600);
  --cp-color-text-tertiary:var(--cp-neutral-500);
  --cp-color-text-inverse:var(--cp-neutral-0);
  --cp-color-action-primary:var(--cp-blue-500);
  --cp-color-action-primary-hover:var(--cp-blue-600);
  --cp-color-action-link:var(--cp-blue-600);
  --cp-color-status-synced:var(--cp-success-600);
  --cp-color-status-paused:var(--cp-warning-600);
  --cp-color-status-offline:var(--cp-neutral-500);
  --cp-color-status-error:var(--cp-danger-600);
  --cp-color-share-live:var(--cp-violet-600);
  --cp-color-share-live-bg:var(--cp-violet-50);
  --cp-color-danger-fill:var(--cp-danger-500);

  /* space */
  --cp-space-1:4px;   --cp-space-2:8px;   --cp-space-3:12px;  --cp-space-4:16px;
  --cp-space-5:20px;  --cp-space-6:24px;  --cp-space-8:32px;  --cp-space-10:40px;
  --cp-space-12:48px; --cp-space-16:64px; --cp-space-20:80px;

  /* radius */
  --cp-radius-xs:4px;  --cp-radius-sm:6px;  --cp-radius-md:8px;
  --cp-radius-lg:12px; --cp-radius-xl:16px; --cp-radius-full:999px;

  /* elevation */
  --cp-elev-1:0 1px 2px rgba(16,24,40,.06);
  --cp-elev-2:0 4px 12px rgba(16,24,40,.08);
  --cp-elev-3:0 12px 32px rgba(16,24,40,.14);

  /* motion */
  --cp-duration-instant:90ms; --cp-duration-fast:140ms;
  --cp-duration-base:180ms;   --cp-duration-slow:240ms;
  --cp-ease-standard:cubic-bezier(0.2,0,0,1);
  --cp-ease-enter:cubic-bezier(0,0,0.2,1);
  --cp-ease-exit:cubic-bezier(0.4,0,1,1);
}

/* dark — system default, no explicit choice */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --cp-color-bg-canvas:var(--cp-neutral-950);
    --cp-color-bg-surface:#151B23;
    --cp-color-bg-raised:#1C2430;
    --cp-color-bg-sunken:#0A0E14;
    --cp-color-bg-hover:#212A36;
    --cp-color-bg-selected:#16233D;
    --cp-color-border-subtle:#2A3341;
    --cp-color-border-strong:#3A4553;
    --cp-color-border-focus:var(--cp-blue-400);
    --cp-color-text-primary:#E8ECF1;
    --cp-color-text-secondary:#A5AFBD;
    --cp-color-text-inverse:var(--cp-neutral-950);
    --cp-color-action-primary:var(--cp-blue-400);
    --cp-color-action-primary-hover:var(--cp-blue-300);
    --cp-color-action-link:var(--cp-blue-300);
    --cp-color-status-synced:var(--cp-success-300);
    --cp-color-status-paused:var(--cp-warning-300);
    --cp-color-status-error:var(--cp-danger-300);
    --cp-color-share-live:var(--cp-violet-300);
    --cp-color-share-live-bg:#241844;
  }
}

/* dark — explicit user choice, must win in both directions */
:root[data-theme="dark"] {
  --cp-color-bg-canvas:var(--cp-neutral-950);
  --cp-color-bg-surface:#151B23;
  --cp-color-bg-raised:#1C2430;
  --cp-color-bg-sunken:#0A0E14;
  --cp-color-bg-hover:#212A36;
  --cp-color-bg-selected:#16233D;
  --cp-color-border-subtle:#2A3341;
  --cp-color-border-strong:#3A4553;
  --cp-color-border-focus:var(--cp-blue-400);
  --cp-color-text-primary:#E8ECF1;
  --cp-color-text-secondary:#A5AFBD;
  --cp-color-text-inverse:var(--cp-neutral-950);
  --cp-color-action-primary:var(--cp-blue-400);
  --cp-color-action-primary-hover:var(--cp-blue-300);
  --cp-color-action-link:var(--cp-blue-300);
  --cp-color-status-synced:var(--cp-success-300);
  --cp-color-status-paused:var(--cp-warning-300);
  --cp-color-status-error:var(--cp-danger-300);
  --cp-color-share-live:var(--cp-violet-300);
  --cp-color-share-live-bg:#241844;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --cp-duration-instant:0ms; --cp-duration-fast:0ms;
    --cp-duration-base:0ms;    --cp-duration-slow:0ms;
  }
}
```

Theme default is **system**, with an explicit user override.

---

## 14. Accessibility floor

- **WCAG AA** minimum across all clients.
- Focus ring: **2px `border/focus` with a 2px offset**, always visible on keyboard focus, never
  removed. It must clear 3:1 against both the component and the surface behind it.
- Status is never communicated by color alone — icon plus text label, always.
- Live regions: a received clipboard item announces `aria-live="polite"`. A share session starting
  or ending announces `aria-live="assertive"` — it is a change in who can see the user's data.
- Every destructive action is reachable and completable by keyboard. `Escape` closes every overlay.
- Honour `prefers-reduced-motion` and `prefers-color-scheme`.

---

## 15. Changing this document

This is a `main` document, so a change here changes every client's obligations
(`DEV_GUIDE.md` §2).

1. Open a PR to `main` from a `main/*` branch.
2. If §8 (status vocabulary) or §9 (copy rules) changes, add a note in `docs/HANDOFFS/` using
   `docs/AGENT_HANDOFF_TEMPLATE.md`, listing every domain that must move. Those two sections are
   cross-domain contracts.
3. Color, spacing, type and component changes need only the PR, but must state which surfaces are
   affected.
4. Never redefine a semantic token's meaning in place. Add a new token and migrate.

### Open decisions for product

- **Violet reservation** costs a color that can never be used decoratively. It buys the clearest
  possible answer to "can anyone else see this?".
- **Secret masking** (§10) implies detection logic in the agent and the web app. It is engineering
  work, not styling, and needs to land in the client contracts.
- **The 360 × 480 agent window** is a forcing function. If the default state does not fit, the
  feature set has outgrown the product's simplicity principle.
