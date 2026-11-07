# Local hostname and network play

`npm start` and `npm run dev` advertise the game as **`http://crapstv.local:3000`** on the selected local IPv4 network. Keep `:3000` in the URL: ordinary browsers do not use DNS-SD service records to find a non-default HTTP port. A custom `PORT` is included automatically; only port 80 omits it.

The server still listens on `0.0.0.0` and prints a direct LAN-IP URL as a fallback. `/api/config` reports both:

```json
{
  "joinOrigin": "http://crapstv.local:3000",
  "lanOrigin": "http://192.168.1.40:3000",
  "localOrigin": "http://crapstv.local:3000",
  "localHostname": "crapstv.local",
  "mdnsStatus": "ready"
}
```

`joinOrigin` prefers the announced hostname. While discovery is unavailable, disabled, misconfigured, or times out, it falls back to the LAN IP. With no non-loopback IPv4, it is `null`. The config endpoint waits for the bounded initial discovery attempt, so a QR generated from it uses the actual probed hostname.

## How it works

The app uses [Ciao](https://github.com/homebridge/ciao), a maintained, MIT-licensed JavaScript implementation of [Multicast DNS, RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html) and [DNS-SD, RFC 6763](https://www.rfc-editor.org/rfc/rfc6763.html). It publishes:

- A real **A address record** for `crapstv.local`, pointing to the selected LAN IPv4.
- An `_http._tcp.local` service PTR, SRV record with the HTTP port, and TXT metadata.
- Cache-flush address records, uniqueness probes, responses to hostname queries, and goodbye packets on normal shutdown.

The HTTP server binds IPv4 only, so the advertisement intentionally omits AAAA records rather than advertising an IPv6 endpoint that the app cannot serve. The default address selection prefers a physical Ethernet/Wi-Fi private address over VPN or tunnel adapters. Use the override below when more than one LAN is active.

Ciao probes for conflicts before advertising. If another device owns the hostname, Ciao changes it (for example, `crapstv-(2).local`); the terminal and config API expose that actual name. The preferred base is tried again on the next launch. If a conflict happens after a TV page is already open, refresh the page to regenerate its join QR from the updated config.

No system hosts file, computer hostname, DNS settings, privileged port, or OS service is modified. On macOS the app coexists with the running Bonjour responder. Ciao documents the limitations of multiple responders sharing UDP 5353 and uses multicast probes so it does not depend on receiving another responder's unicast reply.

## Overrides

| Environment variable | Effect |
| --- | --- |
| `PORT=4000` | Serve and advertise port 4000. |
| `CRAPSTV_MDNS=0` | Disable multicast discovery entirely and use the LAN-IP join URL. `false` and `off` also work. |
| `CRAPSTV_JOIN_MODE=ip` | Keep advertising the local hostname, but put the direct LAN-IP URL in the QR/config `joinOrigin`. Useful for mixed-device parties. |
| `CRAPSTV_LAN_ADDRESS=192.168.1.40` | Advertise only this active non-loopback IPv4 address and its interface. |
| `CRAPSTV_HOSTNAME=my-crapstv` | Use `my-crapstv.local`. Supply one letters/digits/hyphens label, optionally ending in `.local`. |

For macOS/Linux, prefix the start command:

```sh
CRAPSTV_JOIN_MODE=ip npm start
```

For Windows PowerShell:

```powershell
$env:CRAPSTV_JOIN_MODE = 'ip'
npm start
```

Invalid hostname/address overrides do not change system settings or crash the game: discovery is skipped, a message is printed, and the automatically selected LAN-IP URL remains available. Restart the server after changing networks or its selected address.

## Compatibility and limits

All players must be able to reach the host on the same LAN. `.local` resolution requires an mDNS-capable resolver on the joining device. It normally works with Apple Bonjour and many Linux configurations, but **Windows and Android behavior varies with OS version, resolver/browser configuration, and installed mDNS support**. A successful local announcement cannot prove that every phone can resolve it.

Guest Wi-Fi, client isolation, VPN routing, multicast filtering, or the host firewall can block discovery or the game itself. No router setting is changed automatically. If the hostname fails but the direct IP works, use `CRAPSTV_JOIN_MODE=ip` or `CRAPSTV_MDNS=0`. Allow the app's HTTP port and, when using discovery, multicast UDP 5353 on the trusted LAN. The hostname is local to the link; it is not a public internet address. No HTTPS certificate is installed.

## Verification

Unit tests check deterministic interface selection, exact hostname and port preference, IP fallbacks, disabled/error/timeout cleanup, collision-name updates, and the real Ciao A/SRV/PTR records after DNS wire encoding/decoding. During implementation, a temporary server on port 3397 was resolved through the macOS system resolver as `crapstv.local → 192.168.1.154`; fetching `/api/config` through that hostname returned HTTP 200 and the advertised hostname URL. That proves the local Mac setup, not resolution on every guest device.
