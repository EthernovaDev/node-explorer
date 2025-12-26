-- SQLite schema for Ethernova Node Explorer

CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  enode TEXT NOT NULL,
  ip TEXT,
  tcp_port INTEGER,
  client_name TEXT,
  caps TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  seen_count INTEGER,
  country_code TEXT,
  country_name TEXT,
  asn_number INTEGER,
  asn_org TEXT,
  last_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen);
CREATE INDEX IF NOT EXISTS idx_nodes_country ON nodes(country_code);
CREATE INDEX IF NOT EXISTS idx_nodes_asn ON nodes(asn_number);
CREATE INDEX IF NOT EXISTS idx_nodes_client ON nodes(client_name);

CREATE TABLE IF NOT EXISTS candidates (
  enode TEXT PRIMARY KEY,
  node_id TEXT,
  ip TEXT,
  tcp_port INTEGER,
  first_seen INTEGER,
  last_attempt INTEGER,
  attempts INTEGER DEFAULT 0,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_last_attempt ON candidates(last_attempt);


