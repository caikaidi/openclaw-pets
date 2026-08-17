# Security policy

OpenClaw Pets is pre-release software. Please do not publish a suspected
vulnerability before maintainers have had a reasonable opportunity to assess
and fix it. Use GitHub's private vulnerability reporting for this repository:
open the **Security** tab, choose **Advisories**, then **Report a
vulnerability**. Do not place sensitive details in a public issue.

## Sensitive data

Never include Gateway credentials, setup codes, device tokens, private keys,
activity records, or unredacted logs in a report. Maintainers will not ask for
credentials in chat, issue comments, transcripts, or command-line arguments.

## Security boundaries

- Gateway authentication uses a device-bound Ed25519 identity.
- Private signing material and tokens are stored through the operating-system
  credential store.
- Microphone capture is push-to-talk, not ambient.
- Activity data is bounded, labeled untrusted, pausable, and deletable.
- Pet Packs are raster-only, locally loaded, size limited, path checked, and
  SHA-256 verified before rendering.

The detailed threat and ownership model is in `docs/architecture.md`.
