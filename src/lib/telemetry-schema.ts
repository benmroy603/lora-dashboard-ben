import { boardStatusFlags } from "@/lib/telemetry-decoder"

export type TelemetryField = {
  name: string
  type: string
  note?: string
}

export type TelemetryPacketSection = {
  id: "fast" | "medium" | "slow"
  name: string
  cadence: string
  description: string
  fields: TelemetryField[]
}

export const telemetryPacketSections: TelemetryPacketSection[] = [
  {
    id: "fast",
    name: "Fast Packet",
    cadence: "high-rate",
    description: "Powertrain speed and GPS position data for the most responsive dashboard surfaces.",
    fields: [
      { name: "primary_rpm", type: "uint16" },
      { name: "output_rpm", type: "uint16" },
      { name: "speed_mph", type: "uint8" },
      {
        name: "latitude_deg",
        type: "float32",
        note: "accepts decimal degrees or E7 fixed-point degrees",
      },
      {
        name: "longitude_deg",
        type: "float32",
        note: "accepts decimal degrees or E7 fixed-point degrees",
      },
    ],
  },
  {
    id: "medium",
    name: "Medium Packet",
    cadence: "mid-rate",
    description: "Vehicle speed, acceleration, and angular-rate vectors for live motion views.",
    fields: [
      { name: "speed_mps[3]", type: "compressed float[3]", note: "source field: mPs" },
      { name: "acceleration_mps2[3]", type: "compressed float[3]", note: "source field: mPs2" },
      {
        name: "degrees_per_second[3]",
        type: "compressed float[3]",
        note: "source field: degPs",
      },
    ],
  },
  {
    id: "slow",
    name: "Slow Packet",
    cadence: "low-rate",
    description: "Board health, driver setpoints, and location values that change less frequently.",
    fields: [
      {
        name: "board_status_flags",
        type: "bit-packed status mask",
        note: boardStatusFlags.join(", "),
      },
      { name: "setpoints[4]", type: "compressed float[4]", note: "fl, fr, rl, rr" },
      { name: "fuel_percent", type: "uint8" },
      { name: "deg[2]", type: "compressed float[2]" },
      { name: "altitude_deg", type: "float32" },
    ],
  },
]
