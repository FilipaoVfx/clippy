---
name: Pastty
description: Tactile yellow connections on warm ivory, with confident black lettering.
colors:
  paper: "#f4ece5"
  surface: "#f3eae2"
  surface-solid: "#fbf6f0"
  input: "#e9dfd6"
  ink: "#222122"
  muted: "#655d57"
  line: "#cfc2b8"
  yellow: "#ffbd20"
  yellow-ink: "#946000"
  success: "#187947"
  error: "#ae302c"
  warning: "#9c6500"
  dark-paper: "#22201e"
  dark-surface: "#302b27"
  dark-surface-solid: "#38312b"
  dark-input: "#28231f"
  dark-ink: "#fff6ec"
  dark-muted: "#c6b8aa"
  dark-line: "#665447"
  dark-yellow-ink: "#ffc446"
  dark-success: "#76df9b"
  dark-error: "#ff9990"
  dark-warning: "#ffcb71"
typography:
  display:
    fontFamily: "Russo One, sans-serif"
    fontSize: "clamp(78px, 9vw, 136px)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Russo One, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  label:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 700
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "clamp(24px, 4vw, 32px)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "14px"
  lg: "24px"
  pill: "32px"
spacing:
  tight: "8px"
  control: "12px"
  field: "14px"
  section: "24px"
  panel: "30px"
components:
  button-primary:
    backgroundColor: "#242223"
    textColor: "#fffaf4"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "#45403b"
  button-primary-dark:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "30px"
    padding: "10px 26px"
  input-code:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  textarea:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px"
  status-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  pairing-panel:
    rounded: "{rounded.pill}"
    padding: "30px 34px 28px"
---

# Design System: Pastty

## Overview

**Creative North Star: "A little connection"**

Pastty uses the user's supplied concept as its visual authority: a warm ivory field,
yellow pasta connections, dimensional device tiles and bold black lettering. The
physical artwork frames a real, compact application; headings and controls remain
live HTML. The same vocabulary continues through pairing, waiting and sharing.

**Key Characteristics:**

- Warm ivory surfaces with black type and golden accents.
- Real 3D device artwork around a quiet central task.
- Chunky Russo One display lettering paired with Manrope interface text.
- Rounded controls, fine warm borders and restrained ambient depth.
- A dark theme that keeps the same material family and yellow accent.

## Colors

The frontmatter records the actual CSS values. Light-theme names map directly to
custom properties; `dark-` entries describe their overrides under `data-theme=dark`.

### Primary

- **Pasta Yellow** (`yellow`): dimensional artwork, selected emphasis and dark-theme
  primary buttons. Dark Ink is used for text on yellow controls.
- **Golden Ink** (`yellow-ink`): readable accent lettering, small icons, focus rings,
  progress bars and the brand's punctuation. Its dark-theme counterpart is brighter.

### Neutral

- **Ivory Paper** (`paper`): page field and compact header controls.
- **Warm Surface** (`surface`): the pairing panel and its divider badge.
- **Solid Ivory** (`surface-solid`): waiting, connected and help surfaces.
- **Recessed Sand** (`input`): input wells, drop zones and the receiving feed.
- **Dark Ink** (`ink`): primary text; **Warm Muted** (`muted`): supporting copy.
- **Warm Line** (`line`): dividers and container outlines.

Success, error and warning have separate semantic tokens in both themes. They
communicate runtime state and do not replace the brand accent.

**The Readable Gold Rule.** Use Golden Ink for small accent text; Pasta Yellow is
reserved for material, fills and surfaces that retain dark foreground text.

## Typography

**Display Font:** Russo One, with a sans-serif fallback. **Body Font:** Manrope,
with Arial and sans-serif fallbacks. Both families are self-hosted under
`public/fonts/`, with their original license notices. Mono is reserved for session
codes, shared text and measurements.

The frontmatter is the base hierarchy. The hero uses the responsive display size,
with an explicit narrow-screen size of 80px. The tagline uses Russo One at
`clamp(23px, 2.7vw, 36px)` and 26px on mobile. Waiting and connected headlines use
30px and 28px respectively, reducing to 25–27px and 26px on narrow screens.
Interface titles use Manrope 800; controls and section labels use medium or bold
Manrope. Supporting copy is generally 12–17px, with short status/caption strings
at 11–12px. Those small captions are an observation, not a body-text scale.

**The Two Voices Rule.** Russo One names the brand and important states; Manrope
carries instructions and actions. Keep long text and field content out of display type.

