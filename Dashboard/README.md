# AdaptiveDesk Dashboard

Local web dashboard for the AdaptiveDesk workspace system. React + TypeScript + Vite + Tailwind v4, Zustand, Recharts, Motion, React Router.
It runs on your PC and talks to the ESP32 over a WebSocket on your local network. There is no backend, cloud or database.

## Run it

Requires Node.js LTS (`winget install OpenJS.NodeJS.LTS`, then reopen the terminal).

```powershell
cd Dashboard
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run typecheck
```

## Demo vs Live (strictly separate)

| | Demo | Live |
|---|---|---|
| Device | Simulated in the browser (`src/services/demoDevice.ts`) | Your ESP32 over `ws://<host>:<port><path>` |
| Activity / sessions | Own log, seeded with labeled sample data | Own log, only real events and sessions |
| Banner | Always visible "Demo Mode" | none |

Switch with the Live/Demo control in the top bar. Switching stops any running timer. Demo has a "Minimal" hardware profile (Settings → Device & Network) that shows how the UI looks with most hardware missing, plus buttons to trigger simulated events.

## Connecting a real device (Live)

Three transports carry the same protocol. Pick one in Settings → Device & Network:

- **USB · Web Serial (default, no Wi-Fi, no helper program):** the browser talks to the ESP32 directly over USB (`src/services/webSerial.ts`). Click **Connect ESP32** and choose the port; it is remembered and reconnected automatically. Works in Chrome/Edge; in Brave enable `brave://flags/#brave-web-serial-api`. Must be served from `localhost` or HTTPS. See `../docs/hardware-demo-setup.md`.
- **Wi-Fi (optional):** enter the console's address, port and path; needs credentials compiled into the firmware (`secrets.h`) and the local dev server (an HTTPS page can't open `ws://` to a LAN device).
- **USB bridge (legacy):** `../tools/serial-bridge` relays serial to `ws://127.0.0.1:8787/ws`.

Selecting Web Serial never opens a WebSocket. Tests: `npm test` (Vitest, simulated serial).

The client treats a link as "connected" only after the device itself sends a message, so a running bridge with no board behind it shows an honest error instead of a fake connected state.

## Wire protocol v1

JSON text frames. Every message carries `"protocolVersion": 1`. Messages over 16 KB, binary frames, bad JSON, unknown types and unknown feature ids are rejected/ignored and noted in Advanced diagnostics.

Device → dashboard
- `hello` `{deviceId, name?, firmware?, board?, features, system?}` on connect
- `telemetry` `{deviceId, timestamp?, features, system?}` whenever state changes (and in reply to `requestState`)
- `ack` `{requestId, ok, error?}`
- `event` `{event, feature?, detail?}`. Known events: `workspaceAction.pressed`, `control.activated` (detail = control id), `auth.success`, `auth.failed`
- `pong` `{timestamp}` (echo of `ping.timestamp`)

Dashboard → device: `command {requestId, feature, action, value?}`, `ping {timestamp}`, `requestState`.

`features` maps a feature id to `{available: bool, status?: "active"|"disabled"|"connecting"|"error", error?, ...fields}`. A feature the device doesn't list, or lists with `available:false`, is shown as "Not connected" and its controls are inert.

| Feature id | Reported fields | Commands |
|---|---|---|
| `workspacePresence` | `value: bool` | none |
| `ambientLighting` | `enabled`, optional `brightness 0-100`, `color` (`#rrggbb`), `brightnessSource` (`"physical"` = a slide control owns brightness and `setBrightness` is not offered), `scene`, `scenes[]` | `setEnabled`, `setBrightness`, `setColor`, `setScene` |
| `workspaceAction` | `pressCount` | none (emits `workspaceAction.pressed`) |
| `privacyProtection` | `enabled` | `setEnabled` (sensitive) |
| `workstationLock` | `locked: bool` | `lock` (sensitive) |
| `userAuthentication` | `lastResult: "success"\|"failed"`, `lastAt` | none |
| `mediaControl` | `volume`, `playing` | `playPause`, `next`, `previous`, `setVolume` |
| `productivityControls` | `lastControl` | none (emits `control.activated`) |
| `slideControl` | `position 0-100`, optional `raw` | none |
| `pressureSensing` | `value 0-100`, `pressed: bool`, `threshold`, optional `raw` | `setThreshold` (5-95) |
| `audioAlert` | `active: bool`, `muted: bool` | `test`, `setMuted` |
| `wearable` | `connected`, `pairing`, optional `battery`, `charging`, `intensity`, `intensityLevels[]` | `startPairing`, `stopPairing`, `disconnect`, `vibrate`, `setIntensity` |

### Reliability rules implemented
- **Commands are never proof.** UI controls render the device's last *reported* state; an `ack` only means "accepted". Pending commands time out after 5 s and are failed (never replayed) on disconnect or reconnect.
- **Heartbeat + watchdog:** `ping` every 3-15 s (setting); no traffic for 3× that → connection dropped and retried with backoff (1 s → 15 s).
- **No stale values:** when not connected, all feature state is cleared and every feature shows unavailable.
- **No automatic action after reconnect:** the first `hello`/`telemetry` after connecting is a baseline and triggers no events; absence timers are tied to a single connection session.
- **Lock is never claimed early:** "Locked" appears only when `workstationLock.locked === true` is reported. Rule/lock results say "acknowledged".
- Commands are validated against an allow-list (`src/lib/features.ts`) before sending. Sensitive actions (lock, disable privacy, disconnect wristband, enabling lock rules) require confirmation.

## Classroom hardware demo

The Overview page has a labeled **Hardware demo** card (slide control, pressure, RGB light, buzzer). In Demo Mode it is simulated; in Live Mode it shows only what the console reports. Firmware, wiring and run steps: `../docs/hardware-demo-setup.md`. Live Mode needs the local dev server (`npm run dev`): the GitHub Pages site is HTTPS and browsers block it from reaching a `ws://` device (the dashboard says so instead of failing silently).

## Adding hardware later

The dashboard only knows logical features. To light one up: implement it in firmware and report `available: true` for its feature id. Nothing in the UI needs to change. GPIO assignments belong in firmware, never here.

## Layout

```
src/lib        feature registry, protocol + validators, automation vocabulary, event bus, stats
src/services   deviceClient (WebSocket, heartbeat, reconnect), demoDevice, automationEngine, notifier, runtime
src/store      zustand: device (reported state, pending cmds), prefs, session (timer), automation, activity
src/pages      the 8 pages
src/components ui primitives, layout shell, shared widgets
```

Persisted in `localStorage` (`adaptivedesk.*`): preferences, profiles, rules, sessions, activity. Persisted preferences are *never* treated as device state.

## Known limitations
- Prototype security: the WebSocket is plain `ws://` with no authentication. Anyone on the same network who can reach the device could talk to it. Use a trusted network; add a shared token + TLS before any real deployment.
- Wi-Fi credentials are configured in firmware, not through the dashboard (the dashboard never handles them).
- Locking the PC and macro/keystroke output require USB HID support in the console firmware (not present yet), so those stay unavailable/stored-only.
- Browser notifications need permission; timers use wall-clock time so they survive refreshes, but background-tab throttling can delay the completion alert by up to a second.
- No automated test suite yet. Verification so far: strict `tsc`, production build, and headless-browser smoke tests of all routes in both modes.
