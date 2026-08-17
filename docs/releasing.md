# Release process

The repository can build an unsigned local `.app` and `.dmg` for smoke tests.
Those files are not public release artifacts.

An official macOS release must:

1. build from a tagged, clean commit on a controlled runner;
2. use a Developer ID Application signing identity supplied by the runner's
   secure credential store;
3. enable hardened runtime and sign the complete application bundle;
4. submit the signed app for Apple notarization and staple the ticket;
5. recreate and verify the DMG from the signed, notarized app;
6. publish SHA-256 checksums and a software bill of materials.

Never commit signing certificates, private keys, App Store Connect credentials,
Gateway credentials, or notarization profiles. Local `tauri build` output is
acceptable for development, but release automation must fail closed when
signing or notarization is unavailable.
