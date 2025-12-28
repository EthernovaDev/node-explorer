# Ethernova Node Explorer (Local)

A local, personal node/peer dashboard similar to etcnodes.org, but built for your own machine. It discovers peers only from legitimate protocol sources (bootnodes + discovery + peers), stores them in SQLite, and renders a local dashboard on `http://localhost:8088`.

## Features

- Local crawler node (no scanning, no brute force)
- Collector/API on `http://127.0.0.1:9090`
- Dashboard on `http://127.0.0.1:8088`
- GeoIP (Country + ASN) via MaxMind GeoLite2 `.mmdb`
- Export enodes as TXT/JSON/CSV
- IP masking (default ON) with a UI toggle

## Prereqs

- Windows 10/11
- Node.js 20 LTS (`node -v`)
- Ethernova node binary (path configured in `config\app.config.json`)
- Bootnodes provided by you (do not invent)
- GeoLite2 databases (optional but recommended)

### GeoIP setup

Download GeoLite2 Country + ASN from MaxMind and place them here:

```
C:\dev\ethernova-node-explorer\geoip\GeoLite2-Country.mmdb
C:\dev\ethernova-node-explorer\geoip\GeoLite2-ASN.mmdb
```

If the files are missing, the app will show `UNKNOWN` instead of crashing.

## Configuration

Edit `config\app.config.json`:

- `nodeBinaryPath`: path to `ethernova.exe`
- `nodeStartBatPath`: optional path to a `.bat` that starts the node (overrides `nodeBinaryPath`)
- `nodeStartBatArgs`: optional args array passed to the `.bat`
- `rpcUrl`: must be `http://127.0.0.1:8545` (or another local port)
- `apiPort`: collector API port (default 9090)
- `webPort`: dashboard port (default 8088)
- `p2pPort`: P2P port (default 30303, TCP+UDP)
- `maxPeers`: default 200
- `pollSeconds`: collector poll interval
- `onlineWindowMinutes`: window for "online" status
- `datadir`: node data directory
- `logDir`: log directory
- `geoipCountryMmdb` / `geoipAsnMmdb`: MaxMind DB paths
- `enableExpansion`: optional feature flag (default false)
- `autoExportEnabled`: generate fresh `bootnodes.txt` + `static-nodes.json` on a schedule
- `autoExportMinutes`: export interval in minutes (default 30)
- `autoExportLimit`: max enodes to write (default 200)
- `autoExportOnlyOnline`: only nodes seen within the online window (default true)
- `autoExportBootnodesPath`: output path for `bootnodes.txt`
- `autoExportStaticNodesPath`: output path for `static-nodes.json`

Bootnodes go in `config\bootnodes.txt` (one enode per line, `#` comments allowed). See `config\README-BOOTNODES.md`.

If `autoExportEnabled=true`, the collector will overwrite `bootnodes.txt` and create `static-nodes.json` at the configured paths every interval. Existing bootnodes are preserved and fresh enodes are appended (deduped and capped by `autoExportLimit`).

If `nodeStartBatPath` is set, `start-node.ps1` runs that `.bat` and does not add the default CLI flags. Make sure your bat/script enables the admin RPC (`--http.api eth,net,web3,admin`) and uses the right bootnodes/config.

### LAN access (optional)

To see the dashboard from other devices on your local network:

1) Set `webHost` to `0.0.0.0` and `apiProxyEnabled` to `true` in `config\app.config.json`.
2) Open the Windows Firewall port for `webPort` (default 8088). You can run `.\scripts\firewall-rules.ps1` as Administrator.
3) Open `http://<PC-LAN-IP>:8088` from another device.

RPC stays bound to `127.0.0.1` only.

### Optional expansion

When `enableExpansion=true`, the collector will enqueue newly seen enodes and call `admin_addPeer` with a strict rate limit and backoff. It never attempts IPs outside what was learned from peers/bootnodes.

## Run

1. Edit `config\app.config.json`
2. Edit `config\bootnodes.txt`
3. Start everything:

```
.\scripts\start-all.ps1
```

4. Open `http://localhost:8088`

### Stop

```
.\scripts\stop-all.ps1
```

## Verify

```
curl http://localhost:9090/api/health
curl http://localhost:9090/api/stats
```

## Exports

```
.\scripts\export-enodes.ps1 -Format txt
.\scripts\export-enodes.ps1 -Format json
.\scripts\export-enodes.ps1 -Format csv
```

## Firewall rules (Windows)

Port 30303 must allow **both TCP and UDP**. Run as Administrator:

```
.\scripts\firewall-rules.ps1
```

## Security and privacy notes

- RPC is bound to `127.0.0.1` only. Do not expose it publicly.
- If you later expose the dashboard to LAN, keep RPC on localhost only.
- Discovery uses bootnodes + peers only. No scanning or brute force.
- The dashboard is local; IP masking is enabled by default.

## Troubleshooting

- **Peers = 0**: bootnodes missing/wrong, UDP blocked, firewall not open, ISP NAT issues.
- **Admin method missing**: ensure the node starts with `--http.api eth,net,web3,admin`.
- **GeoIP UNKNOWN**: verify `.mmdb` paths in config and files exist.
- **Ports in use**: change `apiPort` or `webPort` in config.
- **Logs**: review `logs\` for node and collector output.

## Scripts

- `scripts\start-all.ps1`: validates Node.js, installs deps if missing, starts node + dashboard
- `scripts\start-node.ps1`: starts ethernova node (RPC bound to localhost)
- `scripts\start-dashboard.ps1`: starts collector + web UI
- `scripts\stop-all.ps1`: stops processes from PID files
- `scripts\export-enodes.ps1`: exports enodes to data directory
- `scripts\firewall-rules.ps1`: adds Windows firewall rules for TCP/UDP P2P








