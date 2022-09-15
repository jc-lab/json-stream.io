import {ReadBuffer} from './read-buffer';

const HEADER_SIZE = 8;

export enum OpCode {
  request = 0x01,
  response_resolve = 0x02,
  response_reject = 0x03,
  stream_data = 0x04,
  flag_include_stream = 0x10,
  flag_upgrade = 0x40,
  flag_end = 0x80,
}

export interface Header {
  streamId: number;
  opCode: number;
  length: number;
}

export function readHeader(reader: ReadBuffer): Header | null {
  const buffer = reader.consume(HEADER_SIZE);
  if (!buffer) {
    return null;
  }

  let streamId = buffer[0] << 24;
  streamId |= buffer[1] << 16;
  streamId |= buffer[2] << 8;
  streamId |= buffer[3];
  const opCode = buffer[4];
  let length = buffer[5] << 16;
  length |= buffer[6] << 8;
  length |= buffer[7];

  return {
    streamId,
    opCode,
    length
  };
}
