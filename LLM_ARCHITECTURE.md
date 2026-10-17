# 🛰️ SYSTEM ARCHITECTURE & DEVELOPER HANDBOOK (FOR LLMs & ENGINEERS)

> **Quick Context for Incoming LLMs:**  
> This document is designed to give you instant, token-efficient understanding of the entire repository, data formats, hardware links, algorithms, and roadmap without having to read hundreds of source lines.

---

## 1. High-Level Summary
This project turns standard 2.4 GHz Wi-Fi beacon packets into an **indoor device-free motion radar & occupancy sentinel**:
1. An **ESP32** (connected via USB to the host computer) enters promiscuous packet-sniffing mode on a designated Wi-Fi channel (Channel 8).
2. It passively intercepts 802.11 management frames (Beacons) transmitted at fixed power by a physical Wi-Fi router (`TARGET_BSSID: d0:15:bb:01:f2:55`).
3. It extracts **RSSI** across a rolling window of 20 frames and **CSI (Channel State Information)** OFDM subcarrier amplitudes.
4. Human movement inside the **1st Fresnel Zone** between the router and the ESP32 disturbs the RF multipath field, generating distinct variance ($\sigma^2$) and phase decorrelation ($\sigma^2_\Delta$).
5. A Python daemon reads serial telemetry at 115200 baud and POSTs JSON packets to a local Next.js API at 10 Hz.
6. The Next.js frontend renders a **Call of Duty style UAV Tactical Mini-Radar** and a **Multi-Person Occupancy Guard**.

---

## 2. Directory Layout & File Responsibilities

```
lucid-babbage/
├── ESP32_MotionSensor/               # Embedded Firmware (PlatformIO & Arduino IDE compatible)
│   ├── MotionDetectionESP32.ino      # Main firmware: Promiscuous RX + CSI callback + Serial streaming
│   ├── platformio.ini                # PlatformIO build definition (env: esp32dev, framework: arduino)
│   ├── credentials.h.example         # Template for Wi-Fi SSID, password, BSSID, and Channel
│   └── credentials.h                 # (Gitignored) User's local hardware configuration
│
├── serial_bridge.py                  # Host Serial Bridge
│   │                                 # Auto-scans COM ports for ESP32, parses JSON telemetry,
│   │                                 # and POSTs at 10 Hz to http://localhost:3000/api/esp32
│
├── web/                              # Next.js 16 (App Router) Tactical HUD
│   ├── src/app/
│   │   ├── page.tsx                  # Main Dashboard: coordinates metrics, radar, charts, and sentinel
│   │   ├── api/esp32/route.ts        # In-memory telemetry buffer (GET / POST)
│   │   └── api/phone-telemetry/route.ts # Mobile accelerometer bridge (GET / POST)
│   ├── src/components/
│   │   ├── UavTacticalRadar.tsx      # Polar Radar: plots ESP32 at center, Router at distance, Fresnel ellipse
│   │   ├── SimpleMotionView.tsx      # Occupancy Sentinel: CUSUM persistence, multi-body decorrelation
│   │   ├── CsiSpectrogramCanvas.tsx  # 64-OFDM subcarrier waterfall spectrogram
│   │   ├── Room3DVisualizer.tsx      # Three.js 3D isometric room occupancy visualizer
│   │   ├── RuViewVitalsWidget.tsx    # Vital signs / chest expansion micro-Doppler tracker
│   │   └── LabSignalChart.tsx        # High-speed time-series line chart of RSSI & variance
│   └── src/utils/
│       ├── predictiveModels.ts       # Signal smoothing & predictive math
│       └── ruviewCore.ts             # CSI amplitude parsing & subcarrier clustering
│
├── README.md                         # Public GitHub README
└── LLM_ARCHITECTURE.md               # THIS FILE: Ground-truth reference for future LLMs
```

---

## 3. Data Flow & Interface Contracts

### A. ESP32 Serial Output (115200 Baud, 10 Hz JSON)
```json
{
  "motion": false,
  "rssi": -65,
  "variance": 0.42,
  "csiVariance": 0.85,
  "triggers": 14,
  "locked": true,
  "beacons": 894,
  "subcarriers": [12, 14, 18, 15, ...]  // 64 raw OFDM amplitude values
}
```

### B. Next.js In-Memory API (`/api/esp32`)
- **`POST /api/esp32`**: Sent by `serial_bridge.py`. Overwrites global in-memory state and calculates timestamps.
- **`GET /api/esp32`**: Polled by client components at ~10 Hz (every 100ms) or via SSE/SWR.
- **Payload Shape:**
  ```typescript
  export interface Esp32Telemetry {
    connected: boolean;
    motion: boolean;
    rssi: number;
    variance: number;
    csiVariance: number;
    triggers: number;
    locked: boolean;
    beacons: number;
    subcarriers?: number[];
    timestamp: number;
  }
  ```

---

## 4. Key Mathematical Models Implemented

