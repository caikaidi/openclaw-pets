import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type SecretInputPath = {
  path: string;
  ownerKind?: string;
};

describe("OpenClaw Pets plugin manifest", () => {
  it("isolates optional provider credentials from Gateway startup", () => {
    const manifestPath = fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      configContracts?: { secretInputs?: { paths?: SecretInputPath[] } };
    };
    const paths = manifest.configContracts?.secretInputs?.paths ?? [];

    expect(paths).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "asr.primary.apiKey", ownerKind: "route" }),
      expect.objectContaining({ path: "asr.fallback.apiKey", ownerKind: "route" }),
      expect.objectContaining({ path: "journal.http.apiKey", ownerKind: "route" }),
    ]));
  });
});
