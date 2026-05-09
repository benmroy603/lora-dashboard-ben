# Baja Telemetry Workbench

A Next.js + shadcn dashboard scaffold for reading Baja car telemetry over a serial connection in desktop Chrome.

## Current Scope

- Detect Web Serial support in Chrome.
- Request a COM port with the browser permission picker.
- Re-open previously authorized ports.
- Open the port with a configurable baud rate.
- Decode the receiver's framed `fast`, `medium`, and `slow` telemetry packets.
- Show all packet fields plus RSSI/SNR from the receiver's serial frame.

This is the bench-test stage. The serial link parses the receiver sketch's framed binary packets into dashboard fields.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL printed by Next.js in desktop Chrome. If port `3000` is already in use, Next.js will choose another port such as `3001`.

## First Hardware Test

1. Plug in the Arduino or telemetry board.
2. Open the app in desktop Chrome on `http://localhost:*`.
3. Enter the correct baud rate for the sketch.
4. Click `Grant & Connect Port`.
5. Choose the board from Chrome's serial picker.
6. Watch `Decoded Telemetry` for live packet fields.

## Notes

- Web Serial works in secure contexts such as `localhost` or HTTPS.
- The serial API is browser-side only, so the serial reader lives in a client component.
- Some Arduino boards reset when the serial port is opened, so expect a short reconnect window when testing.
- The parser expects the receiver frame format: payload length, payload bytes, RSSI float32, then SNR float32.
