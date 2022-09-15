import * as streams from 'stream';
import isPromise from 'is-promise';
import {Header, OpCode} from './header';
import {AbstractCommon, RequestHeader} from './base';
import {Request} from './request';
import {Response} from './response';

export type CallbackRequestHandler<D> = (req: Request<D>, res: Response, next: (err?: any) => void) => void;
export type PromiseRequestHandler<D> = (req: Request<D>, res: Response) => Promise<any>;
export type RequestHandler<D> = CallbackRequestHandler<D> | PromiseRequestHandler<D>;

interface RequestContext {
  streamId: number;

  requestWithStream: streams.PassThrough | null;
  responseWithStream: boolean;

  sentData: boolean;
  responseFinished: boolean;

  upgrade: boolean;
  upgradeWritable: streams.Writable | null;
  upgradeReadable: streams.Readable | null;
}

export class Server extends AbstractCommon {
  private _requestHandlers: Record<string, RequestHandler<any>> = {};
  private _requestContexts: Record<number, RequestContext> = {};

  public onRequest<D>(name: string, handler: RequestHandler<D>): void {
    this._requestHandlers[name] = handler;
  }

  protected handleIncoming(header: Header, content: Buffer | null): Promise<void> {
    const opCodeType = header.opCode & 0x0f;
    if (opCodeType === OpCode.request) {
      return this.handleRequest(header, content);
    } else if (opCodeType === OpCode.stream_data) {
      return this.handleStreamData(header, content);
    }

    return Promise.resolve();
  }

  private handleStreamData(header: Header, content: Buffer | null): Promise<void> {
    const requestContext = this._requestContexts[header.streamId];
    if (!requestContext) {
      return Promise.resolve();
    }
    if (!requestContext.requestWithStream) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const next = () => {
        if (header.opCode & OpCode.flag_end) {
          delete this._requestContexts[header.streamId];
          requestContext.requestWithStream.end();
        }
        resolve();
      };

      if (content && content.byteLength > 0) {
        requestContext.requestWithStream.write(content, (err) => {
          if (err) {
            console.error(err);
          }
          next();
        });
      } else {
        next();
      }
    });
  }

  private handleRequest(header: Header, content: Buffer | null): Promise<void> {
    const nullPosition = content.findIndex((v) => v === 0);
    const headerPart = content.subarray(0, nullPosition);
    const dataPart = content.subarray(nullPosition + 1);
    const requestHeader = JSON.parse(headerPart.toString()) as RequestHeader;

    const sendReject = (msg: string): Promise<any> => {
      return this.sendPayload({
        streamId: header.streamId,
        opCode: OpCode.response_reject
      }, this.holder.textEncode(msg));
    }

    const requestHandler = this._requestHandlers[requestHeader.name];
    if (!requestHandler) {
      return sendReject('not implemented request: ' + requestHeader.name);
    }

    try {
      const withStreamRequest = !!(header.opCode & OpCode.flag_include_stream);

      const requestContext: RequestContext = {
        streamId: header.streamId,
        requestWithStream: null,
        responseWithStream: false,
        responseFinished: false,
        sentData: false,

        upgrade: false,
        upgradeWritable: null,
        upgradeReadable: null
      };
      if (withStreamRequest) {
        requestContext.requestWithStream = new streams.PassThrough();
        this._requestContexts[header.streamId] = requestContext;
      }

      const sendData = (data: any) => {
        if (requestContext.sentData) {
          throw new Error('Already sent data');
        }
        requestContext.sentData = true;

        const binary = this.holder.textEncode(JSON.stringify(data));
        let opCode = OpCode.response_resolve;
        if (requestContext.responseWithStream) {
          opCode |= OpCode.flag_include_stream;
        } else {
          opCode |= OpCode.flag_end;
          if (requestContext.upgrade) {
            opCode |= OpCode.flag_upgrade;
          }
        }

        this.sendPayload({ streamId: header.streamId, opCode }, binary)
          .then(() => {
            if (!requestContext.responseWithStream) {
              this.requestDone(requestContext);
            }
          })
          .catch((err) => {
            this.requestDone(requestContext, err);
          });
      }

      const data = JSON.parse(this.holder.textDecode(dataPart));
      const req = new Request(data, requestContext.requestWithStream);
      const res = new Response({
        withStream: () => {
          requestContext.responseWithStream = true;
        },
        withUpgrade: (writable: streams.Writable, readable: streams.Readable) => {
          requestContext.upgrade = true;
          requestContext.upgradeWritable = writable;
          requestContext.upgradeReadable = readable;
        },
        send: (data) => sendData(data),
        streamWrite: (chunk: Buffer, callback: (error?: (Error | null)) => void) => {
          if (!requestContext.sentData) {
            return callback(new Error('must send data before write stream'));
          }
          const opCode = OpCode.stream_data;
          this.sendPayload({streamId: header.streamId, opCode}, chunk)
            .then(() => callback())
            .catch((err) => callback(err));
        },
        streamFinal: (callback: (error?: (Error | null)) => void) => {
          let opCode = OpCode.stream_data | OpCode.flag_end;
          if (requestContext.upgrade) {
            opCode |= OpCode.flag_upgrade;
          }

          this.sendPayload({streamId: header.streamId, opCode}, null)
            .then(() => {
              this.requestDone(requestContext);
              callback();
            })
            .catch((err) => {
              this.requestDone(requestContext, err);
              callback(err);
            });
        }
      });

      this.holder.nextTick(() => {
        const next = (err?: any, data?: any) => {
          if (err) {
            sendReject(err.message)
              .catch((err) => {
                console.error(err);
              });
            return ;
          }
          if (data) {
            sendData(data);
          } else {
            if (!requestContext.responseWithStream) {
              this.requestDone(requestContext);
            }
          }
        };
        try {
          const ret = requestHandler(req, res, next);
          if (isPromise(ret)) {
            ret
              .then((data) => next(null, data))
              .catch((err) => next(err));
          }
        } catch (err: any) {
          next(err);
        }
      });

      return Promise.resolve();
    } catch (err: any) {
      return sendReject(err.message);
    }
  }

  private requestDone(requestContext: RequestContext, err?: any) {
    if (!err && !requestContext.sentData) {
      console.error(new Error('request is done without sent data'));
    }
    if (requestContext.upgrade) {
      this.upgradeTo(requestContext.upgradeWritable, requestContext.upgradeReadable);
    }
  }
}
