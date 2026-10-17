import { NextRequest, NextResponse } from "next/server";

// Rolling server-side signal buffer for smoothing & outlier rejection
const rssiHistory: number[] = [];
const varHistory: number[] = [];
const csiHistory: number[] = [];
const MAX_HISTORY = 15;

// In-memory cache for live ESP32 telemetry pushed over Serial Bridge or Wi-Fi
let latestEsp32Data = {
  connected: false,
  timestamp: 0,
  ip: "",
  rssi: -60.0,
  fastRssi: -60.0,
  slowRssi: -60.0,
  variance: 0.12,
  noiseFloor: 0.18,
  snr: 1.0,
  csiVariance: 0.25,
  decorrelation: 0.4,
  motion: false,
  subcarriers: [] as number[],
  triggerCount: 0,
  beacons: 0,
  channel: 8,
  locked: false,
  clients: [] as unknown[],
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Compute adjacent subcarrier differential variance across active 802.11 OFDM tones (6..31, 33..58)
function computeActiveDecorrelation(subcarriers: number[]): number {
  if (!Array.isArray(subcarriers) || subcarriers.length < 64) return 0;
  const diffs: number[] = [];
  for (let i = 6; i < 58; i++) {
    if (i === 31 || i === 32) continue; // Skip DC null carrier
    diffs.push(Math.abs(subcarriers[i + 1] - subcarriers[i]));
  }
  if (diffs.length === 0) return 0;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length;
  return Number(variance.toFixed(2));
}

// ESP32 / Serial Bridge Pushes its live sensing data here at 10 Hz
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const rawRssi = Number(body.rssi ?? -60.0);
    const rawVar = Math.max(0, Number(body.variance ?? 0.0));
    const rawCsi = Math.max(0, Number(body.csiVariance ?? 0.0));

    // Maintain server-side rolling window
    if (rawRssi < -10 && rawRssi > -98) {
      rssiHistory.push(rawRssi);
      if (rssiHistory.length > MAX_HISTORY) rssiHistory.shift();
    }
    varHistory.push(rawVar);
    if (varHistory.length > MAX_HISTORY) varHistory.shift();

    csiHistory.push(rawCsi);
    if (csiHistory.length > MAX_HISTORY) csiHistory.shift();

    // Smooth RSSI with median + EMA fusion to prevent distance jitter on the radar
    const medianRssi = rssiHistory.length >= 3 ? median(rssiHistory.slice(-5)) : rawRssi;
    const smoothedRssi = Number((0.65 * rawRssi + 0.35 * medianRssi).toFixed(2));

    const subcarriers: number[] = Array.isArray(body.subcarriers) ? body.subcarriers : [];
    const computedDecorr =
      body.decorrelation !== undefined && Number(body.decorrelation) > 0
        ? Number(body.decorrelation)
        : computeActiveDecorrelation(subcarriers);

    const noiseFloor = Number(body.noiseFloor ?? 0.18);
    const snr = Number(body.snr ?? (rawVar / Math.max(0.08, noiseFloor)).toFixed(2));

    latestEsp32Data = {
      connected: true,
      timestamp: Date.now(),
      ip: body.ip || request.headers.get("x-forwarded-for") || "COM3 (ESP32)",
      rssi: smoothedRssi,
      fastRssi: Number(body.fastRssi ?? rawRssi),
      slowRssi: Number(body.slowRssi ?? smoothedRssi),
      variance: Number(rawVar.toFixed(3)),
      noiseFloor: Number(noiseFloor.toFixed(3)),
      snr: Number(snr.toFixed(2)),
      csiVariance: Number(rawCsi.toFixed(3)),
      decorrelation: Number(computedDecorr.toFixed(2)),
      motion: Boolean(body.motion),
      subcarriers,
      triggerCount: Number(body.triggerCount ?? 0),
      beacons: Number(body.beacons ?? 0),
      channel: Number(body.channel ?? 8),
      locked: body.locked !== undefined ? Boolean(body.locked) : true,
      clients: Array.isArray(body.clients) ? body.clients : [],
    };

    return NextResponse.json({
      success: true,
      receivedAt: latestEsp32Data.timestamp,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// Browser fetches live ESP32 telemetry automatically
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetIp = searchParams.get("ip");

  // If we have recent pushed telemetry (within 3.5 seconds), serve it immediately!
  const ageMs = Date.now() - latestEsp32Data.timestamp;
  const isRecent = latestEsp32Data.timestamp > 0 && ageMs < 3500;

  if (isRecent && latestEsp32Data.connected) {
    return NextResponse.json({
      ...latestEsp32Data,
      ageMs,
      source: "auto_push",
    });
  }

  // Optional direct IP HTTP fallback
  if (targetIp) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);

      const response = await fetch(`http://${targetIp}/status`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        latestEsp32Data = {
          ...latestEsp32Data,
          connected: true,
          timestamp: Date.now(),
          ip: targetIp,
          rssi: Number(data.rssi ?? -60),
          variance: Number(data.variance ?? 0.0),
          csiVariance: Number(data.csiVariance ?? 0.0),
          motion: Boolean(data.motion),
          subcarriers: data.subcarriers || [],
          triggerCount: Number(data.triggerCount ?? 0),
        };
        return NextResponse.json({ ...latestEsp32Data, ageMs: 0, source: "polled" });
      }
    } catch {
      // Polling timeout
    }
  }

  // Disconnected / Stale state: Explicitly zero out motion so UI never stays stuck on old values!
  return NextResponse.json({
    ...latestEsp32Data,
    connected: false,
    motion: false,
    ageMs,
    source: "stale_cache",
  });
}
