"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Radar,
  Crosshair,
  Volume2,
  VolumeX,
  ShieldAlert,
  Navigation,
  Zap,
  Radio,
  Wifi,
  Compass,
  Sliders,
  Users,
  Activity,
  Sparkles,
} from "lucide-react";
import { TrackedSignalEntity } from "@/utils/predictiveModels";

interface UavTacticalRadarProps {
  wifiVariance: number;
  csiVariance: number;
  isMotionDetected: boolean;
  phoneAccelMag: number;
  phoneTag: string;
  isPhoneStreaming: boolean;
  soundEnabled: boolean;
  wifiRssi?: number;
  baselineRssi?: number;
  decorrelationSpread?: number;
  // New Multi-Target & Radius Selection Props
  trackedEntities?: TrackedSignalEntity[];
  selectedRadiusMeters?: number;
  onSelectRadiusMeters?: (r: number) => void;
  routerBearingDeg?: number;
  onChangeRouterBearingDeg?: (deg: number) => void;
  onRouterDistChange?: (dist: number) => void;
  estimatedPeopleInRadius?: number;
  estimatedPetsInRadius?: number;
  respirationBpm?: number;
  stationaryPresenceScore?: number;
  predictedNextRssi?: number;
  predictedNextVariance?: number;
  predictionStatusText?: string;
}

