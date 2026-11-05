# Pastty visual asset provenance

The user supplied the Pastty concept image in their Google Drive `pastty` folder
and requested its implementation across the existing app.

Reference: `https://drive.google.com/file/d/1j1YobT8M3vCPkquV-QDXdS4DGlM7qyND/view`.

## Device background

- Final asset: `public/assets/pastty-devices.webp` (approximately 45 KB).
- Created with the built-in image generation tool from the supplied concept.
- Encoded as WebP with FFmpeg; the source generation remains outside the repository.
- Live headings, navigation and controls are HTML, not baked into the artwork.
- On narrow screens the scene is subdued to keep the task readable.

Exact generation prompt:

> Use case: stylized-concept. Create a production website BACKGROUND ASSET inspired closely by the supplied reference image, not a UI mockup. Keep the same cream ivory warm background (#f4ece5), joyful high-quality photoreal 3D yellow-gold ribbed macaroni tubes curving from left and right sides and four soft ivory square device tiles in the outer corners, black laptop top-left, black smartphone top-right and lower-left, black desktop screen lower-right, tiny green status LEDs. The tubes connect the devices like playful flowing data cables. Wide 16:10 landscape composition. CRITICAL: the entire central 52% width from x=24% to x=76% must remain completely EMPTY plain warm ivory, from the top edge to the bottom edge, to hold live HTML heading and functional interface. All devices and ALL tubes must be confined to the outer 24% left and outer 24% right. Soft studio light, polished buttery yellow ridges, shallow ambient shadows, editorial 3D render, sophisticated tactile materials. Remove ALL text, ALL typography, logos, brand names, navigation, buttons, UI containers, panels, status chips and footer from the reference; no interface baked into the image. No checkerboards, grids, sparkle or confetti decorations. Only 3D devices and looping yellow tubes framing an empty ivory center. Save the final background asset to the generated image output.

## Icons and type

`public/icon.svg` is an authored vector pasta loop, rendered to the three PNG PWA
sizes with FFmpeg. UI icons use a consistent inline SVG stroke vocabulary.
Manrope and Russo One are self-hosted from Google Fonts, with their original
SIL Open Font License notices in `public/fonts/`.

## Verification

The browser flow uses two isolated device contexts and the local Cloudflare runtime.
It verifies keyboard creation, QR generation, joining, bidirectional text, image
transfer, reload/resume, theme switching, help, and the offline app shell. Responsive
checks cover 320, 390, 768 and 1440 CSS pixels. Existing Vitest suites remain intact.
