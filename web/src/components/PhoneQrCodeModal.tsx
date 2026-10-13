"use client";

import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import {
  QrCode,
  X,
  Smartphone,
  Apple,
  CheckCircle2,
  Copy,
  ExternalLink,
  ShieldCheck,
  Zap,
} from "lucide-react";

interface PhoneQrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPhoneConnected: boolean;
  phoneTag: string;
}

export function PhoneQrCodeModal({
  isOpen,
  onClose,
  isPhoneConnected,
  phoneTag,
}: PhoneQrCodeModalProps) {
  const [localIp, setLocalIp] = useState<string>("192.168.1.36");
  const [port, setPort] = useState<string>("3000");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  // Auto-detect browser hostname if accessible
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
        setLocalIp(hostname);
      }
      if (window.location.port) {
        setPort(window.location.port);
      }
    }
  }, []);

  const fullUrl = `http://${localIp}:${port}/mobile`;

  // Generate QR Code with high error correction and contrast
  useEffect(() => {
    QRCode.toDataURL(
      fullUrl,
      {
        width: 320,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
      },
      (err, url) => {
        if (!err && url) {
          setQrDataUrl(url);
        }
      }
    );
  }, [fullUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative flex flex-col gap-5 overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-300 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2">
                <span>CONNECT PHONE BEACON</span>
                <span className="text-[10px] font-sans px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  iOS &amp; Android
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Scan with iPhone Camera or Android to stream motion ground truth
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Status Pill */}
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono flex items-center justify-between border ${
            isPhoneConnected
              ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
              : "bg-slate-900 border-slate-800 text-slate-400"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isPhoneConnected ? "bg-emerald-400 animate-ping" : "bg-slate-600"
              }`}
            />
            <span>
              {isPhoneConnected
                ? `PHONE CONNECTED: ${phoneTag}`
                : "WAITING FOR DEVICE TO SCAN..."}
            </span>
          </div>
          {isPhoneConnected && (
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              ONLINE
            </span>
          )}
        </div>

        {/* QR Code Display & Quick Link */}
        <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-900/60 p-4 rounded-xl border border-slate-800/80">
          {/* QR Code Container */}
          <div className="bg-white p-3 rounded-xl shadow-lg flex-shrink-0">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Scan to open mobile telemetry"
                className="w-48 h-48 aspect-square rounded"
              />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center text-slate-400 font-mono text-xs">
                Generating QR...
              </div>
            )}
          </div>

          {/* Quick Instructions & URL */}
          <div className="flex flex-col gap-3 flex-1 text-xs font-mono">
            <div>
              <span className="text-slate-400 text-[11px] block mb-1">
                TARGET NETWORK URL:
              </span>
              <div className="flex items-center gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-800 text-slate-200">
                <span className="truncate flex-1 text-[11px] text-cyan-300">
                  {fullUrl}
                </span>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                  title="Copy URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
              {copied && (
                <span className="text-[10px] text-emerald-400 mt-1 block">
                  Copied to clipboard!
                </span>
              )}
            </div>

            {/* IP configuration helper */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-500">Wi-Fi IP:</span>
              <input
                type="text"
                value={localIp}
                onChange={(e) => setLocalIp(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-[11px] text-slate-200 font-mono w-32 focus:border-cyan-500 focus:outline-none"
                placeholder="192.168.x.x"
              />
            </div>

            <div className="text-[10px] text-slate-400 leading-relaxed">
              Make sure your phone is connected to the same Wi-Fi network as this computer.
            </div>
          </div>
        </div>

        {/* Operating System Specific Quick Guides */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* iOS Safari Guide */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold font-mono text-slate-200">
              <Apple className="w-4 h-4 text-purple-400" />
              <span>Apple iOS (iPhone / iPad)</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 font-sans leading-relaxed">
              <li>Open default <strong>Camera</strong> app.</li>
              <li>Point at the QR code and tap yellow <strong>Safari banner</strong>.</li>
              <li>Tap <strong>&ldquo;Authorize Sensors &amp; Begin Lab&rdquo;</strong>.</li>
              <li>When iOS asks <em>&ldquo;allow Motion &amp; Orientation&rdquo;</em>, tap <strong>Allow</strong>.</li>
            </ol>
          </div>

          {/* Android Guide */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold font-mono text-slate-200">
              <Smartphone className="w-4 h-4 text-cyan-400" />
              <span>Android (Chrome / Samsung)</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 font-sans leading-relaxed">
              <li>Open <strong>Camera</strong>, <strong>Lens</strong>, or Chrome.</li>
              <li>Scan the QR code and open the page.</li>
              <li>Sensors initialize automatically.</li>
              <li>Select movement mode (e.g. <em>Walking / Pocket</em>).</li>
            </ol>
          </div>
        </div>

        {/* Bottom Close Action */}
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-slate-200 transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
