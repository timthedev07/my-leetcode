import init, { format } from '@wasm-fmt/clang-format/vite'

type FormatRequest = {
  id: number
  source: string
  style: string
}

type FormatResponse = {
  id: number
  formatted?: string
  error?: string
}

const ready = init()

self.onmessage = async (event: MessageEvent<FormatRequest>): Promise<void> => {
  const { id, source, style } = event.data
  try {
    await ready
    const formatted = format(source, 'solution.cpp', style)
    const response: FormatResponse = { id, formatted }
    self.postMessage(response)
  } catch (error) {
    const response: FormatResponse = {
      id,
      error: error instanceof Error ? error.message : 'clang-format failed.'
    }
    self.postMessage(response)
  }
}

