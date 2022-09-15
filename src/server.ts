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
        sentData: false
      };
      if (withStreamRequest) {
        requestContext.requestWithStream = new streams.PassThrough();
        this._requestContexts[header.streamId] = requestContext;
      }

      const done = () => {
        if (requestContext.responseFinished) return ;

        requestContext.responseFinished = true;
        if (!requestContext.sentData) {
          console.error(new Error('error 1'));
        }
      }
      const sendData = (data: any) => {
        if (requestContext.sentData) {
          throw new Error('Already sent data');
        }
        requestContext.sentData = true;

        const binary = this.holder.textEncode(JSON.stringify(data));
        let opCode = OpCode.response_resolve;
        opCode |= requestContext.responseWithStream ? OpCode.flag_include_stream : OpCode.flag_end;

        this.sendPayload({ streamId: header.streamId, opCode }, binary)
          .then(() => {
            if (!requestContext.responseWithStream) {
              done();
            }
          })
          .catch((err) => {
            console.error(err);
            done();
          });
      }

      const data = JSON.parse(this.holder.textDecode(dataPart));
      const req = new Request(data, requestContext.requestWithStream);
      const res = new Response({
        withStream: () => {
          requestContext.responseWithStream = true;
        },
        send: (data) => sendData(data),
        streamWrite: (chunk: Buffer, callback: (error?: (Error | null)) => void) => {
          const opCode = OpCode.stream_data;
          this.sendPayload({streamId: header.streamId, opCode}, chunk)
            .then(() => callback())
            .catch((err) => callback(err));
        },
        streamFinal: (callback: (error?: (Error | null)) => void) => {
          const opCode = OpCode.stream_data | OpCode.flag_end;
          this.sendPayload({streamId: header.streamId, opCode}, null)
            .then(() => {
              callback();
            })
            .catch((err) => {
              done();
              callback(err);
            });
        }
      });

      this.holder.nextTick(() => {
        const next = (err?: any, data?: any) => {
          if (err) {
            return sendReject(err.message);
          }
          if (data) {
            sendData(data);
          }
          done();
        };
        const ret = requestHandler(req, res, next);
        if (isPromise(ret)) {
          ret
            .then((data) => next(null, data))
            .catch((err) => next(err));
        }
      });

      return Promise.resolve();
    } catch (err: any) {
      return sendReject(err.message);
    }
  }
}
