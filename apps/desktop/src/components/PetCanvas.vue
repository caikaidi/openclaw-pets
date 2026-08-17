<script setup lang="ts">
import type { PetSemanticState } from "@openclaw-pets/protocol";

defineProps<{ state: PetSemanticState }>();
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
  </div>
</template>
