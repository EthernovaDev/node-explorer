const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const { openDatabase } = require('./db');
const { createGeoIp } = require('./geoip');
const pkg = require('./package.json');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'app.config.json');

function parseArgs() {
  const args = process.argv.slice(2);
  let configPath = DEFAULT_CONFIG_PATH;
  let mode = 'all';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--config' && args[i + 1]) {
      configPath = path.resolve(process.cwd(), args[i + 1]);
      i += 1;
    } else if (arg === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i += 1;
    }
  }

  return { configPath, mode };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function parseEnode(enode) {
  if (!enode || !enode.startsWith('enode://')) return null;
  const atIndex = enode.indexOf('@');
  if (atIndex === -1) return null;

  const nodeId = enode.slice(8, atIndex);
  let rest = enode.slice(atIndex + 1);
  let query = '';

  const queryIndex = rest.indexOf('?');
  if (queryIndex >= 0) {
    query = rest.slice(queryIndex);
    rest = rest.slice(0, queryIndex);
  }

  let ip = '';
  let portStr = '';

  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end === -1) return null;
    ip = rest.slice(1, end);
    const after = rest.slice(end + 1);
    if (!after.startsWith(':')) return null;
    portStr = after.slice(1);
  } else {
    const lastColon = rest.lastIndexOf(':');
    if (lastColon === -1) return null;
    ip = rest.slice(0, lastColon);
    portStr = rest.slice(lastColon + 1);
  }

  const tcpPort = Number(portStr);
  if (!nodeId || !ip || !Number.isFinite(tcpPort)) return null;

  return { nodeId, ip, tcpPort, query };
}

function maskIp(ip) {
  if (!ip) return ip;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = 'xxx';
      return parts.join('.');
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts.slice(0, 3).join(':')}::`;
    }
  }
  return ip;
}

function maskAddress(address) {
  if (!address) return address;
  if (address.startsWith('[')) {
    const end = address.indexOf(']');
    if (end > -1) {
      const ip = address.slice(1, end);
      const rest = address.slice(end + 1);
      return `[${maskIp(ip)}]${rest}`;
    }
  }
  const lastColon = address.lastIndexOf(':');
  if (lastColon > -1 && address.includes('.')) {
    const ip = address.slice(0, lastColon);
    const port = address.slice(lastColon);
    return `${maskIp(ip)}${port}`;
  }
  return maskIp(address);
}

function maskEnode(enode) {
  const parsed = parseEnode(enode);
  if (!parsed) return enode;
  const maskedIp = maskIp(parsed.ip);
  const host = parsed.ip.includes(':') ? `[${maskedIp}]:${parsed.tcpPort}` : `${maskedIp}:${parsed.tcpPort}`;
  return `enode://${parsed.nodeId}@${host}${parsed.query || ''}`;
}

function sanitizePeer(peer, hideIp) {
  if (!hideIp) return peer;
  const clone = structuredClone(peer);
  if (clone.enode) {
    clone.enode = maskEnode(clone.enode);
  }
  if (clone.network) {
    if (clone.network.remoteAddress) {
      clone.network.remoteAddress = maskAddress(clone.network.remoteAddress);
    }
    if (clone.network.localAddress) {
      clone.network.localAddress = maskAddress(clone.network.localAddress);
    }
  }
  return clone;
}

