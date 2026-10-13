"use client";

import React, { useEffect, useRef } from "react";

interface CsiSpectrogramProps {
  subcarrierAmplitudes: number[]; // 64 subcarrier values
  csiVariance: number;
}

export default function CsiSpectrogramCanvas({
  subcarrierAmplitudes,
  csiVariance,
}: CsiSpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Circular history of last 100 frames of 64 subcarrier values
  const historyRef = useRef<number[][]>([]);

  useEffect(() => {
    // Push new frame to waterfall history
    historyRef.current.push([...subcarrierAmplitudes]);
    if (historyRef.current.length > 90) {
      historyRef.current.shift();
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const history = historyRef.current;

    // Clear background
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, width, height);

    if (history.length < 2) return;

    const numSubcarriers = 64;
    const cellWidth = width / history.length;
    const cellHeight = (height - 30) / numSubcarriers;

    // Colormap function: Amplitude (1 to 28) -> [violet -> purple -> cyan -> white]
    const getColor = (val: number): string => {
      const norm = Math.min(1.0, Math.max(0.0, (val - 4.0) / 22.0));
      if (norm < 0.25) {
        // Deep purple to violet
        const r = Math.round(30 + norm * 4 * 80);
        const g = Math.round(10 + norm * 4 * 20);
        const b = Math.round(60 + norm * 4 * 140);
        return `rgb(${r},${g},${b})`;
      } else if (norm < 0.65) {
        // Violet to cyan
        const t = (norm - 0.25) / 0.4;
        const r = Math.round(110 * (1 - t) + 6 * t);
        const g = Math.round(30 * (1 - t) + 182 * t);
        const b = Math.round(200 * (1 - t) + 212 * t);
        return `rgb(${r},${g},${b})`;
      } else {
        // Cyan to bright white
        const t = (norm - 0.65) / 0.35;
        const r = Math.round(6 + t * 249);
        const g = Math.round(182 + t * 73);
        const b = Math.round(212 + t * 43);
        return `rgb(${r},${g},${b})`;
      }
    };

    // Draw Waterfall Heatmap
    for (let t = 0; t < history.length; t++) {
      const frame = history[t];
      const x = t * cellWidth;

      for (let k = 0; k < numSubcarriers; k++) {
        // Invert Y so subcarrier 0 is at bottom, 63 at top
        const y = (numSubcarriers - 1 - k) * cellHeight;
        ctx.fillStyle = getColor(frame[k]);
        ctx.fillRect(x, y, cellWidth + 0.6, cellHeight + 0.6);
      }
    }

    // Draw Grid Lines & Subcarrier Axis Markers
    ctx.strokeStyle = "#1e293b60";
    ctx.lineWidth = 1;
    [0, 16, 32, 48, 63].forEach((k) => {
      const y = (numSubcarriers - 1 - k) * cellHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.font = "8px monospace";
      ctx.fillText(`SC ${k}`, 4, y - 2);
    });

    // Bottom Axis & Stats bar
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, height - 26, width, 26);
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(0, height - 26);
    ctx.lineTo(width, height - 26);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.fillText("TIME STREAM (10 Hz)", 10, height - 9);

    ctx.fillStyle = "#06b6d4";
    ctx.fillText(`CSI VAR: ${csiVariance.toFixed(2)}`, width - 180, height - 9);

    ctx.fillStyle = "#a855f7";
    ctx.fillText("64 OFDM CHANNELS", width - 340, height - 9);
  }, [subcarrierAmplitudes, csiVariance]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-800 bg-[#05070d]">
      <canvas
        ref={canvasRef}
        width={720}
        height={240}
        className="w-full h-[240px] block"
      />

      {/* Header Badge */}
      <div className="absolute top-2.5 right-3 flex items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-800 text-[10px] font-mono">
        <span className="flex items-center gap-1.5 text-cyan-400 font-bold">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          OFDM 20MHz CSI Waterfall
        </span>
      </div>
    </div>
  );
}
