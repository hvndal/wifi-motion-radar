# 🗺️ PROJECT ROADMAP & TASK BACKLOG

This document tracks active development phases, prioritized tasks, and implementation status for the **Wi-Fi Motion Radar & Tactical Sentinel** project.

---

## 📊 MILESTONE STATUS OVERVIEW

| Phase | Description | Status | Completion |
| :--- | :--- | :---: | :---: |
| **Phase 1: Foundation** | Hardware firmware, Promiscuous RX, CSI callback, Serial bridge | ✅ COMPLETE | 100% |
| **Phase 2: Tactical HUD** | CoD UAV Polar Radar, Log-Distance model, Fresnel Zone ellipse | ✅ COMPLETE | 100% |
| **Phase 3: Occupancy Intelligence** | Subcarrier Decorrelation, CUSUM persistence, multi-person limit | ✅ COMPLETE | 100% |
| **Phase 4: Multi-Node Triangulation & Bearing** | Multi-ESP32 mesh, AoA (Angle-of-Arrival), cartesian X/Y tracking | 🟡 READY FOR ARGON | 0% |
| **Phase 5: Respiration & Micro-Doppler** | FFT spectral chest displacement filter for stationary humans | ⚪ PLANNED | 0% |
| **Phase 6: Audio & Webhooks Alerting** | Browser Web Audio SFX (UAV radar sweep blip, intruder siren) & Webhook alerts | ⚪ PLANNED | 0% |

---

## 📋 DETAILED TASK BREAKDOWN FOR NEXT SPRINT (AGENT ARGON)

### 🚀 Task 4.1: Directional AoA & Bearing Calibration Enhancements
- [ ] **Objective:** Make the UAV Radar compass orientation adaptive.
- [ ] **Details:** Currently, orientation is set via manual compass buttons (North, East, South, West). Implement a persistent local storage configuration or a 2-point reference calibration step where the user pings the device while walking towards the router.
- [ ] **Target Files:**
  - `web/src/components/UavTacticalRadar.tsx`
  - `web/src/app/page.tsx`

### 🔊 Task 4.2: Tactical Tactical SFX & Audio Cues
- [ ] **Objective:** Add optional tactical Call of Duty style radar sweep "blip" and alarm sound effects using Web Audio API (zero external asset dependencies).
- [ ] **Details:**
  - Radar sweep audio cue synced with the 360° sweeping line in `UavTacticalRadar.tsx`.
  - Staccato pulse tone when the CUSUM persistence meter crosses the 60% occupancy threshold.
  - Mute/Unmute toggle button in the HUD header.
- [ ] **Target Files:**
  - `web/src/utils/audioSfx.ts` (create)
  - `web/src/components/UavTacticalRadar.tsx`

### 📈 Task 4.3: WebSocket / SSE Streaming Upgrade (Optional Performance Polish)
- [ ] **Objective:** Replace 100ms client HTTP polling with Server-Sent Events (SSE) or WebSockets.
- [ ] **Details:**
  - Current architecture: `page.tsx` polls `/api/esp32` via `fetch` every 100ms.
  - Proposed improvement: Next.js route handler streaming via `ReadableStream` (SSE) to eliminate polling overhead and achieve sub-10ms UI latency.
- [ ] **Target Files:**
  - `web/src/app/api/esp32/route.ts`
  - `web/src/app/page.tsx`

### 🫁 Task 5.1: Stationary Human Vital Signs (Breathing Detection)
- [ ] **Objective:** Detect when a person is sitting completely still in the room without moving arms/legs.
- [ ] **Details:**
  - Use `ruviewCore.ts` and bandpass filter the CSI subcarriers between `0.15 Hz - 0.4 Hz` (9 - 24 breaths/minute).
  - Surface respiratory rate (BPM) in `RuViewVitalsWidget.tsx`.
- [ ] **Target Files:**
  - `web/src/utils/ruviewCore.ts`
  - `web/src/components/RuViewVitalsWidget.tsx`

---

## 🛠️ VERIFICATION CHECKLIST BEFORE MERGING TASKS
When completing any task above, Agent Argon must run:
1. `npm run build` in `web/` to ensure zero compilation or typing regressions.
2. Confirm `ESP32_MotionSensor/credentials.h` remains uncommitted and untracked.
3. Commit with clean Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).
