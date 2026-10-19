# AdaptiveDesk USB serial bridge (legacy)

> The dashboard now talks to the ESP32 directly over USB with native Web Serial (Settings → Connection type → *USB · Web Serial*), so this bridge is optional. It remains for browsers without Web Serial.

Relays the ESP32's USB serial JSON (newline-delimited, 115200 baud) to the dashboard's WebSocket client at `ws://127.0.0.1:8787/ws`, so the dashboard works with **no Wi-Fi**. Full walkthrough: `../../docs/hardware-demo-setup.md`.

```powershell
npm install            # once (needs internet)
npm run ports          # find your COM port
npm start -- --port COM5
```

Options: `--port COM5|auto` (or env `ADAPTIVEDESK_PORT`), `--baud 115200`, `--ws-port 8787`, `--allow-origin <url>`, `--list`.

While running, type + Enter: `p` release the COM port (to upload firmware or use Serial Monitor), `r` take it back, `l` list ports, `q` quit. Only one program can own a COM port, so close Serial Monitor before starting the bridge or use `p`.

The bridge prints the firmware's debug lines as `[esp32] …`, so it doubles as a serial monitor.

## Behaviour and safety
- Listens on `127.0.0.1` only. Browser connections are accepted only from `localhost`/`127.0.0.1` and the project's GitHub Pages origin (add more with `--allow-origin`).
- Only protocol-v1 JSON of known types passes, each way. Everything is re-serialised, so a message can never carry a second line to the board.
- The dashboard can only connect while the ESP32 is actually answering; otherwise it is refused with a readable reason. If the board goes silent for 3 s, dashboards are disconnected and reconnect automatically when it returns.
- A once-a-second keep-alive makes the firmware stream telemetry (it stays quiet if no bridge is attached).
- DTR/RTS are held low after opening so the board isn't left in reset or bootloader mode (some boards still restart once on open).

## Tests
`npm test` runs the bridge against a mock serial port and a **simulated** ESP32 (no hardware needed).
