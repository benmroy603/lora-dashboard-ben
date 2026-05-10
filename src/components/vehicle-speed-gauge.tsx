'use client'

import { motion } from "motion/react"

import { cn } from "@/lib/utils"

type VehicleSpeedGaugeProps = {
  value: number | null
  updatedAt?: string | null
  maxMph?: number
  className?: string
}

type GaugePoint = {
  x: number
  y: number
}

const VIEWBOX_WIDTH = 240
const VIEWBOX_HEIGHT = 160
const CENTER_X = 120
const CENTER_Y = 116
const ARC_RADIUS = 84
const START_ANGLE = 154
const END_ANGLE = 386
const DEFAULT_MAX_MPH = 80
const HIGH_SPEED_RATIO = 0.82
const OVER_SPEED_RATIO = 0.94

const GAUGE_ARC_PATH = describeArc(START_ANGLE, END_ANGLE)
const SPEED_TICKS = Array.from({ length: 9 }, (_, index) => index / 8)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(3))
}

function pointOnArc(angle: number, radius: number): GaugePoint {
  const radians = (angle * Math.PI) / 180

  return {
    x: roundCoordinate(CENTER_X + radius * Math.cos(radians)),
    y: roundCoordinate(CENTER_Y + radius * Math.sin(radians)),
  }
}

function describeArc(startAngle: number, endAngle: number): string {
  const start = pointOnArc(startAngle, ARC_RADIUS)
  const end = pointOnArc(endAngle, ARC_RADIUS)
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1"

  return [
    `M ${start.x} ${start.y}`,
    `A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
  ].join(" ")
}

function angleForRatio(ratio: number): number {
  return START_ANGLE + (END_ANGLE - START_ANGLE) * ratio
}

function formatSpeed(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--"
  }

  return Math.round(value).toLocaleString()
}

function formatTickLabel(value: number): string {
  return Math.round(value).toString()
}

function getSpeedTone(value: number | null, maxMph: number) {
  if (value === null || !Number.isFinite(value)) {
    return {
      label: "Waiting",
      color: "#64748b",
      badge: "border-border bg-background text-muted-foreground",
    }
  }

  const ratio = value / maxMph

  if (ratio >= 1) {
    return {
      label: "Over range",
      color: "#dc2626",
      badge: "border-border bg-background text-foreground",
    }
  }

  if (ratio >= OVER_SPEED_RATIO) {
    return {
      label: "Limit",
      color: "#dc2626",
      badge: "border-border bg-background text-foreground",
    }
  }

  if (ratio >= HIGH_SPEED_RATIO) {
    return {
      label: "High",
      color: "#d97706",
      badge: "border-border bg-background text-foreground",
    }
  }

  return {
    label: "Nominal",
    color: "#171717",
    badge: "border-border bg-background text-foreground",
  }
}

export function VehicleSpeedGauge({
  value,
  updatedAt,
  maxMph = DEFAULT_MAX_MPH,
  className,
}: VehicleSpeedGaugeProps) {
  const hasReading = value !== null && Number.isFinite(value)
  const clampedMph = hasReading ? clamp(value, 0, maxMph) : 0
  const progress = maxMph > 0 ? clampedMph / maxMph : 0
  const speedTone = getSpeedTone(value, maxMph)
  const ariaLabel = hasReading
    ? `Speed ${Math.round(value)} miles per hour on a ${maxMph} mile per hour gauge`
    : "Speed gauge waiting for telemetry"

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="font-semibold">Speed</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {updatedAt ? `Fast packet ${updatedAt}` : "Waiting for fast packet"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium",
            speedTone.badge,
          )}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: speedTone.color }}
          />
          {speedTone.label}
        </span>
      </header>

      <div className="px-4 py-3">
        <div className="mx-auto min-w-0 max-w-[360px]">
          <svg
            role="img"
            aria-label={ariaLabel}
            className="h-auto w-full overflow-visible"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          >
            <title>{ariaLabel}</title>
            <path
              d={GAUGE_ARC_PATH}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="14"
              className="text-muted/85"
            />
            <motion.path
              d={GAUGE_ARC_PATH}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="10"
              className="text-foreground"
              initial={false}
              animate={{
                opacity: hasReading ? 1 : 0,
                pathLength: progress,
              }}
              transition={{
                opacity: { duration: 0.18 },
                pathLength: { type: "spring", stiffness: 88, damping: 24, mass: 0.85 },
              }}
            />
            <g>
              {SPEED_TICKS.map((ratio, index) => {
                const angle = angleForRatio(ratio)
                const isMajor = index % 2 === 0
                const tickStart = pointOnArc(angle, isMajor ? ARC_RADIUS - 18 : ARC_RADIUS - 14)
                const tickEnd = pointOnArc(angle, ARC_RADIUS - 9)
                const labelPoint = pointOnArc(angle, ARC_RADIUS - 30)
                const tickValue = Math.round(maxMph * ratio)

                return (
                  <motion.g
                    key={ratio}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.28, delay: index * 0.025 }}
                  >
                    <line
                      x1={tickStart.x}
                      y1={tickStart.y}
                      x2={tickEnd.x}
                      y2={tickEnd.y}
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth={isMajor ? 2 : 1.2}
                      className={isMajor ? "text-foreground/45" : "text-foreground/20"}
                    />
                    {isMajor ? (
                      <text
                        x={labelPoint.x}
                        y={labelPoint.y}
                        dominantBaseline="middle"
                        textAnchor="middle"
                        className="fill-muted-foreground font-mono text-[7.5px] font-medium"
                      >
                        {formatTickLabel(tickValue)}
                      </text>
                    ) : null}
                  </motion.g>
                )
              })}
            </g>
            <text
              x={CENTER_X}
              y={CENTER_Y - 14}
              dominantBaseline="middle"
              textAnchor="middle"
              className="fill-foreground font-mono text-[22px] font-semibold"
            >
              {formatSpeed(value)}
            </text>
            <text
              x={CENTER_X}
              y={CENTER_Y + 4}
              dominantBaseline="middle"
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[7px] font-medium"
            >
              MPH
            </text>
          </svg>
        </div>
      </div>
    </article>
  )
}
