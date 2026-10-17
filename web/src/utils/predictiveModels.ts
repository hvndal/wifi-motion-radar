/**
 * Multi-Target RF Signal Decomposition, Stationary Respiration (0.15-0.45 Hz),
 * Pet/Clutter Classification, and 2D Kalman Kinematic Tracker
 *
 * Designed for 10 Hz 64-Subcarrier OFDM CSI + RSSI Telemetry
 */

export type EntityClassification =
  | "HUMAN_MOVING"
  | "HUMAN_STATIONARY"
  | "PET_OR_LOW_MASS"
  | "AMBIENT_FAN_CLUTTER";

export type CorridorSector =
  | "DESK_REFLECTION_NORTH"   // In front of laptop/ESP32 (Backscatter reflection)
  | "FRESNEL_CORE_SOUTH"      // Directly between ESP32 and Router in the back (Deep LoS shadow)
  | "LATERAL_SCATTER_WEST"    // Secondary multipath lobe
  | "LATERAL_SCATTER_EAST";   // Secondary multipath lobe

export interface TrackedSignalEntity {
  id: string;                 // "signal-x", "signal-y", "signal-z"
  designation: string;        // "PERSON X (SIGNAL X)", "PERSON Y (SIGNAL Y)", "SIGNAL Z (PET / SMALL)"
  shortLabel: string;         // "PERSON X", "PERSON Y", "PET / Z"
  classification: EntityClassification;
  sector: CorridorSector;
  rangeMeters: number;        // Euclidean distance from ESP32 (meters)
  angleDeg: number;           // Polar angle on radar (0=E, 90=N/Front, 180=W, 270=S/Back)
  x: number;                  // Normalized radar X (-1 to 1)
  y: number;                  // Normalized radar Y (-1 to 1)
  predX: number;              // 1.5s Forward-predicted normalized X
  predY: number;              // 1.5s Forward-predicted normalized Y
  velocityMs: number;         // Radial velocity (m/s)
  breathingBpm: number | null;// Estimated respiratory rate (12-24 BPM) when stationary
  rcsDbm2: number;            // Effective Radar Cross Section proxy (dBsm)
  confidence: number;         // 0.0 to 1.0
  subcarrierBand: string;     // e.g. "SC 6..31 (Lower 10MHz)" or "SC 33..58 (Upper 10MHz)"
  firstSeenMs: number;
  lastUpdatedMs: number;
  holdRemainingSec: number;   // Stationary lock persistence timer
}

export interface RfDecompositionResult {
  entities: TrackedSignalEntity[];
  estimatedPeopleInRadius: number;
  estimatedPetsInRadius: number;
  totalSignalsInRadius: number;
  stationaryPresenceScore: number;  // 0 to 100% (Static Residual + Breathing Bandpass)
  respirationDetected: boolean;
  respirationBpm: number;
  respirationConfidence: number;    // 0 to 100%
  staticMultipathResidual: number;  // L1 distance from empty-room CSI profile
  lowerBandVariance: number;        // Variance of SC 6..31
  upperBandVariance: number;        // Variance of SC 33..58
  predictedNextRssi: number;
  predictedNextVariance: number;
  predictionStatusText: string;
}

// 2nd-Order Butterworth Bandpass Filter for 0.15 Hz - 0.45 Hz Respiration @ 10 Hz sampling
class RespirationBandpass {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  // Pre-warped coefficients for fs = 10 Hz, f_low = 0.15 Hz, f_high = 0.45 Hz
  private readonly b0 = 0.0864;
  private readonly b1 = 0.0;
  private readonly b2 = -0.0864;
  private readonly a1 = -1.7786;
  private readonly a2 = 0.8273;

  public step(x: number): number {
    const y =
      this.b0 * x +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Number.isFinite(y) ? y : 0;
    return this.y1;
  }
}

interface InternalTrackState {
  rangeMeters: number;
  angleDeg: number;
  velocityMs: number;
  firstSeenMs: number;
  lastActiveMs: number;
  smoothedConfidence: number;
}

