import * as streams from 'stream';

export class Request<D> {
  private _data: D;
  private _stream: streams.Readable | null;

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
