'use client'

import {
  startTransition,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  AlertCircle,
  Cable,
  Database,
  PlugZap,
  Power,
  RadioTower,
  RefreshCw,
  Usb,
  Waves,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  boardStatusFlags,
  parseTelemetryFrames,
  type FastTelemetryPacket,
  type MediumTelemetryPacket,
  type ParsedTelemetryFrame,
  type SlowTelemetryPacket,
  type TelemetryPacket,
} from "@/lib/telemetry-decoder"

type SerialPortRequestFilterLike = {
  usbVendorId: number
  usbProductId?: number
}

type SerialPortOpenOptionsLike = {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: "none" | "even" | "odd"
  bufferSize?: number
  flowControl?: "none" | "hardware"
}

type SerialPortInfoLike = {
  usbVendorId?: number
  usbProductId?: number
}

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: SerialPortOpenOptionsLike): Promise<void>
  close(): Promise<void>
  getInfo?(): SerialPortInfoLike
  forget?(): Promise<void>
}

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>
  requestPort(options?: {
    filters?: SerialPortRequestFilterLike[]
  }): Promise<SerialPortLike>
  addEventListener?(
    type: "connect" | "disconnect",
    listener: EventListenerOrEventListenerObject,
  ): void
  removeEventListener?(
    type: "connect" | "disconnect",
    listener: EventListenerOrEventListenerObject,
  ): void
}

type NavigatorWithSerial = Navigator & {
  serial?: SerialLike
}

type AuthorizedPort = {
  id: string
  label: string
  info: SerialPortInfoLike
  port: SerialPortLike
}

type PacketCounters = {
  fast: number
  medium: number
  slow: number
  total: number
  errors: number
}

type LatestDecodedFrame = {
  payloadLength: number
  packet: TelemetryPacket
  rssi: number
  snr: number
  receivedAt: string
}

type LatestDecodedFrames = {
  fast: LatestDecodedFrame | null
  medium: LatestDecodedFrame | null
  slow: LatestDecodedFrame | null
}

type TelemetryValueProps = {
  label: string
  value: ReactNode
  unit?: string
}

const DEFAULT_BAUD_RATE = "115200"
const EMPTY_PACKET_COUNTERS: PacketCounters = {
  fast: 0,
  medium: 0,
  slow: 0,
  total: 0,
  errors: 0,
}

const EMPTY_LATEST_FRAMES: LatestDecodedFrames = {
  fast: null,
  medium: null,
  slow: null,
}

function getSerialApi(): SerialLike | null {
  if (typeof navigator === "undefined") {
    return null
  }

  return (navigator as NavigatorWithSerial).serial ?? null
}

function subscribeSerialSupport(onStoreChange: () => void): () => void {
  const serial = getSerialApi()

  if (!serial) {
    return () => {}
  }

  serial.addEventListener?.("connect", onStoreChange)
  serial.addEventListener?.("disconnect", onStoreChange)

  return () => {
    serial.removeEventListener?.("connect", onStoreChange)
    serial.removeEventListener?.("disconnect", onStoreChange)
  }
}

function getSerialSupportSnapshot(): boolean {
  return getSerialApi() !== null
}

function getServerSerialSupportSnapshot(): boolean {
  return false
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown serial error."
}

function toHex(value?: number): string {
  if (value === undefined) {
    return "----"
  }

  return value.toString(16).toUpperCase().padStart(4, "0")
}

function formatFloat(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-"
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toString() : "-"
}

function formatVector(values: readonly number[], digits = 2): string {
  return values.map((value) => formatFloat(value, digits)).join(", ")
}

function toLatestDecodedFrame(
  frame: ParsedTelemetryFrame,
  receivedAt: string,
): LatestDecodedFrame {
  return {
    payloadLength: frame.payloadLength,
    packet: frame.packet,
    rssi: frame.rssi,
    snr: frame.snr,
    receivedAt,
  }
}

function updateLatestFrames(
  current: LatestDecodedFrames,
  frames: ParsedTelemetryFrame[],
  receivedAt: string,
): LatestDecodedFrames {
  const next = { ...current }

  for (const frame of frames) {
    const latest = toLatestDecodedFrame(frame, receivedAt)

    if (frame.packet.type === "fast") {
      next.fast = latest
    } else if (frame.packet.type === "medium") {
      next.medium = latest
    } else {
      next.slow = latest
    }
  }

  return next
}

function updatePacketCounters(
  current: PacketCounters,
  frames: ParsedTelemetryFrame[],
  errorCount: number,
): PacketCounters {
  const next = {
    ...current,
    total: current.total + frames.length,
    errors: current.errors + errorCount,
  }

  for (const frame of frames) {
    next[frame.packet.type] += 1
  }

  return next
}