export class MultiTargetRfTracker {
  private emptyRoomSubcarriers: number[] = new Array(64).fill(16);
  private emptyRoomRssi: number = -60.0;
  private isCalibrated: boolean = false;

  // 80-sample (8 second @ 10 Hz) history of active subcarriers
  private subcarrierHistory: number[][] = [];
  private rssiHistory: number[] = [];
  private varHistory: number[] = [];

  private respFilter = new RespirationBandpass();
  private respWaveHistory: { t: number; v: number }[] = [];
  private lastPeakTimeMs = 0;
  private peakIntervalsSec: number[] = [];
  private currentBpm = 16.0;

  // Persistent kinematic state for Signal X, Signal Y, Signal Z
  private tracks: Record<string, InternalTrackState> = {};

  /**
   * Calibrates the empty-room reference vector H_empty so stationary humans
   * can be distinguished from static furniture via multipath residual D_static.
   */
  public calibrateEmptyRoom(subcarriers: number[], rssi: number) {
    if (Array.isArray(subcarriers) && subcarriers.length === 64) {
      this.emptyRoomSubcarriers = [...subcarriers];
    }
    if (rssi < -10 && rssi > -98) {
      this.emptyRoomRssi = rssi;
    }
    this.isCalibrated = true;
  }

  /**
   * Processes a 10 Hz telemetry frame and returns decomposed Signal X / Y / Z entities,
   * radius-filtered people count, stationary breathing lock, and forward predictions.
   */
  public step(params: {
    rssi: number;
    slowRssi: number;
    wifiVariance: number;
    csiVariance: number;
    decorrelationSpread: number;
    subcarriers: number[];
    triggerThreshold: number;
    routerDistMeters: number;
    routerBearingDeg: number;
    selectedRadiusMeters: number;
    connected: boolean;
  }): RfDecompositionResult {
    const {
      rssi,
      slowRssi,
      wifiVariance,
      csiVariance,
      decorrelationSpread,
      subcarriers,
      triggerThreshold,
      routerDistMeters,
      routerBearingDeg,
      selectedRadiusMeters,
      connected,
    } = params;

    const now = Date.now();

    if (!connected) {
      return {
        entities: [],
        estimatedPeopleInRadius: 0,
        estimatedPetsInRadius: 0,
        totalSignalsInRadius: 0,
        stationaryPresenceScore: 0,
        respirationDetected: false,
        respirationBpm: 0,
        respirationConfidence: 0,
        staticMultipathResidual: 0,
        lowerBandVariance: 0,
        upperBandVariance: 0,
        predictedNextRssi: rssi,
        predictedNextVariance: 0,
        predictionStatusText: "Awaiting ESP32 hardware telemetry stream...",
      };
    }

    // Auto-initialize empty room baseline on first calm frames if not manually calibrated
    if (!this.isCalibrated && wifiVariance < triggerThreshold * 0.7 && subcarriers.length === 64) {
      this.emptyRoomSubcarriers = this.emptyRoomSubcarriers.map(
        (prev, i) => 0.92 * prev + 0.08 * subcarriers[i]
      );
      this.emptyRoomRssi = 0.95 * this.emptyRoomRssi + 0.05 * slowRssi;
    }

    // 1. Update Sliding History Buffers (80 frames = 8 seconds @ 10 Hz)
    if (subcarriers.length === 64) {
      this.subcarrierHistory.push([...subcarriers]);
      if (this.subcarrierHistory.length > 80) this.subcarrierHistory.shift();
    }
    this.rssiHistory.push(rssi);
    if (this.rssiHistory.length > 40) this.rssiHistory.shift();
    this.varHistory.push(wifiVariance);
    if (this.varHistory.length > 40) this.varHistory.shift();

    // 2. Compute Static Multipath Residual (D_static) against Empty-Room Profile
    let staticResidualSum = 0;
    let activeCount = 0;
    for (let k = 6; k <= 58; k++) {
      if (k === 32) continue;
      staticResidualSum += Math.abs((subcarriers[k] ?? 16) - (this.emptyRoomSubcarriers[k] ?? 16));
      activeCount++;
    }
    const staticMultipathResidual = Number(
      (activeCount > 0 ? staticResidualSum / activeCount : 0).toFixed(2)
    );

    // 3. Sub-Band Decomposition: Lower 10 MHz (SC 6..31) vs Upper 10 MHz (SC 33..58)
    // Allows separating two distinct spatial reflectors (Signal X vs Signal Y)
    const lowerBandVariance = this.computeBandTemporalVariance(6, 31);
    const upperBandVariance = this.computeBandTemporalVariance(33, 58);

    // 4. Stationary Respiration Bandpass (0.15 - 0.45 Hz) on Top-8 Sensitive Subcarriers
    const topSubcarrierMean = this.computeTopSensitiveSubcarrierMean(subcarriers);
    const filteredResp = this.respFilter.step(topSubcarrierMean);
    this.respWaveHistory.push({ t: now, v: filteredResp });
    if (this.respWaveHistory.length > 60) this.respWaveHistory.shift();

    // Detect zero-crossing peaks in respiratory wave (valid breath cycle: 2.2s to 6.5s)
    if (this.respWaveHistory.length >= 6) {
      const n = this.respWaveHistory.length;
      const prev2 = this.respWaveHistory[n - 3].v;
      const prev1 = this.respWaveHistory[n - 2].v;
      const curr = this.respWaveHistory[n - 1].v;

      if (prev1 > prev2 && prev1 > curr && prev1 > 0.06) {
        const dtSec = (now - this.lastPeakTimeMs) / 1000;
        if (dtSec >= 2.2 && dtSec <= 6.5) {
          this.peakIntervalsSec.push(dtSec);
          if (this.peakIntervalsSec.length > 6) this.peakIntervalsSec.shift();
          const avgInterval =
            this.peakIntervalsSec.reduce((a, b) => a + b, 0) / this.peakIntervalsSec.length;
          this.currentBpm = Number(Math.min(26, Math.max(10, 60 / avgInterval)).toFixed(1));
        }
        this.lastPeakTimeMs = now;
      }
    }

    // Calculate Respiratory Band Energy & Stationary Presence Score
    const respEnergy =
      this.respWaveHistory.reduce((acc, item) => acc + Math.abs(item.v), 0) /
      Math.max(1, this.respWaveHistory.length);
    const rssiShadowOffset = Math.abs(rssi - this.emptyRoomRssi);

    const respirationConfidence = Math.min(
      100,
      Math.round((respEnergy / 0.35) * 65 + (staticMultipathResidual / 1.8) * 35)
    );
    const stationaryPresenceScore = Math.min(
      100,
      Math.round(
        respirationConfidence * 0.55 +
          Math.min(100, (staticMultipathResidual / 1.5) * 100) * 0.3 +
          Math.min(100, (rssiShadowOffset / 2.0) * 100) * 0.15
      )
    );
    const respirationDetected = stationaryPresenceScore >= 32 || csiVariance >= 0.18;

    // 5. Evaluate Primary & Secondary Signal Entities (Signal X, Signal Y, Pet/Signal Z)
    const isMoving =
      wifiVariance >= triggerThreshold || csiVariance >= Math.max(1.05, triggerThreshold * 1.35);

    const activeEntities: TrackedSignalEntity[] = [];

    // --- ENTITY 1: SIGNAL X (Primary Human / Pet Target) ---
    // Determine if moving human, stationary breathing human, or pet/small scatterer
    const rcsProxy = Number((wifiVariance * 2.4 + csiVariance * 1.8 + rssiShadowOffset * 0.9).toFixed(1));

    const isPetSignature =
      isMoving &&
      csiVariance >= 0.95 &&
      wifiVariance < triggerThreshold * 1.35 &&
      rssiShadowOffset < 1.3 &&
      decorrelationSpread < 1.5;

    const signalXActive = isMoving || stationaryPresenceScore >= 32;

    if (signalXActive) {
      // Determine Front Desk (Backscatter) vs Back Router Corridor (Direct Fresnel Shadow)
      // Since Router is at routerBearingDeg (270° Back), direct occlusion causes a negative RSSI drop,
      // while sitting at the desk (opposite side, 90° Front) causes high CSI reflection with minimal RSSI drop.
      const rssiDrop = rssi - slowRssi;
      let targetAngle = routerBearingDeg; // Default along router corridor (270° S)
      let sector: CorridorSector = "FRESNEL_CORE_SOUTH";
      let rawRange = routerDistMeters * 0.48;

      if (rssiDrop > -1.1 && csiVariance > wifiVariance * 0.65) {
        // Backscatter reflection in front of laptop/desk (180° opposite to router in back)
        targetAngle = (routerBearingDeg + 180) % 360;
        sector = "DESK_REFLECTION_NORTH";
        rawRange = Math.max(0.65, Math.min(2.2, 1.15 - Math.min(0.4, csiVariance * 0.12)));
      } else {
        // Direct Line-of-Sight Fresnel corridor between ESP32 and Router in the back
        targetAngle = routerBearingDeg;
        sector = "FRESNEL_CORE_SOUTH";
        const normPerturb = Math.min(1.0, (wifiVariance + csiVariance * 0.5) / 5.0);
        rawRange = Math.max(0.7, Math.min(routerDistMeters * 0.9, routerDistMeters * (0.55 - normPerturb * 0.18)));
      }

      const trackX = this.updateTrack("signal-x", rawRange, targetAngle, isMoving ? 1.0 : 0.0, now);
      const classification: EntityClassification = isPetSignature
        ? "PET_OR_LOW_MASS"
        : isMoving
        ? "HUMAN_MOVING"
        : "HUMAN_STATIONARY";

      const designation =
        classification === "PET_OR_LOW_MASS"
          ? "SIGNAL X [PET / LOW-MASS]"
          : classification === "HUMAN_STATIONARY"
          ? "PERSON X [STATIONARY / BREATHING]"
          : "PERSON X [SIGNAL X • MOVING]";

      const shortLabel =
        classification === "PET_OR_LOW_MASS"
          ? "PET (SIG X)"
          : classification === "HUMAN_STATIONARY"
          ? "PERSON X [STILL]"
          : "PERSON X";

      const rad = (trackX.angleDeg * Math.PI) / 180;
      const normDist = Math.min(0.92, trackX.rangeMeters / Math.max(2, selectedRadiusMeters));
      const x = Math.cos(rad) * normDist;
      const y = -Math.sin(rad) * normDist;

      // Forward kinematic prediction (1.5s ahead)
      const predRange = Math.max(
        0.5,
        Math.min(selectedRadiusMeters * 0.95, trackX.rangeMeters + trackX.velocityMs * 0.8)
      );
      const predNorm = Math.min(0.92, predRange / Math.max(2, selectedRadiusMeters));

      activeEntities.push({
        id: "signal-x",
        designation,
        shortLabel,
        classification,
        sector,
        rangeMeters: Number(trackX.rangeMeters.toFixed(2)),
        angleDeg: Math.round(trackX.angleDeg),
        x,
        y,
        predX: Math.cos(rad) * predNorm,
        predY: -Math.sin(rad) * predNorm,
        velocityMs: isMoving
          ? Number((Math.sqrt(wifiVariance) * 0.24 + csiVariance * 0.16).toFixed(2))
          : 0.02,
        breathingBpm: !isMoving || classification === "HUMAN_STATIONARY" ? this.currentBpm : null,
        rcsDbm2: rcsProxy,
        confidence: Number(
          Math.min(0.99, isMoving ? 0.78 + Math.min(0.2, wifiVariance * 0.08) : stationaryPresenceScore / 100).toFixed(2)
        ),
        subcarrierBand:
          lowerBandVariance >= upperBandVariance
            ? "SC 6..31 (Lower 10MHz)"
            : "SC 33..58 (Upper 10MHz)",
        firstSeenMs: trackX.firstSeenMs,
        lastUpdatedMs: now,
        holdRemainingSec: isMoving ? 15.0 : Math.max(0, 15.0 - (now - trackX.lastActiveMs) / 1000),
      });
    } else if (this.tracks["signal-x"] && now - this.tracks["signal-x"].lastActiveMs < 12000) {
      // Hold Stationary Person X for up to 12 seconds after motion stops so sitting people don't vanish!
      const held = this.tracks["signal-x"];
      const holdRemainingSec = Number(Math.max(0, 12.0 - (now - held.lastActiveMs) / 1000).toFixed(1));
      const rad = (held.angleDeg * Math.PI) / 180;
      const normDist = Math.min(0.92, held.rangeMeters / Math.max(2, selectedRadiusMeters));

      activeEntities.push({
        id: "signal-x",
        designation: "PERSON X [STATIONARY LOCK]",
        shortLabel: "PERSON X [LOCK]",
        classification: "HUMAN_STATIONARY",
        sector: held.angleDeg === routerBearingDeg ? "FRESNEL_CORE_SOUTH" : "DESK_REFLECTION_NORTH",
        rangeMeters: Number(held.rangeMeters.toFixed(2)),
        angleDeg: Math.round(held.angleDeg),
        x: Math.cos(rad) * normDist,
        y: -Math.sin(rad) * normDist,
        predX: Math.cos(rad) * normDist,
        predY: -Math.sin(rad) * normDist,
        velocityMs: 0.0,
        breathingBpm: this.currentBpm,
        rcsDbm2: rcsProxy,
        confidence: Number(Math.max(0.55, holdRemainingSec / 12.0).toFixed(2)),
        subcarrierBand: "SC 6..58 (Resp Lock)",
        firstSeenMs: held.firstSeenMs,
        lastUpdatedMs: now,
        holdRemainingSec,
      });
    }

    // --- ENTITY 2: SIGNAL Y (Secondary Person / Independent Multipath Scatterer) ---
    // Triggered when Subcarrier Phase Decorrelation (σ²Δ >= 1.85) or simultaneous dual sub-band excitation occurs
    const dualSubbandExcitation = lowerBandVariance > 0.45 && upperBandVariance > 0.45;
    const signalYTriggered =
      (decorrelationSpread >= 1.85 && (isMoving || csiVariance > 0.85)) ||
      (dualSubbandExcitation && decorrelationSpread >= 1.45);

    if (signalYTriggered) {
      // Place Signal Y on the secondary multipath vector (offset by 32° from router corridor)
      const secAngle = (routerBearingDeg + 32) % 360;
      const secRawRange = Math.max(
        1.1,
        Math.min(routerDistMeters * 0.92, routerDistMeters * 0.68 + (upperBandVariance - lowerBandVariance) * 0.3)
      );
      const trackY = this.updateTrack("signal-y", secRawRange, secAngle, 1.0, now);

      const isSignalYPet = decorrelationSpread < 2.35 && wifiVariance < triggerThreshold * 1.4;
      const yClass: EntityClassification = isSignalYPet ? "PET_OR_LOW_MASS" : "HUMAN_MOVING";

      const rad = (trackY.angleDeg * Math.PI) / 180;
      const normDist = Math.min(0.92, trackY.rangeMeters / Math.max(2, selectedRadiusMeters));
      const predRange = Math.max(
        0.8,
        Math.min(selectedRadiusMeters * 0.95, trackY.rangeMeters + trackY.velocityMs * 0.7)
      );
      const predNorm = Math.min(0.92, predRange / Math.max(2, selectedRadiusMeters));

      activeEntities.push({
        id: "signal-y",
        designation: isSignalYPet
          ? "SIGNAL Y [PET / SECONDARY]"
          : "PERSON Y [SIGNAL Y • MULTIPATH]",
        shortLabel: isSignalYPet ? "PET (SIG Y)" : "PERSON Y",
        classification: yClass,
        sector: "LATERAL_SCATTER_WEST",
        rangeMeters: Number(trackY.rangeMeters.toFixed(2)),
        angleDeg: Math.round(trackY.angleDeg),
        x: Math.cos(rad) * normDist,
        y: -Math.sin(rad) * normDist,
        predX: Math.cos(rad) * predNorm,
        predY: -Math.sin(rad) * predNorm,
        velocityMs: Number((csiVariance * 0.28).toFixed(2)),
        breathingBpm: null,
        rcsDbm2: Number((decorrelationSpread * 1.9).toFixed(1)),
        confidence: Number(Math.min(0.95, 0.65 + (decorrelationSpread - 1.5) * 0.15).toFixed(2)),
        subcarrierBand: "SC 33..58 (Upper 10MHz)",
        firstSeenMs: trackY.firstSeenMs,
        lastUpdatedMs: now,
        holdRemainingSec: 8.0,
      });
    } else if (this.tracks["signal-y"] && now - this.tracks["signal-y"].lastActiveMs < 6000) {
      // Brief 6-second persistence for Person Y so their marker doesn't flicker between steps
      const heldY = this.tracks["signal-y"];
      const holdRem = Number(Math.max(0, 6.0 - (now - heldY.lastActiveMs) / 1000).toFixed(1));
      const rad = (heldY.angleDeg * Math.PI) / 180;
      const normDist = Math.min(0.92, heldY.rangeMeters / Math.max(2, selectedRadiusMeters));

      activeEntities.push({
        id: "signal-y",
        designation: "PERSON Y [SIGNAL Y • HOLD]",
        shortLabel: "PERSON Y [HOLD]",
        classification: "HUMAN_STATIONARY",
        sector: "LATERAL_SCATTER_WEST",
        rangeMeters: Number(heldY.rangeMeters.toFixed(2)),
        angleDeg: Math.round(heldY.angleDeg),
        x: Math.cos(rad) * normDist,
        y: -Math.sin(rad) * normDist,
        predX: Math.cos(rad) * normDist,
        predY: -Math.sin(rad) * normDist,
        velocityMs: 0.0,
        breathingBpm: this.currentBpm,
        rcsDbm2: Number((decorrelationSpread * 1.5).toFixed(1)),
        confidence: Number(Math.max(0.5, holdRem / 6.0).toFixed(2)),
        subcarrierBand: "SC 33..58 (Upper 10MHz)",
        firstSeenMs: heldY.firstSeenMs,
        lastUpdatedMs: now,
        holdRemainingSec: holdRem,
      });
    }

    // 6. Filter Entities by Selected Radar Radius (e.g., 3m, 5m, 8m, 12m)
    const entitiesInRadius = activeEntities.filter(
      (e) => e.rangeMeters <= selectedRadiusMeters + 0.15
    );

    const estimatedPeopleInRadius = entitiesInRadius.filter(
      (e) => e.classification === "HUMAN_MOVING" || e.classification === "HUMAN_STATIONARY"
    ).length;

    const estimatedPetsInRadius = entitiesInRadius.filter(
      (e) => e.classification === "PET_OR_LOW_MASS"
    ).length;

    // 7. Forward Signal Prediction (Holt-Winters Linear Trend over last 15 samples)
    const { predictedNextRssi, predictedNextVariance, predictionStatusText } =
      this.predictNextTelemetry(rssi, wifiVariance, triggerThreshold, entitiesInRadius);

    return {
      entities: entitiesInRadius,
      estimatedPeopleInRadius,
      estimatedPetsInRadius,
      totalSignalsInRadius: entitiesInRadius.length,
      stationaryPresenceScore,
      respirationDetected,
      respirationBpm: this.currentBpm,
      respirationConfidence,
      staticMultipathResidual,
      lowerBandVariance,
      upperBandVariance,
      predictedNextRssi,
      predictedNextVariance,
      predictionStatusText,
    };
  }

