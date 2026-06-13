'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  CircleMarker,
  LatLngExpression,
  Map as LeafletMap,
  Polyline,
} from "leaflet"
import { Circle, CircleStop, Crosshair, Scan, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type LeafletModule = typeof import("leaflet")
type VehiclePosition = [number, number]

type TrackSample = {
  capturedAt: number
  distanceMeters: number
  position: VehiclePosition
}

type VehicleLocationMapProps = {
  latitude: number | null
  longitude: number | null
  rssi: number | null
  snr: number | null
  updatedAt?: string | null
  className?: string
}

const DEFAULT_CENTER: VehiclePosition = [39.8283, -98.5795]
const DEFAULT_ZOOM = 4
const VEHICLE_ZOOM = 16
const SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
const SATELLITE_ATTRIBUTION = '&copy; <a href="https://www.esri.com/">Esri</a>'

const EARTH_RADIUS_METERS = 6_371_000
const MIN_SAMPLE_DISTANCE_METERS = 2.5
const START_FINISH_RADIUS_METERS = 15
const LOOP_ARM_DISTANCE_METERS = 45
const MIN_LAP_DISTANCE_METERS = 120
const MIN_LAP_DURATION_MS = 15_000
const MIN_LAP_POINTS = 8

function getVehiclePosition(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): VehiclePosition | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return [latitude, longitude]
}

function copyPosition(position: VehiclePosition): VehiclePosition {
  return [position[0], position[1]]
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function distanceBetweenMeters(
  first: VehiclePosition,
  second: VehiclePosition,
): number {
  const firstLatitude = degreesToRadians(first[0])
  const secondLatitude = degreesToRadians(second[0])
  const latitudeDelta = degreesToRadians(second[0] - first[0])
  const longitudeDelta = degreesToRadians(second[1] - first[1])
  const halfChordLength =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(halfChordLength), Math.sqrt(1 - halfChordLength))
  )
}

function createVehicleDot(
  leaflet: LeafletModule,
  position: LatLngExpression,
): CircleMarker {
  return leaflet.circleMarker(position, {
    radius: 8,
    color: "#171717",
    weight: 3,
    opacity: 1,
    fillColor: "#22c55e",
    fillOpacity: 0.92,
    bubblingMouseEvents: false,
  })
}

function createTrackLine(
  leaflet: LeafletModule,
  positions: LatLngExpression[],
): Polyline {
  return leaflet.polyline(positions, {
    color: "#0f766e",
    dashArray: "8 7",
    lineCap: "round",
    lineJoin: "round",
    opacity: 0.92,
    weight: 4,
  })
}

function createTrackStartDot(
  leaflet: LeafletModule,
  position: LatLngExpression,
): CircleMarker {
  return leaflet.circleMarker(position, {
    radius: 5,
    color: "#171717",
    weight: 2,
    opacity: 1,
    fillColor: "#f59e0b",
    fillOpacity: 0.95,
    bubblingMouseEvents: false,
  })
}

function formatCoordinate(value: number | null, axis: "lat" | "lon"): string {
  if (value === null || !Number.isFinite(value)) {
    return "--"
  }

  const positiveSuffix = axis === "lat" ? "N" : "E"
  const negativeSuffix = axis === "lat" ? "S" : "W"
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix

  return `${Math.abs(value).toFixed(6)} ${suffix}`
}

function formatTrackDistance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 m"
  }

  if (value < 160.9344) {
    return `${Math.round(value)} m`
  }

  return `${(value / 1609.344).toFixed(2)} mi`
}

function formatSignalValue(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(1)
    : "--"
}

