import { NextRequest, NextResponse } from "next/server";

export interface PhoneTelemetryRecord {
  timestamp: number;
  activityLabel: string;
  accel: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  orientation: { alpha: number; beta: number; gamma: number };
  magnitude: number;
}

// In-memory buffer of latest phone sensor readings
let latestPhoneRecord: PhoneTelemetryRecord | null = null;
const telemetryHistory: PhoneTelemetryRecord[] = [];
const MAX_HISTORY = 300;

export async function POST(req: NextRequest) {
  try {
    const data: PhoneTelemetryRecord = await req.json();
    latestPhoneRecord = data;

    telemetryHistory.push(data);
    if (telemetryHistory.length > MAX_HISTORY) {
      telemetryHistory.shift();
    }

    return NextResponse.json({ status: "ok", received: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET() {
  const isRecent =
    latestPhoneRecord !== null && Date.now() - latestPhoneRecord.timestamp < 3500;

  return NextResponse.json({
    connected: Boolean(isRecent),
    activityLabel: latestPhoneRecord?.activityLabel || "STILL_DESK",
    accel: latestPhoneRecord?.accel || { x: 0, y: 0, z: 0 },
    gyro: latestPhoneRecord?.gyro || { x: 0, y: 0, z: 0 },
    orientation: latestPhoneRecord?.orientation || { alpha: 0, beta: 0, gamma: 0 },
    magnitude: latestPhoneRecord?.magnitude || 0,
    latest: latestPhoneRecord,
    historyCount: telemetryHistory.length,
    recentSamples: telemetryHistory.slice(-20),
  });
}
