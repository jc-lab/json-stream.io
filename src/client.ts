import * as streams from 'stream';
import Duplexify from 'duplexify';
import {Header, OpCode} from './header';
import {AbstractCommon, RequestHeader} from './base';

export interface RequestConfig {
  timeout?: number;
  withStream?: streams.Readable;
}

export class ClientResponse<D> {
  protected _data: D;
  protected _stream: streams.Readable | null;

  constructor(data: D, stream: streams.Readable | null) {
    this._data = data;
    this._stream = stream;
  }

  public get data(): D {
    return this._data;
  }

  public get stream(): streams.Readable | null {
    return this._stream;
  }
}

interface RequestContext {
  streamId: number;
  requestWithStream: streams.Readable | null;
  timer: any;

  resolve: (res: ClientResponse<any>) => void;
  reject: (err: any) => void;

  responseWithStream: streams.PassThrough | null;

  responsed: boolean;
  cancelled: boolean;
}

export class Client extends AbstractCommon implements streams.Duplex {
  private _requestContexts: Record<number, RequestContext> = {};
  private _streamId: number = 1;

  protected handleIncoming(header: Header, content: Buffer | null): Promise<void> {
    const requestContext = this._requestContexts[header.streamId];
    if (requestContext) {
      const done = () => {
        if (requestContext.responseWithStream) {
          requestContext.responseWithStream.end();
        }
        this.requestDone(requestContext, header);
      };

      requestContext.responsed = true;
      if (requestContext.timer) {
        clearTimeout(requestContext.timer);
        requestContext.timer = null;
      }

      const type = header.opCode & 0x0f;
      if (type === OpCode.response_resolve) {
        const data = content ? JSON.parse(content && this.holder.textDecode(content)) : {};
        requestContext.responseWithStream = (header.opCode & OpCode.flag_include_stream) ? new streams.PassThrough() : null;
        const response = new ClientResponse<any>(data, requestContext.responseWithStream);
        requestContext.resolve(response);
        if (header.opCode & OpCode.flag_end) {
          done();
        }
      } else if (type === OpCode.response_reject) {
        requestContext.reject(new Error(content?.toString() || 'error'));
        done();
      } else if (type === OpCode.stream_data) {
        if (requestContext.responseWithStream) {
          return new Promise<void>((resolve) => {
            const checkEnd = () => {
              if (header.opCode & OpCode.flag_end) {
                done();
              }
            };

            if (content && content.byteLength > 0) {
              requestContext.responseWithStream.write(content, (err) => {
                if (err) {
                  console.error(err);
                }
                checkEnd();
                resolve();
              });
            } else {
              checkEnd();
            }
          });
        }
      }
    }
    else {
      console.error('iunununun', requestContext)
    }
    return Promise.resolve();
  }

  public request<R>(name: string, data: any, config?: RequestConfig): Promise<ClientResponse<R>> {
    const streamId = this._streamId;
    this._streamId += 2;
    return new Promise<ClientResponse<R>>((resolve, reject) => {
      try {
        const requestHeader: RequestHeader = {
          name
        };
        const requestContext: RequestContext = {
          streamId,
          resolve,
          reject,
          requestWithStream: config?.withStream || null,
          timer: null,
          responsed: false,
          cancelled: false,
          responseWithStream: null
        };
        let requestOpCode: number = OpCode.request;
        if (requestContext.requestWithStream) {
          requestOpCode |= OpCode.flag_include_stream;
        } else {
          requestOpCode |= OpCode.flag_end;
        }

        const binaryHeader = this.holder.textEncode(JSON.stringify(requestHeader));
        const binaryData = this.holder.textEncode(JSON.stringify(data || {}));
        if (config?.timeout) {
          requestContext.timer = setTimeout(() => {
            if (!requestContext.responsed) {
              requestContext.cancelled = true;
              delete this._requestContexts[streamId];
              reject(new Error('timed out'));
            }
          }, config.timeout);
        }
        this._requestContexts[streamId] = requestContext;
        this.sendPayload({streamId, opCode: requestOpCode}, Buffer.concat([
          Buffer.from(binaryHeader),
          Buffer.from([0]),
          Buffer.from(binaryData)
        ]))
          .catch((err) => {
            delete this._requestContexts[streamId];
            reject(err);
          });

        if (requestContext.requestWithStream) {
          requestContext.requestWithStream.pipe(new streams.Writable({
            autoDestroy: true,
            write: (chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) => {
              const opCode = OpCode.stream_data;
              this.sendPayload({streamId: streamId, opCode}, chunk)
                .then(() => callback())
                .catch((err) => callback(err));
            },
            destroy: (error: Error | null, callback: (error: (Error | null)) => void) => {
              const opCode = OpCode.stream_data | OpCode.flag_end;
              this.sendPayload({streamId: streamId, opCode}, null)
                .then(() => {
                  callback(null);
                })
                .catch((err) => {
                  callback(err);
                });
            }
          }));
        }
      } catch (e: any) {
        reject(e);
      }
    });
  }

  private requestDone(requestContext: RequestContext, header: Header): void {
    delete this._requestContexts[requestContext.streamId];
    if (header.opCode & OpCode.flag_upgrade) {
      this._upgradeRequested = true;
      const a = new streams.PassThrough();
      const b = new streams.PassThrough();
      const stream = Duplexify(a, b);
      this.upgradeTo(b, a);
      this.emit('upgrade', stream);
    }
  }
}
