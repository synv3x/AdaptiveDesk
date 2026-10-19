# Future design: BLE Wi-Fi provisioning (ESP32-S3 final version)

**Status: design only. Not implemented.** Today, USB serial is the primary transport and Wi-Fi credentials are compiled in from a git-ignored `secrets.h`. The final ESP32-S3 console needs a way to get onto Wi-Fi without recompiling.

## Goals
- First-time setup from the dashboard with no cable, no recompiling, no credentials in source control.
- Credentials never pass through the GitHub Pages site, the bridge, or any log.
- USB serial keeps working as the always-available fallback and for debugging.

## Proposed workflow

1. **Provisioning mode.** The console enters it when it has no stored network, or when the user holds a physical control (e.g. the Workspace Action button) for ~5 s. It shows a short one-time **proof-of-possession (PoP) code** on the OLED and advertises over BLE as `AdaptiveDesk-XXXX` for at most 3 minutes.
2. **Dashboard connects over Web Bluetooth** (Chrome/Edge; works on `localhost` and HTTPS, so GitHub Pages can do this step). The user picks the device and types the PoP code shown on the OLED.
3. **Secure session.** Use the ESP-IDF `wifi_provisioning` manager over BLE with **Security 2** (SRP6a with the PoP as the secret) so credentials are encrypted end to end and the PoP is never sent in the clear. (Security 1 is the fallback.)
4. **Network scan.** The console scans and returns SSIDs + signal strength; the dashboard lists them (2.4 GHz only on ESP32).
5. **Send credentials.** The user selects a network and enters the password; the dashboard writes it over the encrypted channel and does not store it.
6. **Apply and report.** The console tries to join and notifies status over BLE: `connecting` → `connected(ip)` or `failed(reason: wrong password / not found / DHCP)`. On failure the user can retry without leaving the flow.
7. **Persist and hand off.** On success the credentials are saved to NVS (flash encryption + NVS encryption enabled in the production build), BLE provisioning shuts down, the console announces `adaptivedesk.local` via mDNS and starts its WebSocket server. The dashboard offers to switch to the Wi-Fi connection type with the reported address.
8. **Re-provisioning / reset.** Holding the button for ~10 s (or an authenticated command over USB) erases stored credentials and re-enters step 1.

## Components to build
- **Firmware (ESP32-S3):** NimBLE stack + `wifi_provisioning` (BLE scheme, Security 2), provisioning-mode state machine, OLED PoP display, NVS storage, status notifications, factory-reset gesture. Keep the existing JSON protocol unchanged; provisioning is a separate GATT service.
- **Dashboard:** a "Set up Wi-Fi" wizard in Settings (Web Bluetooth). Steps: connect → PoP → pick network → password → progress → result. A feature check hides it when Web Bluetooth is unavailable (Firefox/Safari) and points to USB instead.
- **Docs/tests:** a Web Bluetooth simulator for UI tests; real-device tests of wrong-password, out-of-range and timeout paths.

## Security considerations
- Provisioning window is short, user-initiated, and requires physical access (OLED PoP), so a passer-by cannot onboard the console to their network.
- Credentials exist only on the encrypted BLE channel and in device flash; never in the dashboard's `localStorage`, logs, or exports.
- Rate-limit PoP attempts and close the window after repeated failures.
- After provisioning, the WebSocket/Wi-Fi transport should gain authentication (shared token issued during provisioning) and TLS (`wss://`), since the current prototype is plain `ws://` with no auth. That also removes the HTTPS mixed-content limitation for the hosted dashboard.
- The USB bridge stays loopback-only with an origin allow-list.

## Open questions
- Web Bluetooth is not available on iOS Safari/Firefox: is a phone provisioning app needed, or is "provision once from a laptop with Chrome/Edge" enough for the capstone?
- Which gesture on the final enclosure triggers provisioning/reset?
- Does the wristband (nRF52840, BLE) share the console's BLE radio time with provisioning, or is provisioning only allowed before the wristband is paired?
