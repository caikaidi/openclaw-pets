<script setup lang="ts">
import { resolvePetAnimation } from "@openclaw-pets/petpack";
import type { PetSemanticState } from "@openclaw-pets/protocol";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { animationFrame, spriteStyle } from "../runtime/pet-animation.js";
import type { LoadedPetPack } from "../runtime/pet-pack-loader.js";

const props = defineProps<{ state: PetSemanticState; pack: LoadedPetPack }>();
const elapsed = ref(0);
let origin = performance.now();
let frameRequest = 0;

const animation = computed(() => resolvePetAnimation(props.pack.manifest, props.state));
const asset = computed(() => props.pack.manifest.assets[animation.value.asset]!);
const style = computed(() => spriteStyle(
  asset.value,
  props.pack.assetUrls[asset.value.path]!,
  animationFrame(animation.value, elapsed.value),
  animation.value.visibleBottom,
));

function tick(now: number): void {
  elapsed.value = now - origin;
  frameRequest = requestAnimationFrame(tick);
}

watch(animation, () => {
  origin = performance.now();
  elapsed.value = 0;
});
onMounted(() => { frameRequest = requestAnimationFrame(tick); });
onBeforeUnmount(() => cancelAnimationFrame(frameRequest));
</script>

<template>
  <div class="sprite-pet" :style="style" :aria-label="pack.manifest.name" />
</template>
