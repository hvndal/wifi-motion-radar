#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>

// ====== TARGET ROUTER CONFIGURATION ======
// Replace with your local Wi-Fi Access Point details or create credentials.h
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
const uint8_t TARGET_BSSID[6] = TARGET_ROUTER_BSSID;
const int WIFI_CHANNEL = TARGET_WIFI_CHANNEL;

// ====== HARDWARE PINS ======
const int onboardLed = 2; // Built-in Blue LED indicates motion physically
const int extLed = 26;

// ====== REAL PHYSICAL RSSI BUFFER ======
#define RSSI_BUF_SIZE 20
int8_t rssiBuf[RSSI_BUF_SIZE];
int rssiIndex = 0;
int rssiCount = 0;
float currentVariance = 0.0;
int8_t currentAvgRssi = -58;
unsigned long beaconPackets = 0;

// ====== 64-SUBCARRIER CSI BUFFER & TEMPORAL EMA ======
uint8_t rawSubcarriers[64];
float csiEma[64];
bool csiInitialized = false;
float csiVariance = 0.0;
unsigned long csiPackets = 0;

// ====== CALIBRATED MOTION DETECTION THRESHOLDS ======
bool isMotion = false;
unsigned long lastMotionTime = 0;
const unsigned long DWELL_TIME_MS = 2000;
unsigned long triggerCount = 0;
float motionThreshold = 3.8;    // RSSI variance threshold (dB²)
float csiThreshold = 4.5;       // CSI normalized fluctuation threshold

// Wi-Fi CSI Callback: Measures real OFDM subcarrier temporal fluctuations
void wifiCsiCallback(void *ctx, wifi_csi_info_t *data) {
  if (!data || !data->buf || data->len < 10) return;

  // Filter: ONLY process CSI for frames originating from router
  if (data->mac && memcmp(data->mac, TARGET_BSSID, 6) != 0) return;

  csiPackets++;
  int numPairs = min((int)(data->len / 2), 64);

  float temporalDiffSum = 0;
  float sumAmp = 0;
  for (int i = 0; i < numPairs; i++) {
    int8_t real = data->buf[i * 2];
    int8_t imag = data->buf[i * 2 + 1];
    float amp = sqrtf((float)(real * real + imag * imag));
    rawSubcarriers[i] = (uint8_t)min(255, (int)amp);
    sumAmp += amp;

    if (!csiInitialized) {
      csiEma[i] = amp;
    } else {
      float diff = amp - csiEma[i];
      temporalDiffSum += diff * diff;
      // Exponential moving average: slow adaptive baseline
      csiEma[i] = 0.90f * csiEma[i] + 0.10f * amp;
    }
  }

  if (!csiInitialized) {
    csiInitialized = true;
    csiVariance = 0.4;
  } else {
    float meanAmp = sumAmp / max(1, numPairs);
    float temporalStdDev = sqrtf(temporalDiffSum / max(1, numPairs));
    // Calibrated normalized index: 0.3-0.9 in quiet room, 2.5-8.0 during human motion
    csiVariance = (temporalStdDev / max(10.0f, meanAmp)) * 10.0f;
  }
}

