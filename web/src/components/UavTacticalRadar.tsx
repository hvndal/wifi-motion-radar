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
} from "lucide-react";

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
  baselineRssi?: number;
  decorrelationSpread?: number;
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
}: UavTacticalRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Radar Settings
  const [uavMode, setUavMode] = useState<"standard" | "advanced">("standard");
  const [maxRangeMeters, setMaxRangeMeters] = useState<number>(8.0);
  const [sweepDurationSec, setSweepDurationSec] = useState<number>(3.0);
  const [radarMuted, setRadarMuted] = useState<boolean>(false);
  const [contacts, setContacts] = useState<RadarBlip[]>([]);

  // Calibrated Log-Distance Path Loss Model Parameters
  // d = 10 ^ ((A - RSSI) / (10 * n))
  const [refRssi1m, setRefRssi1m] = useState<number>(-42.0);
  const [pathLossExp, setPathLossExp] = useState<number>(2.4);
  const [routerDistanceMeters, setRouterDistanceMeters] = useState<number>(4.0);
  const [routerBearingDeg, setRouterBearingDeg] = useState<number>(90); // 90° = North / In front of desk
  const [autoRssiDistance, setAutoRssiDistance] = useState<boolean>(true);
  const [showPathLossTuning, setShowPathLossTuning] = useState<boolean>(false);

  // Load saved geometry calibration from localStorage on mount
  useEffect(() => {
    try {
      const savedBearing = localStorage.getItem("uav_router_bearing");
      const savedRefRssi = localStorage.getItem("uav_ref_rssi_1m");
      const savedPathLoss = localStorage.getItem("uav_path_loss_n");
      const savedAutoDist = localStorage.getItem("uav_auto_rssi_dist");
      const savedManualDist = localStorage.getItem("uav_manual_dist");

      if (savedBearing !== null) setRouterBearingDeg(Number(savedBearing));
      if (savedRefRssi !== null) setRefRssi1m(Number(savedRefRssi));
      if (savedPathLoss !== null) setPathLossExp(Number(savedPathLoss));
      if (savedAutoDist !== null) setAutoRssiDistance(savedAutoDist === "true");
      if (savedManualDist !== null) setRouterDistanceMeters(Number(savedManualDist));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleBearingChange = (deg: number) => {
    setRouterBearingDeg(deg);
    try {
      localStorage.setItem("uav_router_bearing", String(deg));
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

  // Compute physical 1st Fresnel Zone radius (semi-minor axis in meters): r1 = sqrt((lambda * d) / 4)
  // At 2.437 GHz (Channel 6/8), wavelength lambda = 0.123 meters
  const fresnelRadiusMeters = useMemo(() => {
    const lambda = 0.123;
    return parseFloat(Math.sqrt((lambda * activeRouterDist) / 4.0).toFixed(2));
  }, [activeRouterDist]);

  // Telemetry HUD state
  const [targetCount, setTargetCount] = useState<number>(0);
  const [activeSector, setActiveSector] = useState<string>("STATIC / PERIMETER CLEAR");

  // Keep references for animation loop so Canvas always reads live geometry without stale closures!
  const angleRef = useRef<number>(0);
  const blipsRef = useRef<RadarBlip[]>([]);
  const lastTimeRef = useRef<number>(0);
  const lastBeepTimeRef = useRef<number>(0);
  const smoothedTargetRangeRef = useRef<number>(activeRouterDist * 0.5);
  const geometryRef = useRef({
    activeRouterDist,
    routerBearingDeg,
    fresnelRadiusMeters,
    isMotionDetected,
    wifiVariance,
    csiVariance,
  });

  useEffect(() => {
    geometryRef.current = {
      activeRouterDist,
      routerBearingDeg,
      fresnelRadiusMeters,
      isMotionDetected,
      wifiVariance,
      csiVariance,
    };
  }, [
    activeRouterDist,
    routerBearingDeg,
    fresnelRadiusMeters,
    isMotionDetected,
    wifiVariance,
    csiVariance,
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

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
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

  // Generate / Update Blips based on physical RF multipath & Diffraction Physics
  useEffect(() => {
    const now = performance.now();
    const existing = [...blipsRef.current];

    if (isMotionDetected) {
      // 1. Diffraction & Shadowing Localization Model along the LoS Corridor:
      // - Deep RSSI drop (high wifiVariance relative to CSI) => Body is near the direct Line-of-Sight midpoint (0.5 * d)
      // - High CSI variance with low RSSI drop => Body is moving near the ESP32 desk receiver (0.25 * d)
      // - Moderate RSSI & CSI disturbance => Body is between midpoint and router (0.65 * d)
      const rssiShadowDepth = Math.abs(wifiRssi - baselineRssi);
      const perturbationIntensity = Math.min(1.0, (wifiVariance + csiVariance * 0.6) / 6.0);

      let fractionalPos = 0.5; // Default to Fresnel Zone center
      if (csiVariance > 1.2 && wifiVariance < 1.2) {
        // Near-field desk movement
        fractionalPos = 0.28;
      } else if (rssiShadowDepth > 2.5 || wifiVariance > 2.2) {
        // Direct Line-of-Sight occlusion near Fresnel core
        fractionalPos = 0.48 - Math.min(0.2, perturbationIntensity * 0.15);
      } else {
        // Outer Fresnel reflection zone
        fractionalPos = 0.62;
      }

      const rawTargetRange = Math.max(0.5, Math.min(activeRouterDist * 0.92, activeRouterDist * fractionalPos));
      // Smooth range with 1D kinematic filter
      smoothedTargetRangeRef.current =
        0.35 * rawTargetRange + 0.65 * smoothedTargetRangeRef.current;
      const estRange = Number(smoothedTargetRangeRef.current.toFixed(2));

      // Estimate radial velocity from CSI Doppler fluctuation
      const estVelocity = Number((Math.sqrt(wifiVariance) * 0.22 + csiVariance * 0.18).toFixed(2));

      // Target angle oriented along the Router-ESP32 Fresnel corridor
      const targetAngle = routerBearingDeg;
      const rad = (targetAngle * Math.PI) / 180;
      const normDist = Math.min(0.92, estRange / maxRangeMeters);
      const targetX = Math.cos(rad) * normDist;
      const targetY = -Math.sin(rad) * normDist;

      const targetIndex = existing.findIndex((b) => b.id === "target-human-01");
      const confidence = Math.min(0.99, Number((0.72 + perturbationIntensity * 0.26).toFixed(2)));

      if (targetIndex >= 0) {
        existing[targetIndex] = {
          ...existing[targetIndex],
          x: targetX,
          y: targetY,
          rangeMeters: estRange,
          angleDeg: targetAngle,
          intensity: 1.0,
          lastPingedAt: now,
          velocityMs: estVelocity,
          confidence,
        };
      } else {
        existing.push({
          id: "target-human-01",
          x: targetX,
          y: targetY,
          rangeMeters: estRange,
          angleDeg: targetAngle,
          intensity: 1.0,
          firstDetectedAt: now,
          lastPingedAt: now,
          type: "hostile",
          velocityMs: estVelocity,
          confidence,
        });
      }

      // If high subcarrier phase decorrelation indicates a 2nd simultaneous moving body, plot secondary scatter contact
      if (decorrelationSpread >= 2.2) {
        const secAngle = (routerBearingDeg + 18) % 360;
        const secRad = (secAngle * Math.PI) / 180;
        const secRange = Number(Math.min(activeRouterDist * 0.85, estRange * 1.25).toFixed(2));
        const secNorm = Math.min(0.92, secRange / maxRangeMeters);
        const secIdx = existing.findIndex((b) => b.id === "target-human-02");
        const secBlip: RadarBlip = {
          id: "target-human-02",
          x: Math.cos(secRad) * secNorm,
          y: -Math.sin(secRad) * secNorm,
          rangeMeters: secRange,
          angleDeg: secAngle,
          intensity: 0.9,
          firstDetectedAt: secIdx >= 0 ? existing[secIdx].firstDetectedAt : now,
          lastPingedAt: now,
          type: "hostile",
          velocityMs: Number((estVelocity * 0.85).toFixed(2)),
          confidence: 0.82,
        };
        if (secIdx >= 0) existing[secIdx] = secBlip;
        else existing.push(secBlip);
      } else {
        const secIdx = existing.findIndex((b) => b.id === "target-human-02");
        if (secIdx >= 0 && now - existing[secIdx].lastPingedAt > 1200) {
          existing.splice(secIdx, 1);
        }
      }
    } else {
      // Room is STILL: Purge hostile target blips after 1.4 seconds
      const filtered = existing.filter((b) => {
        if (b.type === "hostile") {
          return now - b.lastPingedAt < 1400;
        }
        return true;
      });
      existing.length = 0;
      existing.push(...filtered);
    }

    // If Phone Ground Truth is connected, add Friendly Tagged Blip
    if (isPhoneStreaming) {
      const phoneNormDist = 0.45;
      const phoneAngle = (routerBearingDeg + 315) % 360;
      const rad = (phoneAngle * Math.PI) / 180;
      const phoneX = Math.cos(rad) * phoneNormDist;
      const phoneY = -Math.sin(rad) * phoneNormDist;

      const phoneIndex = existing.findIndex((b) => b.type === "friendly");
      if (phoneIndex >= 0) {
        existing[phoneIndex] = {
          ...existing[phoneIndex],
          x: phoneX,
          y: phoneY,
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
  }, [
    wifiVariance,
    csiVariance,
    isMotionDetected,
    isPhoneStreaming,
    phoneAccelMag,
    maxRangeMeters,
    activeRouterDist,
    routerBearingDeg,
    wifiRssi,
    baselineRssi,
    decorrelationSpread,
  ]);

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
      } = geometryRef.current;

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
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, w, h);

      // 2. Tactical Circular Radar Grids
      const numRings = 4;
      for (let i = 1; i <= numRings; i++) {
        const r = (radius / numRings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i === numRings ? "#38bdf8" : "#0284c7";
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

      // 3. Radial Crosshairs & Compass Bearings (0°=E, 90°=N, 180°=W, 270°=S)
      const angles = [
        { deg: 0, label: "E (0°)" },
        { deg: 45, label: "45°" },
        { deg: 90, label: "N (90°)" },
        { deg: 135, label: "135°" },
        { deg: 180, label: "W (180°)" },
        { deg: 225, label: "225°" },
        { deg: 270, label: "S (270°)" },
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

        // Outer angle ticks
        const tx = cx + Math.cos(rad) * (radius + 13);
        const ty = cy - Math.sin(rad) * (radius + 13);
        ctx.globalAlpha = deg % 90 === 0 ? 0.75 : 0.45;
        ctx.fillStyle = deg % 90 === 0 ? "#38bdf8" : "#64748b";
        ctx.font = deg % 90 === 0 ? "bold 8px monospace" : "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, tx, ty);
      });

      // 4. Draw Physical Hardware Nodes: Router (Tx) and ESP32 Sentinel (Rx)
      // B. Wi-Fi Router (Tx) Node placed at exact physical distance and bearing
      const routerRad = (curBearingDeg * Math.PI) / 180;
      const routerNormDist = Math.min(0.92, curRouterDist / maxRangeMeters);
      const routerX = cx + Math.cos(routerRad) * (radius * routerNormDist);
      const routerY = cy - Math.sin(routerRad) * (radius * routerNormDist);

      // C. 1st Fresnel Zone Elliptical Sensing Corridor (True Physics Formula: r1 = sqrt(lambda * d / 4))
      const midX = (cx + routerX) / 2;
      const midY = (cy + routerY) / 2;
      const baselinePx = Math.sqrt((routerX - cx) ** 2 + (routerY - cy) ** 2);
      const pxPerMeter = radius / maxRangeMeters;
      const ellipseSemiMajor = Math.max(12, baselinePx / 2);
      const ellipseSemiMinor = Math.max(12, curFresnelMeters * pxPerMeter * 1.8);
      const ellipseAngle = Math.atan2(routerY - cy, routerX - cx);

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(ellipseAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, ellipseSemiMajor, ellipseSemiMinor, 0, 0, Math.PI * 2);
      ctx.strokeStyle = curMotion ? "#f43f5e" : "#a855f7";
      ctx.lineWidth = curMotion ? 1.8 : 1.2;
      ctx.globalAlpha = curMotion ? 0.55 : 0.28;
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
      ctx.fillText(`ROUTER TX (${curRouterDist.toFixed(1)}m)`, routerX, routerY - 12);

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
      ctx.fillText("ESP32 RX (0.0m)", cx, cy + 19);

      // 5. Rotating Radar Sweep Beam & Phosphor Trailing Glow
      const trailAngle = Math.PI / 3.5;
      const numSlices = 24;
      for (let s = 0; s < numSlices; s++) {
        const sliceStart = sweepAngle - (trailAngle / numSlices) * (s + 1);
        const sliceEnd = sweepAngle - (trailAngle / numSlices) * s;
        const alpha = (1 - s / numSlices) * 0.25;

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
          playRadarBeep(blip.type === "hostile" ? 920 : 640);
        }

        const timeSincePing = (now - blip.lastPingedAt) / 1000;
        const persistSec = uavMode === "advanced" ? 1.0 : sweepDurationSec * 1.2;
        let fadeAlpha = Math.max(0.15, 1.0 - timeSincePing / persistSec);

        if (uavMode === "advanced") {
          fadeAlpha = 0.95;
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
        ctx.fillStyle = blip.type === "hostile" ? "#ef4444" : "#10b981";
        ctx.globalAlpha = fadeAlpha;
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Velocity Direction Vector (Advanced UAV Mode)
        if (uavMode === "advanced" && Math.abs(blip.velocityMs) > 0.08) {
          const arrowLen = Math.min(24, Math.abs(blip.velocityMs) * 20);
          const arrowAngle =
            -blip.angleDeg * (Math.PI / 180) + (blip.velocityMs > 0 ? 0 : Math.PI);
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
        ctx.globalAlpha = fadeAlpha * 0.95;
        ctx.textAlign = "left";
        ctx.fillText(
          `${blip.type === "hostile" ? "MOTION [RF]" : "PHONE [IMU]"} ${blip.rangeMeters}m`,
          bx + 10,
          by - 4
        );
        ctx.font = "8px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(
          `v: ${blip.velocityMs}m/s | conf: ${Math.round(blip.confidence * 100)}%`,
          bx + 10,
          by + 8
        );
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
    if (!isMotionDetected) {
      setActiveSector("STATIC / PERIMETER CLEAR");
    } else if (wifiVariance > 1.8) {
      setActiveSector(`FRESNEL CORE (~${(activeRouterDist * 0.48).toFixed(1)}m)`);
    } else if (csiVariance > 1.1) {
      setActiveSector(`NEAR-FIELD DESK (~${(activeRouterDist * 0.28).toFixed(1)}m)`);
    } else {
      setActiveSector(`OUTER FRESNEL (~${(activeRouterDist * 0.62).toFixed(1)}m)`);
    }
  }, [isMotionDetected, wifiVariance, csiVariance, activeRouterDist]);

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
                TACTICAL UAV RADAR // FRESNEL RF PINPOINTER
              </h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {uavMode === "advanced" ? "ORBITAL VSAT (REALTIME)" : "PULSE SWEEP (COD UAV)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              1st Fresnel Zone Radius r₁ = {fresnelRadiusMeters}m &bull; Log-Distance Path Loss (A={refRssi1m}dBm, n={pathLossExp})
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
              <span>MAX SCALE:</span>
              {[4, 8, 12].map((r) => (
                <button
                  key={r}
                  onClick={() => setMaxRangeMeters(r)}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
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
              <button
                onClick={() => setShowPathLossTuning(!showPathLossTuning)}
                className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 flex items-center gap-1 cursor-pointer"
                title="Tune Path Loss Model Constants"
              >
                <Sliders className="w-2.5 h-2.5" />
                <span>{showPathLossTuning ? "HIDE CAL" : "TUNE RF"}</span>
              </button>
            </div>

            {/* Router Distance & RSSI Reading */}
            <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Router Distance</span>
                <span className="text-purple-300 font-bold text-sm">{activeRouterDist.toFixed(2)} m</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Link RSSI</span>
                <span className="text-cyan-300 font-bold text-sm">{wifiRssi.toFixed(1)} dBm</span>
              </div>
            </div>

            {/* Optional Path Loss Fine-Tuning Sliders */}
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
                  Router Direction from ESP32:
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

            {/* Auto vs Manual Distance Toggle */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
              <span>Distance Mode:</span>
              <button
                onClick={() => {
                  const next = !autoRssiDistance;
                  setAutoRssiDistance(next);
                  try {
                    localStorage.setItem("uav_auto_rssi_dist", String(next));
                  } catch {}
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                  autoRssiDistance
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                    : "bg-slate-950 text-slate-400 border-slate-800"
                }`}
              >
                {autoRssiDistance ? "AUTO PATH-LOSS" : "MANUAL LOCK"}
              </button>
            </div>
            {!autoRssiDistance && (
              <div className="flex items-center gap-2 text-[10px]">
                <span>Exact Dist:</span>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="0.2"
                  value={routerDistanceMeters}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setRouterDistanceMeters(v);
                    try {
                      localStorage.setItem("uav_manual_dist", String(v));
                    } catch {}
                  }}
                  className="w-full accent-purple-500"
                />
                <span className="w-10 text-right font-bold text-slate-200">{routerDistanceMeters}m</span>
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
              Zone: <strong className="text-cyan-300">{activeSector}</strong>
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
                {csiVariance > 0.9 ? "DYNAMIC" : "QUIET"}
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
              CSI Phase Decorrelation: <strong className="text-purple-200">{decorrelationSpread.toFixed(2)} σ²Δ</strong>
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
              FRESNEL ZONE DIFFRACTION MODEL:
            </div>
            The Router (Tx) and ESP32 (Rx) form a 1st Fresnel zone ellipse (r₁ = {fresnelRadiusMeters}m). Deep RSSI shadowing pinpoints bodies crossing the direct Line-of-Sight midpoint, while high CSI subcarrier variance with stable RSSI isolates near-field desk movements.
          </div>
        </div>
      </div>
    </div>
  );
}