function describePort(port: SerialPortLike, index: number): AuthorizedPort {
  const info = port.getInfo?.() ?? {}
  const vendor = toHex(info.usbVendorId)
  const product = toHex(info.usbProductId)

  return {
    id: `${vendor}-${product}-${index}`,
    label:
      info.usbVendorId === undefined && info.usbProductId === undefined
        ? `Serial device ${index + 1}`
        : `VID ${vendor} / PID ${product}`,
    info,
    port,
  }
}

function TelemetryValue({ label, value, unit }: TelemetryValueProps) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-h-6 items-baseline gap-1 font-mono text-sm font-semibold">
        <span className="break-all">{value}</span>
        {unit ? <span className="text-xs font-normal text-muted-foreground">{unit}</span> : null}
      </dd>
    </div>
  )
}

function FrameSignal({ frame }: { frame: LatestDecodedFrame | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{frame ? `len ${frame.payloadLength}` : "waiting"}</span>
      <span>{frame ? `RSSI ${formatFloat(frame.rssi, 1)}` : "RSSI -"}</span>
      <span>{frame ? `SNR ${formatFloat(frame.snr, 1)}` : "SNR -"}</span>
      <span>{frame?.receivedAt ?? "--:--:--"}</span>
    </div>
  )
}

function FastPacketFields({ packet }: { packet: FastTelemetryPacket | null }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <TelemetryValue label="primary_rpm" value={packet ? formatInteger(packet.primary_rpm) : "-"} />
      <TelemetryValue label="output_rpm" value={packet ? formatInteger(packet.output_rpm) : "-"} />
      <TelemetryValue label="speed_mph" value={packet ? formatInteger(packet.speed_mph) : "-"} unit="mph" />
      <TelemetryValue label="latitude_deg" value={packet ? formatFloat(packet.latitude_deg, 6) : "-"} />
      <TelemetryValue label="longitude_deg" value={packet ? formatFloat(packet.longitude_deg, 6) : "-"} />
    </dl>
  )
}

function MediumPacketFields({ packet }: { packet: MediumTelemetryPacket | null }) {
  return (
    <dl className="grid gap-2">
      <TelemetryValue label="speed_mps[3]" value={packet ? `[${formatVector(packet.mPs)}]` : "-"} />
      <TelemetryValue label="acceleration_mps2[3]" value={packet ? `[${formatVector(packet.mPs2)}]` : "-"} />
      <TelemetryValue label="degrees_per_second[3]" value={packet ? `[${formatVector(packet.degPs)}]` : "-"} />
    </dl>
  )
}

