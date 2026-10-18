# NetPayload (MERN, runs in the browser)

Send a file to a device on your local network by IP address and port, over TCP or UDP, from a web page.

**Important:** a browser page cannot open raw TCP/UDP sockets. So the app has two parts:

```
Browser (React)  ──upload file (HTTP)──▶  NetPayload server (Node/Express)  ──TCP/UDP──▶  Device (IP:port)
        ▲                                         │
        └────── live progress (Server-Sent Events)┘            MongoDB: saved profiles + transfer history
```

The server must run on a computer **on the same local network as the target device** (your Mac, a Raspberry Pi, a home server). It cannot work from a cloud host (Vercel, Render, Heroku…), because those cannot reach your private `192.168.x.x` addresses.

## Features

- IP (IPv4/IPv6) and port with live validation; TCP/UDP selector; Send, Cancel; duplicate sends blocked
- Choose or drag-and-drop any file (`.bin`, `.elf`, `.payload`, …). The server streams it to the device in chunks, unchanged, never fully in memory
- Upload progress, then device-send progress (two stages), live over Server-Sent Events
- Connect timeout (10 s), stall timeout (15 s), instant cancel
- Timestamped log with **Clear Log**; transfer history (metadata only, never payload bytes) with **Clear**; saved profiles (add/edit/delete) in MongoDB
- Light/dark mode, responsive (works on a phone browser), haptic buzz on supported phones
- Sending works even if MongoDB is down (only profiles/history are disabled)

## Delivery guarantees

- **TCP:** after writing all bytes the server half-closes the stream and watches up to 3 s for the receiver's reaction (closed cleanly / reset / no signal). None of these is an application-level acknowledgement, so the UI says "Payload sent" with that caveat and never claims confirmed delivery.
- **UDP:** best-effort datagrams (1400 bytes each). No delivery, order or integrity guarantee, and no receipt confirmation.
- A successful connection does not mean the receiver accepted the payload; some receivers need a specific handshake/header. Transport code (`server/src/senders/`) is separate from receiver framing: `sendTcp` accepts an optional `preamble` Buffer, and the default sends raw bytes only.

## Requirements

- Node.js 18.18+ (20 or 22 recommended)
- MongoDB (optional for sending, needed for profiles/history): Docker (`docker compose up -d`), or `brew install mongodb-community`, or a MongoDB Atlas URI

## Run it (development)

```bash
cd NetPayload-MERN
npm run install:all                 # installs root, server and client dependencies
cp server/.env.example server/.env  # optional: edit settings
docker compose up -d                # optional: local MongoDB
npm run dev                         # API on :5000, web app on :5173
```
Open **http://localhost:5173**.

## Run it (production, single port)

```bash
npm run build      # builds the React app into client/dist
npm start          # Express serves the API and the built app on http://127.0.0.1:5000
```

## Use it from your phone's browser

1. In `server/.env` set `HOST=0.0.0.0` and `ACCESS_PIN=choose-a-pin`.
2. `npm run build && npm start`.
3. On a phone connected to the same Wi-Fi, open `http://<your-computer-ip>:5000` and enter the PIN.

The server then accepts requests from your whole network, so **always set `ACCESS_PIN`** and do not expose the port to the internet.

## Server settings (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | API/web port |
| `HOST` | `127.0.0.1` | `127.0.0.1` = this computer only; `0.0.0.0` = your network |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/netpayload` | MongoDB connection |
| `ACCESS_PIN` | empty | If set, the API requires this PIN |
| `ALLOWED_HOSTS` | empty | Extra hostnames the server may be reached by (e.g. `my-mac.local`) |
| `ALLOW_PUBLIC_TARGETS` | `false` | Allow non-private target IPs (not recommended) |
| `ALLOW_LOOPBACK_TARGETS` | `false` | Allow 127.0.0.1 targets (for testing) |
| `MAX_TCP_BYTES` / `MAX_UDP_BYTES` | 1 GiB / 8 MiB | Upload and send limits |

## Security notes

This server opens network connections on a browser's behalf, so it is deliberately restrictive.

**Built in**
- Only private LAN addresses can be targeted by default (10.x, 172.16–31.x, 192.168.x, fc00::/7, fe80::/10). Loopback, public addresses and link-local `169.254.x.x` (cloud metadata) are refused unless you opt in.
- **CSRF protection:** a web page on another site cannot make your browser call the API (`Origin` must match `Host`; cross-site requests are rejected).
- **DNS-rebinding protection:** the `Host` header must be `localhost`, an IP address, or listed in `ALLOWED_HOSTS`.
- Optional PIN (timing-safe comparison) with lock-out after 10 wrong guesses per client IP per 5 minutes.
- `helmet` headers, upload rate limit, JSON body limit, temp files deleted after each transfer, one transfer at a time.
- No receiver exploitation, stealth or scanning features: it only sends a file you choose to an address you enter.

**Known limits (read before opening it to your network)**
- **Plain HTTP:** on Wi-Fi the PIN and file travel unencrypted. Use it only on a network you trust, or put it behind an HTTPS reverse proxy (e.g. Caddy) and add the hostname to `ALLOWED_HOSTS`.
- **Anyone with the PIN can send arbitrary bytes to any private-network IP:port**, including your router, printers or databases. A crafted file can speak other protocols (for example HTTP) to those services. Keep `HOST=127.0.0.1` unless you need phone access, use a long PIN, and never expose the port to the internet.
- One shared PIN, no user accounts, no audit log beyond the history. Not independently security-reviewed.

## API (all under `/api`)

| Method & path | Purpose |
|---|---|
| `GET /health`, `GET /config` | status, limits, whether a PIN is needed |
| `POST /transfers` (multipart: `file`, `host`, `port`, `transport`, `filename`) | start a transfer → `202 {id}` |
| `GET /transfers/:id` / `/events` | snapshot / live Server-Sent Events |
| `DELETE /transfers/:id` | cancel |
| `GET/POST/PUT/DELETE /profiles` | saved profiles |
| `GET/DELETE /history` | transfer history |

## Tests

```bash
npm test                # server (node:test) + client (vitest)
npm test --prefix server
```
Server tests use real loopback sockets: exact-byte TCP transfer, receiver-silence handling, connection refused, cancel, stall timeout, changed-file detection, UDP datagram sizing, the transfer manager (duplicate rejection, replay, history failures), and an end-to-end HTTP test (`test/api.test.js`, needs `npm install`; MongoDB not required).

## Project layout

```
server/src/  config, errors, validation, transferService, transferManager, middleware, app, index
             senders/ (tcpSender, udpSender, common)   routes/ (transfers, profiles, history)   models/
server/test/ validation, senders, manager, api
client/src/  App.jsx, api.js, validation.js, hooks/useTransfer.js, components/ (Cards, Panels, Icon), styles.css
```

## Verification status

- **Verified here (Node 22, no network):** all 23 server tests that use only built-in modules pass (validation, TCP/UDP senders, transfer manager, CSRF/Host/PIN guards), and the client validation logic runs correctly.
- **Not verified:** `npm install`, the Express routes/MongoDB models/`api.test.js` (need the npm packages), the React UI (`vite build`, `vitest`, how it looks in a browser), and behaviour against any real receiver. Run `npm run install:all && npm test && npm run dev` once and report any error you see.
# PayloadSender-Tool
