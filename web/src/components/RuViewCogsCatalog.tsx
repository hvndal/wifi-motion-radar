"use client";

import React, { useState } from "react";
import {
  Heart,
  Shield,
  Building,
  Cpu,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Sliders,
  ExternalLink,
} from "lucide-react";
import { RuViewEdgeCog } from "@/utils/ruviewCore";

interface CogsCatalogProps {
  cogs: RuViewEdgeCog[];
}

export default function RuViewCogsCatalog({ cogs }: CogsCatalogProps) {
  const [selectedCategory, setSelectedCategory] = useState<
    "ALL" | "HEALTH" | "SECURITY" | "BUILDING" | "RESEARCH"
  >("ALL");

  // Simulated active toggle state for demoing module enabling/disabling
  const [enabledCogs, setEnabledCogs] = useState<Record<string, boolean>>({
    "cog-breathing-sync": true,
    "cog-vital-trend": true,
    "cog-fall-detect": true,
    "cog-intrusion": true,
    "cog-occupancy-zones": true,
    "cog-densepose-17": true,
  });

  const toggleCog = (id: string) => {
    setEnabledCogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredCogs =
    selectedCategory === "ALL"
      ? cogs
      : cogs.filter((c) => c.category === selectedCategory);

  return (
    <div className="space-y-4">
      {/* Category Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", "HEALTH", "SECURITY", "BUILDING", "RESEARCH"] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`py-1.5 px-3 rounded-xl text-xs font-mono font-semibold transition-all ${
              selectedCategory === cat
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
            }`}
          >
            {cat === "ALL" && "All Modules (105)"}
            {cat === "HEALTH" && "🫀 Health (14)"}
            {cat === "SECURITY" && "🔒 Security (14)"}
            {cat === "BUILDING" && "🏢 Building (11)"}
            {cat === "RESEARCH" && "🔬 Research (12)"}
          </button>
        ))}
      </div>

      {/* Grid of Cogs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredCogs.map((cog) => {
          const isEnabled = enabledCogs[cog.id] !== false;
          return (
            <div
              key={cog.id}
              className={`p-4 rounded-xl border backdrop-blur-md transition-all ${
                cog.status === "ALERT"
                  ? "bg-rose-950/40 border-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.15)]"
                  : isEnabled
                  ? "bg-slate-900/70 border-slate-800/90"
                  : "bg-slate-950/40 border-slate-900 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono tracking-wider px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                  {cog.category}
                </span>

                <button
                  onClick={() => toggleCog(cog.id)}
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded transition-all ${
                    isEnabled
                      ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {isEnabled ? "ONLINE" : "MUTED"}
                </button>
              </div>

              <h4 className="font-mono font-bold text-slate-200 text-sm flex items-center gap-1.5">
                {cog.name}
              </h4>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                {cog.description}
              </p>

              <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 text-[10px]">OUTPUT:</span>
                <span className="font-bold text-cyan-300">{cog.value}</span>
              </div>

              {cog.alertMessage && (
                <div className="mt-2 p-2 rounded-lg bg-rose-950/60 border border-rose-800/40 text-[10px] font-mono text-rose-300 font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{cog.alertMessage}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
