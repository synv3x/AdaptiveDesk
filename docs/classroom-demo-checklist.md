# Classroom demo checklist (USB, native Web Serial)

No Wi-Fi, router, internet or helper program is needed in the room. Details: `hardware-demo-setup.md`.

## Tonight (needs internet once)
- [ ] `cd firmware\Desktop-ESP32` then `pio run -e adaptivedesk_demo`
- [ ] `cd Dashboard; npm install`
- [ ] Upload firmware: `pio run -e adaptivedesk_demo -t upload`, then **close Serial Monitor**
- [ ] **Brave:** `brave://flags/#brave-web-serial-api` → Enabled → Relaunch (or use Chrome/Edge)
- [ ] `npm run dev`, open http://localhost:5173, **Connect ESP32**, pick "USB-SERIAL CH340", confirm live values
- [ ] Full dry run with the real parts ("Hardware test" below)
- [ ] Pack the **same USB cable/port you tested with** and a spare data cable

## Before class (3 minutes)
- [ ] Serial Monitor closed; nothing else using the COM port
- [ ] Plug in the ESP32 (LED responds to the slider on its own)
- [ ] `cd Dashboard; npm run dev`, open http://localhost:5173 (**not** the GitHub Pages link)
- [ ] **Live** selected → it reconnects by itself, or click **Connect ESP32** and choose the CH340
- [ ] Top bar **Connected · USB**; Overview → **Hardware demo** says "Live hardware"

## Hardware test (2 minutes)
- [ ] Move the slide pot: position % and LED brightness change on screen and on the real LED
- [ ] Slider to 0: LED dark; to 100: full
- [ ] Press the FSR gently then harder: pressure % rises; **Pressed** past the threshold; buzzer sounds
- [ ] Release: **Released**; buzzer stops
- [ ] Change **Buzzer threshold**: behaviour changes
- [ ] Colour presets / picker change the **real** LED
- [ ] **RGB light** switch turns the LED off/on
- [ ] **Test buzzer** beeps; **Mute** on = silent FSR press (badge **Muted**), Test disabled
- [ ] Unplug USB: dashboard shows offline; replug: reconnects by itself (a few seconds)
- [ ] Settings → Device & Network shows messages counting up and "Last message 0.x s ago"

## Talking points
- Logic runs on the ESP32; the browser talks to it **directly over USB (Web Serial)**, no middleware.
- Bidirectional and honest: commands are acknowledged by the ESP32 and the screen shows what the **device reports**.
- Wi-Fi and a serial bridge are optional extra transports; hardware not built yet is "Not connected", never faked; **Demo Mode** is labelled and simulated.

## If something goes wrong
| Problem | Do this |
|---|---|
| No "Connect ESP32" dialog / "Web Serial isn't available" | Brave flag not enabled, or not on localhost. Use Chrome/Edge |
| Board not in the list | Cable is charge-only / driver; click "My ESP32 isn't listed" |
| "…Serial Monitor…" error | Close whatever else holds the COM port, click Reconnect |
| "isn't answering" | Press the board's EN button; re-upload firmware |
| Need to re-upload | **Disconnect** in the dashboard first, upload, then Reconnect |
| Everything fails | Top bar → **Demo Mode** (needs nothing) and say so |

## Testing status (be upfront)
**Verified with SIMULATED serial (no real board, no real Brave):**
- 33 unit/integration tests (`npm test`): line buffering, partial/multiple lines, multi-byte split, debug-text separation, writes, keep-alive, close/lock cleanup, unplug, disconnect event, reopen after close, recoverable read errors, port selection, error messages, `DeviceClient` over a fake `navigator.serial` + fake firmware, double-connect safety, no WebSocket use.
- 29 browser end-to-end checks in headless Chrome with an injected fake `navigator.serial`: Connect ESP32 click → requestPort → live values → commands, no reopen on re-renders, unplug/replug, reload auto-reconnect, Disconnect respected, busy/cancel/unsupported messages, legacy bridge + Wi-Fi + Demo still present.
- Firmware untouched this round (it compiled earlier); legacy bridge tests still pass.

**NOT verified (needs your hardware/browser):** real Brave behaviour (including whether the flag exists under that name), real CH340 driver and COM port, whether opening the port resets your board, real timing/throughput, wiring/ADC/LED/buzzer behaviour.
