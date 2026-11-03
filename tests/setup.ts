import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverStub
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined
})

Object.defineProperty(Element.prototype, 'hasPointerCapture', {
  configurable: true,
  value: () => false
})

Object.defineProperty(Element.prototype, 'setPointerCapture', {
  configurable: true,
  value: () => undefined
})

Object.defineProperty(Element.prototype, 'releasePointerCapture', {
  configurable: true,
  value: () => undefined
})

afterEach(() => {
  cleanup()
})

