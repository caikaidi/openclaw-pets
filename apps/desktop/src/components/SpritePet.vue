<script setup lang="ts">
import { resolvePetAnimation } from "@openclaw-pets/petpack";
import type { PetSemanticState } from "@openclaw-pets/protocol";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { animationFrame, spriteStyle } from "../runtime/pet-animation.js";
import type { LoadedPetPack } from "../runtime/pet-pack-loader.js";
import { isOpaqueSpritePoint, type AlphaBitmap } from "../runtime/sprite-hit-test.js";

const props = defineProps<{ state: PetSemanticState; pack: LoadedPetPack }>();
const emit = defineEmits<{
  petPointerDown: [event: PointerEvent];
  petPointerMove: [event: PointerEvent];
  petPointerUp: [event: PointerEvent];
  petPointerCancel: [event: PointerEvent];
  petContextMenu: [event: MouseEvent];
}>();
const elapsed = ref(0);
const root = ref<HTMLElement>();
const bitmap = shallowRef<AlphaBitmap>();
const pointerOpaque = ref(false);
const pointerPressed = ref(false);
let origin = performance.now();
let frameRequest = 0;
let bitmapRequest = 0;
let lastPointerEvent: PointerEvent | undefined;

const animation = computed(() => resolvePetAnimation(props.pack.manifest, props.state));
const asset = computed(() => props.pack.manifest.assets[animation.value.asset]!);
const assetUrl = computed(() => props.pack.assetUrls[asset.value.path]!);
const frame = computed(() => animationFrame(animation.value, elapsed.value));
const style = computed(() => spriteStyle(
  asset.value,
  assetUrl.value,
  frame.value,
  animation.value.visibleBottom,
));

async function loadBitmap(): Promise<void> {
  const request = ++bitmapRequest;
  bitmap.value = undefined;
  const image = new Image();
  image.src = assetUrl.value;
  try {
    await image.decode();
    if (request !== bitmapRequest) return;
    const canvas = document.createElement("canvas");
    canvas.width = asset.value.width;
    canvas.height = asset.value.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    bitmap.value = { width: pixels.width, height: pixels.height, data: pixels.data };
    refreshPointerOpacity();
  } catch {
    bitmap.value = undefined;
  }
}

function isOpaque(event: MouseEvent): boolean {
  const element = root.value;
  return Boolean(element && isOpaqueSpritePoint(
    bitmap.value,
    asset.value,
    frame.value,
    element.getBoundingClientRect(),
    event.clientX,
    event.clientY,
  ));
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !isOpaque(event)) return;
  lastPointerEvent = event;
  pointerPressed.value = true;
  pointerOpaque.value = true;
  root.value?.setPointerCapture(event.pointerId);
  emit("petPointerDown", event);
}

function onPointerMove(event: PointerEvent): void {
  lastPointerEvent = event;
  if (pointerPressed.value && !isOpaque(event)) {
    cancelPressedPointer(event);
    return;
  }
  if (pointerPressed.value) emit("petPointerMove", event);
  else pointerOpaque.value = isOpaque(event);
}

function onPointerUp(event: PointerEvent): void {
  if (!pointerPressed.value) return;
  lastPointerEvent = event;
  if (!isOpaque(event)) {
    cancelPressedPointer(event);
    return;
  }
  pointerPressed.value = false;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  pointerOpaque.value = isOpaque(event);
  emit("petPointerUp", event);
}

function onPointerCancel(event: PointerEvent): void {
  if (!pointerPressed.value) return;
  lastPointerEvent = undefined;
  pointerPressed.value = false;
  pointerOpaque.value = false;
  emit("petPointerCancel", event);
}

function onContextMenu(event: MouseEvent): void {
  if (!isOpaque(event)) return;
  event.preventDefault();
  emit("petContextMenu", event);
}

function onPointerLeave(): void {
  if (!pointerPressed.value) {
    lastPointerEvent = undefined;
    pointerOpaque.value = false;
  }
}

function cancelPressedPointer(event: PointerEvent): void {
  pointerPressed.value = false;
  pointerOpaque.value = false;
  const element = root.value;
  if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  emit("petPointerCancel", event);
}

function refreshPointerOpacity(): void {
  const event = lastPointerEvent;
  if (!event) return;
  const opaque = isOpaque(event);
  if (pointerPressed.value && !opaque) {
    cancelPressedPointer(event);
    return;
  }
  pointerOpaque.value = opaque;
}

function tick(now: number): void {
  elapsed.value = now - origin;
  frameRequest = requestAnimationFrame(tick);
}

watch(animation, () => {
  origin = performance.now();
  elapsed.value = 0;
});
watch(frame, refreshPointerOpacity);
watch(assetUrl, () => void loadBitmap(), { immediate: true });
onMounted(() => { frameRequest = requestAnimationFrame(tick); });
onBeforeUnmount(() => {
  bitmapRequest += 1;
  cancelAnimationFrame(frameRequest);
});
</script>

<template>
  <div
    ref="root"
    class="sprite-pet"
    :class="{ 'pointer-opaque': pointerOpaque, 'pointer-pressed': pointerPressed }"
    :style="style"
    :aria-label="pack.manifest.name"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="onPointerLeave"
    @contextmenu="onContextMenu"
  />
</template>