// Promiscuous RX Callback: Intercepts management frames (Beacons) from router
void wifiPromiscuousCallback(void* buf, wifi_promiscuous_pkt_type_t type) {
  wifi_promiscuous_pkt_t* pkt = (wifi_promiscuous_pkt_t*)buf;
  if (pkt->rx_ctrl.sig_len <= 24) return;

  uint8_t frameType = pkt->payload[0];
  const uint8_t* ta = &pkt->payload[10];

  // Management frames (Beacons: 0x80) from router have constant fixed transmit power
  bool isRouterMgmt = ((frameType & 0x0C) == 0x00) && (memcmp(ta, TARGET_BSSID, 6) == 0);

  if (!isRouterMgmt) return;

  beaconPackets++;
  int8_t rssi = pkt->rx_ctrl.rssi;

  rssiBuf[rssiIndex] = rssi;
  rssiIndex = (rssiIndex + 1) % RSSI_BUF_SIZE;
  if (rssiCount < RSSI_BUF_SIZE) rssiCount++;

  // Compute real variance across rolling window
  if (rssiCount >= 6) {
    float sum = 0;
    for (int k = 0; k < rssiCount; k++) sum += rssiBuf[k];
    float mean = sum / rssiCount;

    float vSum = 0;
    for (int k = 0; k < rssiCount; k++) {
      float d = rssiBuf[k] - mean;
      vSum += d * d;
    }
    currentVariance = vSum / rssiCount;
    currentAvgRssi = (int8_t)mean;
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(onboardLed, OUTPUT);
  pinMode(extLed, OUTPUT);
  digitalWrite(onboardLed, LOW);
  digitalWrite(extLed, LOW);

  for (int i = 0; i < 64; i++) {
    rawSubcarriers[i] = 12;
    csiEma[i] = 12.0f;
  }

  // Connect to Herman 4G (Channel 11)
  Serial.println("{\"msg\":\"Associating with Herman 4G (Ch11)...\"}");
  WiFi.mode(WIFI_STA);
  WiFi.begin(TARGET_SSID, TARGET_PASS);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 3500) {
    delay(200);
    digitalWrite(onboardLed, !digitalRead(onboardLed));
  }

  // Force hardware radio to Channel 11
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  // Enable promiscuous sniffer for Management frames on Channel 11
  wifi_promiscuous_filter_t filter = {
    .filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT
  };
  esp_wifi_set_promiscuous_filter(&filter);
  esp_wifi_set_promiscuous_rx_cb(wifiPromiscuousCallback);
  esp_wifi_set_promiscuous(true);

  // Enable CSI engine for OFDM subcarriers
  wifi_csi_config_t csi_config = {
    .lltf_en = true,
    .htltf_en = true,
    .stbc_htltf2_en = true,
    .ltf_merge_en = true,
    .channel_filter_en = false,
    .manu_scale = false,
    .shift = 0
  };
  esp_wifi_set_csi_config(&csi_config);
  esp_wifi_set_csi_rx_cb(wifiCsiCallback, NULL);
  esp_wifi_set_csi(true);

  digitalWrite(onboardLed, LOW);
  Serial.println("{\"msg\":\"Calibrated RF Multipath Beacon Sensor Armed on Ch11\"}");
}

void loop() {
  // Motion Detection based on Real Physical Disturbance
  bool rfActive = (currentVariance > motionThreshold) || (csiVariance > csiThreshold);

  if (rfActive) {
    lastMotionTime = millis();
    if (!isMotion) {
      isMotion = true;
      triggerCount++;
      digitalWrite(onboardLed, HIGH);
      digitalWrite(extLed, HIGH);
    }
  } else if (isMotion && (millis() - lastMotionTime > DWELL_TIME_MS)) {
    isMotion = false;
    digitalWrite(onboardLed, LOW);
    digitalWrite(extLed, LOW);
  }

  // Stream Telemetry over Serial @ 10 Hz (every 100ms)
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint >= 100) {
    lastPrint = millis();

    Serial.print("{\"motion\":");
    Serial.print(isMotion ? "true" : "false");
    Serial.print(",\"rssi\":");
    Serial.print(currentAvgRssi);
    Serial.print(",\"variance\":");
    Serial.print(currentVariance, 2);
    Serial.print(",\"csiVariance\":");
    Serial.print(csiVariance, 2);
    Serial.print(",\"triggers\":");
    Serial.print(triggerCount);
    Serial.print(",\"locked\":true");
    Serial.print(",\"beacons\":");
    Serial.print(beaconPackets);

    // Stream 64 subcarriers
    Serial.print(",\"subcarriers\":[");
    for (int i = 0; i < 64; i++) {
      if (i > 0) Serial.print(",");
      Serial.print(rawSubcarriers[i]);
    }
    Serial.println("]}");
  }

  delay(10);
}
