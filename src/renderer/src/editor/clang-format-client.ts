import ClangFormatWorker from '@/workers/clang-format.worker?worker'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'
import type { ClangFormatValidation } from '@shared/types'

type PendingRequest = {
  resolve: (formatted: string) => void
  reject: (error: Error) => void
}

const SAMPLE_CPP = `#include <vector>
using namespace std;
class Solution{public:int answer(vector<int>& values){int total=0;for(int value:values){total+=value;}return total;}};`

export class ClangFormatClient {
  private worker: Worker | null = null
  private sequence = 0
  private readonly pending = new Map<number, PendingRequest>()

  format(source: string, style = DEFAULT_CLANG_FORMAT_YAML): Promise<string> {
    const worker = this.getWorker()
    const id = ++this.sequence
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, source, style })
    })
  }

  async validate(style: string): Promise<ClangFormatValidation> {
    try {
      const formattedPreview = await this.format(SAMPLE_CPP, style)
      return {
        valid: true,
        error: null,
        formattedPreview
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'The formatting configuration is invalid.',
        formattedPreview: null
      }
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const request of this.pending.values()) {
      request.reject(new Error('The formatter was closed before completing the request.'))
    }
    this.pending.clear()
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new ClangFormatWorker()
    worker.onmessage = (event: MessageEvent<{ id: number; formatted?: string; error?: string }>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (event.data.error) pending.reject(new Error(event.data.error))
      else pending.resolve(event.data.formatted ?? '')
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The clang-format worker failed.')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      worker.terminate()
      if (this.worker === worker) this.worker = null
    }
    this.worker = worker
    return worker
  }
}

export const clangFormat = new ClangFormatClient()

