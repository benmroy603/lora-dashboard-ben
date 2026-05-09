export const SR_PKT_TYPE_FAST = 0x01
export const SR_PKT_TYPE_MEDIUM = 0x02
export const SR_PKT_TYPE_SLOW = 0x03

export const SR_FAST_PKT_LEN = 14
export const SR_MED_PKT_LEN = 25
export const SR_SLOW_PKT_LEN = 24
export const SERIAL_SIGNAL_BYTES = 8

export const boardStatusFlags = [
  "wheel",
  "f_HFU",
  "r_HFU",
  "fl_vcmom",
  "fr_vcmom",
  "rl_vcmom",
  "rr_vcmom",
  "pi",
  "pmu",
  "gofobomo",
] as const

export type BoardStatusFlag = (typeof boardStatusFlags)[number]

export type BoardStatuses = Record<BoardStatusFlag, boolean>

export type FastTelemetryPacket = {
  type: "fast"
  primary_rpm: number
  output_rpm: number
  speed_mph: number
  latitude_deg: number
  longitude_deg: number
}

export type MediumTelemetryPacket = {
  type: "medium"
  mPs: [number, number, number]
  mPs2: [number, number, number]
  degPs: [number, number, number]
}

export type SlowTelemetryPacket = {
  type: "slow"
  board_statuses: BoardStatuses
  setpoints: [number, number, number, number]
  fuel_percent: number
  deg: [number, number]
  altitude_deg: number
}

export type TelemetryPacket =
  | FastTelemetryPacket
  | MediumTelemetryPacket
  | SlowTelemetryPacket

export type ParsedTelemetryFrame = {
  payloadLength: number
  packet: TelemetryPacket
  rssi: number
  snr: number
  rawPayload: Uint8Array
}

export type TelemetryFrameParseResult = {
  frames: ParsedTelemetryFrame[]
  errors: string[]
  remaining: Uint8Array
}

const floatScratch = new DataView(new ArrayBuffer(4))

function bitsToFloat32(bits: number): number {
  floatScratch.setUint32(0, bits >>> 0, false)
  return floatScratch.getFloat32(0, false)
}

function getDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readFloat32Le(view: DataView, offset: number): number {
  return view.getFloat32(offset, true)
}

function isKnownPayloadLength(length: number): boolean {
  return (
    length === SR_FAST_PKT_LEN ||
    length === SR_MED_PKT_LEN ||
    length === SR_SLOW_PKT_LEN
  )
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) {
    return right
  }

  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left, 0)
  combined.set(right, left.byteLength)
  return combined
}

function asTuple3(values: number[]): [number, number, number] {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0]
}

function asTuple4(values: number[]): [number, number, number, number] {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0]
}

function decodeCompressedFloats(
  payload: Uint8Array,
  offset: number,
  expectedCount: number,
): number[] {
  const count = payload[offset]
  const maxExp = payload[offset + 1] - 127

  if (count !== expectedCount || count === 0 || count > 8) {
    throw new Error(`Bad compressed float count ${count}; expected ${expectedCount}.`)
  }

  const neededBytes = 2 + count * 2
  if (offset + neededBytes > payload.byteLength) {
    throw new Error("Compressed float block is truncated.")
  }

  const values: number[] = []

  for (let i = 0; i < count; i += 1) {
    const word = (payload[offset + 2 + i * 2] << 8) | payload[offset + 3 + i * 2]
    const sign = (word >> 15) & 0x01
    const man = word & 0x7ff

    if (man === 0) {
      values.push(0)
      continue
    }

    let shift = 0
    let tmp = man
    while ((tmp & 0x400) === 0 && shift < 11) {
      tmp <<= 1
      shift += 1
    }

    const exp = maxExp - shift
    const bits =
      (sign << 31) |
      (((exp + 127) & 0xff) << 23) |
      ((tmp & 0x3ff) << 13)

    values.push(bitsToFloat32(bits))
  }

  return values
}