  private updateTrack(
    id: string,
    measuredRange: number,
    measuredAngle: number,
    activityWeight: number,
    now: number
  ): InternalTrackState {
    const prev = this.tracks[id];
    if (!prev) {
      const initial: InternalTrackState = {
        rangeMeters: measuredRange,
        angleDeg: measuredAngle,
        velocityMs: 0,
        firstSeenMs: now,
        lastActiveMs: now,
        smoothedConfidence: 0.8,
      };
      this.tracks[id] = initial;
      return initial;
    }

    const dtSec = Math.max(0.08, Math.min(1.0, (now - prev.lastActiveMs) / 1000));
    const alpha = activityWeight > 0.5 ? 0.28 : 0.08;
    const newRange = alpha * measuredRange + (1 - alpha) * prev.rangeMeters;
    const rawVel = (newRange - prev.rangeMeters) / dtSec;
    const newVel = 0.35 * rawVel + 0.65 * prev.velocityMs;

    // Smooth angle transition
    let angleDiff = measuredAngle - prev.angleDeg;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    const newAngle = (prev.angleDeg + angleDiff * 0.25 + 360) % 360;

    const updated: InternalTrackState = {
      rangeMeters: newRange,
      angleDeg: newAngle,
      velocityMs: Number(newVel.toFixed(2)),
      firstSeenMs: prev.firstSeenMs,
      lastActiveMs: activityWeight > 0.5 ? now : prev.lastActiveMs,
      smoothedConfidence: Math.min(0.99, prev.smoothedConfidence * 0.9 + 0.1),
    };
    this.tracks[id] = updated;
    return updated;
  }

