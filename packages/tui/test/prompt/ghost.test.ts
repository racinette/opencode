import { describe, expect, test } from "bun:test"
import { BoxRenderable, RGBA, TextareaRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { PromptTextareaRenderable } from "../../src/component/prompt/ghost"

describe("prompt ghost rendering", () => {
  test.each([
    ["hello", " world again", ["hello world", "again"]],
    ["hello long world", " next step", ["hello long", "world next", "step"]],
    ["abcdefghijk", "中", ["abcdefghijk", "中"]],
    ["abcdefghijk", "🙂", ["abcdefghijk", "🙂"]],
    ["abcdefghijkl", " mno", ["abcdefghijkl", " mno"]],
    ["中文🙂", " é👨‍👩‍👧‍👦 next", ["中文🙂 é👨‍👩‍👧‍👦", "next"]],
    ["hello", "\n\nlast", ["hello", "", "last"]],
    ["abc\n", "tail", ["abc", "tail"]],
    ["", "suggestion", ["suggestion"]],
  ])("suffix after %j wraps without editing input", async (text, ghost, expected) => {
    const app = await createTestRenderer({ width: 12, height: 10, useThread: false })
    const editor = new PromptTextareaRenderable(app.renderer, { width: 12, minHeight: 1, maxHeight: 6 })
    app.renderer.root.add(editor)
    editor.setText(text)
    try {
      for (const cursor of [0, Math.floor(text.length / 2), text.length]) {
        editor.cursorOffset = cursor
        const before = editor.cursorOffset
        editor.ghostText = ghost
        await app.flush()
        await app.flush()
        expect(
          app
            .captureCharFrame()
            .split("\n")
            .slice(0, expected.length)
            .map((line) => line.trimEnd()),
        ).toEqual(expected)
        expect(editor.plainText).toBe(text)
        expect(editor.cursorOffset).toBe(before)
      }
    } finally {
      app.renderer.destroy()
    }
  })

  test("grows and shrinks with wrapping, resizing, and the configured height limit", async () => {
    const app = await createTestRenderer({ width: 24, height: 10, useThread: false })
    const editor = new PromptTextareaRenderable(app.renderer, { width: "100%", minHeight: 1, maxHeight: 6 })
    app.renderer.root.add(editor)
    editor.setText("hello long world")
    editor.cursorOffset = 2
    try {
      editor.ghostText = " with a multiline suffix that will wrap across several lines"
      await app.flush()
      expect(editor.height).toBe(4)
      app.resize(12, 10)
      await app.flush()
      await app.flush()
      expect(editor.height).toBe(6)
      app.resize(36, 10)
      await app.flush()
      await app.flush()
      expect(editor.height).toBe(3)
      editor.maxHeight = 2
      await app.flush()
      expect(editor.height).toBe(2)
      editor.maxHeight = 6
      await app.flush()
      expect(editor.height).toBe(3)
      editor.ghostText = ""
      await app.flush()
      expect(editor.height).toBe(1)
      expect(editor.plainText).toBe("hello long world")
      expect(editor.cursorOffset).toBe(2)
      editor.setText("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")
      editor.cursorOffset = 0
      editor.ghostText = " ghost\nnext"
      await app.flush()
      expect(editor.height).toBe(6)
      expect(app.captureCharFrame()).not.toContain("ghost")
    } finally {
      app.renderer.destroy()
    }
  })

  test("ghost color, popup ordering, selection, attachment marks, and submission stay independent", async () => {
    const app = await createTestRenderer({ width: 20, height: 10, useThread: false })
    const parent = new BoxRenderable(app.renderer, { width: 18, height: 8, paddingLeft: 2, paddingTop: 1 })
    const editor = new PromptTextareaRenderable(app.renderer, { width: 12, minHeight: 1, maxHeight: 6 })
    app.renderer.root.add(parent)
    parent.add(editor)
    editor.focus()
    editor.setText("abc")
    editor.cursorOffset = 1
    editor.ghostText = " def"
    editor.ghostColor = RGBA.fromHex("#123456")
    try {
      await app.flush()
      const spans = app.captureSpans().lines[1].spans
      const real = spans.find((span) => span.text.includes("abc"))!
      const ghost = spans.find((span) => span.text.includes("def"))!
      expect(ghost.fg.toString()).toBe(RGBA.fromHex("#123456").toString())
      expect(real.fg.toString()).not.toBe(ghost.fg.toString())
      const popup = new BoxRenderable(app.renderer, {
        position: "absolute",
        left: 2,
        top: 1,
        width: 12,
        height: 2,
        zIndex: 100,
        backgroundColor: "#ff0000",
      })
      popup.add(new TextRenderable(app.renderer, { content: "MENU" }))
      app.renderer.root.add(popup)
      await app.flush()
      expect(app.captureCharFrame()).toContain("MENU")
      expect(app.captureCharFrame()).not.toContain("def")
      expect(app.renderer.currentFocusedEditor).toBe(editor)
      app.renderer.root.remove(popup)
      popup.destroyRecursively()
      const type = editor.extmarks.registerType("attachment")
      const mark = editor.extmarks.create({ start: 0, end: 2, virtual: true, typeId: type })
      editor.setSelection(0, 3)
      const submissions: string[] = []
      editor.onSubmit = () => submissions.push(editor.plainText)
      editor.ghostText = " another"
      await app.flush()
      editor.submit()
      expect(submissions).toEqual(["abc"])
      expect(editor.getSelectedText()).toBe("abc")
      expect(editor.extmarks.get(mark)).not.toBeNull()
      editor.ghostText = ""
      await app.flush()
      expect(editor.getSelectedText()).toBe("abc")
      expect(editor.extmarks.get(mark)).not.toBeNull()
      editor.destroy()
      editor.ghostText = "stale"
      editor.destroy()
    } finally {
      app.renderer.destroy()
    }
  })
})

async function editingFlow(ctor: typeof TextareaRenderable | typeof PromptTextareaRenderable) {
  const app = await createTestRenderer({ width: 24, height: 8, useThread: false })
  const events: string[] = []
  const editor = new ctor(app.renderer, {
    width: 12,
    height: 4,
    onContentChange: () => events.push(`content:${editor.plainText}`),
    onCursorChange: () => events.push(`cursor:${editor.cursorOffset}`),
  })
  app.renderer.root.add(editor)
  editor.focus()
  const keymap = createDefaultOpenTuiKeymap(app.renderer)
  const offManaged = registerManagedTextareaLayer(keymap, app.renderer, {})
  const offMode = keymap.registerLayerFields({ mode: (value, ctx) => ctx.require("mode", value) })
  keymap.setData("mode", "base")
  const commands: string[] = []
  const offCommand = keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: "plugin.command",
        run: () => {
          commands.push("run")
          editor.insertText("!")
        },
      },
    ],
    bindings: [{ key: "ctrl+f", cmd: "plugin.command" }],
  })
  const snapshot = () => ({
    text: editor.plainText,
    cursor: editor.cursorOffset,
    selected: editor.getSelectedText(),
    undo: editor.editBuffer.canUndo(),
    redo: editor.editBuffer.canRedo(),
    events: [...events],
    commands: [...commands],
  })
  const records: ReturnType<typeof snapshot>[] = []
  try {
    await app.flush()
    if (editor instanceof PromptTextareaRenderable) editor.ghostText = " ghost"
    const actions = [
      () => app.mockInput.typeText("hello"),
      () => {
        editor.cursorOffset = 2
      },
      () => app.mockInput.typeText("X"),
      () => app.mockInput.pressBackspace(),
      () => {
        editor.setSelection(1, 3)
        editor.insertText("Y")
      },
      () => editor.undo(),
      () => editor.redo(),
      () => app.mockInput.pasteBracketedText("中文\n🙂"),
      () => editor.setSelection(0, editor.cursorOffset),
      () => app.mockMouse.click(10, 1),
      () => app.mockInput.pressKey("f", { ctrl: true }),
      () => {
        keymap.setData("mode", "autocomplete")
        app.mockInput.pressKey("f", { ctrl: true })
      },
      () => app.mockInput.pressBackspace(),
    ]
    for (const action of actions) {
      await action()
      await app.flush()
      records.push(snapshot())
    }
    expect(commands).toEqual(["run"])
    if (editor instanceof PromptTextareaRenderable) {
      const before = snapshot()
      editor.ghostText = " another"
      await app.flush()
      editor.ghostText = ""
      await app.flush()
      expect(snapshot()).toEqual(before)
    }
    return records
  } finally {
    offCommand()
    offMode()
    offManaged()
    app.renderer.destroy()
  }
}

test("ghost preserves ordinary editing, native events, undo, paste, mouse, and managed keymap behavior", async () => {
  expect(await editingFlow(PromptTextareaRenderable)).toEqual(await editingFlow(TextareaRenderable))
})
