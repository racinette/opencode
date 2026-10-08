import {
  EditBuffer,
  EditorView,
  RGBA,
  TextareaRenderable,
  type OptimizedBuffer,
  type RenderContext,
  type TextareaOptions,
} from "@opentui/core"

type PromptTextareaOptions = TextareaOptions & {
  ghostText?: string
  ghostColor?: RGBA
}

/** The ghost has its own native buffer so it never enters editing, selection, or undo history. */
export class PromptTextareaRenderable extends TextareaRenderable {
  private ghostBuffer: EditBuffer
  private ghostView: EditorView
  private ghostValue = ""
  private displayValue = ""
  private baseMinHeight: number
  private heightLimit: number
  private appliedMinHeight: number
  private contentListener = () => this.updateGhostHeight()

  constructor(ctx: RenderContext, options: PromptTextareaOptions) {
    super(ctx, options)
    this.baseMinHeight = typeof options.minHeight === "number" ? options.minHeight : 1
    this.heightLimit = typeof options.maxHeight === "number" ? options.maxHeight : Infinity
    this.appliedMinHeight = this.baseMinHeight
    this.ghostBuffer = EditBuffer.create(ctx.widthMethod)
    this.ghostBuffer.setDefaultFg(options.ghostColor ?? RGBA.fromHex("#777777"))
    this.ghostView = EditorView.create(this.ghostBuffer, 1, 1)
    this.editBuffer.on("content-changed", this.contentListener)
    this.ghostText = options.ghostText ?? ""
  }

  set ghostText(value: string) {
    if (this.isDestroyed) return
    this.ghostValue = value
    this.updateGhostHeight()
    this.requestRender()
  }

  set ghostColor(value: RGBA) {
    if (this.isDestroyed) return
    this.ghostBuffer.setDefaultFg(value)
    this.requestRender()
  }

  override set maxHeight(value: number | `${number}%` | null | undefined) {
    super.maxHeight = value
    this.heightLimit = typeof value === "number" ? value : Infinity
    this.updateGhostHeight()
  }

  protected override onResize(width: number, height: number) {
    super.onResize(width, height)
    // Recalculate after Yoga finishes the current layout pass.
    queueMicrotask(() => this.updateGhostHeight())
  }

  private endPosition() {
    const info = this.editorView.getLogicalLineInfo()
    const col = info.lineWidthCols.at(-1) ?? 0
    const row = Math.max(0, info.lineSources.length - 1)
    if (this.wrapMode !== "none" && col === this.width) return { row: row + 1, col: 0 }
    return { row, col }
  }

  private configureGhost(col: number) {
    // Padding keeps native word/grapheme wrapping anchored at the input's end,
    // without letting the suffix reflow the input's last word.
    const value = " ".repeat(col) + this.ghostValue
    if (value !== this.displayValue) {
      this.displayValue = value
      this.ghostBuffer.setText(value)
    }
    this.ghostView.setWrapMode(this.wrapMode)
    this.ghostView.setViewport(0, 0, this.width, Math.max(1, this.height), false)
  }

  private updateGhostHeight() {
    if (!this.ghostView || this.isDestroyed || this.width <= 0) return
    const end = this.endPosition()
    if (this.ghostValue) this.configureGhost(end.col)
    const needed = this.ghostValue ? end.row + this.ghostView.getLogicalLineInfo().lineSources.length : 1
    const height = Math.min(this.heightLimit, Math.max(this.baseMinHeight, needed))
    if (height === this.appliedMinHeight) return
    this.appliedMinHeight = height
    this.minHeight = height
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    super.renderSelf(buffer)
    if (!this.ghostValue) return
    const end = this.endPosition()
    const viewport = this.editorView.getViewport()
    const row = end.row - viewport.offsetY
    const col = end.col - viewport.offsetX
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) return
    this.configureGhost(end.col)
    this.ghostView.setViewport(viewport.offsetX, 0, this.width, this.height - row, false)

    // Both draws use the same viewport origin. Clip away the padding and the
    // committed input on the first row; subsequent rows can use the full width.
    buffer.pushScissorRect(this.screenX + col, this.screenY + row, this.width - col, 1)
    buffer.drawEditorView(this.ghostView, this.screenX, this.screenY + row)
    buffer.popScissorRect()
    if (this.height - row <= 1) return
    buffer.pushScissorRect(this.screenX, this.screenY + row + 1, this.width, this.height - row - 1)
    buffer.drawEditorView(this.ghostView, this.screenX, this.screenY + row)
    buffer.popScissorRect()
  }

  override destroy() {
    if (this.isDestroyed) return
    this.editBuffer.off("content-changed", this.contentListener)
    this.ghostView.destroy()
    this.ghostBuffer.destroy()
    super.destroy()
  }
}
