<script setup lang="ts">
import type { PetSemanticState } from "@openclaw-pets/protocol";

defineProps<{ state: PetSemanticState }>();
const emit = defineEmits<{
  petPointerDown: [event: PointerEvent];
  petPointerMove: [event: PointerEvent];
  petPointerUp: [event: PointerEvent];
  petPointerCancel: [event: PointerEvent];
  petContextMenu: [event: MouseEvent];
}>();

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  emit("petPointerDown", event);
}

function onPointerUp(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  emit("petPointerUp", event);
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  emit("petContextMenu", event);
}
</script>

<template>
  <div class="pet-canvas" :data-state="state" aria-label="OpenClaw pet">
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
    <div
      class="pet-canvas-hit-target"
      @pointerdown="onPointerDown"
      @pointermove="emit('petPointerMove', $event)"
      @pointerup="onPointerUp"
      @pointercancel="emit('petPointerCancel', $event)"
      @contextmenu="onContextMenu"
    />
  </div>
</template>
