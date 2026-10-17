"use client";

import React, { useEffect, useRef } from "react";

export interface DataPoint {
  time: number;
  wifiRssi: number;
  wifiVariance: number;
  csiVariance?: number;
  phoneAccel: number;
  phoneGyro: number;
  baselineThreshold: number;
}

interface ChartProps {
  data: DataPoint[];
  baseline: number;
  threshold: number;
}

export default function LabSignalChart({ data, baseline, threshold }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, width, height);

    // Draw Grid Lines
    ctx.strokeStyle = "#1e293b50";
    ctx.lineWidth = 1;

    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = 0; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (data.length < 2) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Awaiting incoming telemetry streams...", width / 2, height / 2);
      return;
    }

    const maxPoints = 60;
    const recent = data.slice(-maxPoints);
    const stepX = width / (maxPoints - 1);

    // Dynamic Y-Axis Scale: adapts smoothly to room sensitivity & live disturbance peaks
    const peakDataVar = recent.reduce(
      (max, pt) => Math.max(max, pt.wifiVariance, (pt.csiVariance || 0) * 1.2, pt.phoneAccel * 0.5),
      0
    );
    const dynamicMaxY = Math.max(3.0, threshold * 2.2, peakDataVar * 1.25);
    const mapVarY = (v: number) =>
      height - 12 - Math.min(height - 24, (Math.max(0, v) / dynamicMaxY) * (height - 34));

    // Draw Threshold Line
    const threshY = mapVarY(threshold);
    ctx.strokeStyle = "#f43f5e80";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(width, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#f43f5e";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`Trigger Threshold (${threshold.toFixed(2)} dB²)`, width - 8, threshY - 4);

    // Baseline Line
    const baseY = mapVarY(baseline);
    ctx.strokeStyle = "#06b6d450";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(width, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 1. Draw CSI Variance (Emerald #10b981)
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    recent.forEach((pt, i) => {
      const cv = pt.csiVariance || 0;
      const cy = mapVarY(cv);
      const px = i * stepX;
      if (i === 0) ctx.moveTo(px, cy);
      else ctx.lineTo(px, cy);
    });
    ctx.stroke();

    // 2. Draw Phone Accelerometer (Purple #a855f7)
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    recent.forEach((pt, i) => {
      const py = mapVarY(pt.phoneAccel * 0.4);
      const px = i * stepX;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 3. Draw Wi-Fi RF Variance (Cyan #06b6d4)
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    recent.forEach((pt, i) => {
      const py = mapVarY(pt.wifiVariance);
      const px = i * stepX;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 4. Draw Dots on latest values
    const last = recent[recent.length - 1];
    const lastX = (recent.length - 1) * stepX;

    // Wi-Fi Dot
    const lastWifiY = mapVarY(last.wifiVariance);
    ctx.fillStyle = "#06b6d4";
    ctx.beginPath();
    ctx.arc(lastX, lastWifiY, 4, 0, Math.PI * 2);
    ctx.fill();

    // CSI Dot
    if (last.csiVariance !== undefined) {
      const lastCsiY = mapVarY(last.csiVariance || 0);
      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(lastX, lastCsiY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Phone Dot
    const lastPhoneY = mapVarY(last.phoneAccel * 0.4);
    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(lastX, lastPhoneY, 4, 0, Math.PI * 2);
    ctx.fill();

  }, [data, baseline, threshold]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-slate-800 bg-[#090d16]">
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        className="w-full h-[220px] block"
      />

      {/* Legend */}
      <div className="absolute top-2.5 left-3 flex flex-wrap items-center gap-4 text-[10px] font-mono pointer-events-none">
        <span className="flex items-center gap-1.5 text-cyan-400 font-bold">
          <span className="w-2.5 h-0.5 bg-cyan-400 rounded-full" />
          Ambient RF Variance (&sigma;&sup2; dB&sup2;)
        </span>
        <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
          <span className="w-2.5 h-0.5 bg-emerald-400 rounded-full" />
          64-Subcarrier CSI (&sigma;&sup2; ampl)
        </span>
        <span className="flex items-center gap-1.5 text-purple-400 font-bold">
          <span className="w-2.5 h-0.5 bg-purple-400 rounded-full" />
          Phone Accelerometer (|a| m/s&sup2;)
        </span>
      </div>
    </div>
  );
}