function SlowPacketFields({ packet }: { packet: SlowTelemetryPacket | null }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-2 sm:grid-cols-2">
        <TelemetryValue label="setpoints[4]" value={packet ? `[${formatVector(packet.setpoints)}]` : "-"} />
        <TelemetryValue label="fuel_percent" value={packet ? formatInteger(packet.fuel_percent) : "-"} unit="%" />
        <TelemetryValue label="deg[2]" value={packet ? `[${formatVector(packet.deg, 6)}]` : "-"} />
        <TelemetryValue label="altitude_deg" value={packet ? formatFloat(packet.altitude_deg, 2) : "-"} />
      </dl>
      <div>
        <p className="text-xs font-medium text-muted-foreground">board_statuses</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {boardStatusFlags.map((flag) => (
            <Badge key={flag} variant={packet?.board_statuses[flag] ? "secondary" : "outline"}>
              {flag}: {packet?.board_statuses[flag] ? "1" : "0"}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SerialConsole() {
  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const shouldReadRef = useRef(false)
  const frameBufferRef = useRef<Uint8Array>(new Uint8Array())

  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD_RATE)
  const [authorizedPorts, setAuthorizedPorts] = useState<AuthorizedPort[]>([])
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null)
  const [totalBytes, setTotalBytes] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [packetCounters, setPacketCounters] = useState<PacketCounters>(EMPTY_PACKET_COUNTERS)
  const [latestFrames, setLatestFrames] = useState<LatestDecodedFrames>(EMPTY_LATEST_FRAMES)
  const serialSupported = useSyncExternalStore(
    subscribeSerialSupport,
    getSerialSupportSnapshot,
    getServerSerialSupportSnapshot,
  )

  const refreshAuthorizedPorts = useCallback(async () => {
    const serial = getSerialApi()
    if (!serial) {
      return
    }

    const ports = await serial.getPorts()

    startTransition(() => {
      setAuthorizedPorts(ports.map((port, index) => describePort(port, index)))
    })
  }, [])

  const disconnectPort = useCallback(
    async () => {
      shouldReadRef.current = false
      frameBufferRef.current = new Uint8Array()

      const reader = readerRef.current
      readerRef.current = null

      if (reader) {
        try {
          await reader.cancel()
        } catch {
          // Ignore cancellation errors during teardown.
        }

        try {
          reader.releaseLock()
        } catch {
          // Ignore release errors if the stream already detached.
        }
      }

      const port = portRef.current
      portRef.current = null

      if (port) {
        try {
          await port.close()
        } catch {
          // Ignore close errors caused by device removal.
        }
      }

      startTransition(() => {
        setConnected(false)
        setConnecting(false)
        setConnectionLabel(null)
      })
    },
    [],
  )

  useEffect(() => {
    const serial = getSerialApi()

    if (!serial) {
      return
    }
    void refreshAuthorizedPorts()

    const handleConnect = () => {
      void refreshAuthorizedPorts()
    }

    const handleDisconnect = () => {
      void refreshAuthorizedPorts()
    }

    serial.addEventListener?.("connect", handleConnect)
    serial.addEventListener?.("disconnect", handleDisconnect)

    return () => {
      serial.removeEventListener?.("connect", handleConnect)
      serial.removeEventListener?.("disconnect", handleDisconnect)
      void disconnectPort()
    }
  }, [disconnectPort, refreshAuthorizedPorts])

  async function beginReading(port: SerialPortLike) {
    shouldReadRef.current = true

    while (shouldReadRef.current && port.readable) {
      const reader = port.readable.getReader()
      readerRef.current = reader

      try {
        while (shouldReadRef.current) {
          const { value, done } = await reader.read()

          if (done) {
            break
          }

          if (!value) {
            continue
          }

          const parseResult = parseTelemetryFrames(frameBufferRef.current, value)
          const receivedAt = new Date().toLocaleTimeString()

          frameBufferRef.current = parseResult.remaining

          startTransition(() => {
            setTotalBytes((current) => current + value.byteLength)

            if (parseResult.frames.length > 0) {
              setLatestFrames((current) =>
                updateLatestFrames(current, parseResult.frames, receivedAt),
              )
              setPacketCounters((current) =>
                updatePacketCounters(current, parseResult.frames, parseResult.errors.length),
              )
            } else if (parseResult.errors.length > 0) {
              setPacketCounters((current) =>
                updatePacketCounters(current, [], parseResult.errors.length),
              )
            }
          })
        }
      } catch (error) {
        if (shouldReadRef.current) {
          const message = getErrorMessage(error)
          setErrorMessage(message)
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          // Ignore release errors on abrupt disconnects.
        }

        if (readerRef.current === reader) {
          readerRef.current = null
        }
      }
    }

    if (portRef.current === port) {
      portRef.current = null
      startTransition(() => {
        setConnected(false)
        setConnecting(false)
        setConnectionLabel(null)
      })
    }
  }

  async function connectToPort(port: SerialPortLike) {
    const parsedBaudRate = Number.parseInt(baudRate, 10)

    if (!Number.isFinite(parsedBaudRate) || parsedBaudRate <= 0) {
      setErrorMessage("Enter a valid baud rate before opening the serial port.")
      return
    }

    if (portRef.current) {
      await disconnectPort()
    }

    const label = describePort(port, 0).label

    frameBufferRef.current = new Uint8Array()
    setErrorMessage(null)
    setConnecting(true)

    try {
      await port.open({
        baudRate: parsedBaudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        bufferSize: 4096,
        flowControl: "none",
      })

      portRef.current = port

      startTransition(() => {
        setConnected(true)
        setConnecting(false)
        setConnectionLabel(label)
      })

      void beginReading(port)
      await refreshAuthorizedPorts()
    } catch (error) {
      const message = getErrorMessage(error)

      startTransition(() => {
        setConnecting(false)
        setConnected(false)
        setConnectionLabel(null)
      })
      setErrorMessage(message)
    }
  }

  async function handleGrantPort() {
    const serial = getSerialApi()

    if (!serial) {
      return
    }

    setConnecting(true)
    setErrorMessage(null)

    try {
      const port = await serial.requestPort()
      await connectToPort(port)
    } catch (error) {
      startTransition(() => {
        setConnecting(false)
      })

      const message = getErrorMessage(error)

      if (message.toLowerCase().includes("user") || message.toLowerCase().includes("abort")) {
        return
      }

      setErrorMessage(message)
    }
  }

  async function handleReconnectSavedPort(port: SerialPortLike) {
    await connectToPort(port)
  }

  const connectionStatus = connected ? "Connected" : connecting ? "Connecting" : "Disconnected"
  const connectionTone = connected
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : connecting
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-zinc-300 bg-zinc-50 text-zinc-700"
  const statusDotTone = connected
    ? "bg-emerald-500"
    : connecting
      ? "bg-amber-500"
      : "bg-zinc-400"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-3 py-3 sm:px-4 lg:px-5">
        <header className="border-b border-border pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <RadioTower className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Chrome Web Serial</p>
                <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
                  Baja Telemetry
                </h1>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[560px]">
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">Status</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`size-2 rounded-full ${statusDotTone}`} />
                  <span className="text-sm font-medium">{connectionStatus}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">Packets</p>
                <p className="mt-1 font-mono text-sm font-medium">{packetCounters.total}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">RX bytes</p>
                <p className="mt-1 font-mono text-sm font-medium">{totalBytes}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">Decode errors</p>
                <p className="mt-1 font-mono text-sm font-medium">{packetCounters.errors}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 py-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Usb className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold">Connection</h2>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium ${connectionTone}`}
                >
                  <span className={`size-1.5 rounded-full ${statusDotTone}`} />
                  {connectionStatus}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="baud-rate" className="text-sm font-medium">
                    Baud rate
                  </label>
                  <Input
                    id="baud-rate"
                    inputMode="numeric"
                    value={baudRate}
                    onChange={(event) => setBaudRate(event.target.value)}
                    placeholder={DEFAULT_BAUD_RATE}
                    className="h-9 rounded-md font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="col-span-2 h-9 rounded-md"
                    onClick={() => void handleGrantPort()}
                    disabled={!serialSupported || connecting}
                  >
                    <PlugZap />
                    Connect
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 rounded-md"
                    onClick={() => void refreshAuthorizedPorts()}
                    disabled={!serialSupported || connecting}
                  >
                    <RefreshCw />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 rounded-md"
                    onClick={() => void disconnectPort()}
                    disabled={!connected && !connecting}
                  >
                    <Power />
                    Close
                  </Button>
                </div>

                <dl className="divide-y divide-border border-t border-border text-sm">
                  <div className="flex items-center justify-between gap-3 py-3">
                    <dt className="text-muted-foreground">Active port</dt>
                    <dd className="min-w-0 truncate text-right font-medium">
                      {connectionLabel ?? "None"}
                    </dd>
                  </div>
                </dl>
              </div>

              {!serialSupported ? (
                <Alert variant="destructive" className="mt-4 rounded-lg">
                  <Cable className="size-4" />
                  <AlertTitle>Web Serial unavailable</AlertTitle>
                  <AlertDescription>Use desktop Chrome on localhost or HTTPS.</AlertDescription>
                </Alert>
              ) : null}

              {errorMessage ? (
                <Alert variant="destructive" className="mt-4 rounded-lg">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Serial error</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Waves className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold">Saved Ports</h2>
                </div>
                <Badge variant="outline" className="rounded-md">
                  {authorizedPorts.length}
                </Badge>
              </div>

              <div className="mt-4 space-y-2">
                {authorizedPorts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/35 px-3 py-6 text-center text-sm text-muted-foreground">
                    None
                  </p>
                ) : (
                  authorizedPorts.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border bg-background px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{entry.label}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {toHex(entry.info.usbVendorId)}:{toHex(entry.info.usbProductId)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-md"
                          onClick={() => void handleReconnectSavedPort(entry.port)}
                          disabled={connecting}
                        >
                          <Waves />
                          Open
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <div className="min-w-0 space-y-4">
            <section>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold">Decoded Telemetry</h2>
                </div>
              </header>

              <div className="mt-3 grid gap-3 xl:grid-cols-3">
                <article className="rounded-lg border border-border bg-card p-4">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Fast Packet</h3>
                      <FrameSignal frame={latestFrames.fast} />
                    </div>
                    <Badge variant="secondary" className="rounded-md">
                      {packetCounters.fast}
                    </Badge>
                  </header>
                  <div className="mt-4">
                    <FastPacketFields
                      packet={
                        latestFrames.fast?.packet.type === "fast"
                          ? latestFrames.fast.packet
                          : null
                      }
                    />
                  </div>
                </article>

                <article className="rounded-lg border border-border bg-card p-4">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Medium Packet</h3>
                      <FrameSignal frame={latestFrames.medium} />
                    </div>
                    <Badge variant="secondary" className="rounded-md">
                      {packetCounters.medium}
                    </Badge>
                  </header>
                  <div className="mt-4">
                    <MediumPacketFields
                      packet={
                        latestFrames.medium?.packet.type === "medium"
                          ? latestFrames.medium.packet
                          : null
                      }
                    />
                  </div>
                </article>

                <article className="rounded-lg border border-border bg-card p-4">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Slow Packet</h3>
                      <FrameSignal frame={latestFrames.slow} />
                    </div>
                    <Badge variant="secondary" className="rounded-md">
                      {packetCounters.slow}
                    </Badge>
                  </header>
                  <div className="mt-4">
                    <SlowPacketFields
                      packet={
                        latestFrames.slow?.packet.type === "slow"
                          ? latestFrames.slow.packet
                          : null
                      }
                    />
                  </div>
                </article>
              </div>
            </section>

          </div>
        </div>
      </div>
    </main>
  )
}
