"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Radio,
  Sliders,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Volume2,
  VolumeX,
  Info,
  Clock,
  UserCheck,
  UserX,
  Users,
  ShieldAlert,
  Gauge,
  Activity,
} from "lucide-react";

interface SimpleMotionViewProps {
  connected: boolean;
  isMoving: boolean;
  rssi: number;
  variance: number;
  csiVariance: number;
  triggerCount: number;
  ip: string;
  onCalibrate: () => void;
  isCalibrating: boolean;
  calibrationProgress: number;
  sensitivity: "low" | "normal" | "high";
  onSetSensitivity: (level: "low" | "normal" | "high") => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  // Live Occupancy Guard Props
  occupancyState: "EMPTY" | "SINGLE" | "MULTI";
  multiPersonProb: number;
  decorrelationSpread: number;
  leakyBucketLevel: number;
  occupancyLimit: 1 | 2;
  onSetOccupancyLimit: (limit: 1 | 2) => void;
}

export function SimpleMotionView({
  connected,
  isMoving,
  rssi,
  variance,
  triggerCount,
  ip,
  onCalibrate,
  isCalibrating,
  calibrationProgress,
  sensitivity,
  onSetSensitivity,
  soundEnabled,
  onToggleSound,
  occupancyState,
  multiPersonProb,
  decorrelationSpread,
  leakyBucketLevel,
  occupancyLimit,
  onSetOccupancyLimit,
}: SimpleMotionViewProps) {
  // Activity timeline in plain English
  const [history, setHistory] = useState<
    Array<{ id: string; time: string; text: string; type: "motion" | "still" | "cal" }>
  >([]);

  useEffect(() => {
    const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (isMoving) {
      setHistory((prev) => [
        {
          id: `m-${Date.now()}`,
          time: nowStr,
          text: "Movement detected in the room",
          type: "motion",
        },
        ...prev.slice(0, 15),
      ]);
    }
  }, [isMoving]);

  // Compute friendly activity level percentage (0 to 100%)
  const activityScore = Math.min(100, Math.round(variance * 12));

  return (
    <div className="flex flex-col gap-5 w-full max-w-4xl mx-auto">
      {/* 1. Hardware Connection Alert Banner (if unplugged) */}
      {!connected ? (
        <div className="p-4 md:p-5 rounded-2xl bg-amber-950/40 border border-amber-500/50 shadow-lg shadow-amber-950/30 flex items-start sm:items-center gap-4 animate-pulse">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-amber-200">
              ESP32 Sensor Not Detected on USB
            </h3>
            <p className="text-xs text-amber-300/80 mt-0.5">
              Please plug your ESP32 board into any USB port on your PC using a data cable. The system will auto-link as soon as it is plugged in!
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-amber-400 bg-amber-900/40 px-3 py-1.5 rounded-lg border border-amber-500/30">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Scanning USB...</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs font-mono text-emerald-300">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span>
              <strong>ESP32 Sensor Active & Connected:</strong> {ip}
            </span>
          </div>
          <span className="text-[11px] text-emerald-400/80">
            Wi-Fi Signal: {rssi} dBm (Healthy)
          </span>
        </div>
      )}

      {/* 2. THE BIG HUMAN PRESENCE CARD (Main attraction for non-tech users) */}
      <div
        className={`relative overflow-hidden p-6 md:p-10 rounded-3xl border-2 transition-all duration-300 shadow-2xl ${
          isMoving
            ? "bg-gradient-to-b from-rose-950/60 to-slate-950 border-rose-500 shadow-rose-950/50"
            : "bg-gradient-to-b from-emerald-950/40 to-slate-950 border-emerald-500/40 shadow-emerald-950/20"
        }`}
      >
        {/* Ambient background glow ring */}
        <div
          className={`absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${
            isMoving ? "bg-rose-500/20" : "bg-emerald-500/10"
          }`}
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          {/* Status Text & Big Icon */}
          <div className="flex items-center gap-5">
            <div
              className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                isMoving
                  ? "bg-rose-500/20 border-rose-500/60 text-rose-300 shadow-[0_0_30px_rgba(244,63,94,0.4)] animate-bounce"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              }`}
            >
              {isMoving ? (
                <UserCheck className="w-12 h-12" />
              ) : (
                <UserX className="w-12 h-12" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                    isMoving
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                  }`}
                >
                  {isMoving ? "Live Alert" : "Live Status"}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Recorded Triggers: <strong>{triggerCount}</strong>
                </span>
              </div>

              <h2
                className={`text-2xl md:text-4xl font-extrabold tracking-tight mt-1 transition-colors duration-200 ${
                  isMoving ? "text-rose-200" : "text-emerald-200"
                }`}
              >
                {isMoving ? "MOVEMENT DETECTED!" : "ROOM IS QUIET & STILL"}
              </h2>

              <p className="text-sm text-slate-300 mt-1 max-w-md">
                {isMoving
                  ? "Someone is walking or moving in the room! The Wi-Fi wave disturbance has tripped the sensor."
                  : "No movement detected in the room right now. The space is calm and static."}
              </p>
            </div>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={onToggleSound}
            className={`self-start sm:self-center flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              soundEnabled
                ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/40"
                : "bg-slate-900 text-slate-500 border-slate-800"
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span>{soundEnabled ? "Radar Beep ON" : "Muted"}</span>
          </button>
        </div>

        {/* Live Activity Meter Bar */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
            <span>Room Motion Intensity</span>
            <span className={isMoving ? "text-rose-400 font-bold" : "text-emerald-400"}>
              {activityScore}% ({isMoving ? "Active" : "Quiet"})
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-200 rounded-full ${
                isMoving
                  ? "bg-gradient-to-r from-amber-500 via-rose-500 to-red-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                  : "bg-emerald-500/70"
              }`}
              style={{ width: `${Math.max(4, Math.min(100, activityScore))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2.5 LIVE OCCUPANCY & MULTI-PERSON GUARD CARD */}
      <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100 font-mono uppercase tracking-wide">
                  Live Occupancy Sentinel
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  REAL-TIME RF GUARD
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Detects multiple simultaneous bodies via subcarrier phase decorrelation &bull; Zero cameras
              </p>
            </div>
          </div>

          {/* Occupancy Limit Selector */}
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <span className="text-[11px] font-mono text-slate-400 pl-2">Room Limit:</span>
            <button
              onClick={() => onSetOccupancyLimit(1)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                occupancyLimit === 1
                  ? "bg-cyan-500 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              1 Person Max
            </button>
            <button
              onClick={() => onSetOccupancyLimit(2)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                occupancyLimit === 2
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              2 People Max
            </button>
          </div>
        </div>

        {/* Live Classification Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Estimated Occupants */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Estimated Occupancy
            </span>
            <div className="my-2">
              <span
                className={`text-2xl font-black font-mono ${
                  occupancyState === "MULTI"
                    ? "text-rose-400"
                    : occupancyState === "SINGLE"
                    ? "text-cyan-300"
                    : "text-emerald-400"
                }`}
              >
                {occupancyState === "MULTI"
                  ? "2+ PEOPLE"
                  : occupancyState === "SINGLE"
                  ? "1 PERSON"
                  : "0 (EMPTY)"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {occupancyState === "MULTI"
                ? "Simultaneous multi-body scatter"
                : occupancyState === "SINGLE"
                ? "Single coherent walking scatter"
                : "Zero microwave disturbance"}
            </div>
          </div>

          {/* Card 2: Limit Status */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Limit Compliance
            </span>
            <div className="my-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
                  (occupancyLimit === 1 && occupancyState === "MULTI") || leakyBucketLevel > 50
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                }`}
              >
                {(occupancyLimit === 1 && occupancyState === "MULTI") || leakyBucketLevel > 50 ? (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>LIMIT EXCEEDED</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>WITHIN LIMIT</span>
                  </>
                )}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {(occupancyLimit === 1 && occupancyState === "MULTI") || leakyBucketLevel > 50
                ? "Sustained crowd signature detected"
                : `Allowed: Up to ${occupancyLimit} guest${occupancyLimit > 1 ? "s" : ""}`}
            </div>
          </div>

          {/* Card 3: Phase Decorrelation Spread */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              RF Phase Decorrelation
            </span>
            <div className="my-2 text-2xl font-black font-mono text-purple-300">
              {decorrelationSpread.toFixed(1)}{" "}
              <span className="text-xs font-normal text-slate-500">&sigma;&sup2;&Delta;</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {decorrelationSpread > 16
                ? "High decorrelation (Multiple bodies)"
                : "Low/coherent (Single reflector)"}
            </div>
          </div>
        </div>

        {/* The Two Live Mathematical Meters */}
        <div className="space-y-4 pt-2">
          {/* Meter 1: Instantaneous Multi-Body Probability */}
          <div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1.5">
              <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                Multi-Body Scatter Probability (Instantaneous)
              </span>
              <span className={multiPersonProb >= 50 ? "text-rose-400 font-bold" : "text-cyan-300"}>
                {multiPersonProb}% ({multiPersonProb >= 50 ? "Multi-Body" : "Single / Quiet"})
              </span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-200 rounded-full ${
                  multiPersonProb >= 50
                    ? "bg-gradient-to-r from-purple-500 via-rose-500 to-red-500"
                    : "bg-cyan-500"
                }`}
                style={{ width: `${Math.max(2, multiPersonProb)}%` }}
              />
            </div>
          </div>

          {/* Meter 2: Live Leaky Bucket Persistence (Anti-False-Alarm Integrator) */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-purple-300 font-bold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-purple-400" />
                Sustained Multi-Person Persistence (Leaky Bucket Integrator)
              </span>
              <span className={leakyBucketLevel > 50 ? "text-rose-400 font-bold" : "text-slate-300"}>
                {Math.round(leakyBucketLevel)}% / 100%
              </span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800 relative">
              {/* Alert trigger line at 60% */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10"
                style={{ left: "60%" }}
                title="Alert Threshold (60%)"
              />
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  leakyBucketLevel > 60
                    ? "bg-gradient-to-r from-amber-500 via-rose-500 to-red-500"
                    : "bg-gradient-to-r from-cyan-500 to-purple-500"
                }`}
                style={{ width: `${Math.max(2, leakyBucketLevel)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              <strong>How this prevents false alarms:</strong> When a single person paces or unpacks luggage, the bucket drains back to 0% as soon as they pause. The bucket only accumulates past the red line when multiple people move continuously at the same time.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Controls Grid: 1-Click Calibration + Sensitivity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card A: 1-Click Calibrate */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Sliders className="w-4 h-4" />
              <span>Room Calibration</span>
            </div>
            <h3 className="text-base font-bold text-slate-100">
              Calibrate to Your Room
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Every room has a slightly different shape and furniture. Click this while sitting still for 3 seconds so the sensor learns your room&apos;s quiet baseline.
            </p>
          </div>

          <button
            onClick={onCalibrate}
            disabled={isCalibrating}
            className={`mt-4 w-full py-3 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
              isCalibrating
                ? "bg-cyan-900/50 text-cyan-200 border border-cyan-500/40"
                : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20"
            }`}
          >
            {isCalibrating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-300" />
                <span>Calibrating... Stay Still ({calibrationProgress}%)</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Calibrate Room (3 Seconds)</span>
              </>
            )}
          </button>
        </div>

        {/* Card B: Friendly Sensitivity Selector */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Radio className="w-4 h-4" />
              <span>Sensor Sensitivity</span>
            </div>
            <h3 className="text-base font-bold text-slate-100">
              Detection Sensitivity
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Choose how sensitive the Wi-Fi radar should be to movement.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            {(
              [
                { id: "low", label: "Low", desc: "Walking only" },
                { id: "normal", label: "Normal", desc: "Recommended" },
                { id: "high", label: "High", desc: "Small gestures" },
              ] as const
            ).map((lvl) => (
              <button
                key={lvl.id}
                onClick={() => onSetSensitivity(lvl.id)}
                className={`py-2.5 px-2 rounded-xl text-center border transition-all cursor-pointer ${
                  sensitivity === lvl.id
                    ? "bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30"
                    : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <div className="text-xs font-bold">{lvl.label}</div>
                <div className="text-[10px] opacity-75 mt-0.5">{lvl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Plain English "How Does It Work?" Explainer */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start gap-4">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
          <Info className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-100 mb-1">
            How does this work without any cameras or microphones?
          </h4>
          <p className="leading-relaxed text-slate-400">
            Your home Wi-Fi router fills this room with invisible radio waves. Because the human body is ~70% water, walking through the room reflects and absorbs these waves like casting a shadow. The ESP32 microchip measures those tiny wave ripples 10 times a second and spots human movement instantly—with <strong className="text-cyan-300">100% privacy and zero cameras</strong>.
          </p>
        </div>
      </div>

      {/* 5. Simple Activity History */}
      {history.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-3">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>Recent Activity Log</span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-slate-950/80 border border-slate-800/60"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                  <span className="text-slate-200 font-medium">{item.text}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-500">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
