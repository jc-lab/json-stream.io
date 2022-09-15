export class ReadBuffer {
  public buffer: Buffer = Buffer.alloc(32768);
  public length: number = 0;

  public append(chunk: Buffer): void {
    const afterSize = this.length + chunk.byteLength;
    if (afterSize > this.buffer.length) {
      this.increaseSize(afterSize);
    }
    chunk.copy(this.buffer, this.length, 0, chunk.byteLength);
    this.length += chunk.byteLength;
  }

  public increaseSize(size: number): void {
    let targetSize = this.buffer.length;
    while (targetSize < size) {
      targetSize += 32768;
    }
    const newBuffer = Buffer.alloc(targetSize);
    this.buffer.copy(newBuffer, 0, 0, this.length);
    this.buffer = newBuffer;
  }

  public consume(size: number): Buffer | null {
    if (this.length < size || size === 0) {
      return null;
    }
    const newBuf = Buffer.alloc(size);
    this.buffer.copy(newBuf, 0, 0, size);
    this.buffer.copyWithin(0, size, this.length);
    this.length -= size;
    return newBuf;
  }
}
