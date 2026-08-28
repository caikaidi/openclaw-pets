import { invoke } from "@tauri-apps/api/core";

export async function quitApp(): Promise<void> {
  await invoke("quit_app");
}
