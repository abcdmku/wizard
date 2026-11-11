import { MAX_SERVER_FRAME_BYTES, type ServerFrame } from '@wizard/dungeon-shared'

export interface EncodedServerFrame {
  readonly bytes: number
  readonly frame: ServerFrame
  readonly payload: string
}

export const encodeServerFrame = (frame: ServerFrame): EncodedServerFrame => {
  const payload = JSON.stringify(frame)
  return { bytes: Buffer.byteLength(payload, 'utf8'), frame, payload }
}

export const isEncodedServerFrameWithinLimit = (encoded: EncodedServerFrame): boolean =>
  encoded.bytes <= MAX_SERVER_FRAME_BYTES
