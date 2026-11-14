/**
 * Splits a stream of text chunks into complete lines. Chunks may cut a line
 * anywhere (including inside a multi-byte character, which the caller's
 * TextDecoder with `stream: true` already handles). `\r\n` and `\n` both end a line.
 */
export class LineSplitter {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    return parts.map((line) => line.replace(/\r$/, ''))
  }

  /** Returns whatever is left once the stream has ended. */
  flush(): string[] {
    const rest = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    return rest ? [rest] : []
  }
}
