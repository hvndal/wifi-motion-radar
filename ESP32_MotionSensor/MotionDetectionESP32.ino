#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <math.h>

// ====== TARGET ROUTER CONFIGURATION ======
// Automatically loads from gitignored credentials.h when present locally
#if __has_include("credentials.h")
  #include "credentials.h"
#else
  #define TARGET_WIFI_SSID     "YOUR_WIFI_SSID"
  #define TARGET_WIFI_PASS     "YOUR_WIFI_PASSWORD"
  #define TARGET_ROUTER_BSSID  {0xd0, 0x15, 0xbb, 0x01, 0xf2, 0x55}
  #define TARGET_WIFI_CHANNEL  8
#endif

const char* TARGET_SSID = TARGET_WIFI_SSID;
const char* TARGET_PASS = TARGET_WIFI_PASS;
uint8_t targetBssid[6] = TARGET_ROUTER_BSSID;
int activeChannel = TARGET_WIFI_CHANNEL;
bool routerLocked = false;

// ====== HARDWARE PINS ======
const int onboardLed = 2; // Built-in Blue LED indicates motion physically
const int extLed = 26;

// ====== HIGH-PRECISION FLOATING-POINT RSSI & EWMA ENGINE ======
#define RSSI_BUF_SIZE 25
int8_t rssiBuf[RSSI_BUF_SIZE];
int rssiIndex = 0;
int rssiCount = 0;

float currentAvgRssi = -60.0f;       // Float precision RSSI (0.01 dBm resolution)
float fastEmaRssi = -60.0f;          // Fast tracking filter (alpha = 0.30)
float slowEmaRssi = -60.0f;          // Slow room baseline filter (alpha = 0.04)
float currentVariance = 0.0f;        // Rolling sample variance (dB²)
float dynamicNoiseFloor = 0.18f;     // Adaptive ambient noise floor (dB²)
float snrRatio = 1.0f;               // Signal-to-Noise disturbance ratio
unsigned long beaconPackets = 0;
unsigned long lastBeaconTimeMs = 0;

// ====== 64-SUBCARRIER OFDM CSI AMPLITUDE & DECORRELATION ENGINE ======
// Valid LLTF subcarriers in 20 MHz 802.11n (excluding null guard bands & DC): indices 6..31 and 33..58
uint8_t rawSubcarriers[64];
float csiEma[64];
float csiFastEma[64];
bool csiInitialized = false;
float csiVariance = 0.0f;            // Normalized temporal CSI perturbation
float csiDecorrelation = 0.0f;       // Adjacent active subcarrier differential variance (σ²Δ)
unsigned long csiPackets = 0;

// ====== ADAPTIVEHYSTERESIS MOTION STATE ======
bool isMotion = false;
unsigned long lastMotionTime = 0;
const unsigned long DWELL_TIME_MS = 1800; // Hold trigger for 1.8s after motion subsides
unsigned long triggerCount = 0;
int consecutiveActiveFrames = 0;          // Debounce: require >= 2 consecutive disturbed frames

// Base sensitivity thresholds (also scaled dynamically against noise floor)
float baseVarianceThresh = 0.65f;         // Sensitive enough for 0.8 dB² walking perturbation
float baseCsiThresh = 1.35f;              // Sensitive to subcarrier multipath fading

// Helper: Check if subcarrier index k (0..63) is an active 802.11 OFDM data/pilot tone
inline bool isActiveSubcarrier(int k) {
  return (k >= 6 && k <= 31) || (k >= 33 && k <= 58);
}