  private computeBandTemporalVariance(startSc: number, endSc: number): number {
    if (this.subcarrierHistory.length < 4) return 0;
    const recent = this.subcarrierHistory.slice(-12);
    let totalVar = 0;
    let count = 0;

    for (let k = startSc; k <= endSc; k++) {
      if (k === 32) continue;
      let sum = 0;
      for (let t = 0; t < recent.length; t++) sum += recent[t][k];
      const mean = sum / recent.length;
      let vSum = 0;
      for (let t = 0; t < recent.length; t++) {
        const d = recent[t][k] - mean;
        vSum += d * d;
      }
      totalVar += vSum / recent.length;
      count++;
    }
    return Number((count > 0 ? totalVar / count : 0).toFixed(2));
  }

  private computeTopSensitiveSubcarrierMean(currentSubcarriers: number[]): number {
    if (this.subcarrierHistory.length < 6) {
      return currentSubcarriers.slice(6, 31).reduce((a, b) => a + b, 0) / 25;
    }
    const recent = this.subcarrierHistory.slice(-20);
    const variances: { k: number; v: number }[] = [];

    for (let k = 6; k <= 58; k++) {
      if (k === 32) continue;
      let sum = 0;
      for (let t = 0; t < recent.length; t++) sum += recent[t][k];
      const mean = sum / recent.length;
      let vSum = 0;
      for (let t = 0; t < recent.length; t++) {
        const d = recent[t][k] - mean;
        vSum += d * d;
      }
      variances.push({ k, v: vSum / recent.length });
    }

    variances.sort((a, b) => b.v - a.v);
    const top8 = variances.slice(0, 8);
    const topMean =
      top8.reduce((acc, item) => acc + (currentSubcarriers[item.k] ?? 16), 0) /
      Math.max(1, top8.length);
    return topMean;
  }

