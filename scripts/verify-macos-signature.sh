#!/bin/sh
set -eu

expected_identifier="dev.openclaw.pets"
expected_team="39A7S92JBW"
expected_authority_hash="80e4b9bdb9e887aae38dd4f4561ceddff5f29c7365ea585b2ececcfefb53e1c8"
app_path="${1:-apps/desktop/src-tauri/target/release/bundle/macos/OpenClaw Pets.app}"

if [ ! -d "$app_path" ]; then
  echo "OpenClaw Pets app bundle is unavailable: $app_path" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
details="$(codesign -dvvv "$app_path" 2>&1)"
requirement="$(codesign -d -r- "$app_path" 2>&1)"
authority_hash="$(printf '%s\n' "$details" | awk -F= '/^Authority=/{sub(/^Authority=/, ""); printf "%s", $0; exit}' | shasum -a 256 | awk '{print $1}')"

printf '%s\n' "$details" | grep -F "Identifier=$expected_identifier" >/dev/null
printf '%s\n' "$details" | grep -F "TeamIdentifier=$expected_team" >/dev/null
printf '%s\n' "$requirement" | grep -F "identifier \"$expected_identifier\"" >/dev/null
[ "$authority_hash" = "$expected_authority_hash" ]

echo "verified_identifier=$expected_identifier"
echo "verified_team=$expected_team"
echo "verified_designated_requirement_authority_hash=$authority_hash"
