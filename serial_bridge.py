import sys
import time
import json
import serial
import serial.tools.list_ports

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False

BAUD = 115200
API_URL = "http://localhost:3000/api/esp32"

print("[BRIDGE] Starting High-Precision ESP32 Serial Bridge (10 Hz)...", flush=True)

session = requests.Session() if HAS_REQUESTS else None


def find_esp32_port():
    ports = serial.tools.list_ports.comports()
    if not ports:
        return None
    # 1. Prefer COM3 or devices with USB / CP210 / CH340 / UART in description
    for p in ports:
        desc = (p.description or "").lower()
        dev = p.device
        if dev == "COM3" or any(k in desc for k in ["cp210", "ch340", "uart", "usb", "serial", "esp"]):
            return p.device
    # 2. Fallback to first available port
    return ports[0].device


def post_telemetry(payload):
    try:
        if HAS_REQUESTS and session is not None:
            session.post(API_URL, json=payload, timeout=0.25)
        else:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                API_URL, data=data, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=0.25):
                pass
    except Exception:
        pass


def main():
    waiting_announced = False

    while True:
        port = find_esp32_port()
        if not port:
            if not waiting_announced:
                print("[BRIDGE] Waiting for ESP32 to be connected via USB...", flush=True)
                waiting_announced = True
            time.sleep(1)
            continue

        waiting_announced = False

        try:
            print(f"[BRIDGE] Found port {port}! Connecting at {BAUD} baud...", flush=True)
            ser = serial.Serial()
            ser.port = port
            ser.baudrate = BAUD
            ser.dtr = False
            ser.rts = False
            ser.timeout = 1.0
            ser.open()
            print(f"[BRIDGE] Linked to ESP32 on {port}! Streaming telemetry to {API_URL}...", flush=True)

            while True:
                raw_bytes = ser.readline()
                if not raw_bytes:
                    continue
                line = raw_bytes.decode("utf-8", errors="ignore").strip()
                if not line or not line.startswith("{"):
                    continue

                try:
                    parsed = json.loads(line)
                    # Ignore status boot messages that only contain "msg"
                    if "msg" in parsed and "rssi" not in parsed:
                        print(f"[ESP32] {parsed['msg']}", flush=True)
                        continue

                    payload = {
                        "ip": f"{port} (Ch{parsed.get('channel', 8)})",
                        "rssi": float(parsed.get("rssi", -60.0)),
                        "fastRssi": float(parsed.get("fastRssi", parsed.get("rssi", -60.0))),
                        "slowRssi": float(parsed.get("slowRssi", parsed.get("rssi", -60.0))),
                        "variance": float(parsed.get("variance", 0.0)),
                        "noiseFloor": float(parsed.get("noiseFloor", 0.18)),
                        "snr": float(parsed.get("snr", 1.0)),
                        "csiVariance": float(parsed.get("csiVariance", 0.0)),
                        "decorrelation": float(parsed.get("decorrelation", 0.0)),
                        "motion": bool(parsed.get("motion", False)),
                        "triggerCount": int(parsed.get("triggers", 0)),
                        "subcarriers": parsed.get("subcarriers", []),
                        "locked": bool(parsed.get("locked", True)),
                        "beacons": int(parsed.get("beacons", 0)),
                        "channel": int(parsed.get("channel", 8)),
                    }
                    post_telemetry(payload)
                except (json.JSONDecodeError, ValueError):
                    pass
        except serial.SerialException as se:
            print(f"[BRIDGE] Serial port {port} disconnected ({se}). Waiting for reconnect...", flush=True)
            time.sleep(1)
        except Exception as e:
            print(f"[BRIDGE] Connection error: {e}. Retrying...", flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main()