export function UavTacticalRadar({
  wifiVariance,
  csiVariance,
  isMotionDetected,
  phoneAccelMag,
  phoneTag,
  isPhoneStreaming,
  soundEnabled,
  wifiRssi = -60.0,
  baselineRssi = -60.0,
  decorrelationSpread = 0.4,
  trackedEntities = [],
  selectedRadiusMeters = 6.0,
  onSelectRadiusMeters,
  routerBearingDeg: propBearingDeg,
  onChangeRouterBearingDeg,
  onRouterDistChange,
  estimatedPeopleInRadius = 0,
  estimatedPetsInRadius = 0,
  respirationBpm = 16.0,
  stationaryPresenceScore = 0,
  predictedNextRssi = -60.0,
  predictedNextVariance = 0.12,
  predictionStatusText = "Scanning 2.4 GHz multipath field...",
}: UavTacticalRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Radar Settings
  const [uavMode, setUavMode] = useState<"standard" | "advanced">("advanced");
  const [localRadiusMeters, setLocalRadiusMeters] = useState<number>(selectedRadiusMeters);
  const maxRangeMeters = onSelectRadiusMeters ? selectedRadiusMeters : localRadiusMeters;

  const handleRadiusSelect = (r: number) => {
    setLocalRadiusMeters(r);
    if (onSelectRadiusMeters) onSelectRadiusMeters(r);
  };

  const [sweepDurationSec, setSweepDurationSec] = useState<number>(3.0);
  const [radarMuted, setRadarMuted] = useState<boolean>(false);

  // Calibrated Log-Distance Path Loss Model Parameters
  // Default router bearing is 270° (BACK / SOUTH) to match user's physical room setup!
  const [refRssi1m, setRefRssi1m] = useState<number>(-42.0);
  const [pathLossExp, setPathLossExp] = useState<number>(2.4);
  const [routerDistanceMeters, setRouterDistanceMeters] = useState<number>(4.0);
  const [localBearingDeg, setLocalBearingDeg] = useState<number>(270); // 270° = BACK (S)
  const routerBearingDeg = propBearingDeg !== undefined ? propBearingDeg : localBearingDeg;

  const [autoRssiDistance, setAutoRssiDistance] = useState<boolean>(true);
  const [showPathLossTuning, setShowPathLossTuning] = useState<boolean>(false);

  // Load saved geometry calibration from localStorage on mount
  useEffect(() => {
    try {
      const savedBearing = localStorage.getItem("uav_router_bearing_v2");
      const savedRefRssi = localStorage.getItem("uav_ref_rssi_1m");
      const savedPathLoss = localStorage.getItem("uav_path_loss_n");
      const savedAutoDist = localStorage.getItem("uav_auto_rssi_dist");
      const savedManualDist = localStorage.getItem("uav_manual_dist");

      if (savedBearing !== null) {
        const b = Number(savedBearing);
        setLocalBearingDeg(b);
        if (onChangeRouterBearingDeg) onChangeRouterBearingDeg(b);
      }
      if (savedRefRssi !== null) setRefRssi1m(Number(savedRefRssi));
      if (savedPathLoss !== null) setPathLossExp(Number(savedPathLoss));
      if (savedAutoDist !== null) setAutoRssiDistance(savedAutoDist === "true");
      if (savedManualDist !== null) setRouterDistanceMeters(Number(savedManualDist));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleBearingChange = (deg: number) => {
    setLocalBearingDeg(deg);
    if (onChangeRouterBearingDeg) onChangeRouterBearingDeg(deg);
    try {
      localStorage.setItem("uav_router_bearing_v2", String(deg));
    } catch {}
  };

  // Smooth RSSI with EMA to prevent distance jumping on the polar plot
  const smoothedRssiRef = useRef<number>(wifiRssi);
  useEffect(() => {
    if (wifiRssi < -10 && wifiRssi > -98) {
      smoothedRssiRef.current = 0.25 * wifiRssi + 0.75 * smoothedRssiRef.current;
    }
  }, [wifiRssi]);

  // Calculate RF physical distance via Log-Distance Path Loss model: d = 10 ^ ((A - RSSI) / (10 * n))
  const estimatedPhysicalDistance = useMemo(() => {
    const effectiveRssi =
      baselineRssi < -10 && !isMotionDetected ? baselineRssi : smoothedRssiRef.current;
    const d = Math.pow(10, (refRssi1m - effectiveRssi) / (10 * pathLossExp));
    return Math.max(1.0, Math.min(14.0, parseFloat(d.toFixed(2))));
  }, [wifiRssi, baselineRssi, isMotionDetected, refRssi1m, pathLossExp]);

  const activeRouterDist = autoRssiDistance ? estimatedPhysicalDistance : routerDistanceMeters;

  useEffect(() => {
    if (onRouterDistChange) onRouterDistChange(activeRouterDist);
  }, [activeRouterDist, onRouterDistChange]);

  // Compute physical 1st Fresnel Zone radius (semi-minor axis in meters): r1 = sqrt((lambda * d) / 4)
  const fresnelRadiusMeters = useMemo(() => {
    const lambda = 0.123;
    return parseFloat(Math.sqrt((lambda * activeRouterDist) / 4.0).toFixed(2));
  }, [activeRouterDist]);

  // Keep references for animation loop so Canvas always reads live geometry & entities without stale closures
  const angleRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastBeepTimeRef = useRef<number>(0);
  const liveStateRef = useRef({
    activeRouterDist,
    routerBearingDeg,
    fresnelRadiusMeters,
    isMotionDetected,
    wifiVariance,
    csiVariance,
    trackedEntities,
    isPhoneStreaming,
    phoneAccelMag,
    maxRangeMeters,
    uavMode,
  });

  useEffect(() => {
    liveStateRef.current = {
      activeRouterDist,
      routerBearingDeg,
      fresnelRadiusMeters,
      isMotionDetected,
      wifiVariance,
      csiVariance,
      trackedEntities,
      isPhoneStreaming,
      phoneAccelMag,
      maxRangeMeters,
      uavMode,
    };
  }, [
    activeRouterDist,
    routerBearingDeg,
    fresnelRadiusMeters,
    isMotionDetected,
    wifiVariance,
    csiVariance,
    trackedEntities,
    isPhoneStreaming,
    phoneAccelMag,
    maxRangeMeters,
    uavMode,
  ]);

  // Initialize Tactical Radar Synth Audio
  const playRadarBeep = useCallback(
    (freq = 880, duration = 0.08) => {
      if (radarMuted || !soundEnabled) return;
      try {
        if (!audioCtxRef.current) {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // AudioContext policy catch
      }
    },
    [radarMuted, soundEnabled]
  );

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

      const {
        activeRouterDist: curRouterDist,
        routerBearingDeg: curBearingDeg,
        fresnelRadiusMeters: curFresnelMeters,
        isMotionDetected: curMotion,
        trackedEntities: curEntities,
        isPhoneStreaming: curPhone,
        maxRangeMeters: curMaxRange,
        uavMode: curUavMode,
      } = liveStateRef.current;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(cx, cy) - 26;

      // Update Sweep Angle
      const sweepSpeedRads = ((Math.PI * 2) / sweepDurationSec) * deltaSec;
      angleRef.current = (angleRef.current + sweepSpeedRads) % (Math.PI * 2);
      const sweepAngle = angleRef.current;

      // 1. Dark Radar Background
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, w, h);

      // 2. Tactical Circular Radar Grids (Scaled to Selected Radius!)
      const numRings = 4;
      for (let i = 1; i <= numRings; i++) {
        const r = (radius / numRings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i === numRings ? "#38bdf8" : "#0284c7";
        ctx.lineWidth = i === numRings ? 2 : 1;
        ctx.globalAlpha = i === numRings ? 0.42 : 0.18;
        ctx.stroke();

        // Range Label
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = "#38bdf8";
        ctx.font = "9px monospace";
        const ringMeters = ((curMaxRange / numRings) * i).toFixed(1);
        ctx.fillText(`${ringMeters}m`, cx + 6, cy - r + 11);
      }

      // 3. Radial Crosshairs & Sector Labels (0°=E, 90°=N/FRONT DESK, 180°=W, 270°=S/BACK ROUTER)
      const angles = [
        { deg: 0, label: "RIGHT (E)" },
        { deg: 45, label: "45°" },
        { deg: 90, label: "FRONT DESK (N)" },
        { deg: 135, label: "135°" },
        { deg: 180, label: "LEFT (W)" },
        { deg: 225, label: "225°" },
        { deg: 270, label: "BACK ROUTER (S)" },
        { deg: 315, label: "315°" },
      ];
      angles.forEach(({ deg, label }) => {
        const rad = (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * radius, cy - Math.sin(rad) * radius);
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 1;
        ctx.globalAlpha = deg % 90 === 0 ? 0.28 : 0.12;
        ctx.stroke();

        const tx = cx + Math.cos(rad) * (radius + 14);
        const ty = cy - Math.sin(rad) * (radius + 14);
        ctx.globalAlpha = deg % 90 === 0 ? 0.8 : 0.45;
        ctx.fillStyle = deg % 90 === 0 ? "#38bdf8" : "#64748b";
        ctx.font = deg % 90 === 0 ? "bold 8px monospace" : "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, tx, ty);
      });

      // 4. Draw Physical Hardware Nodes: Router (Tx) in the Back and ESP32 Sentinel (Rx) at Center
      const routerRad = (curBearingDeg * Math.PI) / 180;
      const routerNormDist = Math.min(0.92, curRouterDist / curMaxRange);
      const routerX = cx + Math.cos(routerRad) * (radius * routerNormDist);
      const routerY = cy - Math.sin(routerRad) * (radius * routerNormDist);

      // 1st Fresnel Zone Elliptical Sensing Corridor (r1 = sqrt(lambda * d / 4))
      const midX = (cx + routerX) / 2;
      const midY = (cy + routerY) / 2;
      const baselinePx = Math.sqrt((routerX - cx) ** 2 + (routerY - cy) ** 2);
      const pxPerMeter = radius / curMaxRange;
      const ellipseSemiMajor = Math.max(14, baselinePx / 2);
      const ellipseSemiMinor = Math.max(14, curFresnelMeters * pxPerMeter * 1.8);
      const ellipseAngle = Math.atan2(routerY - cy, routerX - cx);

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(ellipseAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, ellipseSemiMajor, ellipseSemiMinor, 0, 0, Math.PI * 2);
      ctx.strokeStyle = curMotion ? "#f43f5e" : "#a855f7";
      ctx.lineWidth = curMotion ? 1.8 : 1.2;
      ctx.globalAlpha = curMotion ? 0.55 : 0.3;
      ctx.stroke();
      ctx.fillStyle = curMotion ? "#f43f5e" : "#a855f7";
      ctx.globalAlpha = curMotion ? 0.12 : 0.05;
      ctx.fill();
      ctx.restore();

      // Direct Line-of-Sight Beam
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(cx, cy);
      ctx.lineTo(routerX, routerY);
      ctx.strokeStyle = curMotion ? "#fb7185" : "#c084fc";
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Router (Tx) Node
      ctx.beginPath();
      ctx.arc(routerX, routerY, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = "#a855f7";
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.strokeStyle = "#f3e8ff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#e9d5ff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `ROUTER TX (${curRouterDist.toFixed(1)}m)`,
        routerX,
        curBearingDeg === 270 ? routerY + 15 : routerY - 12
      );

      // Draw ESP32 Sentinel (Receiver / Origin at Center)
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#06b6d4";
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#22d3ee";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ESP32 (LAPTOP)", cx, cy - 12);

      // 5. Rotating Radar Sweep Beam & Phosphor Trailing Glow
      const trailAngle = Math.PI / 3.5;
      const numSlices = 24;
      for (let s = 0; s < numSlices; s++) {
        const sliceStart = sweepAngle - (trailAngle / numSlices) * (s + 1);
        const sliceEnd = sweepAngle - (trailAngle / numSlices) * s;
        const alpha = (1 - s / numSlices) * 0.22;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, sliceStart, sliceEnd);
        ctx.closePath();
        ctx.fillStyle = "#06b6d4";
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

      // 6. Draw Decomposed Target Pointers: PERSON X (SIGNAL X), PERSON Y (SIGNAL Y), PET / SIGNAL Z
      const now = performance.now();
      curEntities.forEach((entity) => {
        const bx = cx + entity.x * radius;
        const by = cy + entity.y * radius;

        // Angle difference from current sweep line for audio ping
        const blipAngle = Math.atan2(by - cy, bx - cx);
        let angleDiff = Math.abs(sweepAngle - blipAngle);
        while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

        if (angleDiff < 0.12 && now - lastBeepTimeRef.current > 450) {
          lastBeepTimeRef.current = now;
          const pingFreq =
            entity.classification === "HUMAN_MOVING"
              ? 940
              : entity.classification === "HUMAN_STATIONARY"
              ? 720
              : 580;
          playRadarBeep(pingFreq);
        }

        // Color coding by classification & signal ID:
        // - PERSON X (MOVING): Rose Red (#f43f5e)
        // - PERSON X (STATIONARY / BREATHING LOCK): Cyan-Emerald (#10b981 / #06b6d4)
        // - PERSON Y (SIGNAL Y): Purple-Magenta (#c084fc)
        // - PET / LOW-MASS: Amber (#f59e0b)
        let coreColor = "#f43f5e";
        let labelColor = "#fda4af";
        if (entity.classification === "PET_OR_LOW_MASS") {
          coreColor = "#f59e0b";
          labelColor = "#fcd34d";
        } else if (entity.id === "signal-y") {
          coreColor = "#c084fc";
          labelColor = "#e9d5ff";
        } else if (entity.classification === "HUMAN_STATIONARY") {
          coreColor = "#10b981";
          labelColor = "#6ee7b7";
        }

        const fadeAlpha = curUavMode === "advanced" ? 0.96 : 0.88;

        // Forward Prediction Ghost Vector (Dashed line to predicted position 1.5s ahead)
        const px = cx + entity.predX * radius;
        const py = cy + entity.predY * radius;
        if (Math.hypot(px - bx, py - by) > 4) {
          ctx.beginPath();
          ctx.setLineDash([3, 3]);
          ctx.moveTo(bx, by);
          ctx.lineTo(px, py);
          ctx.strokeStyle = coreColor;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = coreColor;
          ctx.globalAlpha = 0.5;
          ctx.fill();
        }

        // Outer Pulse / Breathing Ring
        const pulsePeriod = entity.classification === "HUMAN_STATIONARY" ? 2800 : 1100;
        const pulseProgress = ((now % pulsePeriod) / pulsePeriod);
        ctx.beginPath();
        ctx.arc(bx, by, 9 + pulseProgress * 16, 0, Math.PI * 2);
        ctx.strokeStyle = coreColor;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = fadeAlpha * (1 - pulseProgress) * 0.75;
        ctx.stroke();

        // Tactical Diamond / Crosshair Reticle around Person X & Person Y
        ctx.save();
        ctx.translate(bx, by);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.85;
        // Target brackets
        const bSize = 9;
        ctx.beginPath();
        ctx.moveTo(-bSize, -4);
        ctx.lineTo(-bSize, -bSize);
        ctx.lineTo(-4, -bSize);
        ctx.moveTo(4, -bSize);
        ctx.lineTo(bSize, -bSize);
        ctx.lineTo(bSize, -4);
        ctx.moveTo(bSize, 4);
        ctx.lineTo(bSize, bSize);
        ctx.lineTo(4, bSize);
        ctx.moveTo(-4, bSize);
        ctx.lineTo(-bSize, bSize);
        ctx.lineTo(-bSize, 4);
        ctx.stroke();
        ctx.restore();

        // Core Solid Contact Dot
        ctx.beginPath();
        ctx.arc(bx, by, entity.classification === "PET_OR_LOW_MASS" ? 5 : 6.5, 0, Math.PI * 2);
        ctx.fillStyle = coreColor;
        ctx.globalAlpha = fadeAlpha;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pointer Callout Tag: "PERSON X (SIGNAL X)" / "PERSON Y (SIGNAL Y)"
        const labelX = bx + 14;
        const labelY = by - 6;

        // Tag pill background
        ctx.fillStyle = "rgba(3, 7, 18, 0.82)";
        ctx.globalAlpha = 0.9;
        ctx.fillRect(labelX - 3, labelY - 10, 148, 28);
        ctx.strokeStyle = coreColor;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(labelX - 3, labelY - 10, 148, 28);

        ctx.fillStyle = labelColor;
        ctx.font = "bold 9px monospace";
        ctx.globalAlpha = 1.0;
        ctx.textAlign = "left";
        ctx.fillText(`${entity.shortLabel} • ${entity.rangeMeters}m`, labelX, labelY);

        ctx.font = "8px monospace";
        ctx.fillStyle = "#cbd5e1";
        const subText =
          entity.classification === "HUMAN_STATIONARY"
            ? `BREATHING ~${entity.breathingBpm ?? 16} BPM | ${Math.round(entity.confidence * 100)}%`
            : entity.classification === "PET_OR_LOW_MASS"
            ? `LOW-MASS / PET | v:${entity.velocityMs}m/s`
            : `v:${entity.velocityMs}m/s | conf:${Math.round(entity.confidence * 100)}%`;
        ctx.fillText(subText, labelX, labelY + 11);
      });

      // Optional Friendly Phone IMU Blip
      if (curPhone) {
        const phoneAngle = (curBearingDeg + 315) % 360;
        const rad = (phoneAngle * Math.PI) / 180;
        const bx = cx + Math.cos(rad) * (radius * 0.45);
        const by = cy - Math.sin(rad) * (radius * 0.45);

        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#38bdf8";
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = "#7dd3fc";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`PHONE [IMU]`, bx + 9, by + 3);
      }

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
  }, [sweepDurationSec, playRadarBeep]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl relative overflow-hidden">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />

      {/* Header HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Radar
              className="w-5 h-5 animate-spin"
              style={{ animationDuration: `${sweepDurationSec}s` }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-wider uppercase text-cyan-300 font-mono">
                TACTICAL UAV RADAR // MULTI-SIGNAL PINPOINTER (PERSON X &amp; Y)
              </h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {uavMode === "advanced" ? "ORBITAL VSAT (REALTIME)" : "PULSE SWEEP (COD UAV)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              Stationary Breathing Lock (0.15–0.45Hz) &bull; Router in Back ({routerBearingDeg}°) &bull; 1st Fresnel r₁ = {fresnelRadiusMeters}m
            </p>
          </div>
        </div>

        {/* Tactical Mode & Audio Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUavMode(uavMode === "standard" ? "advanced" : "standard")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className={`p-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
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
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start relative z-10">
        {/* Circular Radar Canvas Viewport */}
        <div className="md:col-span-7 flex flex-col items-center justify-center p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 relative">
          <canvas
            ref={canvasRef}
            width={480}
            height={480}
            className="max-w-full h-auto aspect-square rounded-full shadow-inner shadow-black/80"
          />

          {/* Radio Radius Selection & Sweep Speed Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 w-full px-3 pt-3 text-[11px] font-mono text-slate-300 border-t border-slate-800/80 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">RADIO SCAN RADIUS:</span>
              {[3, 5, 8, 12].map((r) => (
                <button
                  key={r}
                  onClick={() => handleRadiusSelect(r)}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    maxRangeMeters === r
                      ? "bg-cyan-500 text-slate-950 font-black shadow-sm shadow-cyan-500/30"
                      : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200"
                  }`}
                >
                  {r}m
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-slate-400">SWEEP:</span>
              {[1.5, 3.0, 5.0].map((s) => (
                <button
                  key={s}
                  onClick={() => setSweepDurationSec(s)}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
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

          {/* Legend for Pointer Types */}
          <div className="flex flex-wrap items-center justify-center gap-4 w-full pt-2.5 text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              PERSON X (Moving)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              PERSON X (Stationary / Breathing)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
              PERSON Y (Signal Y)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
              Pet / Low-Mass
            </span>
          </div>
        </div>

        {/* Tactical Recon HUD Cards (Right Col) */}
        <div className="md:col-span-5 flex flex-col gap-3">
          {/* CARD 1: ESTIMATED PEOPLE IN SELECTED RADIUS */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/30 border border-cyan-500/30 flex flex-col gap-2.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-cyan-300 uppercase flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                Estimated People in {maxRangeMeters}m Radius
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                RADIUS: {maxRangeMeters}m
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[9px] text-slate-400 uppercase">Humans</div>
                <div className="text-xl font-black text-cyan-300 mt-0.5">
                  {estimatedPeopleInRadius}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[9px] text-slate-400 uppercase">Pets / Small</div>
                <div className="text-xl font-black text-amber-300 mt-0.5">
                  {estimatedPetsInRadius}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[9px] text-slate-400 uppercase">Breath Lock</div>
                <div className="text-sm font-black text-emerald-300 mt-1.5">
                  {stationaryPresenceScore >= 30 ? `${respirationBpm} BPM` : "IDLE"}
                </div>
              </div>
            </div>

            {/* Active Signal X & Signal Y Pointer List */}
            <div className="space-y-1.5 pt-1">
              {trackedEntities.length === 0 ? (
                <div className="text-[11px] text-slate-500 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80 text-center">
                  No active human or pet signals inside {maxRangeMeters}m radius.
                </div>
              ) : (
                trackedEntities.map((ent) => (
                  <div
                    key={ent.id}
                    className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          ent.classification === "PET_OR_LOW_MASS"
                            ? "bg-amber-400"
                            : ent.id === "signal-y"
                            ? "bg-purple-400"
                            : ent.classification === "HUMAN_STATIONARY"
                            ? "bg-emerald-400"
                            : "bg-rose-500 animate-ping"
                        }`}
                      />
                      <div>
                        <div className="font-bold text-slate-100">{ent.designation}</div>
                        <div className="text-[10px] text-slate-400">
                          {ent.subcarrierBand} &bull;{" "}
                          {ent.sector === "DESK_REFLECTION_NORTH"
                            ? "Front Desk (90°)"
                            : ent.sector === "FRESNEL_CORE_SOUTH"
                            ? "Back Router LoS (270°)"
                            : "Multipath Lobe"}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-cyan-300">{ent.rangeMeters}m</div>
                      <div className="text-[10px] text-slate-400">
                        {Math.round(ent.confidence * 100)}% conf
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* CARD 2: PREDICTIVE TELEMETRY & POTENTIAL SIGNAL FORECAST */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-purple-300 uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Signal Trajectory &amp; State Predictor (t + 1.5s)
              </span>
              <span className="text-[10px] text-emerald-300 font-bold">
                STATIONARY: {stationaryPresenceScore}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">
                  Predicted Next RSSI
                </span>
                <span className="text-cyan-300 font-bold">{predictedNextRssi} dBm</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">
                  Predicted Next σ²
                </span>
                <span className="text-purple-300 font-bold">{predictedNextVariance} dB²</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-300 bg-slate-950/90 p-2 rounded-lg border border-slate-800/80 leading-relaxed">
              <strong className="text-cyan-400">Forecast:</strong> {predictionStatusText}
            </div>
          </div>

          {/* CARD 3: Physical Node Geometry: Router in the Back (270°) */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-purple-300 uppercase flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-purple-400" />
                Router Placement &amp; RF Calibration
              </span>
              <button
                onClick={() => setShowPathLossTuning(!showPathLossTuning)}
                className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 flex items-center gap-1 cursor-pointer"
              >
                <Sliders className="w-2.5 h-2.5" />
                <span>{showPathLossTuning ? "HIDE CAL" : "TUNE RF"}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Router Distance</span>
                <span className="text-purple-300 font-bold text-sm">
                  {activeRouterDist.toFixed(2)} m
                </span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Link RSSI</span>
                <span className="text-cyan-300 font-bold text-sm">{wifiRssi.toFixed(1)} dBm</span>
              </div>
            </div>

            {showPathLossTuning && (
              <div className="p-2.5 rounded-lg bg-slate-950 border border-purple-500/30 space-y-2 text-[10px]">
                <div className="flex items-center justify-between text-purple-300 font-bold">
                  <span>1m Ref RSSI (A):</span>
                  <span>{refRssi1m} dBm</span>
                </div>
                <input
                  type="range"
                  min="-52"
                  max="-32"
                  step="1"
                  value={refRssi1m}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRefRssi1m(v);
                    try {
                      localStorage.setItem("uav_ref_rssi_1m", String(v));
                    } catch {}
                  }}
                  className="w-full accent-purple-500"
                />
                <div className="flex items-center justify-between text-cyan-300 font-bold">
                  <span>Wall Path Loss (n):</span>
                  <span>{pathLossExp.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="1.8"
                  max="3.6"
                  step="0.1"
                  value={pathLossExp}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPathLossExp(v);
                    try {
                      localStorage.setItem("uav_path_loss_n", String(v));
                    } catch {}
                  }}
                  className="w-full accent-cyan-500"
                />
              </div>
            )}

            {/* Bearing / Direction of Router relative to Laptop */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Compass className="w-3 h-3 text-cyan-400" />
                  Router Direction Relative to Laptop:
                </span>
                <span className="text-purple-300 font-bold">
                  {routerBearingDeg === 270
                    ? "270° (IN THE BACK)"
                    : routerBearingDeg === 90
                    ? "90° (IN FRONT)"
                    : `${routerBearingDeg}°`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px]">
                {[
                  { label: "BACK (S)", deg: 270 },
                  { label: "FRONT (N)", deg: 90 },
                  { label: "RIGHT (E)", deg: 0 },
                  { label: "LEFT (W)", deg: 180 },
                ].map((b) => (
                  <button
                    key={b.deg}
                    onClick={() => handleBearingChange(b.deg)}
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
          </div>
        </div>
      </div>
    </div>
  );
}