export function VehicleLocationMap({
  latitude,
  longitude,
  rssi,
  snr,
  updatedAt,
  className,
}: VehicleLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const dotRef = useRef<CircleMarker | null>(null)
  const trackLineRef = useRef<Polyline | null>(null)
  const trackStartDotRef = useRef<CircleMarker | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const hasFocusedVehicleRef = useRef(false)
  const trackArmedRef = useRef(false)
  const trackDistanceRef = useRef(0)
  const trackLastPositionRef = useRef<VehiclePosition | null>(null)
  const trackPointCountRef = useRef(0)
  const trackStartedAtRef = useRef<number | null>(null)
  const trackStartPositionRef = useRef<VehiclePosition | null>(null)
  const followVehicleRef = useRef(true)
  const [mapReady, setMapReady] = useState(false)
  const [followVehicle, setFollowVehicle] = useState(true)
  const [isTrackRecording, setIsTrackRecording] = useState(false)
  const [trackArmed, setTrackArmed] = useState(false)
  const [trackComplete, setTrackComplete] = useState(false)
  const [trackSamples, setTrackSamples] = useState<TrackSample[]>([])
  const position = useMemo(
    () => getVehiclePosition(latitude, longitude),
    [latitude, longitude],
  )
  const positionRef = useRef<VehiclePosition | null>(position)
  const hasPosition = position !== null
  const hasTrackOutline = trackSamples.length >= 2
  const trackDistanceMeters = trackSamples.at(-1)?.distanceMeters ?? 0
  const trackStatusLabel = isTrackRecording
    ? trackArmed
      ? "Loop armed"
      : "Recording"
    : trackComplete
      ? "Lap complete"
      : hasTrackOutline
        ? "Track ready"
        : "No track"
  const trackBadgeVariant = isTrackRecording || trackComplete
    ? "secondary"
    : hasTrackOutline
      ? "outline"
      : "ghost"

  useEffect(() => {
    positionRef.current = position
  }, [position])

  const pauseVehicleFollow = useCallback(() => {
    if (!positionRef.current) {
      return
    }

    followVehicleRef.current = false
    setFollowVehicle(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function mountMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return
      }

      const leaflet = await import("leaflet")

      if (cancelled || !mapContainerRef.current) {
        return
      }

      const initialPosition = positionRef.current
      const map = leaflet.map(mapContainerRef.current, {
        attributionControl: true,
        preferCanvas: true,
        worldCopyJump: true,
        zoomControl: false,
      })

      leafletRef.current = leaflet
      map.setView(
        initialPosition ?? DEFAULT_CENTER,
        initialPosition ? VEHICLE_ZOOM : DEFAULT_ZOOM,
      )
      leaflet.control.zoom({ position: "bottomright" }).addTo(map)
      leaflet
        .tileLayer(SATELLITE_TILE_URL, {
          attribution: SATELLITE_ATTRIBUTION,
          crossOrigin: true,
          maxZoom: 19,
          minZoom: 2,
        })
        .addTo(map)

      if (initialPosition) {
        dotRef.current = createVehicleDot(leaflet, initialPosition).addTo(map)
        hasFocusedVehicleRef.current = true
      }

      map.on("dragstart", pauseVehicleFollow)
      mapRef.current = map
      setMapReady(true)
      window.requestAnimationFrame(() => {
        map.invalidateSize({ pan: false })
      })
    }

    void mountMap()

    return () => {
      cancelled = true
      dotRef.current = null
      trackLineRef.current = null
      trackStartDotRef.current = null
      leafletRef.current = null
      hasFocusedVehicleRef.current = false

      if (mapRef.current) {
        mapRef.current.off("dragstart", pauseVehicleFollow)
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [pauseVehicleFollow])

  useEffect(() => {
    const map = mapRef.current
    const leaflet = leafletRef.current

    if (!mapReady || !map || !leaflet) {
      return
    }

    if (!position) {
      dotRef.current?.remove()
      dotRef.current = null
      hasFocusedVehicleRef.current = false
      return
    }

    if (!dotRef.current) {
      dotRef.current = createVehicleDot(leaflet, position).addTo(map)
    } else {
      dotRef.current.setLatLng(position)
    }

    dotRef.current.bringToFront()

    if (!followVehicleRef.current) {
      return
    }

    if (!hasFocusedVehicleRef.current) {
      map.flyTo(position, VEHICLE_ZOOM, {
        animate: true,
        duration: 0.9,
      })
      hasFocusedVehicleRef.current = true
      return
    }

    map.panTo(position, {
      animate: true,
      duration: 0.35,
      easeLinearity: 0.35,
    })
  }, [mapReady, position])

  useEffect(() => {
    const map = mapRef.current
    const leaflet = leafletRef.current

    if (!mapReady || !map || !leaflet) {
      return
    }

    const positions = trackSamples.map((sample) => sample.position)

    if (positions.length === 0) {
      trackLineRef.current?.remove()
      trackStartDotRef.current?.remove()
      trackLineRef.current = null
      trackStartDotRef.current = null
      return
    }

    const startPosition = positions[0]

    if (!trackStartDotRef.current) {
      trackStartDotRef.current = createTrackStartDot(leaflet, startPosition).addTo(map)
    } else {
      trackStartDotRef.current.setLatLng(startPosition)
    }

    if (positions.length < 2) {
      trackLineRef.current?.remove()
      trackLineRef.current = null
      trackStartDotRef.current.bringToFront()
      dotRef.current?.bringToFront()
      return
    }

    if (!trackLineRef.current) {
      trackLineRef.current = createTrackLine(leaflet, positions).addTo(map)
    } else {
      trackLineRef.current.setLatLngs(positions)
    }

    trackLineRef.current.bringToBack()
    trackStartDotRef.current.bringToFront()
    dotRef.current?.bringToFront()
  }, [mapReady, trackSamples])

  useEffect(() => {
    if (!isTrackRecording || !position) {
      return
    }

    const startPosition = trackStartPositionRef.current
    const lastPosition = trackLastPositionRef.current
    const startedAt = trackStartedAtRef.current

    if (!startPosition || !lastPosition || startedAt === null) {
      return
    }

    const segmentMeters = distanceBetweenMeters(lastPosition, position)

    if (segmentMeters < MIN_SAMPLE_DISTANCE_METERS) {
      return
    }

    const now = Date.now()
    const nextDistanceMeters = trackDistanceRef.current + segmentMeters

    trackDistanceRef.current = nextDistanceMeters
    trackLastPositionRef.current = copyPosition(position)
    trackPointCountRef.current += 1

    setTrackSamples((current) => [
      ...current,
      {
        capturedAt: now,
        distanceMeters: nextDistanceMeters,
        position: copyPosition(position),
      },
    ])

    const distanceFromStart = distanceBetweenMeters(startPosition, position)

    if (
      !trackArmedRef.current &&
      (distanceFromStart >= LOOP_ARM_DISTANCE_METERS ||
        nextDistanceMeters >= LOOP_ARM_DISTANCE_METERS)
    ) {
      trackArmedRef.current = true
      setTrackArmed(true)
    }

    const canFinish =
      trackArmedRef.current &&
      distanceFromStart <= START_FINISH_RADIUS_METERS &&
      now - startedAt >= MIN_LAP_DURATION_MS &&
      nextDistanceMeters >= MIN_LAP_DISTANCE_METERS &&
      trackPointCountRef.current >= MIN_LAP_POINTS

    if (canFinish) {
      setIsTrackRecording(false)
      setTrackComplete(true)
    }
  }, [isTrackRecording, position])

  const startTrackRecording = useCallback(() => {
    if (!position) {
      return
    }

    const now = Date.now()
    const startPosition = copyPosition(position)
    const firstSample = {
      capturedAt: now,
      distanceMeters: 0,
      position: startPosition,
    }

    trackArmedRef.current = false
    trackDistanceRef.current = 0
    trackLastPositionRef.current = startPosition
    trackPointCountRef.current = 1
    trackStartedAtRef.current = now
    trackStartPositionRef.current = startPosition
    setTrackArmed(false)
    setTrackComplete(false)
    setTrackSamples([firstSample])
    setIsTrackRecording(true)
  }, [position])

  const stopTrackRecording = useCallback(() => {
    trackArmedRef.current = false
    setTrackArmed(false)
    setIsTrackRecording(false)
    setTrackComplete(false)
    setTrackSamples((current) => (current.length < 2 ? [] : current))
  }, [])

  const clearTrack = useCallback(() => {
    trackArmedRef.current = false
    trackDistanceRef.current = 0
    trackLastPositionRef.current = null
    trackPointCountRef.current = 0
    trackStartedAtRef.current = null
    trackStartPositionRef.current = null
    setTrackArmed(false)
    setTrackComplete(false)
    setTrackSamples([])
    setIsTrackRecording(false)
  }, [])

  const frameTrack = useCallback(() => {
    const map = mapRef.current
    const trackLine = trackLineRef.current

    if (!map || !trackLine || !hasTrackOutline) {
      return
    }

    pauseVehicleFollow()
    map.fitBounds(trackLine.getBounds(), {
      animate: true,
      duration: 0.5,
      maxZoom: 18,
      padding: [28, 28],
    })
  }, [hasTrackOutline, pauseVehicleFollow])

  const recenterVehicle = useCallback(() => {
    const map = mapRef.current
    const currentPosition = positionRef.current

    if (!map || !currentPosition) {
      return
    }

    followVehicleRef.current = true
    setFollowVehicle(true)
    hasFocusedVehicleRef.current = true
    map.panTo(currentPosition, {
      animate: true,
      duration: 0.45,
      easeLinearity: 0.35,
    })
    dotRef.current?.bringToFront()
  }, [])

  const signalCard = (
    <article className="rounded-lg border border-border bg-card px-4 py-3 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Signal</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {updatedAt ? `Fast packet ${updatedAt}` : "Waiting for fast packet"}
          </p>
        </div>
        <dl className="grid min-w-[220px] flex-1 grid-cols-2 gap-2 sm:flex-none">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">RSSI</dt>
            <dd className="mt-1 truncate font-mono text-sm font-semibold">
              {formatSignalValue(rssi)}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">SNR</dt>
            <dd className="mt-1 truncate font-mono text-sm font-semibold">
              {formatSignalValue(snr)}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <article className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Position</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {updatedAt ? `Fast packet ${updatedAt}` : "Waiting for fast packet"}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={hasPosition ? "secondary" : "outline"} className="rounded-md">
              {hasPosition ? "GPS locked" : "No fix"}
            </Badge>
            <Badge variant={trackBadgeVariant} className="rounded-md">
              {trackStatusLabel}
            </Badge>
          </div>
        </header>

        <div className="relative min-h-[320px] overflow-hidden bg-muted/50 sm:min-h-[380px]">
          <div
            ref={mapContainerRef}
            aria-label="Vehicle position map"
            className="absolute inset-0"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Track outline</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {formatTrackDistance(trackDistanceMeters)} / {trackSamples.length} pts
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!followVehicle && hasPosition ? (
              <Button
                variant="secondary"
                size="sm"
                className="rounded-md"
                onClick={recenterVehicle}
              >
                <Crosshair data-icon="inline-start" />
                Recenter
              </Button>
            ) : null}
            <Button
              variant={isTrackRecording ? "destructive" : "outline"}
              size="sm"
              className="rounded-md"
              onClick={isTrackRecording ? stopTrackRecording : startTrackRecording}
              disabled={!hasPosition && !isTrackRecording}
            >
              {isTrackRecording ? (
                <CircleStop data-icon="inline-start" />
              ) : (
                <Circle data-icon="inline-start" className="fill-current" />
              )}
              {isTrackRecording ? "Stop Track" : "Record Track"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={frameTrack}
              disabled={!hasTrackOutline}
            >
              <Scan data-icon="inline-start" />
              Frame
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={clearTrack}
              disabled={trackSamples.length === 0 && !isTrackRecording}
            >
              <Trash2 data-icon="inline-start" />
              Clear
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-border text-sm sm:grid-cols-4">
          <div className="min-w-0 border-r border-border px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Latitude</dt>
            <dd className="mt-1 truncate font-mono font-semibold">
              {formatCoordinate(latitude, "lat")}
            </dd>
          </div>
          <div className="min-w-0 px-4 py-3 sm:border-r sm:border-border">
            <dt className="text-xs font-medium text-muted-foreground">Longitude</dt>
            <dd className="mt-1 truncate font-mono font-semibold">
              {formatCoordinate(longitude, "lon")}
            </dd>
          </div>
          <div className="min-w-0 border-r border-border px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Track</dt>
            <dd className="mt-1 truncate font-mono font-semibold">
              {formatTrackDistance(trackDistanceMeters)}
            </dd>
          </div>
          <div className="min-w-0 px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Points</dt>
            <dd className="mt-1 truncate font-mono font-semibold">
              {trackSamples.length}
            </dd>
          </div>
        </dl>
      </article>
      {signalCard}
    </div>
  )
}