## Layout

The header is a horizontal brand/navigation/status row within a 1600px maximum.
The main shell is at most 920px, with 20px minimum side space. The pairing panel
is at most 640px and divides two actions equally; a thin rule and centered “or”
marker separate them. At 440px and below the actions stack vertically and that
rule becomes horizontal.

The connected view is at most 860px, with text/image/video actions on the left and
a receiving feed on the right. At 760px and below it becomes a single-column task
flow. Waiting uses a centered 560px surface. Header navigation wraps below the
brand/tools on mobile. Breakpoints observed in the stylesheet are 440px, 760px,
1100px and 1500px; preserve the task order when adapting between them.

The device scene is decorative and has no pointer interaction. On desktop it fills
the viewport; in waiting/connected states its opacity drops so the task leads. On
mobile it is a subdued, fading backdrop. The dark theme uses a low-opacity
luminosity treatment rather than introducing a different illustration.

## Elevation & Depth

The dimensional source is the generated raster
`public/assets/pastty-devices.webp`, based on the supplied Drive image. Exact
source and generation prompt are recorded in
[the asset provenance](docs/design/pastty-assets.md). Do not rebuild these devices
as a collection of CSS shapes. Containers use tonal layering and thin borders;
the home panel has an ambient shadow (`0 24px 45px #60442114`), while toasts use
`0 8px 24px #3a291c24` for temporary elevation.

The pairing panel has one entrance, `room-arrives`: a short vertical settle with a
2px-to-zero blur, lasting .65s with `cubic-bezier(.16,1,.3,1)`. The app remains
still during use. Reduced motion removes that entrance and control/progress
transitions; toast exit duration becomes 1ms so cleanup still completes.

## Shapes

Controls are rounded pills or circles; fields and content items use smaller,
practical corners. Reused radius tokens are 8px, 14px and 24px. The home panel
uses 32px corners, reducing to 25px on mobile. Waiting uses 28px, and the connected
surface 26px. These are purpose-specific containers, not a new universal radius.
Icons use inline SVG with rounded caps/joins and a consistent 1.8px stroke at 24px.
The pasta-loop SVG mark also supplies the raster PWA icons.

## Components

### Buttons

Primary actions are confident dark pills with warm light text in the light theme;
the dark theme changes their fill to yellow with dark text. Hover darkens/lifts
light-theme actions by 2px. Secondary actions keep the surface and a warm outline.
Join is a compact circular arrow attached to the code field, with an explicit
disabled state until a valid code is entered.

### Inputs / Fields

Code entry is centered, uppercase mono inside a sand pill. Shared text uses a
recessed, outlined textarea with a 105px minimum height and 14px padding. File
drop zones use a dashed warm outline; dragging changes the fill and accent border.
Focus-visible on buttons, links, inputs and textareas uses a 3px Golden Ink outline
with a 4px offset. Selection, caret and scrollbars are themed from the same palette.

### Navigation and Status

A rounded outlined navigation group contains the dark selected Connect action and
a quiet How it works control. Status is a separate rounded chip with a semantic
dot and runtime text. Icon-only controls include accessible action labels.
The help control exposes an inline section rather than replacing the main task.

### Pairing and Waiting

Start and Join share one panel and a continuous visual boundary. Their small icon
tiles are part of the supplied composition. Waiting exposes a prominent mono code,
a copy action and a 170px QR on white with a 10px quiet-zone padding. Keep QR
contrast independent of the current theme.

### Connected Sharing

Text, image and video actions retain one label-and-field vocabulary. Received
items have a recessed feed with light content items, a time label and copy/download
actions. New items get a Golden Ink outline. Empty, progress and toast states use
the same type and semantic palette. Toasts use 16px inline SVG status icons;
identical messages replace one another and the visible stack is capped at one
on mobile (760px and below) or two on desktop so bursts do not cover the task.

## Do's and Don'ts

### Do:

- **Do** preserve the supplied ivory, black, yellow and 3D device identity.
- **Do** keep the central task legible while artwork frames the outer space.
- **Do** use real controls, keyboard focus, labels and runtime feedback.
- **Do** apply both theme palettes and reduced-motion behavior to new components.
- **Do** retain a white QR quiet zone and readable contrast in both themes.

### Don't:

- **Don't** bake headings, navigation or interactive controls into the artwork.
- **Don't** replace the supplied physical 3D material with flat CSS approximations.
- **Don't** use the display face for instructions or long shared content.
- **Don't** treat small status captions as the default size for new body copy.