// Wi-Fi CSI Callback: Extracts real OFDM subcarrier amplitudes & spatial decorrelation
void IRAM_ATTR wifiCsiCallback(void *ctx, wifi_csi_info_t *data) {
  if (!data || !data->buf || data->len < 64) return;

  // Filter: ONLY process CSI for frames originating from our locked target router
  if (routerLocked && data->mac && memcmp(data->mac, targetBssid, 6) != 0) return;

  csiPackets++;
  int numPairs = min((int)(data->len / 2), 64);

  // 1. Compute instantaneous total power for AGC (Automatic Gain Control) normalization
  float frameEnergySum = 0.0f;
  int activeCount = 0;
  float rawAmp[64];

  for (int i = 0; i < numPairs; i++) {
    int8_t real = data->buf[i * 2];
    int8_t imag = data->buf[i * 2 + 1];
    float amp = sqrtf((float)(real * real + imag * imag));
    rawAmp[i] = amp;
    if (isActiveSubcarrier(i)) {
      frameEnergySum += amp;
      activeCount++;
    }
  }

  float meanActiveAmp = (activeCount > 0) ? (frameEnergySum / activeCount) : 14.0f;
  if (meanActiveAmp < 1.0f) meanActiveAmp = 1.0f;

  // Normalize subcarriers to a consistent reference scale (mean = 16.0) to eliminate AGC jumps
  float scaleFactor = 16.0f / meanActiveAmp;

  float temporalDiffSum = 0.0f;
  for (int i = 0; i < 64; i++) {
    if (i < numPairs && isActiveSubcarrier(i)) {
      float normAmp = rawAmp[i] * scaleFactor;
      uint8_t clamped = (uint8_t)min(255.0f, max(1.0f, normAmp));
      rawSubcarriers[i] = clamped;

      if (!csiInitialized) {
        csiEma[i] = normAmp;
        csiFastEma[i] = normAmp;
      } else {
        csiFastEma[i] = 0.45f * normAmp + 0.55f * csiFastEma[i];
        float diff = csiFastEma[i] - csiEma[i];
        temporalDiffSum += diff * diff;
        // Slow baseline tracks static furniture reflections
        csiEma[i] = 0.94f * csiEma[i] + 0.06f * normAmp;
      }
    } else {
      // Interpolate guard bands / DC null smoothly for clean UI visualization
      rawSubcarriers[i] = 14;
    }
  }

  // Smooth DC carrier (index 32) from neighbors 31 & 33
  rawSubcarriers[32] = (rawSubcarriers[31] + rawSubcarriers[33]) / 2;
  for (int i = 0; i < 6; i++) rawSubcarriers[i] = rawSubcarriers[6];
  for (int i = 59; i < 64; i++) rawSubcarriers[i] = rawSubcarriers[58];

  // Compute adjacent subcarrier differential spread (σ²Δ) across active tones ONLY
  float adjDiffs[52];
  int dCount = 0;
  float diffMean = 0.0f;
  for (int i = 6; i < 58; i++) {
    if (i == 31 || i == 32) continue; // Skip DC null boundary
    float d = fabsf((float)rawSubcarriers[i + 1] - (float)rawSubcarriers[i]);
    adjDiffs[dCount++] = d;
    diffMean += d;
  }
  if (dCount > 0) {
    diffMean /= dCount;
    float dVarSum = 0.0f;
    for (int j = 0; j < dCount; j++) {
      float dv = adjDiffs[j] - diffMean;
      dVarSum += dv * dv;
    }
    csiDecorrelation = 0.70f * csiDecorrelation + 0.30f * (dVarSum / dCount);
  }

  if (!csiInitialized) {
    csiInitialized = true;
    csiVariance = 0.25f;
  } else if (activeCount > 0) {
    float rmsDiff = sqrtf(temporalDiffSum / activeCount);
    csiVariance = 0.65f * csiVariance + 0.35f * rmsDiff;
  }
}

