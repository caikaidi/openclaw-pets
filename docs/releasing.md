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

The macOS credential vault is protected by the app's designated requirement.
The verifier pins the Bundle ID, Team ID, and a hash of the approved signing
authority name without publishing that name. A certificate renewal that keeps
the same authority name remains compatible; changing the Team or authority is
a credential migration event, not a routine rebuild. Local production builds
must use the release command, which bundles the app and then runs the
fail-closed verifier automatically:

```bash
corepack pnpm release:macos
```

The desktop `tauri:build` script has the same mandatory verifier. A raw
`tauri build` is only a development command and must not be distributed.

If the approved signer must change, ship an explicit versioned vault migration
and retain the previous vault as a recovery copy before updating the verifier.

Never commit signing certificates, private keys, App Store Connect credentials,
Gateway credentials, or notarization profiles. Local `tauri build` output is
acceptable for development, but release automation must fail closed when
signing or notarization is unavailable.