function decodeStatuses(payload: Uint8Array): BoardStatuses {
  return {
    wheel: Boolean(payload[1] & 0x01),
    f_HFU: Boolean((payload[1] >> 1) & 0x01),
    r_HFU: Boolean((payload[1] >> 2) & 0x01),
    fl_vcmom: Boolean((payload[1] >> 3) & 0x01),
    fr_vcmom: Boolean((payload[1] >> 4) & 0x01),
    rl_vcmom: Boolean((payload[1] >> 5) & 0x01),
    rr_vcmom: Boolean((payload[1] >> 6) & 0x01),
    pi: Boolean((payload[1] >> 7) & 0x01),
    pmu: Boolean(payload[2] & 0x01),
    gofobomo: Boolean((payload[2] >> 1) & 0x01),
  }
}

export function decodeTelemetryPayload(payload: Uint8Array): TelemetryPacket {
  if (payload.byteLength === 0) {
    throw new Error("Empty telemetry payload.")
  }

  const view = getDataView(payload)

  switch (payload[0]) {
    case SR_PKT_TYPE_FAST:
      if (payload.byteLength !== SR_FAST_PKT_LEN) {
        throw new Error(`Fast packet length ${payload.byteLength}; expected ${SR_FAST_PKT_LEN}.`)
      }

      return {
        type: "fast",
        primary_rpm: view.getUint16(1, false),
        output_rpm: view.getUint16(3, false),
        speed_mph: view.getUint8(5),
        latitude_deg: readFloat32Le(view, 6),
        longitude_deg: readFloat32Le(view, 10),
      }

    case SR_PKT_TYPE_MEDIUM:
      if (payload.byteLength !== SR_MED_PKT_LEN) {
        throw new Error(`Medium packet length ${payload.byteLength}; expected ${SR_MED_PKT_LEN}.`)
      }

      return {
        type: "medium",
        mPs: asTuple3(decodeCompressedFloats(payload, 1, 3)),
        mPs2: asTuple3(decodeCompressedFloats(payload, 9, 3)),
        degPs: asTuple3(decodeCompressedFloats(payload, 17, 3)),
      }

    case SR_PKT_TYPE_SLOW:
      if (payload.byteLength !== SR_SLOW_PKT_LEN) {
        throw new Error(`Slow packet length ${payload.byteLength}; expected ${SR_SLOW_PKT_LEN}.`)
      }

      const deg = decodeCompressedFloats(payload, 14, 2)

      return {
        type: "slow",
        board_statuses: decodeStatuses(payload),
        setpoints: asTuple4(decodeCompressedFloats(payload, 3, 4)),
        fuel_percent: view.getUint8(13),
        deg: [deg[0] ?? 0, deg[1] ?? 0],
        altitude_deg: readFloat32Le(view, 20),
      }

    default:
      throw new Error(`Unknown packet type 0x${payload[0].toString(16).padStart(2, "0")}.`)
  }
}

export function parseTelemetryFrames(
  pending: Uint8Array,
  incoming: Uint8Array,
): TelemetryFrameParseResult {
  const bytes = appendBytes(pending, incoming)
  const view = getDataView(bytes)
  const frames: ParsedTelemetryFrame[] = []
  const errors: string[] = []
  let offset = 0

  while (offset < bytes.byteLength) {
    if (!isKnownPayloadLength(bytes[offset])) {
      const skippedFrom = offset

      while (offset < bytes.byteLength && !isKnownPayloadLength(bytes[offset])) {
        offset += 1
      }

      errors.push(`Skipped ${offset - skippedFrom} byte(s) before the next telemetry frame.`)
      continue
    }

    const payloadLength = bytes[offset]
    const frameLength = 1 + payloadLength + SERIAL_SIGNAL_BYTES

    if (bytes.byteLength - offset < frameLength) {
      break
    }

    const payloadStart = offset + 1
    const signalStart = payloadStart + payloadLength
    const rawPayload = bytes.slice(payloadStart, signalStart)

    try {
      frames.push({
        payloadLength,
        packet: decodeTelemetryPayload(rawPayload),
        rssi: readFloat32Le(view, signalStart),
        snr: readFloat32Le(view, signalStart + 4),
        rawPayload,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Could not decode telemetry frame.")
    }

    offset += frameLength
  }

  return {
    frames,
    errors,
    remaining: bytes.slice(offset),
  }
}
