# Pastty

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Share clipboard text, images, and videos between devices through a short-lived room.
The repository retains its technical package and protocol name, Clippy.

## Users and Operating Context

People moving content between a phone, tablet, and computer. Inferred from the
existing app and README; the user requested preservation of the app with a new aesthetic.
One device creates a room, another joins by code or QR, and both can send content.

## Capabilities and Constraints

No account is required. Up to five devices per room. Text, supported images up to
5 MB, and supported videos up to 50 MB. Cloudflare Workers with a Durable Object
per pairing code and a dependency-free installable PWA. Existing protocol, QR,
resumption, transfer limits, and ephemeral lifecycle remain the product contract.
Transport encryption is not end-to-end encryption. Resume metadata may be persisted;
content is not saved as message history. Keep these distinctions in user-facing claims.

## Brand Commitments

The user supplied the Pastty concept in Google Drive folder `pastty` and explicitly
authorized implementing its aesthetic across the app. The reference's Pastty name,
ivory surface, black lettering, yellow pasta connections, and 3D device tiles define
the replacement visual identity. Source: image `1j1YobT8M3vCPkquV-QDXdS4DGlM7qyND`.
