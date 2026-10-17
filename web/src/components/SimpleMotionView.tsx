"use client";

import React, { useState, useEffect } from "react";
import {
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
  Crosshair,
} from "lucide-react";
import { TrackedSignalEntity } from "@/utils/predictiveModels";

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
  // New Multi-Target & Radius Selection Props
  trackedEntities?: TrackedSignalEntity[];
  selectedRadiusMeters?: number;
  onSelectRadiusMeters?: (r: number) => void;
  estimatedPeopleInRadius?: number;
  estimatedPetsInRadius?: number;
  respirationBpm?: number;
  stationaryPresenceScore?: number;
  predictionStatusText?: string;
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
  trackedEntities = [],
  selectedRadiusMeters = 6.0,
  onSelectRadiusMeters,
  estimatedPeopleInRadius = 0,
  estimatedPetsInRadius = 0,
  respirationBpm = 16.0,
  stationaryPresenceScore = 0,
  predictionStatusText = "Monitoring 2.4 GHz multipath field...",
}: SimpleMotionViewProps) {
  // Activity timeline in plain English
  const [history, setHistory] = useState<
    Array<{ id: string; time: string; text: string; type: "motion" | "still" | "cal" }>
  >([]);

  useEffect(() => {
    const nowStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (isMoving) {
      setHistory((prev) => [
        {
          id: `m-${Date.now()}`,
          time: nowStr,
          text:
            trackedEntities.length > 0
              ? `${trackedEntities[0].designation} detected at ${trackedEntities[0].rangeMeters}m`
              : "Movement detected in the room",
          type: "motion",
        },
        ...prev.slice(0, 15),
      ]);
    }
  }, [isMoving, trackedEntities]);

  // Compute friendly activity level percentage (0 to 100%)
  const activityScore = connected
    ? Math.min(100, Math.round(variance * 28 + decorrelationSpread * 8))
    : 0;

  const isStationaryOccupied =
    !isMoving && (estimatedPeopleInRadius > 0 || stationaryPresenceScore >= 32);

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
        <div className="px-4 py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-emerald-300">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span>
              <strong>ESP32 Sensor Active &amp; Connected:</strong> {ip}
            </span>
          </div>
          <span className="text-[11px] text-emerald-400/80">
            Router in Back (270°) &bull; Signal: {rssi} dBm
          </span>
        </div>
      )}

      {/* 2. THE BIG HUMAN PRESENCE CARD (Supports Moving, Stationary Breathing, and Empty) */}
      <div
        className={`relative overflow-hidden p-6 md:p-10 rounded-3xl border-2 transition-all duration-300 shadow-2xl ${
          isMoving
            ? "bg-gradient-to-b from-rose-950/60 to-slate-950 border-rose-500 shadow-rose-950/50"
            : isStationaryOccupied
            ? "bg-gradient-to-b from-cyan-950/50 to-slate-950 border-cyan-500/60 shadow-cyan-950/30"
            : "bg-gradient-to-b from-emerald-950/40 to-slate-950 border-emerald-500/40 shadow-emerald-950/20"
        }`}
      >
        {/* Ambient background glow ring */}
        <div
          className={`absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${
            isMoving
              ? "bg-rose-500/20"
              : isStationaryOccupied
              ? "bg-cyan-500/15"
              : "bg-emerald-500/10"
          }`}
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          {/* Status Text & Big Icon */}
          <div className="flex items-center gap-5">
            <div
              className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                isMoving
                  ? "bg-rose-500/20 border-rose-500/60 text-rose-300 shadow-[0_0_30px_rgba(244,63,94,0.4)] animate-bounce"
                  : isStationaryOccupied
                  ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.3)]"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              }`}
            >
              {isMoving || isStationaryOccupied ? (
                <UserCheck className="w-12 h-12" />
              ) : (
                <UserX className="w-12 h-12" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                    isMoving
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse"
                      : isStationaryOccupied
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                  }`}
                >
                  {isMoving
                    ? "Active Motion Alert"
                    : isStationaryOccupied
                    ? `Stationary Presence (${respirationBpm} BPM)`
                    : "Empty / Clear"}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Triggers: <strong>{triggerCount}</strong>
                </span>
              </div>

              <h2
                className={`text-2xl md:text-4xl font-extrabold tracking-tight mt-1 transition-colors duration-200 ${
                  isMoving
                    ? "text-rose-200"
                    : isStationaryOccupied
                    ? "text-cyan-200"
                    : "text-emerald-200"
                }`}
              >
                {isMoving
                  ? "MOVEMENT DETECTED!"
                  : isStationaryOccupied
                  ? "STATIONARY PERSON MAPPED"
                  : "ROOM IS QUIET & EMPTY"}
              </h2>

              <p className="text-sm text-slate-300 mt-1 max-w-md">
                {predictionStatusText}
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
            <span>Room RF Perturbation &amp; Stationary Presence</span>
            <span className={isMoving ? "text-rose-400 font-bold" : "text-cyan-300"}>
              Motion: {activityScore}% | Stationary Lock: {stationaryPresenceScore}%
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-200 rounded-full ${
                isMoving
                  ? "bg-gradient-to-r from-amber-500 via-rose-500 to-red-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                  : isStationaryOccupied
                  ? "bg-gradient-to-r from-cyan-500 to-emerald-400"
                  : "bg-emerald-500/70"
              }`}
              style={{
                width: `${Math.max(4, Math.min(100, Math.max(activityScore, stationaryPresenceScore)))}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* 2.5 LIVE OCCUPANCY, RADIUS SELECTION & SIGNAL X / SIGNAL Y TRACKER */}
      <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100 font-mono uppercase tracking-wide">
                  Radius Occupancy &amp; Signal X / Y Pinpointer
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  BREATHING + MOTION FUSION
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Maps moving &amp; stationary humans (Person X, Person Y) and separates low-mass pets inside your selected radio radius
              </p>
            </div>
          </div>

          {/* Radio Scan Radius Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-mono text-cyan-400 pl-2 pr-1 font-bold">
                Radio Radius:
              </span>
              {[3, 5, 8, 12].map((r) => (
                <button
                  key={r}
                  onClick={() => onSelectRadiusMeters && onSelectRadiusMeters(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    selectedRadiusMeters === r
                      ? "bg-cyan-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {r}m
                </button>
              ))}
            </div>

            {/* Occupancy Limit Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 pl-2">Max:</span>
              <button
                onClick={() => onSetOccupancyLimit(1)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  occupancyLimit === 1
                    ? "bg-cyan-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                1 Person
              </button>
              <button
                onClick={() => onSetOccupancyLimit(2)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  occupancyLimit === 2
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                2 People
              </button>
            </div>
          </div>
        </div>

        {/* Live Classification Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Estimated Occupants in Selected Radius */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              People in {selectedRadiusMeters}m Radius
            </span>
            <div className="my-2 flex items-baseline gap-2">
              <span
                className={`text-2xl font-black font-mono ${
                  estimatedPeopleInRadius >= 2 || occupancyState === "MULTI"
                    ? "text-rose-400"
                    : estimatedPeopleInRadius === 1 || occupancyState === "SINGLE"
                    ? "text-cyan-300"
                    : "text-emerald-400"
                }`}
              >
                {estimatedPeopleInRadius >= 2 || occupancyState === "MULTI"
                  ? "2+ PEOPLE"
                  : estimatedPeopleInRadius === 1 || occupancyState === "SINGLE"
                  ? "1 PERSON"
                  : "0 (EMPTY)"}
              </span>
              {estimatedPetsInRadius > 0 && (
                <span className="text-xs font-mono font-bold text-amber-400">
                  (+{estimatedPetsInRadius} Pet/Small)
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {estimatedPeopleInRadius >= 2
                ? "Person X + Person Y simultaneous scatter"
                : estimatedPeopleInRadius === 1
                ? isMoving
                  ? "Person X (Signal X) moving in radius"
                  : `Person X stationary (${respirationBpm} BPM lock)`
                : "Zero human signatures inside radius"}
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
                  (occupancyLimit === 1 &&
                    (occupancyState === "MULTI" || estimatedPeopleInRadius >= 2)) ||
                  leakyBucketLevel >= 60
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                }`}
              >
                {(occupancyLimit === 1 &&
                  (occupancyState === "MULTI" || estimatedPeopleInRadius >= 2)) ||
                leakyBucketLevel >= 60 ? (
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
              {(occupancyLimit === 1 &&
                (occupancyState === "MULTI" || estimatedPeopleInRadius >= 2)) ||
              leakyBucketLevel >= 60
                ? "Multiple human signals detected"
                : `Allowed: Up to ${occupancyLimit} person${occupancyLimit > 1 ? "s" : ""}`}
            </div>
          </div>

          {/* Card 3: Phase Decorrelation Spread */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              RF Phase Decorrelation
            </span>
            <div className="my-2 text-2xl font-black font-mono text-purple-300">
              {decorrelationSpread.toFixed(2)}{" "}
              <span className="text-xs font-normal text-slate-500">&sigma;&sup2;&Delta;</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {decorrelationSpread >= 2.5
                ? "High decorrelation (Person X + Person Y)"
                : decorrelationSpread >= 0.8
                ? "Coherent scatter (Single Person X)"
                : "Quiet baseline (< 0.8)"}
            </div>
          </div>
        </div>

        {/* Active Decomposed Pointers List: PERSON X (SIGNAL X) & PERSON Y (SIGNAL Y) */}
        <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2.5 font-mono">
          <div className="flex items-center justify-between text-xs">
            <span className="text-cyan-300 font-bold flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
              LIVE SIGNAL POINTERS IN {selectedRadiusMeters}m RADIUS (PERSON X &amp; PERSON Y)
            </span>
            <span className="text-[10px] text-slate-400">
              {trackedEntities.length} Active Signal{trackedEntities.length === 1 ? "" : "s"}
            </span>
          </div>

          {trackedEntities.length === 0 ? (
            <div className="text-xs text-slate-500 py-3 text-center border border-dashed border-slate-800 rounded-xl">
              No active signals inside {selectedRadiusMeters}m radius. Walk or sit near the laptop to lock Person X.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {trackedEntities.map((ent) => (
                <div
                  key={ent.id}
                  className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          ent.classification === "PET_OR_LOW_MASS"
                            ? "bg-amber-400"
                            : ent.id === "signal-y"
                            ? "bg-purple-400"
                            : ent.classification === "HUMAN_STATIONARY"
                            ? "bg-emerald-400"
                            : "bg-rose-500 animate-ping"
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-100">
                        {ent.designation}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {ent.sector === "DESK_REFLECTION_NORTH"
                        ? "Sector: Front Desk (90° Backscatter)"
                        : ent.sector === "FRESNEL_CORE_SOUTH"
                        ? "Sector: Back Router Corridor (270°)"
                        : "Sector: Secondary Multipath Lobe"}
                    </div>
                    <div className="text-[10px] text-cyan-400">
                      {ent.classification === "HUMAN_STATIONARY"
                        ? `Stationary Breathing Lock: ~${ent.breathingBpm ?? 16} BPM`
                        : ent.classification === "PET_OR_LOW_MASS"
                        ? "Low-Mass Scatter (Possible Pet / Small Object)"
                        : `Radial Velocity: ${ent.velocityMs} m/s`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-cyan-300">
                      {ent.rangeMeters}m
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {Math.round(ent.confidence * 100)}% conf
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The Two Live Mathematical Meters */}
        <div className="space-y-4 pt-1">
          {/* Meter 1: Instantaneous Multi-Body Probability */}
          <div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1.5">
              <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                Multi-Body Scatter Probability (Signal X + Signal Y)
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
                Sustained Multi-Person Persistence (Leaky Bucket CUSUM)
              </span>
              <span className={leakyBucketLevel >= 60 ? "text-rose-400 font-bold" : "text-slate-300"}>
                {Math.round(leakyBucketLevel)}% / 100%
              </span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800 relative">
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10"
                style={{ left: "60%" }}
                title="Alert Threshold (60%)"
              />
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  leakyBucketLevel >= 60
                    ? "bg-gradient-to-r from-amber-500 via-rose-500 to-red-500"
                    : "bg-gradient-to-r from-cyan-500 to-purple-500"
                }`}
                style={{ width: `${Math.max(2, leakyBucketLevel)}%` }}
              />
            </div>
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
              <span>Empty-Room Reference Calibration</span>
            </div>
            <h3 className="text-base font-bold text-slate-100">
              Lock Empty-Room Profile
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Snapshots the 64-subcarrier multipath profile of your room so the radar can keep stationary people mapped via static shadowing &amp; breathing micro-Doppler.
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
                <span>Calibrating... ({calibrationProgress}%)</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Calibrate Room Baseline (3s)</span>
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
              Choose how sensitive the Wi-Fi radar should be to subtle movements and breathing.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            {(
              [
                { id: "low", label: "Low", desc: "Walking only" },
                { id: "normal", label: "Normal", desc: "Recommended" },
                { id: "high", label: "High", desc: "Micro-motion" },
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

      {/* 4. Plain English Explainer */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start gap-4">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
          <Info className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-100 mb-1">
            How Person X, Person Y, Stationary Breathing, and Pets are Separated
          </h4>
          <p className="leading-relaxed text-slate-400">
            We split the 20 MHz Wi-Fi channel into Lower (<code className="text-cyan-300">SC 6..31</code>) and Upper (<code className="text-purple-300">SC 33..58</code>) sub-bands. A single human body (<strong className="text-cyan-300">Person X</strong>) casts a deep radio shadow and exhibits a <strong className="text-emerald-300">0.15–0.45 Hz chest breathing rhythm</strong> when sitting still. A second person (<strong className="text-purple-300">Person Y</strong>) creates frequency-selective interference notches across both sub-bands, while pets produce fast micro-Doppler ripples with minimal RSSI shadowing.
          </p>
        </div>
      </div>

      {/* 5. Simple Activity History */}
      {history.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-3">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>Recent Signal Activity Log</span>
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