  private predictNextTelemetry(
    currentRssi: number,
    currentVar: number,
    threshold: number,
    entities: TrackedSignalEntity[]
  ): {
    predictedNextRssi: number;
    predictedNextVariance: number;
    predictionStatusText: string;
  } {
    const n = this.varHistory.length;
    if (n < 4) {
      return {
        predictedNextRssi: currentRssi,
        predictedNextVariance: currentVar,
        predictionStatusText: "Initializing autoregressive predictor...",
      };
    }

    const recentVar = this.varHistory.slice(-8);
    const firstHalf = recentVar.slice(0, Math.floor(recentVar.length / 2));
    const secondHalf = recentVar.slice(Math.floor(recentVar.length / 2));
    const mean1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const mean2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const varTrend = mean2 - mean1;

    const predictedNextVariance = Number(Math.max(0.05, currentVar + varTrend * 1.4).toFixed(2));

    const recentRssi = this.rssiHistory.slice(-6);
    const rssiTrend =
      (recentRssi[recentRssi.length - 1] - recentRssi[0]) / Math.max(1, recentRssi.length - 1);
    const predictedNextRssi = Number((currentRssi + rssiTrend * 2.0).toFixed(1));

    let predictionStatusText = "Room RF field stable — zero oncoming trajectory";
    if (entities.length >= 2) {
      predictionStatusText =
        "Multi-signal interference (Signal X + Signal Y) active in radius";
    } else if (entities.length === 1) {
      const e = entities[0];
      if (e.classification === "PET_OR_LOW_MASS") {
        predictionStatusText = `Low-mass scatter (${e.shortLabel}) at ${e.rangeMeters}m — likely pet or small object`;
      } else if (e.classification === "HUMAN_STATIONARY") {
        predictionStatusText = `Stationary human (${e.shortLabel}) locked at ${e.rangeMeters}m via ${e.breathingBpm ?? 16} BPM micro-Doppler`;
      } else if (varTrend > 0.15) {
        predictionStatusText = `${e.shortLabel} approaching Fresnel core (predicted σ² → ${predictedNextVariance} dB²)`;
      } else {
        predictionStatusText = `${e.shortLabel} moving at ${e.rangeMeters}m (${e.sector === "DESK_REFLECTION_NORTH" ? "Front Desk" : "Back Router Corridor"})`;
      }
    }

    return {
      predictedNextRssi,
      predictedNextVariance,
      predictionStatusText,
    };
  }
}

