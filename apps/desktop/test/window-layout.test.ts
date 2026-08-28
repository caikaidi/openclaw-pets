import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  layoutFor,
  panelStatusCenterX,
  petViewportForScale,
  repositionForLayout,
  type WindowGeometry,
} from "../src/runtime/window-layout.js";

describe("pet window layout", () => {
  it("keeps the native launch window aligned with the initial status layout", () => {
    const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    const initial = layoutFor(33, "status");

    expect(config.app.windows[0]).toMatchObject({ width: initial.width, height: initial.height });
  });

  it.each([
    [33, { width: 202, height: 117 }],
    [50, { width: 306, height: 177 }],
    [75, { width: 459, height: 266 }],
  ] as const)("uses the %s%% pet viewport", (scale, expected) => {
    expect(petViewportForScale(scale)).toEqual(expected);
  });

  it("adds headroom above the pet without moving the pet on screen", () => {
    const collapsed = layoutFor(33, "none");
    const expanded = layoutFor(33, "decision");
    const current: WindowGeometry = { x: 300, y: 600, width: collapsed.width, height: collapsed.height };

    const next = repositionForLayout(current, collapsed, expanded, 2);

    expect(next.x + expanded.pet.x * 2).toBe(current.x + collapsed.pet.x * 2);
    expect(next.y + expanded.pet.y * 2).toBe(current.y + collapsed.pet.y * 2);
    expect(next.y).toBeLessThan(current.y);
  });

  it("keeps the pet bottom anchored when changing scale", () => {
    const small = layoutFor(33, "none");
    const large = layoutFor(75, "none");
    const current: WindowGeometry = { x: 900, y: 700, width: small.width, height: small.height };

    const next = repositionForLayout(current, small, large, 2);

    const oldBottom = current.y + (small.pet.y + small.pet.height) * 2;
    const newBottom = next.y + (large.pet.y + large.pet.height) * 2;
    expect(newBottom).toBe(oldBottom);
  });

  it("clamps the visible pet to the physical monitor, including the Dock area", () => {
    const layout = layoutFor(33, "none");
    const current: WindowGeometry = { x: 100, y: 1_900, width: layout.width, height: layout.height };
    const next = repositionForLayout(current, layout, layout, 2, {
      x: 0,
      y: 0,
      width: 3_024,
      height: 1_964,
    });

    expect(next.y + layout.pet.height * 2).toBe(1_964);
  });

  it.each([
    ["left", -42],
    ["right", 1_640],
  ] as const)("opens an overlay inward at the %s edge without moving the pet", (_edge, x) => {
    const collapsed = layoutFor(33, "none");
    const expanded = layoutFor(33, "decision");
    const current: WindowGeometry = { x, y: 700, width: collapsed.width, height: collapsed.height };
    const monitor = { x: 0, y: 0, width: 1_800, height: 1_200 };

    const next = repositionForLayout(current, collapsed, expanded, 2, monitor);
    const oldPetLeft = current.x + collapsed.pet.x * 2;
    const newPetLeft = next.x + next.layout.pet.x * 2;
    const overlay = next.layout.overlay!;

    expect(newPetLeft).toBe(oldPetLeft);
    expect(next.x + overlay.x * 2).toBeGreaterThanOrEqual(monitor.x);
    expect(next.x + (overlay.x + overlay.width) * 2).toBeLessThanOrEqual(monitor.x + monitor.width);
    expect(next.layout.overlayAnchorX).toBeGreaterThanOrEqual(24);
    expect(next.layout.overlayAnchorX).toBeLessThanOrEqual(overlay.width - 24);
  });

  it("preserves the pet position when closing an edge-aligned overlay", () => {
    const collapsed = layoutFor(33, "none");
    const expanded = layoutFor(33, "decision");
    const opened = repositionForLayout(
      { x: -42, y: 700, width: collapsed.width, height: collapsed.height },
      collapsed,
      expanded,
      2,
      { x: 0, y: 0, width: 1_800, height: 1_200 },
    );

    const closed = repositionForLayout(opened, opened.layout, collapsed, 2, {
      x: 0,
      y: 0,
      width: 1_800,
      height: 1_200,
    });

    expect(closed.x + closed.layout.pet.x * 2).toBe(opened.x + opened.layout.pet.x * 2);
  });

  it("keeps the panel recording status pill inside an edge-aligned native window", () => {
    const collapsed = layoutFor(33, "none");
    const expanded = layoutFor(33, "panel");
    const opened = repositionForLayout(
      { x: 1_640, y: 700, width: collapsed.width, height: collapsed.height },
      collapsed,
      expanded,
      2,
      { x: 0, y: 0, width: 1_800, height: 1_200 },
    );
    const center = panelStatusCenterX(opened.layout);

    expect(center - 125).toBeGreaterThanOrEqual(8);
    expect(center + 125).toBeLessThanOrEqual(opened.layout.width - 8);
  });

  it.each(["status", "decision", "panel"] as const)("reserves a feathering gutter around the %s overlay", (overlay) => {
    const layout = layoutFor(33, overlay);
    const frame = layout.overlay!;

    expect(frame.x).toBeGreaterThanOrEqual(24);
    expect(frame.y).toBeGreaterThanOrEqual(16);
    expect(layout.width - frame.x - frame.width).toBeGreaterThanOrEqual(24);
    expect(layout.pet.y - frame.y - frame.height).toBeGreaterThanOrEqual(32);
  });
});