// Promiscuous RX Callback: Intercepts 802.11 Management & Data frames from Target Router
void IRAM_ATTR wifiPromiscuousCallback(void* buf, wifi_promiscuous_pkt_type_t type) {
  wifi_promiscuous_pkt_t* pkt = (wifi_promiscuous_pkt_t*)buf;
  if (pkt->rx_ctrl.sig_len < 24) return;

  // Address 2 (Transmitter MAC / TA) is at offset 10 in 802.11 MAC header
  const uint8_t* ta = &pkt->payload[10];
  // Address 3 (BSSID) is at offset 16
  const uint8_t* bssid = &pkt->payload[16];

  bool fromTarget = (memcmp(ta, targetBssid, 6) == 0) || (memcmp(bssid, targetBssid, 6) == 0);
  if (!fromTarget) return;

  beaconPackets++;
  lastBeaconTimeMs = millis();
  int8_t rssi = pkt->rx_ctrl.rssi;

  // Reject impossible hardware glitch spikes (e.g., 0 or > -15 dBm or < -98 dBm)
  if (rssi >= -10 || rssi < -98) return;

  rssiBuf[rssiIndex] = rssi;
  rssiIndex = (rssiIndex + 1) % RSSI_BUF_SIZE;
  if (rssiCount < RSSI_BUF_SIZE) rssiCount++;

  // Update Fast & Slow Exponential Moving Averages
  if (rssiCount == 1) {
    fastEmaRssi = (float)rssi;
    slowEmaRssi = (float)rssi;
    currentAvgRssi = (float)rssi;
  } else {
    fastEmaRssi = 0.25f * (float)rssi + 0.75f * fastEmaRssi;
    slowEmaRssi = 0.04f * (float)rssi + 0.96f * slowEmaRssi;
  }

  // Compute exact floating-point mean & variance across rolling window
  if (rssiCount >= 5) {
    float sum = 0.0f;
    for (int k = 0; k < rssiCount; k++) sum += (float)rssiBuf[k];
    float mean = sum / rssiCount;
    currentAvgRssi = 0.40f * mean + 0.60f * currentAvgRssi;

    float vSum = 0.0f;
    for (int k = 0; k < rssiCount; k++) {
      float d = (float)rssiBuf[k] - mean;
      vSum += d * d;
    }
    float rawVar = vSum / rssiCount;
    // Include fast-vs-slow EMA divergence to capture body shadowing step changes immediately
    float emaDivergence = (fastEmaRssi - slowEmaRssi) * (fastEmaRssi - slowEmaRssi);
    currentVariance = 0.60f * rawVar + 0.40f * emaDivergence;
  }
}

// Auto-Discovery: Scans all 2.4 GHz channels to find TARGET_SSID's true BSSID and channel
void discoverTargetRouter() {
  Serial.println("{\"msg\":\"Scanning 2.4 GHz spectrum for target router...\"}");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  int n = WiFi.scanNetworks(false, true);
  int bestRssi = -1000;
  int foundIdx = -1;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    uint8_t* bssid = WiFi.BSSID(i);

    // Match either by configured SSID or configured BSSID
    bool ssidMatch = (strlen(TARGET_SSID) > 0 && ssid.equalsIgnoreCase(TARGET_SSID));
    bool bssidMatch = (memcmp(bssid, targetBssid, 6) == 0);

    if (ssidMatch || bssidMatch) {
      if (WiFi.RSSI(i) > bestRssi) {
        bestRssi = WiFi.RSSI(i);
        foundIdx = i;
      }
    }
  }

  if (foundIdx >= 0) {
    memcpy(targetBssid, WiFi.BSSID(foundIdx), 6);
    activeChannel = WiFi.channel(foundIdx);
    routerLocked = true;
    Serial.printf(
      "{\"msg\":\"Locked onto AP [%s] on Channel %d (RSSI: %d dBm)\"}\n",
      WiFi.SSID(foundIdx).c_str(),
      activeChannel,
      bestRssi
    );
  } else {
    // Fallback: retain configured BSSID and channel
    routerLocked = true;
    Serial.printf(
      "{\"msg\":\"Using configured BSSID on Channel %d\"}\n",
      activeChannel
    );
  }
  WiFi.scanDelete();
}

void setup() {
  Serial.begin(115200);
  delay(150);

  pinMode(onboardLed, OUTPUT);
  pinMode(extLed, OUTPUT);
  digitalWrite(onboardLed, LOW);
  digitalWrite(extLed, LOW);

  for (int i = 0; i < 64; i++) {
    rawSubcarriers[i] = 16;
    csiEma[i] = 16.0f;
    csiFastEma[i] = 16.0f;
  }

  // 1. Dynamically discover the router's current channel & BSSID
  discoverTargetRouter();

  // 2. Associate with AP so hardware CSI engine receives constant HT-LTF / LLTF frames
  WiFi.mode(WIFI_STA);
  WiFi.begin(TARGET_SSID, TARGET_PASS, activeChannel, targetBssid);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 4000) {
    delay(150);
    digitalWrite(onboardLed, !digitalRead(onboardLed));
  }

  // 3. Lock hardware radio onto the discovered channel
  esp_wifi_set_channel(activeChannel, WIFI_SECOND_CHAN_NONE);

  // 4. Enable Promiscuous Sniffer for both Management (Beacons) and Data frames
  wifi_promiscuous_filter_t filter = {
    .filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT | WIFI_PROMIS_FILTER_MASK_DATA
  };
  esp_wifi_set_promiscuous_filter(&filter);
  esp_wifi_set_promiscuous_rx_cb(wifiPromiscuousCallback);
  esp_wifi_set_promiscuous(true);

  // 5. Enable Hardware CSI Engine for 64-OFDM subcarriers
  wifi_csi_config_t csi_config = {
    .lltf_en = true,
    .htltf_en = true,
    .stbc_htltf2_en = true,
    .ltf_merge_en = true,
    .channel_filter_en = true,
    .manu_scale = false,
    .shift = 0
  };
  esp_wifi_set_csi_config(&csi_config);
  esp_wifi_set_csi_rx_cb(wifiCsiCallback, NULL);
  esp_wifi_set_csi(true);

  digitalWrite(onboardLed, LOW);
  Serial.printf("{\"msg\":\"ESP32 Precision RF Radar Armed on Ch%d\"}\n", activeChannel);
}

