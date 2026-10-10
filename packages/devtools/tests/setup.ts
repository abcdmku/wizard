/**
 * jsdom lacks the layout APIs React Flow measures with; stub them the way the React Flow
 * testing guide does so `<ReactFlow>` renders nodes and edges under Vitest.
 */
const WIDTH = 800
const HEIGHT = 600

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element): void {
    const contentRect = { x: 0, y: 0, top: 0, left: 0, width: WIDTH, height: HEIGHT }
    this.callback(
      [{ target, contentRect } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyStub {
  readonly m22: number
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1]
    this.m22 = scale === undefined ? 1 : Number(scale)
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
  writable: true,
  value: DOMMatrixReadOnlyStub,
})
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => HEIGHT },
  offsetWidth: { configurable: true, get: () => WIDTH },
})
;(globalThis.SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
