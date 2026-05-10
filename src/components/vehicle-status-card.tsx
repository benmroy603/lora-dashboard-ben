'use client'

import { ShieldCheck } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { boardStatusFlags, type BoardStatuses } from "@/lib/telemetry-decoder"
import { cn } from "@/lib/utils"

type VehicleStatusCardProps = {
  statuses: BoardStatuses | null
  updatedAt?: string | null
  className?: string
}

function formatStatusName(name: string): string {
  return name.replaceAll("_", " ")
}

export function VehicleStatusCard({
  statuses,
  updatedAt,
  className,
}: VehicleStatusCardProps) {
  const hasReading = statuses !== null

  return (
    <Card className={cn("rounded-lg", className)}>
      <CardHeader className="border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <CardTitle>Vehicle Statuses</CardTitle>
        </div>
        <CardDescription>
          {updatedAt ? `Slow packet ${updatedAt}` : "Waiting for slow packet"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {boardStatusFlags.map((flag) => {
            const isGood = Boolean(statuses?.[flag])
            const statusLabel = hasReading ? (isGood ? "good" : "off") : "waiting"

            return (
              <div
                key={flag}
                aria-label={`${formatStatusName(flag)} status ${statusLabel}`}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2",
                  hasReading && isGood
                    ? "border-green-300 bg-green-50 text-green-950"
                    : "border-zinc-300 bg-zinc-50 text-zinc-700",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {formatStatusName(flag)}
                  </span>
                </div>
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full ring-2 ring-background",
                    hasReading && isGood ? "bg-green-600" : "bg-zinc-400",
                  )}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
