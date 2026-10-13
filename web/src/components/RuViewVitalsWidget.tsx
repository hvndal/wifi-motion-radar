"use client";

import React, { useEffect, useRef } from "react";
import { Heart, Wind, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import { VitalsOutput } from "@/utils/ruviewCore";

interface VitalsWidgetProps {
  vitals: VitalsOutput;
  isStationary: boolean;
}

export default function RuViewVitalsWidget({ vitals, isStationary }: VitalsWidgetProps) {
  const breathCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const breathHistory = useRef<number[]>([]);
  const heartHistory = useRef<number[]>([]);

  useEffect(() => {
    // Record waveform points
    breathHistory.current.push(vitals.breathingWaveform);
    if (breathHistory.current.length > 80) breathHistory.current.shift();

    heartHistory.current.push(vitals.cardiacPulseWaveform);
    if (heartHistory.current.length > 80) heartHistory.current.shift();

    // 1. Draw Breathing Waveform (Cyan #06b6d4)
    const bCanvas = breathCanvasRef.current;
    if (bCanvas) {
      const ctx = bCanvas.getContext("2d");
      if (ctx) {
        const w = bCanvas.width;
        const h = bCanvas.height;
        ctx.fillStyle = "#060911";
        ctx.fillRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = "#1e293b50";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw breathing wave
        const pts = breathHistory.current;
        if (pts.length > 1) {
          ctx.strokeStyle = "#06b6d4";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          const stepX = w / (pts.length - 1);
          pts.forEach((val, i) => {
            const y = h / 2 - val * (h / 2 - 8);
            const x = i * stepX;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();

          // End dot
          const lastY = h / 2 - pts[pts.length - 1] * (h / 2 - 8);
          ctx.fillStyle = "#22d3ee";
          ctx.beginPath();
          ctx.arc(w - 2, lastY, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 2. Draw Cardiac Micro-Doppler Waveform (Purple #a855f7)
    const hCanvas = heartCanvasRef.current;
    if (hCanvas) {
      const ctx = hCanvas.getContext("2d");
      if (ctx) {
        const w = hCanvas.width;
        const h = hCanvas.height;
        ctx.fillStyle = "#060911";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "#1e293b50";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        const pts = heartHistory.current;
        if (pts.length > 1) {
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          const stepX = w / (pts.length - 1);
          pts.forEach((val, i) => {
            const y = h / 2 - val * (h / 2 - 8);
            const x = i * stepX;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();

          const lastY = h / 2 - pts[pts.length - 1] * (h / 2 - 8);
          ctx.fillStyle = "#c084fc";
          ctx.beginPath();
          ctx.arc(w - 2, lastY, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [vitals]);

  return (
    <div className="space-y-4">
      {/* Vitals Summary Banner */}
      {vitals.apneaAlert && (
        <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/80 text-rose-200 flex items-center gap-3 animate-pulse">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
          <div className="text-xs font-mono">
            <strong className="block font-bold">APNEA / RESPIRATORY CESSATION DETECTED</strong>
            No chest displacement detected for {vitals.lastPeakIntervalSec}s in stationary sector.
          </div>
        </div>
      )}

      {/* Main Two Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Respiration */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-md space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-1.5 text-cyan-400 font-bold uppercase tracking-wider">
              <Wind className="w-4 h-4 text-cyan-400" />
              Respiration Rate
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/40 text-[10px]">
              0.1 - 0.45 Hz Bandpass
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-3xl md:text-4xl font-extrabold font-mono text-cyan-300">
              {vitals.breathingRateBpm.toFixed(1)}{" "}
              <span className="text-xs text-slate-500 font-normal">BPM</span>
            </p>
            <p className="text-[11px] font-mono text-slate-400">
              Cycle: <strong className="text-slate-200">{vitals.lastPeakIntervalSec}s</strong>
            </p>
          </div>

          {/* Oscilloscope Canvas */}
          <div className="rounded-xl overflow-hidden border border-slate-800/80">
            <canvas
              ref={breathCanvasRef}
              width={340}
              height={70}
              className="w-full h-[70px] block"
            />
          </div>
          <p className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
            <span>Chest Displacement Waveform</span>
            <span className="text-cyan-400">Normal Range: 12-20 BPM</span>
          </p>
        </div>

        {/* Card 2: Cardiac Micro-Doppler */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-md space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-1.5 text-purple-400 font-bold uppercase tracking-wider">
              <Heart className="w-4 h-4 text-purple-400 animate-pulse" />
              Cardiac Pulse
            </span>
            <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40 text-[10px]">
              0.85 - 2.1 Hz Bandpass
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-3xl md:text-4xl font-extrabold font-mono text-purple-300">
              {vitals.heartRateBpm}{" "}
              <span className="text-xs text-slate-500 font-normal">BPM</span>
            </p>
            <p className="text-[11px] font-mono text-slate-400">
              Status:{" "}
              <strong className={vitals.heartRateBpm > 105 ? "text-amber-400" : "text-emerald-400"}>
                {vitals.heartRateBpm > 105 ? "Elevated" : "Resting"}
              </strong>
            </p>
          </div>

          {/* Oscilloscope Canvas */}
          <div className="rounded-xl overflow-hidden border border-slate-800/80">
            <canvas
              ref={heartCanvasRef}
              width={340}
              height={70}
              className="w-full h-[70px] block"
            />
          </div>
          <p className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
            <span>Micro-Doppler Blood Flow Impulse</span>
            <span className="text-purple-400">Normal Range: 60-95 BPM</span>
          </p>
        </div>
      </div>

      {/* Signal Quality & Integrity Footer */}
      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          {isStationary ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
          <span className="text-slate-300">
            {isStationary
              ? "Subject Stationary: Vitals Signal Pure"
              : "Motion Artifacts Present: Filtering High Frequency Noise"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-[11px]">Signal Quality (SQI):</span>
          <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                vitals.signalQualityIndex > 70
                  ? "bg-cyan-400"
                  : vitals.signalQualityIndex > 40
                  ? "bg-amber-400"
                  : "bg-rose-400"
              }`}
              style={{ width: `${vitals.signalQualityIndex}%` }}
            />
          </div>
          <span className="text-cyan-300 font-bold">{vitals.signalQualityIndex}%</span>
        </div>
      </div>
    </div>
  );
}
