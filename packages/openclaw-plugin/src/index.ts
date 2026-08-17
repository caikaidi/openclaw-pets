import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerOpenClawPets } from "./plugin.js";

export default definePluginEntry({
  id: "openclaw-pets",
  name: "OpenClaw Pets",
  description: "Desktop companion state projection and additive user-controlled context.",
  register(api) {
    registerOpenClawPets(api);
  },
});

export { ActivityStore } from "./activity-store.js";
export { registerOpenClawPets } from "./plugin.js";
export { PetStateProjector } from "./state-projector.js";
