# 🛰️ Wi-Fi Motion & Occupancy Radar Lab

An experimental indoor human motion detection and occupancy surveillance system powered by an **ESP32**, **Wi-Fi RF disturbances (RSSI + Channel State Estimation)**, and a **Next.js tactical HUD**.

---

## ⚡ Overview

When a human body enters a room, it reflects, absorbs, and scatters 2.4 GHz microwave Wi-Fi signals. By analyzing high-frequency fluctuations across Wi-Fi beacon frames between an Access Point (Router) and an ESP32 station:
- **Phase Variance & Decorrelation ($\sigma^2_\Delta$)** exposes multi-path scattering caused by chest movements and walking.
- **Log-Distance Path Loss Model** computes dynamic geometric distance between the ESP32 receiver and the transmitting router.
- **Leaky Bucket CUSUM Filter** rejects spurious radio glitches and triggers true room occupancy alerts.

---

## 🧱 Architecture

```
┌─────────────────┐       2.4 GHz RF Beacons      ┌─────────────────────────┐
│ Wi-Fi Router TX │ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ > │ ESP32 Microcontroller  │
│ (Target AP)     │       (Fresnel Scattering)    │ (Promiscuous Sniffer)   │
└─────────────────┘                               └───────────┬─────────────┘
                                                              │ 115200 Baud Serial
                                                              ▼
                                                   ┌─────────────────────────┐
                                                   │ Python Serial Bridge    │
                                                   │ (serial_bridge.py)      │
                                                   └───────────┬─────────────┘
                                                              │ HTTP POST (10 Hz)
                                                              ▼
                                                   ┌─────────────────────────┐
                                                   │ Next.js Tactical HUD    │
                                                   │ - CoD Tactical UAV Radar│
                                                   │ - Occupancy Sentinel    │
                                                   │ - Subcarrier CSI Heatmap│
                                                   └─────────────────────────┘
```

---

## 🚀 Features

- **CoD Tactical UAV Mini-Radar:**
  - Real-time polar display plotting the physical ESP32 receiver at center and Wi-Fi Router at calibrated path-loss distance.
  - Interactive **Fresnel Zone Ellipse** visualizing the direct line-of-sight microwave multipath zone.
  - Bearing calibration compass (N/E/S/W) with smooth radial sweeping scanline.
- **Multi-Person Occupancy Guard:**
  - Subcarrier Phase Decorrelation metric separating single-person micro-movements from multi-body scattering.
  - Persistent CUSUM integration with configurable alert thresholds (1 vs 2+ occupants).
- **Zero Cloud Dependencies:**
  - Completely local data pipeline via high-speed serial bridge streaming into an embedded in-memory Next.js route handler.

---

## 🛠️ Hardware Requirements

1. **ESP32 Development Board** (ESP32-WROOM-32 or similar).
2. **Micro-USB / USB-C Cable** with data lines (CP2102 or CH340 chip).
3. Any standard **2.4 GHz Wi-Fi Router or Mobile Hotspot**.

---

## 🔧 Setup & Installation

### 1. Flash the ESP32 Firmware

1. Open `ESP32_MotionSensor/` in VS Code with [PlatformIO](https://platformio.org/) or Arduino IDE.
2. Copy the credentials template:
   ```bash
   cp ESP32_MotionSensor/credentials.h.example ESP32_MotionSensor/credentials.h
   ```
3. Edit `credentials.h` with your Wi-Fi SSID, password, channel, and router BSSID.
4. Connect your ESP32 to your computer via USB and upload the firmware.

### 2. Start the Serial Bridge

The bridge auto-detects your ESP32 serial port (e.g. `COM3` on Windows or `/dev/ttyUSB0` on Linux) and relays metrics to the web UI at 10 Hz:

```bash
# Install Python dependencies
pip install pyserial requests

# Start the bridge
python serial_bridge.py
```

### 3. Launch the Web Interface

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📐 Detection Theory

- **RSSI Variance ($\sigma^2$):** Calculated over a rolling 20-packet sample window of raw 802.11 beacons. In static empty rooms, variance hovers between `0.05 - 0.2 dB²`. Human movement in the 1st Fresnel zone induces spikes from `0.6 to 4.0+ dB²`.
- **Log-Distance Model:**
  $$d = 10^{\frac{|RSSI| - A}{10 \cdot n}}$$
  Where $A = -42 \text{ dBm}$ (1-meter reference RSSI) and $n = 2.4$ (indoor path loss exponent).

---

## 📄 License

MIT License. Free to use, modify, and build upon.
