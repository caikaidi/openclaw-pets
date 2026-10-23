<script setup lang="ts">
import type { PetSemanticState } from "@openclaw-pets/protocol";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ state: PetSemanticState; paused?: boolean }>();
const visualState = ref(props.state);
watch([() => props.state, () => props.paused], ([state, paused]) => {
  if (!paused) visualState.value = state;
  else onBlur();
});
const emit = defineEmits<{
  petPointerDown: [event: PointerEvent];
  petPointerMove: [event: PointerEvent];
  petPointerUp: [event: PointerEvent];
  petPointerCancel: [event: PointerEvent];
  petContextMenu: [event: MouseEvent];
}>();

let pressedEvent: PointerEvent | undefined;

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  pressedEvent = event;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  emit("petPointerDown", event);
}

function onPointerUp(event: PointerEvent): void {
  if (!pressedEvent) return;
  pressedEvent = undefined;
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  emit("petPointerUp", event);
}

function cancelPointer(event: PointerEvent): void {
  if (!pressedEvent) return;
  pressedEvent = undefined;
  const target = event.currentTarget as HTMLElement | null;
  if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
  emit("petPointerCancel", event);
}

function onPointerMove(event: PointerEvent): void {
  if (!pressedEvent) return;
  if (document.elementFromPoint(event.clientX, event.clientY) !== event.currentTarget) {
    cancelPointer(event);
    return;
  }
  emit("petPointerMove", event);
}
function onBlur(): void { if (pressedEvent) cancelPointer(pressedEvent); }
onMounted(() => window.addEventListener("blur", onBlur));
onBeforeUnmount(() => window.removeEventListener("blur", onBlur));

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  emit("petContextMenu", event);
}
</script>

<template>
  <div class="pet-canvas" :data-state="visualState" :class="{ 'pet-paused': paused }" aria-label="OpenClaw pet">
    <div class="pet-visual"><div class="pet-canvas-motion">
    <div class="pet-shadow" />
    <div class="claw claw-left"><span /></div>
    <div class="claw claw-right"><span /></div>
    <div class="pet-body">
      <div class="antenna antenna-left"><i /></div>
      <div class="antenna antenna-right"><i /></div>
      <div class="face">
        <span class="eye eye-left" />
        <span class="eye eye-right" />
        <span class="mouth" />
      </div>
      <div class="status-mark">!</div>
    </div>
    </div></div>
    <div
      class="pet-canvas-hit-target"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="cancelPointer"
      @pointerleave="cancelPointer"
      @lostpointercapture="cancelPointer"
      @contextmenu="onContextMenu"
    />
  </div>
</template>
