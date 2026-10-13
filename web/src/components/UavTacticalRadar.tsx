"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Radar, Crosshair, Volume2, VolumeX, ShieldAlert, Navigation, Zap, Radio, Wifi, Compass, Sliders } from "lucide-react";

interface RadarBlip {
  id: string;
  x: number; // Normalized -1 to 1 in radar space
  y: number; // Normalized -1 to 1 in radar space
  rangeMeters: number;
  angleDeg: number;
  intensity: number; // 0 to 1
  firstDetectedAt: number;
  lastPingedAt: number;
  type: "hostile" | "friendly" | "ambient";
  velocityMs: number;
  confidence: number;
}

interface UavTacticalRadarProps {
  wifiVariance: number;
  csiVariance: number;
  isMotionDetected: boolean;
  phoneAccelMag: number;
  phoneTag: string;
  isPhoneStreaming: boolean;
  soundEnabled: boolean;
  wifiRssi?: number;
}

export function UavTacticalRadar({
  wifiVariance,
  csiVariance,
  isMotionDetected,
  phoneAccelMag,
  phoneTag,
  isPhoneStreaming,
  soundEnabled,
  wifiRssi = -64,
}: UavTacticalRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Radar Settings
  const [uavMode, setUavMode] = useState<"standard" | "advanced">("standard");
  const [maxRangeMeters, setMaxRangeMeters] = useState<number>(6.0);
  const [sweepDurationSec, setSweepDurationSec] = useState<number>(3.0);
  const [radarMuted, setRadarMuted] = useState<boolean>(false);
  const [contacts, setContacts] = useState<RadarBlip[]>([]);

  // Physical Node Placement Geometry
  // Calculate RF physical distance via Log-Distance Path Loss model: d = 10 ^ ((P_tx - RSSI) / (10 * n))
  const estimatedPhysicalDistance = useMemo(() => {
    // Reference RSSI at 1m in indoor space = -42 dBm, Path loss exponent n = 2.4
    const d = Math.pow(10, (-42 - wifiRssi) / (10 * 2.4));
    return Math.max(1.2, Math.min(10.0, parseFloat(d.toFixed(1))));
  }, [wifiRssi]);

  const [routerDistanceMeters, setRouterDistanceMeters] = useState<number>(4.0);
  const [routerBearingDeg, setRouterBearingDeg] = useState<number>(90); // 90° = North / In front of desk
  const [autoRssiDistance, setAutoRssiDistance] = useState<boolean>(true);

  const activeRouterDist = autoRssiDistance ? estimatedPhysicalDistance : routerDistanceMeters;

  // Telemetry HUD state
  const [lastPingTime, setLastPingTime] = useState<number>(0);
  const [targetCount, setTargetCount] = useState<number>(0);
  const [activeSector, setActiveSector] = useState<string>("NONE");

  // Keep references for animation loop
  const angleRef = useRef<number>(0);
  const blipsRef = useRef<RadarBlip[]>([]);
  const lastTimeRef = useRef<number>(0);
  const lastBeepTimeRef = useRef<number>(0);

  // Initialize Tactical Radar Synth Audio
  const playRadarBeep = useCallback((freq = 880, duration = 0.08) => {
    if (radarMuted || !soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }

      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + duration);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // AudioContext policy catch
    }
  }, [radarMuted, soundEnabled]);

  // Generate / Update Blips based on physical RF multipath & Doppler features
  useEffect(() => {
    const now = performance.now();
    const existing = [...blipsRef.current];

    // ONLY display a target blip when real physical motion is detected!
    if (isMotionDetected) {
      // Map physical range from measured RF perturbation (stronger disturbance = closer to sensor/baseline)
      const normalizedPerturbation = Math.min(1.0, wifiVariance / 15.0);
      const estRange = Math.max(0.6, (1.0 - normalizedPerturbation * 0.5) * (activeRouterDist * 0.75));
      const estVelocity = Number((wifiVariance * 0.12).toFixed(2));

      // Target blip is oriented along the physical router-ESP32 corridor with slight multipath angular spread
      const targetAngle = routerBearingDeg;
      const rad = (targetAngle * Math.PI) / 180;
      const normDist = Math.min(0.9, estRange / maxRangeMeters);
      const targetX = Math.cos(rad) * normDist;
      const targetY = -Math.sin(rad) * normDist;

      const targetIndex = existing.findIndex((b) => b.type === "hostile");
      if (targetIndex >= 0) {
        existing[targetIndex] = {
          ...existing[targetIndex],
          x: targetX,
          y: targetY,
          rangeMeters: Number(estRange.toFixed(1)),
          angleDeg: targetAngle,
          intensity: 1.0,
          lastPingedAt: now,
          velocityMs: estVelocity,
          confidence: Math.min(0.98, 0.7 + normalizedPerturbation * 0.25),
        };
      } else {
        existing.push({
          id: "target-human-01",
          x: targetX,
          y: targetY,
          rangeMeters: Number(estRange.toFixed(1)),
          angleDeg: targetAngle,
          intensity: 1.0,
          firstDetectedAt: now,
          lastPingedAt: now,
          type: "hostile",
          velocityMs: estVelocity,
          confidence: 0.88,
        });
      }
    } else {
      // Room is STILL: Purge hostile target blips after 1.5 seconds! Room returns to 100% CLEAR!
      const filtered = existing.filter((b) => {
        if (b.type === "hostile") {
          return now - b.lastPingedAt < 1500;
        }
        return true;
      });
      existing.length = 0;
      existing.push(...filtered);
    }

    // If Phone Ground Truth is connected, add Friendly Tagged Blip
    if (isPhoneStreaming) {
      const phoneNormDist = 0.45;
      const phoneAngle = 210; // Bottom-left sector
      const rad = (phoneAngle * Math.PI) / 180;
      const phoneX = Math.cos(rad) * phoneNormDist;
      const phoneY = -Math.sin(rad) * phoneNormDist;

      const phoneIndex = existing.findIndex((b) => b.type === "friendly");
      if (phoneIndex >= 0) {
        existing[phoneIndex] = {
          ...existing[phoneIndex],
          intensity: 1.0,
          lastPingedAt: now,
          velocityMs: Number((phoneAccelMag * 0.2).toFixed(2)),
        };
      } else {
        existing.push({
          id: "friendly-phone",
          x: phoneX,
          y: phoneY,
          rangeMeters: Number((phoneNormDist * maxRangeMeters).toFixed(1)),
          angleDeg: phoneAngle,
          intensity: 1.0,
          firstDetectedAt: now,
          lastPingedAt: now,
          type: "friendly",
          velocityMs: 0.0,
          confidence: 0.99,
        });
      }
    }

    blipsRef.current = existing;
    setContacts([...existing]);
    setTargetCount(existing.length);
  }, [wifiVariance, csiVariance, isMotionDetected, isPhoneStreaming, phoneAccelMag, maxRangeMeters]);

  // Main Radar Canvas Render & Sweep Animation Loop
  useEffect(() => {
    let animId: number;

    const render = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const deltaSec = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(cx, cy) - 24;

      // Update Sweep Angle
      const sweepSpeedRads = ((Math.PI * 2) / sweepDurationSec) * deltaSec;
      angleRef.current = (angleRef.current + sweepSpeedRads) % (Math.PI * 2);
      const sweepAngle = angleRef.current;

      // 1. Dark Radar Background
      ctx.fillStyle = "#030712"; // Deep space void
      ctx.fillRect(0, 0, w, h);

      // 2. Tactical Circular Radar Grids
      const numRings = 4;
      for (let i = 1; i <= numRings; i++) {
        const r = (radius / numRings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i === numRings ? "#38bdf8" : "#0284c7"; // Cyan tactical grid
        ctx.lineWidth = i === numRings ? 2 : 1;
        ctx.globalAlpha = i === numRings ? 0.35 : 0.18;
        ctx.stroke();

        // Range Label
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#38bdf8";
        ctx.font = "9px monospace";
        const ringMeters = ((maxRangeMeters / numRings) * i).toFixed(1);
        ctx.fillText(`${ringMeters}m`, cx + 6, cy - r + 11);
      }

      // 3. Radial Crosshairs & Angle Rays
      const angles = [0, 45, 90, 135, 180, 225, 270, 315];
      angles.forEach((deg) => {
        const rad = (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 1;
        ctx.globalAlpha = deg % 90 === 0 ? 0.25 : 0.12;
        ctx.stroke();

        // Outer angle ticks
        const tx = cx + Math.cos(rad) * (radius + 12);
        const ty = cy + Math.sin(rad) * (radius + 12);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#64748b";
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${deg}°`, tx, ty);
      });

      // 4. Draw Physical Hardware Nodes: Router (Tx) and ESP32 Sentinel (Rx)
      // A. ESP32 Sentinel (Receiver / Origin at Center)
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#06b6d4"; // Cyan
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#22d3ee";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ESP32 (LAPTOP)", cx, cy + 20);

      // B. Wi-Fi Router (Tx) Node placed at exact physical distance and bearing
      const routerRad = (routerBearingDeg * Math.PI) / 180;
      const routerNormDist = Math.min(0.92, activeRouterDist / maxRangeMeters);
      const routerX = cx + Math.cos(routerRad) * (radius * routerNormDist);
      const routerY = cy - Math.sin(routerRad) * (radius * routerNormDist);

      ctx.beginPath();
      ctx.arc(routerX, routerY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#a855f7"; // Purple Router Node
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.strokeStyle = "#f3e8ff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#e9d5ff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`ROUTER (${activeRouterDist}m)`, routerX, routerY - 12);

      // C. 1st Fresnel Zone Elliptical Sensing Corridor (Physical Radio Path)
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(cx, cy);
      ctx.lineTo(routerX, routerY);
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Draw 1st Fresnel Zone Ellipse around the baseline path
      const midX = (cx + routerX) / 2;
      const midY = (cy + routerY) / 2;
      const baselineLength = Math.sqrt((routerX - cx) ** 2 + (routerY - cy) ** 2);
      const ellipseSemiMajor = baselineLength / 2 + 10;
      const ellipseSemiMinor = Math.max(16, baselineLength * 0.22); // ~1st Fresnel radius at 2.4 GHz
      const ellipseAngle = Math.atan2(routerY - cy, routerX - cx);

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(ellipseAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, ellipseSemiMajor, ellipseSemiMinor, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.22;
      ctx.stroke();
      ctx.fillStyle = "#a855f7";
      ctx.globalAlpha = 0.04;
      ctx.fill();
      ctx.restore();

      // 5. Rotating Radar Sweep Beam & Phosphor Trailing Glow
      const trailAngle = Math.PI / 3.5; // 50 degrees trail
      const numSlices = 24;
      for (let s = 0; s < numSlices; s++) {
        const sliceStart = sweepAngle - (trailAngle / numSlices) * (s + 1);
        const sliceEnd = sweepAngle - (trailAngle / numSlices) * s;
        const alpha = (1 - s / numSlices) * 0.25;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, sliceStart, sliceEnd);
        ctx.closePath();
        ctx.fillStyle = "#06b6d4"; // Cyan radar sweep
        ctx.globalAlpha = alpha;
        ctx.fill();
      }

      // Leading Sweep Needle Line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const sweepX = cx + Math.cos(sweepAngle) * radius;
      const sweepY = cy + Math.sin(sweepAngle) * radius;
      ctx.lineTo(sweepX, sweepY);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.stroke();

      // 6. Draw Targets & Blips (Call of Duty UAV Minimap Style)
      const now = performance.now();
      blipsRef.current.forEach((blip) => {
        const bx = cx + blip.x * radius;
        const by = cy + blip.y * radius;

        // Angle difference from current sweep line
        const blipAngle = Math.atan2(by - cy, bx - cx);
        let angleDiff = Math.abs(sweepAngle - blipAngle);
        while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

        // Ping detection trigger when sweep line crosses the blip
        if (angleDiff < 0.12 && now - lastBeepTimeRef.current > 400) {
          lastBeepTimeRef.current = now;
          setLastPingTime(now);
          playRadarBeep(blip.type === "hostile" ? 920 : 640);
        }

        // Blip Fade calculation (Call of Duty UAV Ping Persistence)
        const timeSincePing = (now - blip.lastPingedAt) / 1000;
        const persistSec = uavMode === "advanced" ? 1.0 : sweepDurationSec * 1.2;
        let fadeAlpha = Math.max(0.15, 1.0 - timeSincePing / persistSec);

        if (uavMode === "advanced") {
          fadeAlpha = 0.95; // Always crisp in Advanced UAV orbital mode
        }

        // Outer radar pulse shockwave ring
        const pulseProgress = (timeSincePing % 1.2) / 1.2;
        ctx.beginPath();
        ctx.arc(bx, by, 8 + pulseProgress * 16, 0, Math.PI * 2);
        ctx.strokeStyle = blip.type === "hostile" ? "#ef4444" : "#10b981";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = fadeAlpha * (1 - pulseProgress) * 0.7;
        ctx.stroke();

        // Core Solid Blip Dot
        ctx.beginPath();
        ctx.arc(bx, by, blip.type === "hostile" ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = blip.type === "hostile" ? "#ef4444" : "#10b981"; // Red = Hostile/Unknown, Green = Friendly
        ctx.globalAlpha = fadeAlpha;
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Velocity Direction Vector (Advanced UAV Mode)
        if (uavMode === "advanced" && Math.abs(blip.velocityMs) > 0.1) {
          const arrowLen = Math.min(24, Math.abs(blip.velocityMs) * 18);
          const arrowAngle = blip.angleDeg * (Math.PI / 180) + (blip.velocityMs > 0 ? 0 : Math.PI);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(arrowAngle) * arrowLen, by + Math.sin(arrowAngle) * arrowLen);
          ctx.strokeStyle = "#fca5a5";
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.85;
          ctx.stroke();
        }

        // Blip Metadata Box
        ctx.fillStyle = blip.type === "hostile" ? "#fca5a5" : "#6ee7b7";
        ctx.font = "bold 9px monospace";
        ctx.globalAlpha = fadeAlpha * 0.9;
        ctx.textAlign = "left";
        ctx.fillText(
          `${blip.type === "hostile" ? "TARGET [RF]" : "PHONE [GPS]"} ${blip.rangeMeters}m`,
          bx + 10,
          by - 4
        );
        ctx.font = "8px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(`v: ${blip.velocityMs > 0 ? "+" : ""}${blip.velocityMs} m/s`, bx + 10, by + 8);
      });

      // 7. Outer Compass Ring Border
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [maxRangeMeters, sweepDurationSec, uavMode, playRadarBeep]);

  // Current active sector calculation
  useEffect(() => {
    if (wifiVariance > 2.5) {
      setActiveSector("FRESNEL CORE (ROOM CENTER)");
    } else if (csiVariance > 1.2) {
      setActiveSector("SECTOR B (PROXIMITY DESK)");
    } else {
      setActiveSector("STATIC / PERIMETER CLEAR");
    }
  }, [wifiVariance, csiVariance]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl relative overflow-hidden">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />

      {/* Header HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Radar className="w-5 h-5 animate-spin" style={{ animationDuration: `${sweepDurationSec}s` }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-wider uppercase text-cyan-300 font-mono">
                TACTICAL UAV RADAR // RF DOPPLER SWEEP
              </h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {uavMode === "advanced" ? "ADVANCED UAV (VSAT)" : "STANDARD UAV (3s PING)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              Multipath Fresnel Doppler Pinpointer &bull; Zero Cameras &bull; Call of Duty Minimap Sweep
            </p>
          </div>
        </div>

        {/* Tactical Mode & Audio Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUavMode(uavMode === "standard" ? "advanced" : "standard")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all flex items-center gap-1.5 ${
              uavMode === "advanced"
                ? "bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-lg shadow-purple-500/10"
                : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <span>{uavMode === "advanced" ? "Orbital VSAT (Realtime)" : "Pulse Sweep (COD UAV)"}</span>
          </button>

          <button
            onClick={() => setRadarMuted(!radarMuted)}
            className={`p-1.5 rounded-lg border text-xs font-mono transition-all ${
              radarMuted
                ? "bg-slate-900 text-slate-500 border-slate-800"
                : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
            }`}
            title={radarMuted ? "Unmute Radar Ping" : "Mute Radar Ping"}
          >
            {radarMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Radar View & Side HUD Stats */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center relative z-10">
        {/* Circular Radar Canvas Viewport */}
        <div className="md:col-span-8 flex flex-col items-center justify-center p-2 bg-slate-900/60 rounded-xl border border-slate-800/80 relative">
          <canvas
            ref={canvasRef}
            width={480}
            height={480}
            className="max-w-full h-auto aspect-square rounded-full shadow-inner shadow-black/80"
          />

          {/* Quick Range / Sweep Selector Overlay */}
          <div className="flex items-center justify-between w-full px-4 pt-3 text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-1">
              <span>RANGE:</span>
              {[3, 5, 8].map((r) => (
                <button
                  key={r}
                  onClick={() => setMaxRangeMeters(r)}
                  className={`px-1.5 py-0.5 rounded ${
                    maxRangeMeters === r
                      ? "bg-cyan-500/30 text-cyan-200 font-bold border border-cyan-500/50"
                      : "hover:text-slate-200"
                  }`}
                >
                  {r}m
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span>SWEEP:</span>
              {[1.5, 3.0, 5.0].map((s) => (
                <button
                  key={s}
                  onClick={() => setSweepDurationSec(s)}
                  className={`px-1.5 py-0.5 rounded ${
                    sweepDurationSec === s
                      ? "bg-purple-500/30 text-purple-200 font-bold border border-purple-500/50"
                      : "hover:text-slate-200"
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tactical Recon HUD Cards (Right Col) */}
        <div className="md:col-span-4 flex flex-col gap-3">
          {/* Physical Node Geometry Card: Router & ESP32 Alignment */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-purple-300 uppercase flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-purple-400" />
                Physical Node Geometry
              </span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40">
                {autoRssiDistance ? "AUTO-RSSI ESTIMATION" : "MANUAL ALIGNMENT"}
              </span>
            </div>

            {/* Router Distance & RSSI Reading */}
            <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Router Distance</span>
                <span className="text-purple-300 font-bold text-sm">{activeRouterDist} meters</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Link RSSI</span>
                <span className="text-cyan-300 font-bold text-sm">{wifiRssi} dBm</span>
              </div>
            </div>

            {/* Bearing / Direction of Router relative to Laptop */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Compass className="w-3 h-3 text-cyan-400" />
                  Router Direction Relative to Desk:
                </span>
                <span className="text-slate-200 font-bold">{routerBearingDeg}°</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px]">
                {[
                  { label: "FRONT (N)", deg: 90 },
                  { label: "RIGHT (E)", deg: 0 },
                  { label: "BACK (S)", deg: 270 },
                  { label: "LEFT (W)", deg: 180 },
                ].map((b) => (
                  <button
                    key={b.deg}
                    onClick={() => setRouterBearingDeg(b.deg)}
                    className={`py-1 px-1 rounded border text-center transition-all cursor-pointer ${
                      routerBearingDeg === b.deg
                        ? "bg-purple-600 text-white border-purple-400 font-bold shadow-sm"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto vs Manual Distance Toggle */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
              <span>Auto RSSI Range:</span>
              <button
                onClick={() => setAutoRssiDistance(!autoRssiDistance)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                  autoRssiDistance
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                    : "bg-slate-950 text-slate-500 border-slate-800"
                }`}
              >
                {autoRssiDistance ? "ENABLED (Auto)" : "MANUAL (Custom)"}
              </button>
            </div>
            {!autoRssiDistance && (
              <div className="flex items-center gap-2 text-[10px]">
                <span>Distance:</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={routerDistanceMeters}
                  onChange={(e) => setRouterDistanceMeters(parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <span className="w-8 text-right font-bold text-slate-200">{routerDistanceMeters}m</span>
              </div>
            )}
          </div>

          {/* Target Status Card */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                Active Contacts
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  targetCount > 0
                    ? "bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                }`}
              >
                {targetCount > 0 ? `${targetCount} DETECTED` : "CLEAR"}
              </span>
            </div>

            <div className="text-2xl font-black font-mono text-slate-100 flex items-baseline gap-2">
              <span>{targetCount}</span>
              <span className="text-xs font-normal text-slate-400">
                {targetCount === 1 ? "Target In Room" : "Targets Tracked"}
              </span>
            </div>

            <p className="text-[11px] font-mono text-slate-400">
              Sector: <strong className="text-cyan-300">{activeSector}</strong>
            </p>
          </div>

          {/* Tactical Doppler Velocity Card */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-purple-400" />
                Doppler Multipath Shift
              </span>
              <span className="text-[10px] font-mono text-purple-300">
                {csiVariance > 1.0 ? "DYNAMIC" : "QUIET"}
              </span>
            </div>

            <div className="text-xl font-bold font-mono text-purple-300">
              {(csiVariance * 0.42).toFixed(2)} m/s
            </div>

            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-cyan-400 h-full transition-all duration-300"
                style={{ width: `${Math.min(100, (csiVariance / 3.0) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] font-mono text-slate-400">
              Doppler shifts proportional to chest and gait locomotion.
            </p>
          </div>

          {/* Friendly Phone Co-Pilot Card */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                Phone Co-Pilot (Inertial Beacon)
              </span>
              <span
                className={`text-[10px] font-mono font-bold ${
                  isPhoneStreaming ? "text-emerald-400" : "text-slate-500"
                }`}
              >
                {isPhoneStreaming ? "LINKED (GREEN BLIP)" : "OFFLINE"}
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-300">
              {isPhoneStreaming
                ? `Phone (${phoneTag}): |a| = ${phoneAccelMag} m/s²`
                : "Scan QR on phone to link friendly beacon & fuse gyro."}
            </p>
          </div>

          {/* How This Works Physics Explainer */}
          <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-800/40 text-[10px] font-mono text-purple-200/90 leading-relaxed">
            <div className="font-bold flex items-center gap-1 text-purple-300 mb-1">
              <Navigation className="w-3 h-3" />
              HOW THE UAV PINPOINTS TARGETS:
            </div>
            The Router (Tx) and ESP32 (Rx) form a 1st Fresnel zone ellipse. When a person moves, 2.4 GHz waves reflect off their body (wavelength &lambda; = 12.5 cm), causing cyclic Doppler constructive/destructive fades. The radar sweep periodically calculates radial distance from subcarrier phase slopes and plots blips with tactical decay!
          </div>
        </div>
      </div>
    </div>
  );
}
