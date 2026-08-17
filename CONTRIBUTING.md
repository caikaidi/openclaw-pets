# Contributing

Thank you for helping build OpenClaw Pets.

## Before opening a change

1. Keep OpenClaw as the only agent, model, tool, and approval runtime.
2. Keep Pet Packs data-only.
3. Treat `packages/protocol` and the Pet Pack manifest as versioned public
   compatibility boundaries.
4. Add a failing test before changing behavior at one of those boundaries.
5. Do not add artwork without a documented redistribution license.

## Checks

```bash
corepack pnpm install
corepack pnpm check
cd apps/desktop/src-tauri
cargo fmt --check
cargo check
cargo test --lib
```

Do not include credentials, local activity records, generated signing keys,
or packaged applications in commits.

## Compatibility changes

Protocol methods and manifest fields must remain backward compatible within a
format version. Breaking changes require a new protocol or format version,
migration notes, and tests for both rejection and upgrade behavior.
