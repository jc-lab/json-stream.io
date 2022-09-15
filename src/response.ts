import * as streams from 'stream';

export interface ResponseHandlers {
  withStream(): void;
  withUpgrade(writable: streams.Writable, readable: streams.Readable): void;
  send(data: any): void;
  streamWrite(chunk: Buffer, callback: (error?: (Error | null)) => void): void;
  streamFinal(callback: (error?: (Error | null)) => void): void;
}

export class Response extends streams.Writable {
  protected _finished: boolean = false;

  constructor(
    private readonly handlers: ResponseHandlers
  ) {
    super({
      autoDestroy: true
    });
  }

  public withUpgrade(writable: streams.Writable, readable: streams.Readable): this {
    this.handlers.withUpgrade(writable, readable);
    return this;
  }

  public withStream(): this {
    this.handlers.withStream();
    return this;
  }

  public send(data: any): void {
    this.handlers.send(data || {});
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.handlers.streamWrite(buffer, callback);
  }

  _destroy(error: Error | null, callback: (error?: (Error | null)) => void) {
    this.handlers.streamFinal(callback);
  }
}
