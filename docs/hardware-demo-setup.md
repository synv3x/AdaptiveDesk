# Hardware demo: setup and run guide (USB, native Web Serial)

Board: ESP32 DevKit V1 (`esp32doit-devkit-v1`) with a CH340 USB-serial chip. Firmware: `firmware/Desktop-ESP32`, environment `adaptivedesk_demo`.

**How it connects:** the dashboard talks to the ESP32 *directly from the browser* over USB using the Web Serial API. No bridge program, no Wi-Fi, no internet at runtime.

```
sensors/LED/buzzer ── ESP32 ──USB cable──> browser (Web Serial) = dashboard at http://localhost:5173
```
The old Node.js serial bridge (`tools/serial-bridge`) and Wi-Fi remain available as optional transports (Settings → Device & Network).

## Wiring

| Part | Wiring | GPIO |
|---|---|---|
| Slide potentiometer (10 kΩ) | outer pins to 3V3 and GND, wiper to the pin | **32** (ADC1) |
| FSR + 10 kΩ divider | FSR from 3V3 to the pin; 10 kΩ from the pin to GND | **33** (ADC1) |
| RGB LED (common cathode) | R, G, B through 330 Ω each; common leg to GND | **18** R, **13** G, **14** B |
| Active buzzer module | VCC to 3V3, GND to GND, signal to the pin | **25** |

Pins and calibration: `firmware/Desktop-ESP32/include/hardware_config.h` (`SLIDER_INVERT`, `FSR_INVERT`, `BUZZER_ACTIVE_LOW` if something is backwards).

## Do these tonight, while you still have internet

1. `cd firmware\Desktop-ESP32` then `pio run -e adaptivedesk_demo` (downloads the toolchain the first time).
2. `cd Dashboard` then `npm install`.
After that everything works offline.

## 1. Upload the firmware (once)

Wi-Fi credentials are **not** required; with no `include/secrets.h` the firmware is USB-only.

```powershell
cd firmware\Desktop-ESP32
pio run -e adaptivedesk_demo -t upload
```
If upload hangs on "Connecting…", hold the board's **BOOT** button. **Close PlatformIO Serial Monitor afterwards**: only one program can own the COM port, and the dashboard needs it.

## 2. Use the browser's Web Serial

Web Serial works in **Chrome and Edge** out of the box. **Brave disables it by default.** To enable it:
1. Open `brave://flags/#brave-web-serial-api`
2. Set it to **Enabled**, click **Relaunch**.

(Not verified in Brave on your machine by me: if the flag name differs in your Brave version, search `serial` in `brave://flags`, or use Chrome/Edge.) The page must be `http://localhost` or HTTPS, which `npm run dev` gives you.

## 3. Start the dashboard and connect

```powershell
cd Dashboard
npm run dev            # http://localhost:5173
```
1. Open http://localhost:5173 in Brave.
2. Make sure **Live** is selected in the top bar (default).
3. Click **Connect ESP32** (on the Overview, or **Settings → Device & Network**). The browser shows a port list: choose **USB-SERIAL CH340 (COMx)** and click **Connect**.
4. Within a couple of seconds the top bar turns green ("Connected · USB") and the **Hardware demo** card shows live values. **Settings → Device & Network** shows status, last-message time and message count.

If your board isn't listed, click **My ESP32 isn't listed** to see all ports.

After this first time the browser remembers the port: reloading the page or replugging the cable **reconnects automatically**. **Disconnect** stops that until you connect again.

Opening the port may restart the ESP32 once; the dashboard waits for it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Web Serial isn't available here" | Use Chrome/Edge, or enable `brave://flags/#brave-web-serial-api` and relaunch Brave. Must be on `localhost`. |
| Port list is empty / board missing | Charge-only cable, or CH340 driver not installed (Device Manager → Ports). Try another cable/port. |
| "Couldn't open the serial port… Serial Monitor" | Another program owns the port: close PlatformIO Serial Monitor, Arduino IDE, the old bridge, other tabs. |
| "The serial port opened, but the ESP32 isn't answering" | Board not running this firmware (re-upload), or press its EN button; check 115200 baud. |
| "Lost the ESP32… unplugged" | Replug; it reconnects by itself. |
| Need to upload firmware | Click **Disconnect** first (releases the port), upload, then click **Reconnect to last ESP32**. |
| LED always dark | Slider at the bottom (0% brightness) or LED toggled off. |
| Buzzer sounds constantly | Set `BUZZER_ACTIVE_LOW true`, re-upload. |

## Optional transports
- **USB bridge (legacy):** `cd tools\serial-bridge; npm install; npm start -- --port COM5`, then Settings → Connection type → *USB bridge (legacy)*. See `tools/serial-bridge/README.md`.
- **Wi-Fi:** copy `include/secrets.example.h` to `secrets.h`, set your 2.4 GHz network, rebuild/upload; Settings → *Wi-Fi*. Wi-Fi code is compiled in only when `secrets.h` has a real network name.

## What was and wasn't verified
See "Testing status" in `classroom-demo-checklist.md`.
