/** @jsxImportSource @opentui/solid */
import { expect, mock, test } from "bun:test"
import type { TuiPromptRef } from "@opencode-ai/plugin/tui"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { createEffect, createSignal, Show } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"

async function wait(fn: () => boolean) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for prompt")
    await Bun.sleep(10)
  }
}

test("public prompt ghost is reactive, independent of current/set/reset, and scoped to its mount", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const app = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => app.renderer }))
  const events = createEventSource()
  const calls = createFetch()
  const [mounted, setMounted] = createSignal(true)
  const seen: string[] = []
  let prompt: TuiPromptRef | undefined
  let disposeSlots: (() => void) | undefined
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      fetch: calls.fetch,
      events: events.source,
      args: {},
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      pluginHost: {
        async start({ api, runtime }) {
          const slots = runtime.setupSlots(api)
          const unregister = slots.register({
            id: "ghost-test",
            slots: {
              home_prompt(_ctx, props) {
                const [ref, setRef] = createSignal<TuiPromptRef>()
                createEffect(() => {
                  if (ref()) seen.push(ref()!.ghost)
                })
                return (
                  <Show when={mounted()}>
                    <api.ui.Prompt
                      placeholders={{ normal: ["PLACEHOLDER"] }}
                      ref={(value) => {
                        prompt = value
                        setRef(value)
                        props.ref?.(value)
                      }}
                    />
                  </Show>
                )
              },
            },
          })
          disposeSlots = () => {
            unregister()
            slots.dispose()
          }
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    }).pipe(Effect.provide(Global.layerWith({ state: tmp.path, data: tmp.path, home: tmp.path }))),
  )
  try {
    await wait(() => prompt !== undefined)
    const first = prompt!
    first.focus()
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("expected prompt textarea")
    first.setGhost("suggestion")
    await app.flush()
    expect(first.ghost).toBe("suggestion")
    expect(first.current).toEqual({ input: "", parts: [] })
    expect(app.captureCharFrame()).toContain("suggestion")
    expect(app.captureCharFrame()).not.toContain("PLACEHOLDER")
    first.setGhost("")
    await app.flush()
    expect(app.captureCharFrame()).toContain("PLACEHOLDER")
    first.set({ input: "hello", parts: [] })
    editor.cursorOffset = 2
    first.setGhost(" tail")
    await app.flush()
    expect(first.current.input).toBe("hello")
    expect(editor.cursorOffset).toBe(2)
    expect(app.captureCharFrame()).toContain("hello tail")
    editor.deleteCharBackward()
    await app.flush()
    expect(first.current.input).toBe("hllo")
    expect(first.ghost).toBe(" tail")
    first.set({ input: "replacement", parts: [] })
    await app.flush()
    expect(first.ghost).toBe(" tail")
    first.reset()
    await app.flush()
    expect(first.current).toEqual({ input: "", parts: [] })
    expect(first.ghost).toBe(" tail")
    first.setGhost("")
    await app.flush()
    expect(seen).toEqual(["", "suggestion", "", " tail", ""])
    first.set({ input: "saved draft", parts: [] })
    first.setGhost(" old suffix")
    await app.flush()
    setMounted(false)
    await app.flush()
    expect(prompt).toBeUndefined()
    expect(editor.isDestroyed).toBe(true)
    setMounted(true)
    await app.flush()
    await wait(() => prompt !== undefined)
    expect(prompt).not.toBe(first)
    expect(prompt!.current.input).toBe("saved draft")
    expect(prompt!.ghost).toBe("")
    first.setGhost(" stale")
    await app.flush()
    expect(prompt!.ghost).toBe("")
    expect(app.captureCharFrame()).not.toContain("stale")
    expect(app.captureCharFrame()).not.toContain("old suffix")
    prompt!.reset()
  } finally {
    app.renderer.destroy()
    await task
    mock.restore()
  }
})
