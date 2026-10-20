# 🗺️ PROJECT ROADMAP & TASK BACKLOG

This document tracks active development phases, prioritized tasks, and implementation status for the **Wi-Fi Motion Radar & Tactical Sentinel** project.

---

## 📊 MILESTONE STATUS OVERVIEW

| Phase | Description | Status | Completion |
| :--- | :--- | :---: | :---: |
| **Phase 1: Foundation** | Hardware firmware, Promiscuous RX, CSI callback, Serial bridge | ✅ COMPLETE | 100% |
| **Phase 2: Tactical HUD** | CoD UAV Polar Radar, Log-Distance model, Fresnel Zone ellipse | ✅ COMPLETE | 100% |
| **Phase 3: Occupancy Intelligence** | Subcarrier Decorrelation, CUSUM persistence, multi-person limit | ✅ COMPLETE | 100% |
| **Phase 4: Multi-Signal Decomposition & Radius** | Signal X & Signal Y sub-band pointers, Pet separation, Back (270°) router & radius selector | ✅ COMPLETE | 100% |
| **Phase 5: Respiration & Micro-Doppler** | 0.15–0.45 Hz Butterworth bandpass + Static CSI Residual for stationary humans | ✅ COMPLETE | 100% |
| **Phase 6: Audio & Webhooks Alerting** | Browser Web Audio SFX (UAV radar sweep blip, intruder siren) & Webhook alerts | ✅ COMPLETE | 100% |
| **Phase 7: Kinetic Decibel Meter (`dB-RF`) App** | Consumer Frontend App: `0–100 dB-RF` Kinetic Volume Meter + Browser Mic `dBA` Fusion ($0 Hardware) | 🟡 NEXT UP | 0% |
| **Phase 8: Hardware Super-Puck Expansion (Later)** | Optional \$1–\$4 GPIO add-ons (`INMP441` I2S Mic, `HLK-LD2410C` 24GHz mmWave, `SCD40` CO₂) | ⚪ BACKLOG (LATER) | 0% |

---

## 📱 PHASE 7: ZERO-COST FRONTEND APP — "KINETIC DECIBEL METER (`dB-RF`)" (NO PURCHASES NEEDED)

You do **not** need to buy anything to build and use the **Kinetic Activity Decibel Monitor** app! Using only your existing ESP32 + laptop/phone browser:

### 🚀 Task 7.1: `dB-RF` Kinetic Volume Meter & Consumer App UI
- [ ] **Objective:** Build a dedicated, product-grade **"Kinetic Decibel Meter (`dB-RF`)"** frontend app view alongside the radar.
- [ ] **Features (100% Software / Existing ESP32):**
  - **Live `0–100 dB-RF` Logarithmic Gauge:** Maps combined RF variance ($\sigma^2$), 64-CSI turbulence, and phase decorrelation ($\sigma^2_\Delta$) into an intuitive decibel scale:
    - `0–15 dB-RF`: **Silent Field** (Empty Room)
    - `15–35 dB-RF`: **Micro-Activity** (Stationary Breathing / Desk Work)
    - `35–65 dB-RF`: **Normal Living** (1 Person Walking / Routine Motion)
    - `65–85 dB-RF`: **High Kinetic Activity** (Multi-Person Movement / Pacing)
    - `85–100 dB-RF`: **Crowd / Thrash Overload** (Sustained Party / Intrusion)
  - **SPL-Style Metrics:** Live `dB-RF`, `Peak Hold (Max)`, `1-Min Rolling Average (Leq)`, and `15-Min Occupancy Dose (%)`.
  - **Optional Browser/Phone Mic `dBA` Envelope Cross-Check ($0):** Uses the browser's built-in `AudioContext` `AnalyserNode` (zero audio recording, local RMS amplitude only) to compare **Sound Decibels (`dBA`) vs. Kinetic RF Decibels (`dB-RF`)** so loud TVs/traffic are never misdiagnosed as physical crowd movement.
  - **Passive Wi-Fi MAC / Probe Counter (ESP32 Firmware Upgrade - $0):** Count unique active mobile devices transmitting within the RSSI radius on Channel 8.

---

## 🛒 PHASE 8: FUTURE HARDWARE SHOPPING LIST (TO DO LATER — \$1 TO \$4 ADD-ONS)

When you are ready to turn the prototype into a standalone commercial wall-puck later on, these optional sensors wire directly into the existing ESP32's spare GPIO pins:

| Component | Est. Cost | Interface | ESP32 Pins | What It Adds Later |
| :--- | :---: | :---: | :--- | :--- |
| **`INMP441` MEMS Microphone** | ~\$1.20 | I2S Digital | `GPIO 14, 15, 32` | On-board hardware `dBA` sound decibel meter (no laptop/phone mic needed). |
| **`HLK-LD2410C` 24GHz mmWave** | ~\$2.50 | UART (TX/RX) | `GPIO 16, 17` | Sub-decimeter line-of-sight distance + stationary chest breathing lock, fused with ESP32 Wi-Fi through-wall coverage. |
| **`BME680` or `SCD40` CO₂/VOC** | ~\$4.00 | I2C (`SDA/SCL`) | `GPIO 21, 22` | Exhalation CO₂ slope over 10 mins mathematically proves exact human headcount (1 vs. 5+ people). |
| **2nd `ESP32-WROOM-32` Node** | ~\$4.00 | Wi-Fi Mesh | USB Power | Orthogonal bistatic Fresnel intersection for true 2D `(X, Y)` room triangulation. |

---

## 🛠️ VERIFICATION CHECKLIST BEFORE MERGING TASKS
When completing any task above, Agent Argon must run:
1. `npm run build` in `web/` to ensure zero compilation or typing regressions.
2. Confirm `ESP32_MotionSensor/credentials.h` remains uncommitted and untracked.
3. Commit with clean Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).

