import test from "node:test";
import assert from "node:assert/strict";
import { foregroundForCell, projectVisibleCells } from "../public/jelly-overlay.mjs";

function cell(chars, width = 1, color = {}) {
  return {
    getChars: () => chars, getWidth: () => width, getFgColor: () => color.value ?? 0,
    isFgRGB: () => color.mode === "rgb", isFgPalette: () => color.mode === "palette",
    isInvisible: () => false, isBold: () => false, isItalic: () => false,
    isUnderline: () => false, isStrikethrough: () => false
  };
}

function buffer(lines, viewportY = 0) {
  return {
    viewportY, getNullCell: () => ({}),
    getLine: row => lines[row] && ({ getCell: col => lines[row][col] })
  };
}

test("projects only visible non-empty cells at viewport coordinates", () => {
  const result = projectVisibleCells(buffer([
    [cell("hidden")], [cell("A"), cell("", 1), cell("B")]
  ], 1), 1, 3, "#abc");
  assert.deepEqual(result.map(({ row, col, chars, width }) => ({ row, col, chars, width })), [
    { row: 0, col: 0, chars: "A", width: 1 }, { row: 0, col: 2, chars: "B", width: 1 }
  ]);
});

test("wide Unicode occupies its lead cell width and skips continuation cells", () => {
  const result = projectVisibleCells(buffer([[
    cell("界", 2), cell("", 0), cell("e\u0301", 1)
  ]]), 1, 3, "#abc");
  assert.deepEqual(result.map(({ col, chars, width }) => ({ col, chars, width })), [
    { col: 0, chars: "界", width: 2 }, { col: 2, chars: "e\u0301", width: 1 }
  ]);
});

test("preserves RGB, indexed, and default foreground colors", () => {
  assert.equal(foregroundForCell(cell("R", 1, { mode: "rgb", value: 0x12abef })), "#12abef");
  assert.equal(foregroundForCell(cell("G", 1, { mode: "palette", value: 2 })), "#74ffbd");
  assert.equal(foregroundForCell(cell("D"), "#fedcba"), "#fedcba");
});