### 1. Dynamic Distance (Log-Distance Path Loss Model)
Located in [`UavTacticalRadar.tsx`](file:///c:/Users/herma/Documents/antigravity/lucid-babbage/web/src/components/UavTacticalRadar.tsx):
$$d = 10^{\frac{|RSSI| - A}{10 \cdot n}}$$
- $A = -42\text{ dBm}$ (measured reference RSSI at 1 meter).
- $n = 2.4$ (indoor wall/obstacle path loss exponent).
- Distance is clamped between $1.0\text{ m}$ and $14.0\text{ m}$ to prevent polar radar overflow.

### 2. The 1st Fresnel Zone Microwave Ellipse
- **Foci:** ESP32 Receiver $(0, 0)$ and Router Transmitter $(x_{\text{tx}}, y_{\text{tx}})$.
- **Center:** Midpoint $(\frac{x_{\text{tx}}}{2}, \frac{y_{\text{tx}}}{2})$.
- **Major Radius ($a$):** $\frac{d}{2} \cdot \text{scale}$.
- **Minor Radius ($b$ / First Fresnel Radius):**
  $$r_1 = \sqrt{\frac{\lambda \cdot d}{4}} \approx \sqrt{\frac{0.125 \cdot d}{4}} \text{ meters}$$
  *(For 2.4 GHz, $\lambda \approx 0.125\text{ m}$)*.
- Any human passing within this ellipse causes significant destructive/constructive multi-path interference.

### 3. Multi-Person Occupancy & Phase Decorrelation ($\sigma^2_\Delta$)
Located in [`SimpleMotionView.tsx`](file:///c:/Users/herma/Documents/antigravity/lucid-babbage/web/src/components/SimpleMotionView.tsx):
- **Subcarrier Decorrelation:**
  $$\sigma^2_\Delta = \text{Variance of adjacent subcarrier amplitude differences } (|S_{k} - S_{k-1}|)$$
- Single person breathing/typing $\implies$ Low-frequency global shift, low $\sigma^2_\Delta$.
- Multiple independent human bodies moving $\implies$ High $\sigma^2_\Delta$ across disparate OFDM subcarriers.
- **Leaky Bucket CUSUM:**
  Accumulates $S_t = \max(0, S_{t-1} + (\text{variance} - \text{baseline}) - \text{leakRate})$.
  Triggers room occupancy confirmation only when persistence reaches $60\%$.

### 4. Stationary Human Mapping (Respiratory Micro-Doppler + Static Residual)
Located in [`predictiveModels.ts`](file:///c:/Users/herma/Documents/antigravity/lucid-babbage/web/src/utils/predictiveModels.ts):
- Standard variance radars lose track of humans as soon as they sit still ($\sigma^2_{\text{RSSI}} \to 0$).
- **Static Multipath Residual ($D_{\text{static}}$):** Compares live active OFDM subcarriers ($k \in [6..31, 33..58]$) against the calibrated empty-room profile $\mathbf{H}_{\text{empty}}$:
  $$D_{\text{static}}(t) = \frac{1}{52}\sum_{k} \left| |H_k(t)| - |H_k^{\text{empty}}| \right|$$
- **Respiratory Bandpass ($0.15\text{–}0.45\text{ Hz}$):** Applies a 2nd-order Butterworth bandpass filter (`10 Hz` sampling) across the Top-8 most sensitive subcarriers to isolate chest expansion (`10–26 BPM`), keeping **`PERSON X [STILL]`** locked on the radar.

### 5. Multi-Signal Decomposition (`PERSON X / SIGNAL X`, `PERSON Y / SIGNAL Y`, & `PET`)
Located in [`predictiveModels.ts`](file:///c:/Users/herma/Documents/antigravity/lucid-babbage/web/src/utils/predictiveModels.ts) and [`UavTacticalRadar.tsx`](file:///c:/Users/herma/Documents/antigravity/lucid-babbage/web/src/components/UavTacticalRadar.tsx):
- Splits the 20 MHz 802.11n channel into **Lower Sub-Band (`SC 6..31`)** and **Upper Sub-Band (`SC 33..58`)** to track two independent spatial scatterers (`PERSON X` and `PERSON Y`).
- **Front Desk vs. Back Router Disambiguation:** Default router placement is **`270° (BACK / SOUTH)`**. Direct corridor occlusion causes a negative RSSI drop ($\Delta\text{RSSI} < -1.1\text{ dB}$) along `270°`, whereas sitting at the desk in front of the ESP32 (`90° NORTH`) creates high CSI backscatter reflection with minimal RSSI drop.
- **Pet / Low-Mass Filtering:** High-frequency CSI ripple with low total Radar Cross Section ($\text{RCS}$) and low RSSI shadow is tagged as **`PET (SIG X/Y)`** and excluded from the human headcount inside the user-selected radio radius (`3m`, `5m`, `8m`, `12m`).

---

## 5. Development & Running State

### Active Processes in Local Dev Environment:
1. **Serial Bridge:**
   - Command: `python serial_bridge.py`
   - Port: Auto-detects ESP32 (typically `COM3` on Windows).
2. **Next.js Web UI:**
   - Port: `http://localhost:3000` (and `http://192.168.1.36:3000` on LAN).
   - Build mode: `next start` or `next dev`.

### Quick Health-Check Commands:
```powershell
# 1. Verify ESP32 is streaming over COM3:
python -c "import serial; s=serial.Serial('COM3', 115200, timeout=2); print(s.readline().decode()); s.close()"

# 2. Verify API receives telemetry:
curl.exe -s http://localhost:3000/api/esp32

# 3. Check Git branch:
git status
```

---

## 6. Known Boundaries & Immediate Opportunities
- **Hardware Bearing:** A single ESP32 receiver only measures scalar RSSI/CSI; it cannot physically deduce continuous 360° angle-of-arrival (AoA) without an antenna array, though it disambiguates Front Backscatter (`90° N`) vs. Back Fresnel Occlusion (`270° S`).
- **Multi-Node Expansion:** Adding a 2nd ESP32 creates a bistatic/trilateration mesh, enabling exact $(X, Y)$ cartesian coordinate triangulation of moving bodies.
- **CSI Phase Extraction:** ESP-IDF supports raw I/Q phase vectors. Future upgrades can enable Doppler spectrum filtering using FFT on raw subcarriers.