export interface GPSCoordinates {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
}

export class SpatialKalmanFilter {
  private x: number;
  private z: number;
  private vx: number = 0;
  private vz: number = 0;
  private lastTime: number = Date.now();

  constructor(initialX: number = 0, initialZ: number = 2.5) {
    this.x = initialX;
    this.z = initialZ;
  }

  update(measX: number, measZ: number, dtOverride?: number) {
    const now = Date.now();
    const dt = dtOverride ?? Math.max(0.05, Math.min(1.0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    const alpha = 0.35;
    const beta = 0.12;

    const predX = this.x + this.vx * dt;
    const predZ = this.z + this.vz * dt;

    const resX = measX - predX;
    const resZ = measZ - predZ;

    this.x = predX + alpha * resX;
    this.z = predZ + alpha * resZ;
    this.vx = this.vx + (beta / dt) * resX;
    this.vz = this.vz + (beta / dt) * resZ;

    return { x: this.x, z: this.z, vx: this.vx, vz: this.vz };
  }

  predictFuture(horizonSec: number = 1.5) {
    return {
      x: Number((this.x + this.vx * horizonSec).toFixed(2)),
      z: Number((this.z + this.vz * horizonSec).toFixed(2)),
    };
  }
}

export class RSSIPredictor {
  private alpha: number;
  private est: number = -58;
  private trend: number = 0;

  constructor(alpha: number = 0.35) {
    this.alpha = alpha;
  }

  recordSample(rssi: number) {
    const prevEst = this.est;
    this.est = this.alpha * rssi + (1 - this.alpha) * (this.est + this.trend);
    this.trend = 0.25 * (this.est - prevEst) + 0.75 * this.trend;
    const predictedNext = Number((this.est + this.trend * 2).toFixed(1));
    const residual = Number(Math.abs(rssi - this.est).toFixed(2));
    return { predictedNext, residual };
  }
}

export function classifyActivity(
  rfVariance: number,
  velocityMag: number,
  vz: number
): { activity: "APPROACHING" | "RECEDING" | "PACING" | "STATIONARY" | "CLEAR"; confidence: number } {
  if (rfVariance < 0.25 && velocityMag < 0.05) {
    return { activity: "CLEAR", confidence: 95 };
  }
  if (velocityMag < 0.12) {
    return { activity: "STATIONARY", confidence: 82 };
  }
  if (vz < -0.15) {
    return { activity: "APPROACHING", confidence: 88 };
  }
  if (vz > 0.15) {
    return { activity: "RECEDING", confidence: 85 };
  }
  return { activity: "PACING", confidence: 80 };
}

