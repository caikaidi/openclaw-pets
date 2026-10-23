<script setup lang="ts">
import { EditKeyboard } from "../runtime/edit-keyboard.js";
defineProps<{ modelValue: string; disabled?: boolean; maxlength?: number; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string]; save: [] }>();
const keyboard = new EditKeyboard();
</script>

<template>
  <textarea
    :value="modelValue" :disabled="disabled" :maxlength="maxlength" :aria-label="label"
    class="activity-edit" rows="3"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    @compositionstart="keyboard.compositionStart()"
    @compositionend="keyboard.compositionEnd()"
    @keydown="keyboard.keydown($event, () => { if (!disabled) emit('save'); })"
    @keyup="keyboard.keyup($event)"
    @blur="keyboard.reset()"
  />
</template>
