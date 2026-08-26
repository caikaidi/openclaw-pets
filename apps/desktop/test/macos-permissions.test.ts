import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tauriDir = fileURLToPath(new URL("../src-tauri/", import.meta.url));

describe("macOS microphone bundle contract", () => {
  it("declares audio input for the hardened runtime", async () => {
    const config = JSON.parse(
      await readFile(`${tauriDir}/tauri.conf.json`, "utf8"),
    ) as {
      bundle?: { macOS?: { entitlements?: string; hardenedRuntime?: boolean } };
    };

    expect(config.bundle?.macOS?.hardenedRuntime ?? true).toBe(true);
    expect(config.bundle?.macOS?.entitlements).toBe("Entitlements.plist");

    const entitlements = await readFile(`${tauriDir}/Entitlements.plist`, "utf8");
    expect(entitlements).toMatch(
      /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/,
    );
  });

  it("explains microphone use before macOS asks for consent", async () => {
    const infoPlist = await readFile(`${tauriDir}/Info.plist`, "utf8");
    expect(infoPlist).toMatch(
      /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/,
    );
  });

  it("runs as an accessory app without a Dock icon", async () => {
    const infoPlist = await readFile(`${tauriDir}/Info.plist`, "utf8");
    expect(infoPlist).toMatch(
      /<key>LSUIElement<\/key>\s*<true\s*\/>/,
    );

    const rustEntryPoint = await readFile(`${tauriDir}/src/lib.rs`, "utf8");
    expect(rustEntryPoint).toMatch(
      /app\.set_activation_policy\(tauri::ActivationPolicy::Accessory\)/,
    );
    expect(rustEntryPoint).toMatch(/app\.set_dock_visibility\(false\)/);
  });
});
