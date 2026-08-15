# Project Instructions

## Project overview

This project is a prototype wearable-device system using Raspberry Pi Zero W.

The prototype workflow is:

1. Detect another device using Bluetooth.
2. Determine proximity using Bluetooth RSSI.
3. Create a proximity event.
4. Send the event to a server over Wi-Fi.
5. Display the received event on a web page.

The final system may also include:

- vibration motor
- GPS
- heart-rate sensor
- audio recording
- CHIRIMEN

## Development environment

- JavaScript
- Node.js
- npm
- Raspberry Pi Zero W
- CHIRIMEN
- Git

## Project structure

- `src/` contains JavaScript code that runs on the Raspberry Pi.
- `server/` will contain server-side code.
- `web/` will contain browser-side code.

## Development rules

- Use JavaScript with ES modules (`import` / `export`).
- Prefer simple code that is easy for beginners to understand.
- Add comments for important logic.
- Do not add unnecessary libraries.
- Separate Bluetooth detection, proximity detection, and upload logic into different modules.
- Do not implement hardware-dependent features until requested.
- Keep the prototype simple.

## Current goal

For now, focus on:

Bluetooth detection
→ proximity detection
→ Wi-Fi upload
→ web display

GPS, heart-rate sensing, audio recording, and vibration will be added later.