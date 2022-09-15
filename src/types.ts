type TextEncodeFunction = (input: string) => Uint8Array;
type TextDecodeFunction = (input: Uint8Array) => string;

type NextTickFunction = (fn: Function) => void;

export interface Options {
  textEncode?: TextEncodeFunction;
  textDecode?: TextDecodeFunction;
  nextTick?: NextTickFunction;
}

export interface InternalHolder {
  textEncode: TextEncodeFunction;
  textDecode: TextDecodeFunction;
  nextTick?: NextTickFunction;
}
