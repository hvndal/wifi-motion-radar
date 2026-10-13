/**
 * Mathematical Models for Wi-Fi Motion Sensing, Spatial Telemetry,
 * and Kalman-Filter Trajectory Prediction
 */

// 1. Log-Distance Path Loss Model for Indoor 2.4 GHz Multipath
export interface PathLossConfig {
  txPower1m: number; // RSSI at 1 meter (typically -38 to -44 dBm)
  pathLossExponent: number; // Indoor environment factor (typically 2.2 to 2.8)
}

export const DEFAULT_PATH_LOSS: PathLossConfig = {
  txPower1m: -38.0,
  pathLossExponent: 2.4,
};

/**
 * Converts raw RSSI (dBm) to estimated Euclidean distance (meters)
 * d = 10 ^ ((P_0 - RSSI) / (10 * n))
 */
export function rssiToDistance(rssi: number, config: PathLossConfig = DEFAULT_PATH_LOSS): number {
  if (rssi >= 0 || isNaN(rssi)) return 1.0;
  const ratio = (config.txPower1m - rssi) / (10.0 * config.pathLossExponent);
  const dist = Math.pow(10.0, ratio);
  return Math.max(0.5, Math.min(12.0, parseFloat(dist.toFixed(2))));
}

// 2. 2D Kinematic Kalman Filter for Spatial Trajectory Estimation & Forward Prediction
export interface KalmanState2D {
  x: number;      // Position X (meters)
  z: number;      // Position Z (meters)
  vx: number;     // Velocity X (m/s)
  vz: number;     // Velocity Z (m/s)
  covariance: number[][]; // 4x4 state error covariance
}

export class SpatialKalmanFilter {
  private state: [number, number, number, number]; // [x, z, vx, vz]
  private P: number[][]; // 4x4 covariance matrix
  private Q: number;     // Process noise
  private R: number;     // Measurement noise
  private lastTimestamp: number;

  constructor(initialX: number = 0, initialZ: number = 2.5) {
    this.state = [initialX, initialZ, 0, 0];
    // Initial high uncertainty
    this.P = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 2],
    ];
    this.Q = 0.08; // Process uncertainty (human movement fluidity)
    this.R = 0.65; // Wi-Fi RSSI / multipath measurement noise variance
    this.lastTimestamp = 0;
  }

  /**
   * Update filter with incoming noisy position measurement (e.g. from Wi-Fi trilateration/RSSI)
   */
  public update(measuredX: number, measuredZ: number, dtSec?: number): KalmanState2D {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const dt = dtSec ?? (this.lastTimestamp === 0 ? 0.2 : Math.max(0.05, Math.min(1.0, (now - this.lastTimestamp) / 1000)));
    this.lastTimestamp = now;

    // 1. Prediction step: x_k = F * x_{k-1}
    const [x, z, vx, vz] = this.state;
    const predX = x + vx * dt;
    const predZ = z + vz * dt;
    const predVx = vx;
    const predVz = vz;

    // F * P * F^T + Q
    const p00 = this.P[0][0] + dt * (this.P[2][0] + this.P[0][2] + dt * this.P[2][2]) + this.Q;
    const p11 = this.P[1][1] + dt * (this.P[3][1] + this.P[1][3] + dt * this.P[3][3]) + this.Q;
    const p22 = this.P[2][2] + this.Q * 2;
    const p33 = this.P[3][3] + this.Q * 2;

    // 2. Kalman Gain: K = P * H^T * (H * P * H^T + R)^-1
    const kX = p00 / (p00 + this.R);
    const kZ = p11 / (p11 + this.R);
    const kVx = (dt * this.P[2][2]) / (p00 + this.R);
    const kVz = (dt * this.P[3][3]) / (p11 + this.R);

    // 3. Update state with innovation (measurement - prediction)
    const innovX = measuredX - predX;
    const innovZ = measuredZ - predZ;

    const newX = predX + kX * innovX;
    const newZ = predZ + kZ * innovZ;
    const newVx = predVx + kVx * innovX;
    const newVz = predVz + kVz * innovZ;

    this.state = [newX, newZ, newVx, newVz];

    // Update covariance
    this.P[0][0] = (1 - kX) * p00;
    this.P[1][1] = (1 - kZ) * p11;
    this.P[2][2] = (1 - kVx) * p22;
    this.P[3][3] = (1 - kVz) * p33;

    return {
      x: parseFloat(newX.toFixed(2)),
      z: parseFloat(newZ.toFixed(2)),
      vx: parseFloat(newVx.toFixed(2)),
      vz: parseFloat(newVz.toFixed(2)),
      covariance: this.P,
    };
  }

  /**
   * Forecast future position forward by seconds ahead
   */
  public predictFuture(secondsAhead: number = 1.5): { x: number; z: number } {
    const [x, z, vx, vz] = this.state;
    // Decelerating kinematic projection
    const damping = Math.exp(-0.4 * secondsAhead);
    return {
      x: parseFloat((x + vx * secondsAhead * damping).toFixed(2)),
      z: parseFloat((z + vz * secondsAhead * damping).toFixed(2)),
    };
  }

  public getState(): KalmanState2D {
    return {
      x: parseFloat(this.state[0].toFixed(2)),
      z: parseFloat(this.state[1].toFixed(2)),
      vx: parseFloat(this.state[2].toFixed(2)),
      vz: parseFloat(this.state[3].toFixed(2)),
      covariance: this.P,
    };
  }
}

