import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, ssrContextKey } from "vue";
import * as Vue from "vue";
import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import ts from "typescript";
import EditTextarea from "../src/components/EditTextarea.vue";

// Vitest's Node transform supplies SSR setup. Compile the unchanged real
// template for a client renderer rather than inventing event handlers in tests.
const { descriptor } = parse(readFileSync(new URL("../src/components/EditTextarea.vue", import.meta.url), "utf8"));
const script = compileScript(descriptor, { id: "edit-fixture" });
const template = compileTemplate({ source: descriptor.template!.content, filename: "EditTextarea.vue", id: "edit-fixture", compilerOptions: { bindingMetadata: script.bindings } });
if (template.errors.length) throw new Error(String(template.errors));
const code = template.code.replace(/import \{([^}]+)\} from "vue"/gu, (_match, bindings: string) => `const {${bindings.replace(/ as /gu, ": ")}} = Vue`)
  .replace("export function render", "function render");
const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const ClientTextarea = { ...EditTextarea, render: new Function("Vue", `${javascript}; return render`)(Vue) };

type Node = { props: Record<string, unknown>; children: Node[] };
const node = (): Node => ({ props: {}, children: [] });
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: node, createComment: node,
  insert: (child, parent) => { parent.children.push(child); }, remove: () => {},
  setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null,
  patchProp: (element, key, _previous, value) => { element.props[key] = value; },
});
afterEach(() => vi.restoreAllMocks());
function mount(disabled = false) {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const save = vi.fn(); const root = node();
  const app = renderer.createApp({ render: () => h(ClientTextarea, { label: "fixture", modelValue: "拼音", disabled, onSave: save }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root); const textarea = root.children[0]!;
  const fire = (name: string, extra = {}) => {
    const event = { key: "Enter", keyCode: 13, repeat: false, shiftKey: false, isComposing: false, preventDefault: vi.fn(), ...extra };
    (textarea.props[name] as (event: unknown) => void)(event); return event;
  };
  return { save, fire, time: (value: number) => { now = value; }, unmount: () => app.unmount() };
}
describe("actual EditTextarea template event wiring (synthetic, not a native IME)", () => {
  it("mouse composition end followed by independent Enter saves first time through the component", () => {
    const f = mount(); f.fire("onCompositionstart"); f.fire("onCompositionend"); f.time(500);
    f.fire("onKeydown"); expect(f.save).toHaveBeenCalledOnce(); f.unmount();
  });
  it("end-before-keydown confirmation and held repeats cannot emit save", () => {
    const f = mount(); f.fire("onCompositionstart"); f.fire("onCompositionend"); f.time(20);
    f.fire("onKeydown"); f.time(500); f.fire("onKeydown", { repeat: true }); expect(f.save).not.toHaveBeenCalled();
    f.fire("onKeyup"); f.fire("onKeydown"); expect(f.save).toHaveBeenCalledOnce(); f.unmount();
  });
  it("composition Enter is blocked, then next independent Enter saves; Shift Enter remains native", () => {
    const f = mount(); f.fire("onCompositionstart"); f.fire("onKeydown", { isComposing: true });
    f.fire("onCompositionend"); f.fire("onKeyup"); expect(f.save).not.toHaveBeenCalled();
    const newline = f.fire("onKeydown", { shiftKey: true }); expect(newline.preventDefault).not.toHaveBeenCalled();
    f.fire("onKeydown"); expect(f.save).toHaveBeenCalledOnce(); f.unmount();
  });
  it("disabled editor cannot save even from a manually dispatched event", () => {
    const f = mount(true); f.fire("onKeydown"); expect(f.save).not.toHaveBeenCalled(); f.unmount();
  });
});
