import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quitApp } from "../src/runtime/app-lifecycle.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

describe("desktop app lifecycle", () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it("uses the native quit command", async () => {
    await quitApp();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("quit_app");
  });
});
