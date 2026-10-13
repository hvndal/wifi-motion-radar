import { NextRequest, NextResponse } from "next/server";

// In-memory cache for live ESP32 telemetry pushed over Wi-Fi
let latestEsp32Data = {
  connected: false,
  timestamp: 0,
  ip: "",
  rssi: -50,
  variance: 0.0,
  csiVariance: 0.0,
  motion: false,
  subcarriers: [] as number[],
  triggerCount: 0,
  clients: [] as unknown[],
};

// ESP32 Pushes its live sensing data here over Wi-Fi
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    latestEsp32Data = {
      connected: true,
      timestamp: Date.now(),
      ip: body.ip || request.headers.get("x-forwarded-for") || "ESP32",
      rssi: Number(body.rssi ?? -50),
      variance: Number(body.variance ?? 0.0),
      csiVariance: Number(body.csiVariance ?? 0.0),
      motion: Boolean(body.motion),
      subcarriers: Array.isArray(body.subcarriers) ? body.subcarriers : [],
      triggerCount: Number(body.triggerCount ?? 0),
      clients: Array.isArray(body.clients) ? body.clients : [],
    };
    return NextResponse.json({ success: true, receivedAt: latestEsp32Data.timestamp });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// Browser fetches live ESP32 telemetry automatically
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetIp = searchParams.get("ip");

  // If we have recent pushed telemetry (within 4 seconds), serve it immediately!
  const isRecent = Date.now() - latestEsp32Data.timestamp < 4000;
  if (isRecent && latestEsp32Data.connected) {
    return NextResponse.json({
      ...latestEsp32Data,
      source: "auto_push",
    });
  }

  // If a specific IP was provided or fallback polling is requested
  if (targetIp) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);

      const response = await fetch(`http://${targetIp}/status`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        latestEsp32Data = {
          connected: true,
          timestamp: Date.now(),
          ip: targetIp,
          rssi: Number(data.rssi ?? -50),
          variance: Number(data.variance ?? 0.0),
          csiVariance: Number(data.csiVariance ?? 0.0),
          motion: Boolean(data.motion),
          subcarriers: data.subcarriers || [],
          triggerCount: Number(data.triggerCount ?? 0),
          clients: data.clients || [],
        };
        return NextResponse.json({ ...latestEsp32Data, source: "polled" });
      }
    } catch {
      // Polling timeout
    }
  }

  return NextResponse.json({
    connected: isRecent,
    timestamp: latestEsp32Data.timestamp,
    ip: latestEsp32Data.ip,
    rssi: latestEsp32Data.rssi,
    variance: latestEsp32Data.variance,
    csiVariance: latestEsp32Data.csiVariance,
    motion: latestEsp32Data.motion,
    subcarriers: latestEsp32Data.subcarriers,
    triggerCount: latestEsp32Data.triggerCount,
    source: "cache",
  });
}
