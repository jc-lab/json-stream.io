import * as utils from 'util';
import * as streams from 'stream';
import Duplexify from 'duplexify';
import {
  InternalHolder,
  Options
} from './types';
import {ReadBuffer} from './read-buffer';
import {Header, readHeader} from './header';

const defaultTextEncoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : (utils && utils.TextEncoder) ? new utils.TextEncoder() : undefined;
const defaultTextDecoder = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : (utils && utils.TextDecoder) ? new utils.TextDecoder() : undefined;

const defaultHolder: Partial<InternalHolder> = {};
if (defaultTextEncoder && defaultTextDecoder) {
  Object.assign(defaultHolder, {
    textEncode: (input) => defaultTextEncoder.encode(input),
    textDecode: (input) => defaultTextDecoder.decode(input)
  });
}
if (typeof process !== 'undefined') {
  defaultHolder.nextTick = process.nextTick;
} else if (typeof setImmediate === 'function') {
  defaultHolder.nextTick = setImmediate;
} else if (typeof setTimeout === 'function') {
  defaultHolder.nextTick = (fn) => setTimeout(fn, 0);
}

export interface RequestHeader {
  name: string;
}

export abstract class AbstractCommon extends Duplexify {
  protected readonly writeStream: streams.PassThrough;
  protected readonly readStream: streams.Writable;
  protected readonly holder: InternalHolder;

  private readonly _receiveBuffer: ReadBuffer = new ReadBuffer();
  private _receiveHeader: Header | null = null;

  constructor(options?: Partial<Options>) {
    super();

    this.holder = defaultHolder as InternalHolder;
    if (options?.textEncode) this.holder.textEncode = options.textEncode;
    if (options?.textDecode) this.holder.textDecode = options.textDecode;
    if (options?.nextTick) this.holder.nextTick = options.nextTick;

    this.writeStream = new streams.PassThrough();
    this.readStream = new streams.Writable({
      autoDestroy: true,
      write: (chunk: any, encoding: BufferEncoding, callback2: (error?: (Error | null)) => void) => {
        const uuid = Math.random();
        console.log('_WRITE ', uuid, 'START');
        const callback = (error?: (Error | null)) => {
          console.log('_WRITE ', uuid, 'END');
          callback2(error);
        };
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this._receiveBuffer.append(buffer);
        const next = () => {
          if (this._receiveBuffer.length <= 0) {
            return callback();
          }
          if (!this._receiveHeader) {
            this._receiveHeader = readHeader(this._receiveBuffer);
          }
          if (!this._receiveHeader) {
            return callback();
          }
          const header = this._receiveHeader;
          const content = this._receiveBuffer.consume(header.length);
          if (content || header.length === 0) {
            this._receiveHeader = null;
            return this.handleIncoming(header, content)
              .then(() => next())
              .catch((err) => callback(err));
          }

          callback();
        }
        next();
      }
    });
    super.setReadable(this.writeStream);
    super.setWritable(this.readStream);
  }

  protected abstract handleIncoming(header: Header, content: Buffer | null): Promise<void>;

  protected sendPayload(header: Partial<Header>, data: Uint8Array | null): Promise<any> {
    const streamId = header.streamId || 0;
    const opcode = header.opCode as number;

    const dataBuffer = data ? (Buffer.isBuffer(data) ? data : Buffer.from(data)) : null;
    const dataLength = dataBuffer?.length || 0;

    const headerPayload = Buffer.from([
      (streamId >> 24) & 0xff,
      (streamId >> 16) & 0xff,
      (streamId >> 8) & 0xff,
      (streamId) & 0xff,
      opcode,
      (dataLength >> 16) & 0xff,
      (dataLength >> 8) & 0xff,
      (dataLength) & 0xff
    ]);

    return new Promise<void>((resolve, reject) => {
      const expectedCount = 1 + (dataBuffer ? 1 : 0);
      let writtenCount = 0;

      const next = () => {
        writtenCount++;
        if (writtenCount === expectedCount) {
          resolve();
        }
      };

      const writableCorked = this.writeStream.writableCorked;
      if (!writableCorked) {
        this.writeStream.cork();
      }
      this.writeStream.write(headerPayload, (err) => {
        if (err) reject(err);
        else next();
      });
      if (dataBuffer) {
        this.writeStream.write(dataBuffer, (err) => {
          if (err) reject(err);
          else next();
        });
      }
      if (!writableCorked) {
        this.writeStream.uncork();
      }
    });
  }

  protected upgradeTo(writable: streams.Writable, readable: streams.Readable): void {
    if (this._receiveHeader) {
      throw new Error('illegal state');
    }
    if (this._receiveBuffer.length) {
      writable.write(this._receiveBuffer.consume(this._receiveBuffer.length));
    }
    this.setWritable(writable);
    this.setReadable(readable);
  }
}
