# 🤖 AGENT BRIEFING & EXECUTION PROTOCOL (ARGON / GEMINI AGENT)

Welcome Agent Argon. You are operating in **`lucid-babbage`** (GitHub: `hvndal/wifi-motion-radar`).
This repository is an **ESP32-driven Wi-Fi Motion Radar & Tactical Indoor Occupancy Sentinel**.

Read this file completely before writing code. This file guarantees zero context thrashing and 100% token efficiency.

---

## ⚡ 1. TL;DR — SYSTEM AT A GLANCE

```
┌─────────────────────────────────┐
│ Wi-Fi AP (Router TX)            │  Beacon Frames @ 2.4 GHz (Channel 8)
│ BSSID: d0:15:bb:01:f2:55        │  Transmitted at fixed EIRP power
└────────────────┬────────────────┘
                 │ (Microwave multipath disturbance caused by moving humans)
                 ▼
┌─────────────────────────────────┐
│ ESP32 Hardware (COM3)           │  Promiscuous sniffer + CSI callback
│ Firmware: ESP32_MotionSensor/   │  Computes RSSI rolling variance (20 pkts) & CSI
└────────────────┬────────────────┘
                 │ 115200 baud UART (JSON strings @ 10 Hz)
                 ▼
┌─────────────────────────────────┐
│ Python Bridge (serial_bridge.py)│  Auto-scans COM3, validates JSON,
│                                 │  POSTs to http://localhost:3000/api/esp32
└────────────────┬────────────────┘
                 │ HTTP POST @ 10 Hz
                 ▼
┌─────────────────────────────────┐
│ Next.js 16 HUD (web/)           │  In-memory API (/api/esp32) + Tactical Radar UI
│                                 │  - CoD UAV Radar (UavTacticalRadar.tsx)
│                                 │  - Occupancy Sentinel (SimpleMotionView.tsx)
│                                 │  - 64-OFDM CSI Spectrogram (CsiSpectrogramCanvas.tsx)
└─────────────────────────────────┘
```

---

## 🧭 2. DIRECTORY STRUCTURE & FILE ROLES

| Path | Language / Stack | Purpose & Role |
| :--- | :--- | :--- |
| `ESP32_MotionSensor/MotionDetectionESP32.ino` | C++ / Arduino / ESP-IDF | Promiscuous RX frame filter (`0x80` Beacons), CSI OFDM callback, variance calculus, 10Hz serial stream. |
| `ESP32_MotionSensor/platformio.ini` | PlatformIO Config | Target: `esp32dev`, platform `espressif32`, baud `115200`. |
| `ESP32_MotionSensor/credentials.h` | C++ Header (Gitignored) | Real local Wi-Fi SSID, password, target BSSID, channel. |
| `ESP32_MotionSensor/credentials.h.example` | C++ Header (Tracked) | Safe template with placeholders for public git. |
| `serial_bridge.py` | Python 3.10+ (`pyserial`, `requests`) | Host daemon reading UART, retrying COM port locks, pushing telemetry to web server. |
| `web/src/app/api/esp32/route.ts` | Next.js Route Handler | In-memory atomic telemetry store (`GET` client polling / `POST` bridge ingest). |
| `web/src/app/api/phone-telemetry/route.ts` | Next.js Route Handler | Mobile sensor telemetry endpoint (optional phone accelerometer fusion). |
| `web/src/components/UavTacticalRadar.tsx` | React / Canvas / Lucide | CoD UAV Polar Radar, Log-Distance Path Loss model, 1st Fresnel Zone ellipse rendering. |
| `web/src/components/SimpleMotionView.tsx` | React / Tailwind | Occupancy Sentinel: Subcarrier Phase Decorrelation ($\sigma^2_\Delta$) + Leaky Bucket CUSUM. |
| `web/src/components/CsiSpectrogramCanvas.tsx`| React / HTML5 Canvas | Real-time 64-OFDM subcarrier waterfall heatmap. |
| `web/src/components/Room3DVisualizer.tsx` | React / Three.js | Isometric room view with live RF reflection vectors. |
| `web/src/utils/predictiveModels.ts` | TypeScript | Signal smoothing, Holt-Winters exponential trend, noise gating. |
| `web/src/utils/ruviewCore.ts` | TypeScript | OFDM amplitude subband clustering & respiratory micro-Doppler filters. |
| `LLM_ARCHITECTURE.md` | Markdown | Deep math theory (Fresnel radii, log-distance formula, CUSUM derivation). |
| `PROJECT_ROADMAP.md` | Markdown | Active task backlog, milestones, and implementation phases. |

