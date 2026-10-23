import { describe, expect, it, vi } from "vitest";
import { EditKeyboard } from "../src/runtime/edit-keyboard.js";

const enter = (extra = {}) => ({ key: "Enter", keyCode: 13, shiftKey: false, isComposing: false, repeat: false, preventDefault: vi.fn(), ...extra });
describe("editor keyboard contract", () => {
  it.each([80, 100, 500, 10_000])("expires unidentified mouse commit guard by %i ms", (delay) => {
    let now = 0; const keyboard = new EditKeyboard(() => now); const save = vi.fn();
    keyboard.compositionStart(); keyboard.compositionEnd(); now = delay;
    keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it("guards end-before-keydown within 80ms, repeat, then releases on Enter keyup", () => {
    let now = 0; const keyboard = new EditKeyboard(() => now); const save = vi.fn();
    keyboard.compositionStart(); keyboard.compositionEnd(); now = 30;
    keyboard.keydown(enter(), save); now = 250;
    keyboard.keydown(enter({ repeat: true }), save); expect(save).not.toHaveBeenCalled();
    keyboard.keyup({ key: "Enter" }); keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it.each([" ", "1", "5"])("recognizes pinyin candidate selection with %j before compositionend", (key) => {
    const keyboard = new EditKeyboard(() => 0); const save = vi.fn();
    keyboard.compositionStart(); keyboard.keydown(enter({ key, keyCode: 229, isComposing: true }), save);
    keyboard.compositionEnd(); keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it("ordinary pinyin typing does not misidentify an end-before-keydown Enter as a mouse/space commit", () => {
    const keyboard = new EditKeyboard(() => 0); const save = vi.fn();
    keyboard.compositionStart(); keyboard.keydown(enter({ key: "n", keyCode: 229 }), save);
    keyboard.compositionEnd(); keyboard.keydown(enter(), save); expect(save).not.toHaveBeenCalled();
    keyboard.keyup({ key: "Enter" }); keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it("does not save an Enter pressed during composition or its repeats after end", () => {
    let now = 0; const keyboard = new EditKeyboard(() => now); const save = vi.fn();
    keyboard.compositionStart(); keyboard.keydown(enter(), save); keyboard.compositionEnd(); now = 500;
    keyboard.keydown(enter({ repeat: true }), save); expect(save).not.toHaveBeenCalled();
    keyboard.keyup({ key: "Enter" }); keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it("does not swallow an independent Enter 500ms after mouse composition commit", () => {
    let now = 0; const keyboard = new EditKeyboard(() => now); const save = vi.fn();
    keyboard.compositionStart(); keyboard.compositionEnd(); now = 500;
    keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
  it("saves once on Enter and leaves Shift Enter to insert a newline", () => {
    const keyboard = new EditKeyboard(); const save = vi.fn();
    const newline = enter({ shiftKey: true }); keyboard.keydown(newline, save);
    expect(newline.preventDefault).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    keyboard.keydown(enter(), save); keyboard.keydown(enter({ repeat: true }), save);
    expect(save).toHaveBeenCalledOnce();
  });
  it.each(["composition", "end-before-keydown", "229", "isComposing"])("does not submit IME confirmation: %s", (order) => {
    let now = 0; const keyboard = new EditKeyboard(() => now); const save = vi.fn();
    if (order === "composition" || order === "end-before-keydown") keyboard.compositionStart();
    if (order === "end-before-keydown") keyboard.compositionEnd();
    keyboard.keydown(enter({ keyCode: order === "229" ? 229 : 13, isComposing: order === "isComposing" }), save);
    expect(save).not.toHaveBeenCalled();
    keyboard.compositionEnd(); keyboard.keyup({ key: "Enter" }); now = 100;
    keyboard.keydown(enter(), save); expect(save).toHaveBeenCalledOnce();
  });
});