// 3. Autoregressive AR(1) & EMA Time-Series Predictor for Wi-Fi RSSI
export class RSSIPredictor {
  private alpha: number; // Smoothing factor (0 < alpha < 1)
  private ema: number;
  private trend: number;
  private history: number[];
  private maxHistory: number;

  constructor(alpha: number = 0.35, maxHistory: number = 30) {
    this.alpha = alpha;
    this.ema = -55;
    this.trend = 0;
    this.history = [];
    this.maxHistory = maxHistory;
  }

  public recordSample(rssi: number): { predictedNext: number; variance: number; residual: number } {
    this.history.push(rssi);
    if (this.history.length > this.maxHistory) this.history.shift();

    const previousEma = this.ema;
    this.ema = this.alpha * rssi + (1 - this.alpha) * this.ema;
    this.trend = 0.3 * (this.ema - previousEma) + 0.7 * this.trend;

    // Variance calculation
    const mean = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const variance = this.history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.history.length;

    // Predicted next step: AR(1) with linear trend
    const predictedNext = parseFloat((this.ema + this.trend).toFixed(1));
    const residual = parseFloat(Math.abs(rssi - predictedNext).toFixed(2));

    return {
      predictedNext,
      variance: parseFloat(variance.toFixed(2)),
      residual,
    };
  }
}

// 4. GPS & Local Coordinate Conversion
export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
}

/**
 * Projects WGS84 GPS coordinate relative to a local room anchor into (X, Z) Cartesian coordinates
 * 1 degree latitude ~= 111,320 meters
 * 1 degree longitude ~= 111,320 * cos(lat) meters
 */
export function gpsToLocalRoomCoordinates(
  current: GPSCoordinates,
  anchor: GPSCoordinates
): { localX: number; localZ: number } {
  const latRad = (anchor.latitude * Math.PI) / 180.0;
  const metersPerDegLat = 111132.954;
  const metersPerDegLon = 111412.84 * Math.cos(latRad);

  const deltaLat = current.latitude - anchor.latitude;
  const deltaLon = current.longitude - anchor.longitude;

  const localX = deltaLon * metersPerDegLon;
  const localZ = deltaLat * metersPerDegLat;

  return {
    localX: parseFloat(localX.toFixed(2)),
    localZ: parseFloat(localZ.toFixed(2)),
  };
}

// 5. Activity State Probability Classifier
export type ActivityType = "STATIONARY" | "WALKING" | "APPROACHING" | "RECEDING" | "HIGH_ACTIVITY";

export function classifyActivity(
  rfVariance: number,
  velocity: number,
  deltaDistance: number
): { activity: ActivityType; confidence: number } {
  if (rfVariance < 1.8 && Math.abs(velocity) < 0.25) {
    return { activity: "STATIONARY", confidence: 95 };
  }

  if (rfVariance > 12.0 || Math.abs(velocity) > 1.8) {
    return { activity: "HIGH_ACTIVITY", confidence: 90 };
  }

  if (deltaDistance < -0.15) {
    return { activity: "APPROACHING", confidence: 88 };
  }

  if (deltaDistance > 0.15) {
    return { activity: "RECEDING", confidence: 86 };
  }

  return { activity: "WALKING", confidence: 82 };
}