function parsePeerCount(value) {
  if (typeof value === 'string' && value.startsWith('0x')) {
    return parseInt(value, 16);
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function main() {
  const { configPath, mode } = parseArgs();
  const config = loadConfig(configPath);
  const rootDir = path.resolve(__dirname, '..');

  const apiPort = Number(config.apiPort || 9090);
  const webPort = Number(config.webPort || 8088);
  const apiHost = config.apiHost || '127.0.0.1';
  const webHost = config.webHost || '127.0.0.1';
  const apiProxyEnabled = config.apiProxyEnabled !== undefined ? Boolean(config.apiProxyEnabled) : false;
  const pollMs = Number(config.pollSeconds || 15) * 1000;
  const onlineWindowMs = Number(config.onlineWindowMinutes || 10) * 60 * 1000;
  const enableExpansion = Boolean(config.enableExpansion);
  const expansionRate = Number(config.expansionRateLimitPerMin || 30);

  const autoExportEnabled = config.autoExportEnabled !== undefined ? Boolean(config.autoExportEnabled) : false;
  const autoExportMinutes = Math.max(1, Number(config.autoExportMinutes || 30));
  const autoExportMs = autoExportMinutes * 60 * 1000;
  const autoExportLimit = Math.max(1, Number(config.autoExportLimit || config.maxPeers || 200));
  const autoExportOnlyOnline = config.autoExportOnlyOnline !== undefined ? Boolean(config.autoExportOnlyOnline) : true;
  const autoExportBootnodesPath = config.autoExportBootnodesPath
    ? path.resolve(config.autoExportBootnodesPath)
    : path.join(rootDir, 'config', 'bootnodes.txt');
  const autoExportStaticNodesPath = config.autoExportStaticNodesPath
    ? path.resolve(config.autoExportStaticNodesPath)
    : path.join(rootDir, 'config', 'static-nodes.json');

  const dbPath = path.join(rootDir, 'data', 'db.sqlite');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const db = await openDatabase(dbPath, schemaPath);
  const geo = await createGeoIp(config.geoipCountryMmdb, config.geoipAsnMmdb);

  let lastUpdate = null;
  let lastPeersRaw = [];
  let lastPeerCount = 0;
  let lastNodeInfo = null;
  let rpcOk = false;
  let isPolling = false;
  let lastAutoExport = 0;

  const expansionState = {
    windowStart: 0,
    count: 0
  };

  async function rpcCall(method, params = []) {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`RPC ${method} failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`RPC ${method} error: ${data.error.message || 'unknown'}`);
    }
    return data.result;
  }

  async function upsertPeers(peers) {
    if (!Array.isArray(peers) || peers.length === 0) return;
    const now = Date.now();
    const unique = new Map();

    for (const peer of peers) {
      const parsed = parseEnode(peer.enode);
      if (!parsed) continue;
      if (unique.has(parsed.nodeId)) continue;

      const geoData = geo.lookup(parsed.ip);
      unique.set(parsed.nodeId, {
        node_id: parsed.nodeId,
        enode: peer.enode,
        ip: parsed.ip,
        tcp_port: parsed.tcpPort,
        client_name: peer.name || null,
        caps: JSON.stringify(peer.caps || []),
        first_seen: now,
        last_seen: now,
        seen_count: 1,
        country_code: geoData.countryCode,
        country_name: geoData.countryName,
        asn_number: geoData.asnNumber,
        asn_org: geoData.asnOrg,
        last_source: 'local-1'
      });
    }

    if (unique.size === 0) return;

    const sql = `
      INSERT INTO nodes (
        node_id, enode, ip, tcp_port, client_name, caps,
        first_seen, last_seen, seen_count,
        country_code, country_name, asn_number, asn_org, last_source
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(node_id) DO UPDATE SET
        enode = excluded.enode,
        ip = excluded.ip,
        tcp_port = excluded.tcp_port,
        client_name = excluded.client_name,
        caps = excluded.caps,
        last_seen = excluded.last_seen,
        seen_count = nodes.seen_count + 1,
        country_code = excluded.country_code,
        country_name = excluded.country_name,
        asn_number = excluded.asn_number,
        asn_org = excluded.asn_org,
        last_source = excluded.last_source
    `;

    await db.exec('BEGIN');
    const stmt = await db.prepare(sql);
    try {
      for (const item of unique.values()) {
        await stmt.run(
          item.node_id,
          item.enode,
          item.ip,
          item.tcp_port,
          item.client_name,
          item.caps,
          item.first_seen,
          item.last_seen,
          item.seen_count,
          item.country_code,
          item.country_name,
          item.asn_number,
          item.asn_org,
          item.last_source
        );
      }
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    } finally {
      await stmt.finalize();
    }

    if (enableExpansion) {
      const candidateSql = `
        INSERT OR IGNORE INTO candidates (
          enode, node_id, ip, tcp_port, first_seen, status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
      `;
      const candidateStmt = await db.prepare(candidateSql);
      try {
        for (const item of unique.values()) {
          await candidateStmt.run(
            item.enode,
            item.node_id,
            item.ip,
            item.tcp_port,
            item.first_seen
          );
        }
      } finally {
        await candidateStmt.finalize();
      }
    }
  }

  async function runExpansion() {
    if (!enableExpansion) return;

    const now = Date.now();
    if (now - expansionState.windowStart >= 60000) {
      expansionState.windowStart = now;
      expansionState.count = 0;
    }

    const remaining = expansionRate - expansionState.count;
    if (remaining <= 0) return;

    const maxCandidates = Number(config.expansionMaxCandidates || 5000);
    const candidates = await db.all(
      `SELECT enode, attempts, last_attempt FROM candidates
       WHERE status IS NULL OR status IN ('pending', 'failed')
       ORDER BY (last_attempt IS NOT NULL), last_attempt ASC, first_seen ASC
       LIMIT ?`,
      maxCandidates
    );

    const queue = [];
    for (const candidate of candidates) {
      const attempts = candidate.attempts || 0;
      const lastAttempt = candidate.last_attempt || 0;
      const backoffMs = (attempts + 1) * 60000;
      if (lastAttempt && now - lastAttempt < backoffMs) {
        continue;
      }
      queue.push(candidate);
      if (queue.length >= remaining) break;
    }

    for (const candidate of queue) {
      let status = 'failed';
      try {
        const ok = await rpcCall('admin_addPeer', [candidate.enode]);
        status = ok ? 'added' : 'failed';
      } catch (err) {
        status = 'failed';
      }

      await db.run(
        `UPDATE candidates
         SET attempts = attempts + 1,
             last_attempt = ?,
             status = ?
         WHERE enode = ?`,
        now,
        status,
        candidate.enode
      );

      expansionState.count += 1;
      if (expansionState.count >= expansionRate) break;
    }
  }

  async function writeAutoExports() {
    if (!autoExportEnabled) return;

    const now = Date.now();
    const cutoff = now - onlineWindowMs;
    const limit = autoExportLimit;
    let rows = [];

    if (autoExportOnlyOnline) {
      rows = await db.all(
        'SELECT enode FROM nodes WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?',
        cutoff,
        limit
      );
    } else {
      rows = await db.all(
        'SELECT enode FROM nodes ORDER BY last_seen DESC LIMIT ?',
        limit
      );
    }

    const freshEnodes = rows.map(row => row.enode).filter(Boolean);
    let existingEnodes = [];
    if (fs.existsSync(autoExportBootnodesPath)) {
      existingEnodes = fs.readFileSync(autoExportBootnodesPath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    }

    const combined = [];
    const seen = new Set();
    for (const enode of existingEnodes) {
      if (!seen.has(enode)) {
        seen.add(enode);
        combined.push(enode);
      }
    }
    for (const enode of freshEnodes) {
      if (!seen.has(enode)) {
        seen.add(enode);
        combined.push(enode);
      }
    }

    const finalEnodes = combined.slice(0, limit);
    const header = `# Generated by Ethernova Node Explorer at ${new Date(now).toISOString()}\n`;
    const bootnodesPayload = `${header}${finalEnodes.join('\n')}\n`;

    fs.mkdirSync(path.dirname(autoExportBootnodesPath), { recursive: true });
    fs.writeFileSync(autoExportBootnodesPath, bootnodesPayload, 'utf8');

    fs.mkdirSync(path.dirname(autoExportStaticNodesPath), { recursive: true });
    fs.writeFileSync(autoExportStaticNodesPath, JSON.stringify(finalEnodes, null, 2), 'utf8');
  }

  async function maybeAutoExport() {
    if (!autoExportEnabled) return;
    const now = Date.now();
    if (now - lastAutoExport < autoExportMs) return;
    await writeAutoExports();
    lastAutoExport = now;
  }

  async function poll() {
    if (isPolling) return;
    isPolling = true;

    try {
      const peers = await rpcCall('admin_peers');
      let nodeInfo = null;
      try {
        nodeInfo = await rpcCall('admin_nodeInfo');
      } catch (err) {
        nodeInfo = null;
      }
      const peerCountRaw = await rpcCall('net_peerCount');

      lastPeersRaw = Array.isArray(peers) ? peers : [];
      lastPeerCount = parsePeerCount(peerCountRaw);
      lastNodeInfo = nodeInfo;
      lastUpdate = Date.now();
      rpcOk = true;

      await upsertPeers(lastPeersRaw);
      await runExpansion();
      await maybeAutoExport();
    } catch (err) {
      rpcOk = false;
    } finally {
      isPolling = false;
    }
  }

  async function getStats() {
    const cutoff = Date.now() - onlineWindowMs;
    const totalRow = await db.get('SELECT COUNT(*) AS count FROM nodes');
    const onlineRow = await db.get('SELECT COUNT(*) AS count FROM nodes WHERE last_seen >= ?', cutoff);

    const countries = await db.all(
      `SELECT
        COALESCE(country_code, 'UNKNOWN') AS country_code,
        COALESCE(country_name, 'UNKNOWN') AS country_name,
        COUNT(*) AS total,
        SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online
       FROM nodes
       GROUP BY country_code, country_name
       ORDER BY online DESC, total DESC
       LIMIT 10`,
      cutoff
    );

    const asns = await db.all(
      `SELECT
        COALESCE(asn_number, 0) AS asn_number,
        COALESCE(asn_org, 'UNKNOWN') AS asn_org,
        COUNT(*) AS total,
        SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online
       FROM nodes
       GROUP BY asn_number, asn_org
       ORDER BY online DESC, total DESC
       LIMIT 10`,
      cutoff
    );

    const clients = await db.all(
      `SELECT
        COALESCE(client_name, 'UNKNOWN') AS client,
        COUNT(*) AS count
       FROM nodes
       GROUP BY client_name
       ORDER BY count DESC
       LIMIT 10`
    );

    return {
      peersNow: lastPeersRaw.length || lastPeerCount,
      nodesSeenTotal: totalRow ? totalRow.count : 0,
      nodesOnline: onlineRow ? onlineRow.count : 0,
      lastUpdate,
      topCountries: countries.map(row => {
        const label = row.country_name && row.country_name !== 'UNKNOWN'
          ? `${row.country_name} (${row.country_code})`
          : row.country_code;
        return {
          country: label,
          online: row.online || 0,
          total: row.total || 0
        };
      }),
      topASNs: asns.map(row => ({
        asn: row.asn_number || null,
        org: row.asn_org,
        online: row.online || 0,
        total: row.total || 0
      })),
      topClients: clients
    };
  }

  async function startApiServer() {
    const app = Fastify({ logger: true });

    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = [
          `http://localhost:${webPort}`,
          `http://127.0.0.1:${webPort}`
        ];
        if (allowed.includes(origin)) {
          return cb(null, true);
        }
        return cb(null, false);
      }
    });

    app.get('/api/health', async () => {
      return {
        ok: true,
        db: true,
        rpc: rpcOk,
        version: pkg.version,
        lastUpdate
      };
    });

    app.get('/api/stats', async () => {
      return getStats();
    });

    app.get('/api/peers', async (req) => {
      const hideIp = String(req.query.hideIp || '').toLowerCase() === 'true';
      return lastPeersRaw.map(peer => sanitizePeer(peer, hideIp));
    });

    app.get('/api/nodes', async (req) => {
      const query = req.query || {};
      const page = Math.max(1, Number(query.page || 1));
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 25)));
      const sortField = String(query.sort || 'last_seen');
      const dir = String(query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const status = String(query.status || 'online');
      const hideIp = String(query.hideIp || '').toLowerCase() === 'true';

      const allowedSort = new Set([
        'last_seen',
        'first_seen',
        'seen_count',
        'country_code',
        'asn_number',
        'client_name',
        'ip',
        'tcp_port'
      ]);
      const sort = allowedSort.has(sortField) ? sortField : 'last_seen';

      const params = [];
      const where = [];

      if (query.search) {
        const value = `%${query.search}%`;
        where.push('(node_id LIKE ? OR enode LIKE ? OR ip LIKE ? OR client_name LIKE ?)');
        params.push(value, value, value, value);
      }

      if (query.client) {
        where.push('client_name LIKE ?');
        params.push(`%${query.client}%`);
      }

      if (query.country) {
        where.push('(country_code = ? OR country_name LIKE ?)');
        params.push(query.country, `%${query.country}%`);
      }

      if (query.asn) {
        const asnValue = String(query.asn).replace(/[^0-9]/g, '');
        if (asnValue) {
          where.push('asn_number = ?');
          params.push(Number(asnValue));
        }
      }

      const cutoff = Date.now() - onlineWindowMs;
      if (status === 'online') {
        where.push('last_seen >= ?');
        params.push(cutoff);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalRow = await db.get(`SELECT COUNT(*) AS count FROM nodes ${whereSql}`, params);
      const total = totalRow ? totalRow.count : 0;

      const offset = (page - 1) * pageSize;
      const rows = await db.all(
        `SELECT
          node_id, enode, ip, tcp_port, client_name, caps,
          first_seen, last_seen, seen_count,
          country_code, country_name, asn_number, asn_org, last_source
         FROM nodes
         ${whereSql}
         ORDER BY ${sort} ${dir}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset
      );

      const items = rows.map(row => {
        let ip = row.ip;
        if (hideIp) {
          ip = maskIp(ip);
        }
        let caps = [];
        if (row.caps) {
          try {
            caps = JSON.parse(row.caps);
          } catch (err) {
            caps = [];
          }
        }
        return {
          node_id: row.node_id,
          enode: row.enode,
          ip,
          tcp_port: row.tcp_port,
          client_name: row.client_name,
          caps,
          first_seen: row.first_seen,
          last_seen: row.last_seen,
          seen_count: row.seen_count,
          country_code: row.country_code,
          country_name: row.country_name,
          asn_number: row.asn_number,
          asn_org: row.asn_org,
          last_source: row.last_source,
          online: row.last_seen >= cutoff
        };
      });

      return {
        page,
        pageSize,
        total,
        items
      };
    });

    app.get('/api/export/enodes.txt', async (req, reply) => {
      const rows = await db.all('SELECT enode FROM nodes ORDER BY last_seen DESC');
      const payload = rows.map(row => row.enode).join('\n');
      reply.type('text/plain').send(payload);
    });

    app.get('/api/export/enodes.json', async (req, reply) => {
      const rows = await db.all('SELECT enode FROM nodes ORDER BY last_seen DESC');
      reply.send(rows.map(row => row.enode));
    });

    app.get('/api/export/enodes.csv', async (req, reply) => {
      const rows = await db.all('SELECT enode FROM nodes ORDER BY last_seen DESC');
      const lines = ['enode'];
      for (const row of rows) {
        const value = String(row.enode || '').replace(/"/g, '""');
        lines.push(`"${value}"`);
      }
      reply.type('text/csv').send(lines.join('\n'));
    });

    await app.listen({ host: apiHost, port: apiPort });
    return app;
  }

  async function startWebServer() {
    const app = Fastify({ logger: true });
    const webDir = path.join(rootDir, 'web');
    const proxyTarget = `http://${apiHost}:${apiPort}`;

    if (apiProxyEnabled) {
      app.get('/api/*', async (req, reply) => {
        const url = `${proxyTarget}${req.raw.url}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            accept: req.headers.accept || '*/*'
          }
        });

        reply.status(res.status);
        res.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'transfer-encoding') return;
          reply.header(key, value);
        });

        const buffer = Buffer.from(await res.arrayBuffer());
        reply.send(buffer);
      });
    }

    app.get('/config.js', async (req, reply) => {
      const requestHost = req.headers.host || `127.0.0.1:${webPort}`;
      const payload = {
        apiBase: apiProxyEnabled ? `http://${requestHost}` : `http://${apiHost}:${apiPort}`,
        pollSeconds: Number(config.pollSeconds || 15),
        onlineWindowMinutes: Number(config.onlineWindowMinutes || 10)
      };
      reply.header('cache-control', 'no-store');
      reply.type('application/javascript');
      reply.send(`window.APP_CONFIG = ${JSON.stringify(payload)};`);
    });

    await app.register(fastifyStatic, {
      root: webDir,
      index: 'index.html'
    });

    await app.listen({ host: webHost, port: webPort });
    return app;
  }

  if (mode === 'api' || mode === 'all') {
    await startApiServer();
    poll();
    setInterval(poll, pollMs);
  }

  if (mode === 'web' || mode === 'all') {
    await startWebServer();
  }

  if (mode !== 'api' && mode !== 'web' && mode !== 'all') {
    console.error('Unknown mode. Use --mode api|web|all');
  }

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});