---

## 🔒 3. SECURITY & CREDENTIAL PROTOCOL

> [!CAUTION]
> **NEVER COMMIT PRIVATE WI-FI CREDENTIALS OR PASSWORDS TO GIT!**
> - The user's SSID (`GAGAN HUNDAL_4G`) and password (`Harman1973`) are stored in `ESP32_MotionSensor/credentials.h` which is strictly gitignored.
> - `MotionDetectionESP32.ino` uses `#if __has_include("credentials.h")` to fall back to safe placeholders when compiled on clean public clones.
> - Always run `git diff --cached` before committing to verify zero credential leakage.

---

## ⚙️ 4. HOW TO RUN & VERIFY THE SYSTEM

### Step 1: Serial Bridge Daemon
In PowerShell:
```powershell
# Using Python 3.14 / py:
python serial_bridge.py
```
*Expected log:* `[BRIDGE] ESP32 found on COM3. Connected!` followed by streaming 10 Hz HTTP 200 responses.

### Step 2: Web Server
In `web/`:
```powershell
npm run dev
# or for production:
npm run build; npm run start -- -p 3000
```
Open [http://localhost:3000](http://localhost:3000).

### Step 3: Quick Terminal Health Checks
```powershell
# Test COM3 raw serial feed:
python -c "import serial; s=serial.Serial('COM3', 115200, timeout=2); print(s.readline().decode()); s.close()"

# Test local API response:
curl http://localhost:3000/api/esp32
```

---

## 📐 5. MATHEMATICAL CONSTANTS & DETECTION FORMULAS

### Log-Distance Path Loss (Distance from ESP32 to Router):
$$d = 10^{\frac{|RSSI| - A}{10 \cdot n}}$$
- $A = -42\text{ dBm}$ (reference RSSI @ 1 meter from target AP).
- $n = 2.4$ (indoor residential path loss exponent).
- Distance $d$ is clamped in UI between `1.0m` and `14.0m`.

### 1st Fresnel Zone Ellipse Radius (Semi-minor axis $b$):
$$r_1 = \sqrt{\frac{\lambda \cdot d}{4}} \approx \sqrt{\frac{0.125 \cdot d}{4}} \text{ (meters for 2.4 GHz)}$$

### Subcarrier Phase Decorrelation ($\sigma^2_\Delta$):
$$\sigma^2_\Delta = \text{Variance of } |S_{k} - S_{k-1}| \quad (k \in [1..63])$$
- Quiet room: $\sigma^2_\Delta < 0.8$
- Single person moving: $0.8 \le \sigma^2_\Delta < 2.5$
- Multi-person movement: $\sigma^2_\Delta \ge 2.5$

### Leaky Bucket CUSUM:
$$S_t = \max(0, S_{t-1} + (\text{variance} - \text{baseline}) - \text{leakRate})$$
- Default alert threshold: $S_t \ge 60\%$

---

## 🎯 6. IMMEDIATE WORKFLOW GUIDELINES FOR AGENT ARGON
1. **Always check `git status` first** to ensure clean working tree.
2. **Consult `PROJECT_ROADMAP.md`** before picking up new tasks or refactoring components.
3. **Keep code modular**: UI components in `web/src/components/`, math logic in `web/src/utils/`, firmware code in `ESP32_MotionSensor/`.
4. **Verify builds after frontend changes** with `npm run build` in `web/` to prevent React/TypeScript runtime crashes.
