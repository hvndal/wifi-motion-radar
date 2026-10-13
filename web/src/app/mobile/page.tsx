"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Smartphone,
  Activity,
  Compass,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Radio,
  Send,
  Zap,
  Apple,
  ShieldCheck,
  Hand,
  Vibrate,
} from "lucide-react";

export default function MobileSensorClient() {
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamCount, setStreamCount] = useState<number>(0);
  const [currentActivity, setCurrentActivity] = useState<string>("STILL_DESK");
  const [sensorStatusMsg, setSensorStatusMsg] = useState<string>("");
  const [isTouchEmulating, setIsTouchEmulating] = useState<boolean>(false);

  // Phone Sensor State
  const [accel, setAccel] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [gyro, setGyro] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [orient, setOrient] = useState<{ alpha: number; beta: number; gamma: number }>({
    alpha: 0,
    beta: 0,
    gamma: 0,
  });
  const [magnitude, setMagnitude] = useState<number>(0);

  const accelRef = useRef(accel);
  const gyroRef = useRef(gyro);
  const orientRef = useRef(orient);
  const activityRef = useRef(currentActivity);

  accelRef.current = accel;
  gyroRef.current = gyro;
  orientRef.current = orient;
  activityRef.current = currentActivity;

  // Detect iOS platform on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const ua = navigator.userAgent;
      const isApple =
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIsIOS(isApple);
    }
  }, []);

  const startListening = useCallback(() => {
    let receivedHardwareEvent = false;

    // 1. Accelerometer & Gyroscope
    const onMotion = (e: DeviceMotionEvent) => {
      receivedHardwareEvent = true;
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (a) {
        const ax = a.x || 0;
        const ay = a.y || 0;
        const az = a.z || 0;
        const mag = Math.sqrt(ax * ax + ay * ay + az * az);
        setAccel({
          x: parseFloat(ax.toFixed(2)),
          y: parseFloat(ay.toFixed(2)),
          z: parseFloat(az.toFixed(2)),
        });
        setMagnitude(parseFloat(mag.toFixed(2)));
      }

      const r = e.rotationRate;
      if (r) {
        setGyro({
          x: parseFloat((r.alpha || 0).toFixed(2)),
          y: parseFloat((r.beta || 0).toFixed(2)),
          z: parseFloat((r.gamma || 0).toFixed(2)),
        });
      }
    };

    // 2. Device Orientation
    const onOrientation = (e: DeviceOrientationEvent) => {
      setOrient({
        alpha: parseFloat((e.alpha || 0).toFixed(1)),
        beta: parseFloat((e.beta || 0).toFixed(1)),
        gamma: parseFloat((e.gamma || 0).toFixed(1)),
      });
    };

    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);

    // Watchdog: If iOS Safari blocks hardware devicemotion over plain HTTP, offer touch emulation
    setTimeout(() => {
      if (!receivedHardwareEvent && isIOS) {
        setSensorStatusMsg(
          "iOS Note: Safari may restrict native motion sensors over HTTP. Kinetic Touch mode enabled as fallback!"
        );
        setIsTouchEmulating(true);
      }
    }, 2000);
  }, [isIOS]);

  // Request Permissions for Sensors (iOS 13+ & Android)
  const handleRequestPermission = async () => {
    try {
      // 1. iOS DeviceMotionEvent permission
      if (
        typeof DeviceMotionEvent !== "undefined" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (DeviceMotionEvent as any).requestPermission === "function"
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const motionPerm = await (DeviceMotionEvent as any).requestPermission();
        if (motionPerm !== "granted") {
          alert("iOS Sensor access denied. Enabling Kinetic Touch mode.");
          setIsTouchEmulating(true);
        }
      }

      // 2. iOS DeviceOrientationEvent permission
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (DeviceOrientationEvent as any).requestPermission === "function"
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (DeviceOrientationEvent as any).requestPermission();
      }

      setPermissionGranted(true);
      startListening();
      if (navigator.vibrate) navigator.vibrate(50);
    } catch (err) {
      console.warn("Sensor permission notice:", err);
      // Fallback for iOS when blocked over HTTP
      setPermissionGranted(true);
      setIsTouchEmulating(true);
      startListening();
    }
  };

  // Kinetic Touch Simulator for iOS fallback (Swiping or tapping simulates walking/movement)
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const speed = Math.abs(touch.clientX % 10 - 5) + Math.abs(touch.clientY % 10 - 5);
      const simulatedMag = 9.81 + speed * 1.5;
      setAccel({
        x: parseFloat(((touch.clientX % 20) - 10).toFixed(2)),
        y: parseFloat(((touch.clientY % 20) - 10).toFixed(2)),
        z: 9.81,
      });
      setMagnitude(parseFloat(simulatedMag.toFixed(2)));
    }
  };

  // Telemetry Transmission Loop (Streams to Dashboard via Local API)
  useEffect(() => {
    if (!permissionGranted) return;
    setIsStreaming(true);

    const interval = setInterval(async () => {
      const payload = {
        timestamp: Date.now(),
        activityLabel: activityRef.current,
        accel: accelRef.current,
        gyro: gyroRef.current,
        orientation: orientRef.current,
        magnitude: Math.sqrt(
          accelRef.current.x * accelRef.current.x +
            accelRef.current.y * accelRef.current.y +
            accelRef.current.z * accelRef.current.z
        ),
      };

      try {
        await fetch("/api/phone-telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setStreamCount((prev) => prev + 1);
      } catch {
        // Offline or buffering
      }
    }, 100); // 10 Hz telemetry stream

    return () => clearInterval(interval);
  }, [permissionGranted]);

  return (
    <div
      onTouchMove={handleTouchMove}
      className="min-h-screen bg-[#07090e] text-slate-100 p-4 max-w-md mx-auto flex flex-col font-sans select-none"
    >
      {/* Top Header */}
      <header className="pb-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-500/40 text-purple-400 flex items-center justify-center">
            {isIOS ? <Apple className="w-5 h-5 text-purple-300" /> : <Smartphone className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wide text-slate-100 flex items-center gap-1.5">
              <span>Inertial Sensor Co-Pilot</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40 font-mono">
                {isIOS ? "APPLE iOS" : "ANDROID"}
              </span>
            </h1>
            <p className="text-[11px] text-slate-400 font-mono">
              Dual-Engine Sensor Fusion &bull; Gyro + Accel
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <span
            className={`w-2 h-2 rounded-full ${
              isStreaming ? "bg-cyan-400 animate-ping" : "bg-slate-600"
            }`}
          />
          <span className={isStreaming ? "text-cyan-400 font-bold" : "text-slate-500"}>
            {isStreaming ? `${streamCount} pkts` : "STANDBY"}
          </span>
        </div>
      </header>

      {/* Sensor Permission / Connect Card */}
      {!permissionGranted ? (
        <div className="my-6 p-5 rounded-2xl bg-gradient-to-b from-purple-950/30 to-slate-900 border border-purple-500/30 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              {isIOS ? "Authorize iPhone Motion Sensors" : "Sensor Permission Required"}
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {isIOS
                ? "Tap below to grant iOS Safari motion permission. This streams your iPhone's gyroscope and accelerometer to the dashboard to cross-verify physical footsteps."
                : "Authorizes real-time capture of Accelerometer and Gyroscope. The dashboard fuses phone inertial data with ESP32 Wi-Fi disturbances to eliminate false alarms and confirm real human movement."}
            </p>
          </div>
          <button
            onClick={handleRequestPermission}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-purple-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Authorize Sensors &amp; Begin Fusion</span>
          </button>
        </div>
      ) : (
        <div className="my-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex items-center justify-between text-xs font-mono">
          <span className="text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Stream Active (10 Hz &bull; UAV Synced)</span>
          </span>
          <span className="text-emerald-400 font-bold">ONLINE</span>
        </div>
      )}

      {/* Status Warning / Fallback Notice */}
      {sensorStatusMsg && (
        <div className="p-3 mb-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-[11px] font-mono text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
          <span>{sensorStatusMsg}</span>
        </div>
      )}

      {/* Kinetic Touch / Shake Pad for iPhone */}
      {isTouchEmulating && (
        <div className="mb-4 p-4 rounded-xl bg-purple-950/30 border border-purple-500/40 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs font-mono font-bold text-purple-300">
            <Hand className="w-4 h-4 text-purple-400" />
            <span>KINETIC MOTION PAD (iOS HTTP FALLBACK)</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Swipe or tap in this area while walking to inject kinetic inertial force into the UAV radar!
          </p>
          <div
            onTouchMove={handleTouchMove}
            className="h-16 rounded-lg bg-purple-900/40 border border-dashed border-purple-500/50 flex items-center justify-center text-xs font-mono text-purple-200"
          >
            &sim; SWIPE / TAP TO GENERATE FORCE &sim;
          </div>
        </div>
      )}

      {/* Sensor Fusion Context Selector */}
      <div className="my-2">
        <label className="text-[11px] font-mono text-slate-400 block mb-1.5 uppercase">
          Active Phone Position (Fusion Context):
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          {[
            { id: "STILL_DESK", label: "Resting on Desk", desc: "Filters noise", color: "border-slate-700 bg-slate-900" },
            { id: "STILL_HAND", label: "Held in Hand", desc: "Micro-tremor", color: "border-purple-800 bg-purple-950/40" },
            { id: "WALKING_POCKET", label: "Pocket (Walking)", desc: "Step impulse", color: "border-cyan-800 bg-cyan-950/40" },
            { id: "WALKING_HAND", label: "Hand (Walking)", desc: "Active swing", color: "border-cyan-800 bg-cyan-950/40" },
            { id: "SITTING_GESTURE", label: "Desk Gesturing", desc: "Upper body", color: "border-amber-800 bg-amber-950/40" },
            { id: "EMPTY_ROOM", label: "Room Empty", desc: "Calibrate zero", color: "border-emerald-800 bg-emerald-950/40" },
          ].map((act) => (
            <button
              key={act.id}
              onClick={() => {
                setCurrentActivity(act.id);
                if (navigator.vibrate) navigator.vibrate(30);
              }}
              className={`py-2 px-2.5 rounded-xl border text-left transition-all ${
                currentActivity === act.id
                  ? "border-cyan-400 bg-cyan-950/70 text-cyan-200 shadow-md shadow-cyan-500/20 font-bold"
                  : `${act.color} text-slate-400 hover:text-slate-200`
              }`}
            >
              <div className="text-[10px] text-slate-500 uppercase">{act.desc}</div>
              <div>{act.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Live Sensor Telemetry HUD */}
      <div className="space-y-3 my-4 flex-1">
        {/* Accelerometer */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 font-mono">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-purple-400 font-bold">
              <Activity className="w-3.5 h-3.5" />
              ACCELEROMETER (m/s&sup2;)
            </span>
            <span className="text-slate-200 font-bold">Mag: {magnitude}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">AX</span>
              <span className="text-purple-300 font-bold">{accel.x}</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">AY</span>
              <span className="text-purple-300 font-bold">{accel.y}</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">AZ</span>
              <span className="text-purple-300 font-bold">{accel.z}</span>
            </div>
          </div>
        </div>

        {/* Gyroscope */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 font-mono">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-400 font-bold">
              <Compass className="w-3.5 h-3.5" />
              GYROSCOPE (&deg;/s)
            </span>
            <span className="text-slate-400 text-[10px]">Rotational Velocity</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">&omega;X</span>
              <span className="text-cyan-300 font-bold">{gyro.x}</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">&omega;Y</span>
              <span className="text-cyan-300 font-bold">{gyro.y}</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">&omega;Z</span>
              <span className="text-cyan-300 font-bold">{gyro.z}</span>
            </div>
          </div>
        </div>

        {/* Orientation */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 font-mono">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-slate-300 font-bold">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              DEVICE ORIENTATION (&deg;)
            </span>
            <span className="text-slate-400 text-[10px]">Tilt Angles</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">ALPHA</span>
              <span className="text-slate-200 font-bold">{orient.alpha}&deg;</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">BETA</span>
              <span className="text-slate-200 font-bold">{orient.beta}&deg;</span>
            </div>
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
              <span className="text-[9px] text-slate-500 block">GAMMA</span>
              <span className="text-slate-200 font-bold">{orient.gamma}&deg;</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 font-mono text-center">
        <span>Zero-Cost Wi-Fi &amp; Motion Sensing Lab</span>
        <span className="mx-2">&bull;</span>
        <span>iOS &amp; Android Friendly Node</span>
      </footer>
    </div>
  );
}
