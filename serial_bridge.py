import sys
import time
import json
import urllib.request
import serial
import serial.tools.list_ports

BAUD = 115200
API_URL = "http://localhost:3000/api/esp32"

print("[BRIDGE] Starting Auto-Detecting ESP32 Serial Bridge...", flush=True)

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
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(API_URL, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=0.2) as resp:
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
            print(f"[BRIDGE] Successfully linked to ESP32 on {port}! Streaming data to {API_URL}...", flush=True)

            while True:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if not line or not line.startswith('{'):
                    continue

                try:
                    parsed = json.loads(line)
                    payload = {
                        "ip": f"{port} (USB Auto-Link)",
                        "rssi": parsed.get("rssi", -50),
                        "variance": parsed.get("variance", 0.0),
                        "csiVariance": parsed.get("csiVariance", 0.0),
                        "motion": parsed.get("motion", False),
                        "triggerCount": parsed.get("triggers", 0),
                        "subcarriers": parsed.get("subcarriers", []),
                        "locked": parsed.get("locked", False)
                    }
                    post_telemetry(payload)
                except json.JSONDecodeError:
                    pass
        except serial.SerialException as se:
            print(f"[BRIDGE] Serial port {port} disconnected ({se}). Waiting for reconnect...", flush=True)
            time.sleep(1)
        except Exception as e:
            print(f"[BRIDGE] Connection error: {e}. Retrying...", flush=True)
            time.sleep(1)

if __name__ == "__main__":
    main()