void loop() {
  unsigned long now = millis();

  // Slowly adapt the ambient noise floor when the room is calm
  if (!isMotion && currentVariance < dynamicNoiseFloor * 2.2f) {
    dynamicNoiseFloor = 0.992f * dynamicNoiseFloor + 0.008f * max(0.08f, currentVariance);
  }
  dynamicNoiseFloor = constrain(dynamicNoiseFloor, 0.08f, 0.55f);

  // Calculate dynamic trigger thresholds relative to room noise floor
  float effectiveVarThresh = max(baseVarianceThresh, dynamicNoiseFloor * 3.2f);
  snrRatio = currentVariance / max(0.08f, dynamicNoiseFloor);

  // Dual-Engine Motion Trigger: RSSI Multipath Variance OR CSI Subcarrier Perturbation
  bool frameDisturbed = (currentVariance >= effectiveVarThresh) || (csiVariance >= baseCsiThresh);

  if (frameDisturbed) {
    consecutiveActiveFrames = min(10, consecutiveActiveFrames + 1);
  } else {
    consecutiveActiveFrames = max(0, consecutiveActiveFrames - 1);
  }

  // Require at least 2 consecutive disturbed samples (200ms) to eliminate single-packet RF glitches
  if (consecutiveActiveFrames >= 2) {
    lastMotionTime = now;
    if (!isMotion) {
      isMotion = true;
      triggerCount++;
      digitalWrite(onboardLed, HIGH);
      digitalWrite(extLed, HIGH);
    }
  } else if (isMotion && (now - lastMotionTime > DWELL_TIME_MS)) {
    isMotion = false;
    digitalWrite(onboardLed, LOW);
    digitalWrite(extLed, LOW);
  }

  // Stream High-Precision Telemetry over Serial @ 10 Hz (every 100ms)
  static unsigned long lastPrint = 0;
  if (now - lastPrint >= 100) {
    lastPrint = now;

    Serial.print("{\"motion\":");
    Serial.print(isMotion ? "true" : "false");
    Serial.print(",\"rssi\":");
    Serial.print(currentAvgRssi, 2);
    Serial.print(",\"fastRssi\":");
    Serial.print(fastEmaRssi, 2);
    Serial.print(",\"slowRssi\":");
    Serial.print(slowEmaRssi, 2);
    Serial.print(",\"variance\":");
    Serial.print(currentVariance, 3);
    Serial.print(",\"noiseFloor\":");
    Serial.print(dynamicNoiseFloor, 3);
    Serial.print(",\"snr\":");
    Serial.print(snrRatio, 2);
    Serial.print(",\"csiVariance\":");
    Serial.print(csiVariance, 3);
    Serial.print(",\"decorrelation\":");
    Serial.print(csiDecorrelation, 2);
    Serial.print(",\"triggers\":");
    Serial.print(triggerCount);
    Serial.print(",\"channel\":");
    Serial.print(activeChannel);
    Serial.print(",\"locked\":");
    Serial.print((now - lastBeaconTimeMs < 3000) ? "true" : "false");
    Serial.print(",\"beacons\":");
    Serial.print(beaconPackets);

    // Stream 64 sanitized OFDM subcarriers
    Serial.print(",\"subcarriers\":[");
    for (int i = 0; i < 64; i++) {
      if (i > 0) Serial.print(",");
      Serial.print(rawSubcarriers[i]);
    }
    Serial.println("]}");
  }

  delay(10);
}
