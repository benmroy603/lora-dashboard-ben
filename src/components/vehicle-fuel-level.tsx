'use client'

import { Fuel } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

type VehicleFuelLevelProps = {
  value: number | null
  updatedAt?: string | null
  className?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatFuelLevel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--"
  }

  return Math.round(value).toString()
}

function getFuelTone(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return {
      label: "Waiting",
      bar: "bg-muted-foreground",
      badge: "border-border bg-background text-muted-foreground",
    }
  }

  if (value <= 15) {
    return {
      label: "Critical",
      bar: "bg-destructive",
      badge: "border-border bg-background text-foreground",
    }
  }

  if (value <= 30) {
    return {
      label: "Low",
      bar: "bg-chart-2",
      badge: "border-border bg-background text-foreground",
    }
  }

  return {
    label: "Ready",
    bar: "bg-chart-1",
    badge: "border-border bg-background text-foreground",
  }
}

export function VehicleFuelLevel({
  value,
  updatedAt,
  className,
}: VehicleFuelLevelProps) {
  const hasReading = value !== null && Number.isFinite(value)
  const level = hasReading ? clamp(value, 0, 100) : 0
  const fuelTone = getFuelTone(value)
  const ariaLabel = hasReading
    ? `Fuel level ${Math.round(value)} percent`
    : "Fuel level waiting for telemetry"

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Fuel className="size-4 text-muted-foreground" />
            <h3 className="font-semibold">Fuel Level</h3>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {updatedAt ? `Slow packet ${updatedAt}` : "Waiting for slow packet"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium",
            fuelTone.badge,
          )}
        >
          {fuelTone.label}
        </span>
      </header>

      <div className="flex flex-1 flex-col justify-center gap-4 p-4">
        <div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Remaining
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold leading-none">
              {formatFuelLevel(value)}
              <span className="ml-1 text-sm font-medium text-muted-foreground">%</span>
            </p>
          </div>
        </div>

        <div
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasReading ? Math.round(level) : undefined}
          className="h-5 overflow-hidden rounded-md border border-border bg-muted"
        >
          <motion.div
            className={cn("h-full rounded-sm", fuelTone.bar)}
            initial={false}
            animate={{ width: `${level}%` }}
            transition={{ type: "spring", stiffness: 95, damping: 22, mass: 0.8 }}
          />
        </div>
      </div>
    </article>
  )
}
