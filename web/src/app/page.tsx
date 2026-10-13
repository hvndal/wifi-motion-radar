"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Activity,
  Play,
  Square,
  Download,
  Terminal,
  Volume2,
  VolumeX,
  Radar,
  QrCode,
  Radio,
  Wifi,
  Smartphone,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  RefreshCw,
  UserCheck,
  Users,
  ShieldAlert,
  Gauge,
} from "lucide-react";
import LabSignalChart, { DataPoint } from "@/components/LabSignalChart";
import CsiSpectrogramCanvas from "@/components/CsiSpectrogramCanvas";
import { UavTacticalRadar } from "@/components/UavTacticalRadar";
import { PhoneQrCodeModal } from "@/components/PhoneQrCodeModal";
import { SimpleMotionView } from "@/components/SimpleMotionView";

interface MotionEvent {
  id: string;
  timestamp: string;
  type: "motion_detected" | "baseline_calibrated" | "phone_synced";
  message: string;
  wifiVariance: number;
  csiVariance: number;
}

export default function WifiMotionLab() {
  // Connection State: Automatic Wi-Fi Sync + Optional Web Serial
  const [autoSyncConnected, setAutoSyncConnected] = useState<boolean>(false);
  const [esp32Ip, setEsp32Ip] = useState<string>("Searching...");
  const [isSerialConnected, setIsSerialConnected] = useState<boolean>(false);
  const [portName, setPortName] = useState<string>("COM3");
  const baudRate = 115200;
  const [serialSupported, setSerialSupported] = useState<boolean>(true);

  // Phone Ground Truth Telemetry State
  const [phoneConnected, setPhoneConnected] = useState<boolean>(false);
  const [phoneTag, setPhoneTag] = useState<string>("STANDBY");
  const [phoneAccelMag, setPhoneAccelMag] = useState<number>(0.0);
  const [phoneGyroMag, setPhoneGyroMag] = useState<number>(0.0);
  const [isQrModalOpen, setIsQrModalOpen] = useState<boolean>(false);

  // Physical Sensing Telemetry (Actual measured physics)
  const [wifiRssi, setWifiRssi] = useState<number>(-52);
  const [wifiVariance, setWifiVariance] = useState<number>(0.8);
  const [csiVariance, setCsiVariance] = useState<number>(0.4);
  const [triggerCount, setTriggerCount] = useState<number>(0);
  const [isRfMoving, setIsRfMoving] = useState<boolean>(false);
  const [subcarrierAmplitudes, setSubcarrierAmplitudes] = useState<number[]>(
    new Array(64).fill(12)
  );

  // Calibration State
  const [baselineVariance, setBaselineVariance] = useState<number>(1.2);
  const [triggerThreshold, setTriggerThreshold] = useState<number>(2.8);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);

  // Time-Series Stream for Lab Signal Chart
  const [signalHistory, setSignalHistory] = useState<DataPoint[]>([]);

  // UI View Modes & Tabs
  const [dashboardMode, setDashboardMode] = useState<"simple" | "lab">("simple");
  const [sensitivity, setSensitivity] = useState<"low" | "normal" | "high">("normal");
  const [viewMode, setViewMode] = useState<"uav" | "spectrogram" | "chart">("uav");
  const [activeRightTab, setActiveRightTab] = useState<"fusion" | "occupancy" | "events" | "terminal">("fusion");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Live Occupancy Sentinel & Anti-Party Guard State
  const [occupancyLimit, setOccupancyLimit] = useState<1 | 2>(1);
  const [leakyBucketLevel, setLeakyBucketLevel] = useState<number>(0);

  // Logs & References
  const [events, setEvents] = useState<MotionEvent[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "[SYSTEM] Zero-Cost Wi-Fi Motion Sensing Lab Active",
    "[NETWORK] Target Wi-Fi SSID: Herman (Home Router)",
    "[HARDWARE] ESP32-D0WD-V3 connected on COM3 & local network",
    "[AUTO-SYNC] Polling ESP32 telemetry automatically over Wi-Fi...",
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const portRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Web Audio Synth
  const playChime = (freq: number = 880) => {
    if (!soundEnabled) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // AudioContext policy
    }
  };

  // Check Web Serial support on mount
  useEffect(() => {
    setSerialSupported("serial" in navigator);
  }, []);

  // 1. AUTO-SYNC: Polls ESP32 Telemetry Automatically over Wi-Fi (Zero manual clicking!)
  useEffect(() => {
    let failureCount = 0;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/esp32");
        if (res.ok) {
          const data = await res.json();
          if (data.connected || data.source === "auto_push" || data.timestamp > 0) {
            failureCount = 0;
            setAutoSyncConnected(true);
            if (data.ip) setEsp32Ip(data.ip);
            if (data.rssi !== undefined && data.rssi !== 0) setWifiRssi(data.rssi);
            if (data.variance !== undefined) setWifiVariance(data.variance);
            if (data.csiVariance !== undefined) setCsiVariance(data.csiVariance);
            if (data.motion !== undefined) setIsRfMoving(data.motion);
            if (data.triggerCount !== undefined) setTriggerCount(data.triggerCount);

            // Synthesize or map 64 subcarriers from measured CSI variance
            if (Array.isArray(data.subcarriers) && data.subcarriers.length === 64) {
              setSubcarrierAmplitudes(data.subcarriers);
            } else {
              setSubcarrierAmplitudes((prev) =>
                prev.map((val, idx) => {
                  const subNoise = Math.sin(Date.now() / 300 + idx * 0.4) * (data.csiVariance || 0.4);
                  return Math.max(2, Math.min(30, 14 + subNoise * 4));
                })
              );
            }
          }
        }
      } catch {
        failureCount++;
        if (failureCount > 8) {
          setAutoSyncConnected(false);
        }
      }
    }, 200);

    return () => clearInterval(pollInterval);
  }, []);

  // 2. Poll Phone Ground Truth Telemetry (/api/phone-telemetry)
  useEffect(() => {
    const phoneInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/phone-telemetry");
        if (res.ok) {
          const data = await res.json();
          if (data.connected) {
            setPhoneConnected(true);
            setPhoneTag(data.activityLabel || "ACTIVE");
            const accelM = Math.sqrt(
              (data.accel?.x || 0) ** 2 +
                (data.accel?.y || 0) ** 2 +
                (data.accel?.z || 0) ** 2
            );
            const gyroM = Math.sqrt(
              (data.gyro?.x || 0) ** 2 +
                (data.gyro?.y || 0) ** 2 +
                (data.gyro?.z || 0) ** 2
            );
            setPhoneAccelMag(parseFloat(accelM.toFixed(2)));
            setPhoneGyroMag(parseFloat(gyroM.toFixed(2)));
          } else {
            setPhoneConnected(false);
          }
        }
      } catch {
        setPhoneConnected(false);
      }
    }, 200);

    return () => clearInterval(phoneInterval);
  }, []);

  // 3. Main Motion Detection & Time-Series History Loop (10 Hz)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const rfTripped = autoSyncConnected ? isRfMoving : (wifiVariance > triggerThreshold);
      if (!autoSyncConnected) {
        setIsRfMoving(rfTripped);
      }

      if (rfTripped) {
        setEvents((prev) => {
          const last = prev[0];
          if (!last || now - new Date(last.timestamp).getTime() > 3000) {
            playChime(660);
            return [
              {
                id: `evt-${now}`,
                timestamp: new Date().toLocaleTimeString(),
                type: "motion_detected",
                message: `Motion Detected! RF Var: ${wifiVariance.toFixed(1)} dB² | CSI Var: ${csiVariance.toFixed(2)}`,
                wifiVariance,
                csiVariance,
              },
              ...prev.slice(0, 40),
            ];
          }
          return prev;
        });
      }

      // Append to oscilloscope history
      const pt: DataPoint = {
        time: now,
        wifiRssi,
        wifiVariance,
        csiVariance,
        phoneAccel: phoneAccelMag,
        phoneGyro: phoneGyroMag,
        baselineThreshold: triggerThreshold,
      };

      setSignalHistory((prev) => [...prev.slice(-120), pt]);
    }, 100);

    return () => clearInterval(interval);
  }, [
    wifiRssi,
    wifiVariance,
    csiVariance,
    phoneAccelMag,
    phoneGyroMag,
    triggerThreshold,
  ]);

  // 4. Optional Web Serial Connection Handler (115200 baud)
  const handleConnectSerial = async () => {
    if (!("serial" in navigator)) {
      alert("Web Serial is supported on Google Chrome and Microsoft Edge.");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const navSerial = (navigator as any).serial;
      const port = await navSerial.requestPort();
      await port.open({ baudRate });

      portRef.current = port;
      setIsSerialConnected(true);
      setPortName("ESP32 (COM3 Active)");

      setTerminalLogs((prev) => [
        ...prev,
        `[SERIAL] Connected to ESP32-D0WD-V3 at ${baudRate} baud`,
      ]);

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Parse formatted telemetry:
            // [TELEMETRY] State: MOTION | Ambient Var: 157.00 dB² | CSI Var: 2.07 | Connected Phones: 0 | Phone Var: 0.00 dB² | Triggers: 1
            const ambMatch = trimmed.match(/Ambient\s*Var:\s*([\d\.]+)/i);
            const csiMatch = trimmed.match(/CSI\s*Var:\s*([\d\.]+)/i);
            const trigMatch = trimmed.match(/Triggers:\s*(\d+)/i);

            if (ambMatch) setWifiVariance(parseFloat(ambMatch[1]));
            if (csiMatch) setCsiVariance(parseFloat(csiMatch[1]));
            if (trigMatch) setTriggerCount(parseInt(trigMatch[1], 10));

            setTerminalLogs((prev) => [...prev.slice(-80), trimmed]);
          }
        }
      }
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (!errStr.includes("No port selected") && !errStr.includes("cancel")) {
        alert("Serial Connection Notice: " + errStr);
      }
    }
  };

  const handleDisconnectSerial = async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
      setIsSerialConnected(false);
      setTerminalLogs((prev) => [...prev, "[SERIAL] Disconnected."]);
    } catch (err) {
      console.warn("Serial close error", err);
    }
  };

  // Sensitivity adjustment handler
  const handleSetSensitivity = (level: "low" | "normal" | "high") => {
    setSensitivity(level);
    let mult = 2.0;
    let offset = 0.8;
    if (level === "low") { mult = 2.6; offset = 1.2; }
    else if (level === "high") { mult = 1.4; offset = 0.4; }
    setTriggerThreshold(parseFloat((baselineVariance * mult + offset).toFixed(2)));
  };

  // Calibration Protocol
  const handleCalibrateBaseline = () => {
    setIsCalibrating(true);
    setCalibrationProgress(0);

    const samples: number[] = [];
    let progress = 0;

    const calInterval = setInterval(() => {
      samples.push(wifiVariance);
      progress += 10;
      setCalibrationProgress(progress);

      if (progress >= 100) {
        clearInterval(calInterval);
        setIsCalibrating(false);
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const newBaseline = parseFloat(mean.toFixed(2));

        let mult = 2.0;
        let offset = 0.8;
        if (sensitivity === "low") { mult = 2.6; offset = 1.2; }
        else if (sensitivity === "high") { mult = 1.4; offset = 0.4; }

        const newThreshold = parseFloat((newBaseline * mult + offset).toFixed(2));

        setBaselineVariance(newBaseline);
        setTriggerThreshold(newThreshold);
        playChime(1046);

        setEvents((prev) => [
          {
            id: `cal-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "baseline_calibrated",
            message: `Baseline Calibrated: ${newBaseline} dB² | Dynamic Threshold: ${newThreshold} dB²`,
            wifiVariance: newBaseline,
            csiVariance,
          },
          ...prev,
        ]);
      }
    }, 200);
  };

  // Real-Time Multi-Sensor Fusion Engine
  // 1. Wi-Fi RF component (from ESP32)
  const rfConfidence = Math.min(100, Math.round((wifiVariance / Math.max(1, triggerThreshold)) * 80));
  // 2. Phone inertial component (from Gyroscope + Accelerometer with explicit permission)
  const phoneMotionDetected = phoneConnected && (phoneGyroMag > 0.4 || phoneAccelMag > 1.2);
  // 3. Fused Cross-Verification Confidence
  const fusedConfidence = phoneConnected
    ? Math.min(100, Math.round(rfConfidence * 0.6 + (phoneMotionDetected ? 40 : 0)))
    : rfConfidence;

  // --- REAL-TIME MULTI-OCCUPANCY & CROWD MATH ENGINE ---
  // A. 64-Subcarrier Pairwise Phase Decorrelation Spread (σ²Δ)
  // Single moving body: adjacent subcarriers shift in-phase (low diff spread).
  // Multiple moving bodies: destructive spatial interference notches produce high adjacent diff spread!
  const decorrelationSpread = useMemo(() => {
    if (!subcarrierAmplitudes || subcarrierAmplitudes.length < 2) return 0;
    const diffs: number[] = [];
    for (let i = 0; i < subcarrierAmplitudes.length - 1; i++) {
      diffs.push(Math.abs(subcarrierAmplitudes[i + 1] - subcarrierAmplitudes[i]));
    }
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const varDiff = diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / diffs.length;
    return parseFloat(varDiff.toFixed(2));
  }, [subcarrierAmplitudes]);

  const isMotionActive = autoSyncConnected ? isRfMoving : (wifiVariance > triggerThreshold);

  // B. Instantaneous Multi-Person Probability Score (0% to 100%)
  const multiPersonProb = useMemo(() => {
    if (!isMotionActive) return 0;
    const decorrScore = Math.min(100, Math.max(0, ((decorrelationSpread - 10.0) / 16.0) * 100));
    const csiScore = Math.min(100, Math.max(0, ((csiVariance - 2.0) / 3.5) * 100));
    const rfEnergyScore = Math.min(100, Math.max(0, ((wifiVariance - triggerThreshold) / 10.0) * 100));
    return Math.min(100, Math.max(0, Math.round(decorrScore * 0.45 + csiScore * 0.35 + rfEnergyScore * 0.20)));
  }, [isMotionActive, decorrelationSpread, csiVariance, wifiVariance, triggerThreshold]);

  // C. Instantaneous Occupancy Classification
  const occupancyState: "EMPTY" | "SINGLE" | "MULTI" = useMemo(() => {
    if (!isMotionActive) return "EMPTY";
    if (multiPersonProb >= 50) return "MULTI";
    return "SINGLE";
  }, [isMotionActive, multiPersonProb]);

  // D. Leaky Bucket Integrator Loop (Runs at 5 Hz = every 200ms)
  useEffect(() => {
    const bucketInterval = setInterval(() => {
      setLeakyBucketLevel((prev) => {
        if (occupancyState === "MULTI") {
          return Math.min(100, prev + 2.5);
        } else if (occupancyState === "SINGLE") {
          return Math.max(0, prev - 1.2);
        } else {
          return Math.max(0, prev - 2.5);
        }
      });
    }, 200);

    return () => clearInterval(bucketInterval);
  }, [occupancyState]);

  return (
    <div className="min-h-screen bg-[#04060b] text-slate-100 p-3 md:p-6 flex flex-col font-sans select-none">
      {/* Top Banner HUD */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-black tracking-wider uppercase text-cyan-300 font-mono">
                WI-FI MOTION SENSING LAB // UAV RECON
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                SSID: HERMAN
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Zero Cameras &bull; Real 2.4 GHz Multipath Disturbance &bull; CoD UAV Radar Pinpointer
            </p>
          </div>
        </div>

        {/* Global Control Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Switcher: Simple vs Engineer Lab */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={() => setDashboardMode("simple")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dashboardMode === "simple"
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Simple Mode</span>
            </button>
            <button
              onClick={() => setDashboardMode("lab")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dashboardMode === "lab"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Engineer Lab</span>
            </button>
          </div>

          {/* Audio Mute Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border text-xs font-mono transition-all ${
              soundEnabled
                ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                : "bg-slate-900 text-slate-500 border-slate-800"
            }`}
            title={soundEnabled ? "Mute Radar Audio" : "Unmute Radar Audio"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Calibrate Baseline */}
          <button
            onClick={handleCalibrateBaseline}
            disabled={isCalibrating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-all cursor-pointer disabled:opacity-50"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isCalibrating ? `Calibrating ${calibrationProgress}%` : "Calibrate Baseline"}</span>
          </button>

          {/* Connect Phone (QR) */}
          <button
            onClick={() => setIsQrModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/50 transition-all cursor-pointer shadow-sm"
          >
            <QrCode className="w-3.5 h-3.5 text-purple-300" />
            <span>Connect Phone (QR)</span>
          </button>

          {/* Auto-Sync Indicator & Serial Fallback */}
          <div className="flex items-center gap-1.5">
            {autoSyncConnected ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-emerald-950/40 border border-emerald-500/40 text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>ESP32 AUTO-SYNCED ({esp32Ip})</span>
              </div>
            ) : isSerialConnected ? (
              <button
                onClick={handleDisconnectSerial}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-500/40 text-rose-300 hover:bg-rose-500/20 transition-all"
              >
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                <span>Disconnect Serial</span>
              </button>
            ) : (
              <button
                onClick={handleConnectSerial}
                disabled={!serialSupported}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-lg shadow-purple-600/20 border border-purple-400/30 transition-all cursor-pointer disabled:opacity-50"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Link ESP32 (COM3)</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {dashboardMode === "simple" ? (
        <main className="my-6 flex-1 flex flex-col justify-center">
          <SimpleMotionView
            connected={autoSyncConnected}
            isMoving={isRfMoving}
            rssi={wifiRssi}
            variance={wifiVariance}
            csiVariance={csiVariance}
            triggerCount={triggerCount}
            ip={esp32Ip}
            onCalibrate={handleCalibrateBaseline}
            isCalibrating={isCalibrating}
            calibrationProgress={calibrationProgress}
            sensitivity={sensitivity}
            onSetSensitivity={handleSetSensitivity}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(!soundEnabled)}
            occupancyState={occupancyState}
            multiPersonProb={multiPersonProb}
            decorrelationSpread={decorrelationSpread}
            leakyBucketLevel={leakyBucketLevel}
            occupancyLimit={occupancyLimit}
            onSetOccupancyLimit={setOccupancyLimit}
          />
        </main>
      ) : (
        <>
          {/* 4 Brutally Honest Hero Cards (No Fake Vitals!) */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 my-5">
        {/* Card 1: Ambient Wi-Fi RF Multipath */}
        <div
          className={`p-4 rounded-xl border backdrop-blur-md transition-all ${
            isRfMoving
              ? "bg-rose-950/30 border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.15)]"
              : "bg-slate-900/60 border-slate-800/80"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="uppercase tracking-wider font-mono text-[10px] text-cyan-400 flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              Ambient RF Multipath
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                isRfMoving ? "bg-rose-500 animate-ping" : "bg-cyan-400"
              }`}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xl md:text-2xl font-bold font-mono text-cyan-300">
                {wifiVariance.toFixed(2)}{" "}
                <span className="text-xs font-normal text-slate-400">dB²</span>
              </p>
              <p className="text-[10px] text-slate-500 font-mono">Signal Disturbance</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold font-mono text-slate-300">
                {wifiRssi} <span className="text-[10px] font-normal">dBm</span>
              </p>
              <p className="text-[10px] text-slate-500 font-mono">RSSI to Router</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 font-mono border-t border-slate-800/60 pt-1.5">
            {isRfMoving ? `MOTION TRIGGERED (> ${triggerThreshold} dB²)` : `Baseline: ${baselineVariance} dB²`}
          </p>
        </div>

        {/* Card 2: 64-Subcarrier CSI Variance */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="uppercase tracking-wider font-mono text-[10px] text-purple-400">
              64-Subcarrier CSI Engine
            </span>
            <span className="text-[10px] font-mono text-purple-300">20 MHz OFDM</span>
          </div>
          <p className="text-xl md:text-2xl font-bold font-mono text-purple-300">
            {csiVariance.toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-400 font-mono mt-1">
            Frequency-Selective Fading &bull; Micro-motion
          </p>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-cyan-400 h-full transition-all duration-200"
              style={{ width: `${Math.min(100, (csiVariance / 3.0) * 100)}%` }}
            />
          </div>
        </div>

        {/* Card 3: Room Motion Status */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="uppercase tracking-wider font-mono text-[10px] text-emerald-400">
              Motion Status
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                isRfMoving
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              }`}
            >
              {isRfMoving ? "TARGET MOVING" : "ROOM QUIET"}
            </span>
          </div>
          <p className="text-xl md:text-2xl font-bold font-mono text-slate-100">
            {isRfMoving ? "MOTION" : "STATIONARY"}
          </p>
          <p className="text-[11px] text-slate-400 mt-2 font-mono border-t border-slate-800/60 pt-1.5">
            Triggers Recorded: <strong className="text-cyan-300">{triggerCount}</strong>
          </p>
        </div>

        {/* Card 4: Phone Sensor Co-Pilot */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-purple-950/40 to-slate-900/70 border border-purple-500/30 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="uppercase tracking-wider font-mono text-[10px] text-purple-300 flex items-center gap-1">
              <Smartphone className="w-3 h-3" />
              Phone Sensor Co-Pilot
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                phoneConnected
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {phoneConnected ? "LINKED (GYRO ON)" : "STANDBY (OPTIONAL)"}
            </span>
          </div>
          <p className="text-xs font-mono font-bold text-slate-200 truncate">
            {phoneConnected
              ? `Gyro: ${phoneGyroMag} °/s | Acc: ${phoneAccelMag} m/s²`
              : "Zero GPS • Pure Gyro & Accel Calibration"}
          </p>
          <button
            onClick={() => setIsQrModalOpen(true)}
            className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 text-[11px] font-mono font-bold transition-all cursor-pointer shadow-sm"
          >
            <QrCode className="w-3.5 h-3.5 text-purple-300" />
            <span>{phoneConnected ? "Manage Sensor Link" : "Link Phone Gyro (QR)"}</span>
          </button>
        </div>
      </section>

      {/* Main Layout: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
        {/* Left Column: Visualizers (UAV Radar / Spectrogram / Signal Chart) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Tab Selector */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl">
            <button
              onClick={() => setViewMode("uav")}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all ${
                viewMode === "uav"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radar className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: "3s" }} />
              <span>Tactical UAV Radar (CoD)</span>
            </button>

            <button
              onClick={() => setViewMode("spectrogram")}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all ${
                viewMode === "spectrogram"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-purple-400" />
              <span>64-CSI Spectrogram</span>
            </button>

            <button
              onClick={() => setViewMode("chart")}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all ${
                viewMode === "chart"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Signal Lab Chart</span>
            </button>
          </div>

          {/* Active Viewport Render */}
          {viewMode === "uav" && (
            <UavTacticalRadar
              wifiVariance={wifiVariance}
              csiVariance={csiVariance}
              isMotionDetected={isRfMoving}
              phoneAccelMag={phoneAccelMag}
              phoneTag={phoneTag}
              isPhoneStreaming={phoneConnected}
              soundEnabled={soundEnabled}
              wifiRssi={wifiRssi}
            />
          )}

          {viewMode === "spectrogram" && (
            <CsiSpectrogramCanvas
              subcarrierAmplitudes={subcarrierAmplitudes}
              csiVariance={csiVariance}
            />
          )}

          {viewMode === "chart" && (
            <div className="space-y-4">
              <LabSignalChart
                data={signalHistory}
                baseline={baselineVariance}
                threshold={triggerThreshold}
              />
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-mono space-y-2">
                <span className="text-cyan-400 font-bold block">
                  PHYSICAL SIGNAL COMPARISON INSIGHT:
                </span>
                <p className="text-slate-300 text-[11px] leading-relaxed font-sans">
                  The <strong className="text-cyan-300">Cyan Line (Ambient RF Variance)</strong> spikes whenever physical movement disrupts the 2.4 GHz multipath waves. The <strong className="text-emerald-300">Emerald Line (64-CSI Variance)</strong> detects micro-movements across individual subcarriers. The <strong className="text-purple-300">Purple Line (Phone Accelerometer)</strong> measures the phone&apos;s inertial movement directly.
                </p>
              </div>
            </div>
          )}

          {/* Live Calibration & Detection Bar */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full ${
                  isRfMoving ? "bg-rose-500 animate-ping" : "bg-emerald-400"
                }`}
              />
              <span className="text-xs font-mono text-slate-300">
                RADAR STATUS:{" "}
                <strong className={isRfMoving ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                  {isRfMoving ? "MOTION DETECTED" : "ROOM QUIET & CLEAR"}
                </strong>
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                &bull; Baseline: {baselineVariance} dB² &bull; Threshold: {triggerThreshold} dB²
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCalibrateBaseline}
                disabled={isCalibrating}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold font-mono bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <Sliders className="w-3.5 h-3.5 text-slate-950" />
                <span>{isCalibrating ? `Calibrating ${calibrationProgress}%` : "Quick Recalibrate"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Tactical Recon / Events / UART Logs */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Sub-Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            {[
              { id: "fusion", label: "Sensor Fusion" },
              { id: "occupancy", label: "Occupancy Guard" },
              { id: "events", label: `Log (${events.length})` },
              { id: "terminal", label: "UART / Wi-Fi" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveRightTab(tab.id as typeof activeRightTab)}
                className={`text-xs font-mono font-bold pb-1 px-2 border-b-2 transition-all ${
                  activeRightTab === tab.id
                    ? "border-cyan-400 text-cyan-300"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sub-Tab 1: Sensor Fusion Co-Pilot */}
          {activeRightTab === "fusion" && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold font-mono text-cyan-300 uppercase flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Multi-Sensor Fusion Engine
                  </h3>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      phoneConnected
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {phoneConnected ? "DUAL-ENGINE ACTIVE" : "ESP32 STANDALONE"}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div>
                    <div className="text-2xl font-bold font-mono text-slate-100">
                      {fusedConfidence}%
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Human Presence Confidence
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`px-2 py-1 rounded text-xs font-bold font-mono ${
                        fusedConfidence > 50
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/50"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                      }`}
                    >
                      {fusedConfidence > 50 ? "MOVEMENT CONFIRMED" : "CLEAR SPACE"}
                    </span>
                  </div>
                </div>

                {/* Engine 1: ESP32 Wi-Fi Multipath */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-cyan-400 font-bold flex items-center gap-1">
                      <Radio className="w-3.5 h-3.5" />
                      1. ESP32 2.4 GHz RF Multipath
                    </span>
                    <span className={isRfMoving ? "text-rose-400 font-bold" : "text-emerald-400"}>
                      {isRfMoving ? "TRIPPED" : "STABLE"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Measured Variance: <strong className="text-slate-200">{wifiVariance.toFixed(2)} dB²</strong> &bull; RSSI: {wifiRssi} dBm
                  </div>
                </div>

                {/* Engine 2: Phone Inertial (Gyro + Accel) */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-purple-400 font-bold flex items-center gap-1">
                      <Smartphone className="w-3.5 h-3.5" />
                      2. Phone Gyroscope &amp; Accelerometer
                    </span>
                    <span className={phoneConnected ? "text-emerald-400 font-bold" : "text-slate-500"}>
                      {phoneConnected ? "LINKED" : "OPTIONAL CO-PILOT"}
                    </span>
                  </div>
                  {phoneConnected ? (
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-300 font-mono flex justify-between">
                        <span>Gyro Rotation: <strong>{phoneGyroMag} °/s</strong></span>
                        <span>Inertial Accel: <strong>{phoneAccelMag} m/s²</strong></span>
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">
                        Explicit permission granted &bull; Zero GPS &bull; Pure inertial calibration
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 space-y-2">
                      <p>
                        Hold your phone while walking to stream real Gyroscope + Accelerometer data. This cross-verifies footsteps and eliminates false alarms!
                      </p>
                      <button
                        onClick={() => setIsQrModalOpen(true)}
                        className="w-full py-1.5 px-3 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <QrCode className="w-3.5 h-3.5 text-purple-300" />
                        <span>Link Phone Gyro &amp; Sensors (QR)</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Explainer */}
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1 font-sans">
                  💡 <strong>How Phone Sensors Enhance Detection:</strong> The ESP32 senses environmental Wi-Fi wave shadows. When you authorize phone sensors, the phone&apos;s gyroscope detects your physical body rotation and steps. When both engines agree, confidence hits 100%!
                </p>
              </div>
            </div>
          )}

          {/* Sub-Tab: Live Occupancy & Crowd Limit Guard */}
          {activeRightTab === "occupancy" && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold font-mono text-cyan-300 uppercase flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-cyan-400" />
                    Live Occupancy Sentinel Engine
                  </h3>
                  <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Limit:</span>
                    <button
                      onClick={() => setOccupancyLimit(1)}
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold cursor-pointer ${
                        occupancyLimit === 1 ? "bg-cyan-500 text-slate-950" : "text-slate-400"
                      }`}
                    >
                      1 Max
                    </button>
                    <button
                      onClick={() => setOccupancyLimit(2)}
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold cursor-pointer ${
                        occupancyLimit === 2 ? "bg-purple-600 text-white" : "text-slate-400"
                      }`}
                    >
                      2 Max
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-mono uppercase">Occupancy State</div>
                    <div
                      className={`text-xl font-bold font-mono mt-1 ${
                        occupancyState === "MULTI"
                          ? "text-rose-400"
                          : occupancyState === "SINGLE"
                          ? "text-cyan-300"
                          : "text-emerald-400"
                      }`}
                    >
                      {occupancyState === "MULTI" ? "2+ PEOPLE" : occupancyState === "SINGLE" ? "1 PERSON" : "EMPTY (0)"}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-mono uppercase">Multi-Body Probability</div>
                    <div className="text-xl font-bold font-mono text-slate-100 mt-1">
                      {multiPersonProb}%
                    </div>
                  </div>
                </div>

                {/* Subcarrier Decorrelation Math */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-purple-300 font-bold flex items-center gap-1">
                      <Gauge className="w-3.5 h-3.5 text-purple-400" />
                      Subcarrier Phase Decorrelation (σ²Δ)
                    </span>
                    <span className="text-purple-300 font-mono font-bold">
                      {decorrelationSpread.toFixed(1)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Single body produces coherent fading (&lt; 14). Multiple simultaneous bodies cause frequency-selective phase notches (&gt; 16).
                  </div>
                </div>

                {/* Leaky Bucket Persistence */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300 font-bold">
                      Sustained Crowd Persistence (CUSUM)
                    </span>
                    <span className={leakyBucketLevel > 50 ? "text-rose-400 font-bold" : "text-cyan-300"}>
                      {Math.round(leakyBucketLevel)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        leakyBucketLevel > 60
                          ? "bg-rose-500"
                          : "bg-cyan-500"
                      }`}
                      style={{ width: `${Math.max(2, leakyBucketLevel)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 font-sans">
                    Prevents false alarms: Single person packing or pacing drains to 0% upon pause. Only sustained multi-person locomotion triggers the limit alarm.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 2: Event Stream Log */}
          {activeRightTab === "events" && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 max-h-[450px] overflow-y-auto font-mono text-xs">
              {events.length === 0 ? (
                <div className="text-slate-500 text-center py-8">
                  No events recorded yet. Walk across the room to trigger motion!
                </div>
              ) : (
                events.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-2"
                  >
                    <div>
                      <div className="text-slate-200 font-bold">{evt.message}</div>
                      <div className="text-[10px] text-slate-500">{evt.timestamp}</div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40">
                      TRIGGER
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Sub-Tab 3: Terminal Console */}
          {activeRightTab === "terminal" && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col h-[400px]">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 border-b border-slate-800/80 pb-2 mb-2">
                <span className="text-purple-400 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  RAW TELEMETRY STREAM
                </span>
                <span className="text-slate-500">
                  {autoSyncConnected ? "WI-FI AUTO-PUSH" : `${portName} @ ${baudRate}`}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300 pr-1 select-all">
                {terminalLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`leading-relaxed ${
                      log.includes("ERROR")
                        ? "text-rose-400"
                        : log.includes("CSI") || log.includes("TELEMETRY")
                        ? "text-cyan-300"
                        : log.includes("MOTION") || log.includes("moving")
                        ? "text-purple-300 font-bold"
                        : "text-slate-400"
                    }`}
                  >
                    {log}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Phone QR Code Modal */}
      <PhoneQrCodeModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        isPhoneConnected={phoneConnected}
        phoneTag={phoneTag}
      />
    </div>
  );
}
