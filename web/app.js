(() => {
  const config = window.APP_CONFIG || {};
  const apiBaseConfig = config.apiBase || 'http://127.0.0.1:9090';
  const baseTrimmed = apiBaseConfig.endsWith('/') ? apiBaseConfig.slice(0, -1) : apiBaseConfig;
  const API_PREFIX = baseTrimmed.endsWith('/api') ? baseTrimmed : `${baseTrimmed}/api`;
  const POLL_MS = (config.pollSeconds || 15) * 1000;
  const ONLINE_WINDOW_MIN = config.onlineWindowMinutes || 10;

  if (window.Chart && window.Chart.defaults) {
    Chart.defaults.font.family = "'Sora', 'Segoe UI', sans-serif";
    Chart.defaults.color = '#cbd5f5';
  }

  const state = {
    search: '',
    client: '',
    country: '',
    asn: '',
    status: 'online',
    sort: 'last_seen',
    dir: 'desc',
    page: 1,
    pageSize: 25,
    hideIp: true
  };

  const el = {
    peersNow: document.getElementById('peersNow'),
    nodesTotal: document.getElementById('nodesTotal'),
    nodesOnline: document.getElementById('nodesOnline'),
    lastUpdate: document.getElementById('lastUpdate'),
    onlineLabel: document.getElementById('onlineLabel'),
    nodesBody: document.getElementById('nodesBody'),
    pageInfo: document.getElementById('pageInfo'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    statusText: document.getElementById('statusText'),
    statusDot: document.getElementById('statusDot'),
    ipToggle: document.getElementById('ipToggle'),
    searchInput: document.getElementById('searchInput'),
    clientFilter: document.getElementById('clientFilter'),
    countryFilter: document.getElementById('countryFilter'),
    asnFilter: document.getElementById('asnFilter'),
    statusFilter: document.getElementById('statusFilter'),
    sortSelect: document.getElementById('sortSelect'),
    pageSizeSelect: document.getElementById('pageSizeSelect'),
    exportTxt: document.getElementById('exportTxt'),
    exportJson: document.getElementById('exportJson'),
    exportCsv: document.getElementById('exportCsv')
  };

  el.onlineLabel.textContent = `Nodes Online (last ${ONLINE_WINDOW_MIN} min)`;

  el.exportTxt.href = `${API_PREFIX}/export/enodes.txt`;
  el.exportJson.href = `${API_PREFIX}/export/enodes.json`;
  el.exportCsv.href = `${API_PREFIX}/export/enodes.csv`;

  let chartCountries = null;
  let chartAsn = null;
  let chartClients = null;

  const colors = ['#22d3ee', '#38bdf8', '#60a5fa', '#f59e0b', '#f97316', '#10b981', '#ef4444'];

  function buildQuery() {
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.client) params.set('client', state.client);
    if (state.country) params.set('country', state.country);
    if (state.asn) params.set('asn', state.asn);
    if (state.status) params.set('status', state.status);
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
    params.set('sort', state.sort);
    params.set('dir', state.dir);
    params.set('hideIp', state.hideIp ? 'true' : 'false');
    return params.toString();
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    return res.json();
  }

  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    return date.toLocaleString();
  }

  function formatCountry(item) {
    const code = item.country_code || 'UNKNOWN';
    const name = item.country_name || '';
    return name ? `${name} (${code})` : code;
  }

  function formatAsn(item) {
    if (!item.asn_number) return 'UNKNOWN';
    const org = item.asn_org ? ` ${item.asn_org}` : '';
    return `AS${item.asn_number}${org}`;
  }

  function truncateEnode(enode) {
    if (!enode) return '';
    if (enode.length <= 46) return enode;
    return `${enode.slice(0, 24)}...${enode.slice(-10)}`;
  }

  function renderChart(current, ctx, labels, data, label, horizontal = true) {
    if (!window.Chart) {
      return current;
    }
    if (!current) {
      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label,
            data,
            backgroundColor: colors,
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: horizontal ? 'y' : 'x',
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              ticks: { precision: 0, color: '#cbd5f5' },
              grid: { color: 'rgba(148, 163, 184, 0.15)' }
            },
            y: {
              ticks: { color: '#cbd5f5' },
              grid: { display: false }
            }
          }
        }
      });
    }

    current.data.labels = labels;
    current.data.datasets[0].data = data;
    current.update();
    return current;
  }

  function updateStatus(ok, rpc) {
    if (!ok) {
      el.statusText.textContent = 'API offline';
      el.statusDot.style.background = '#dc2626';
      return;
    }
    if (!rpc) {
      el.statusText.textContent = 'RPC unavailable';
      el.statusDot.style.background = '#d97706';
      return;
    }
    el.statusText.textContent = 'Collecting peers';
    el.statusDot.style.background = '#16a34a';
  }

  async function loadHealth() {
    try {
      const data = await fetchJson(`${API_PREFIX}/health`);
      updateStatus(Boolean(data.ok), Boolean(data.rpc));
    } catch (err) {
      updateStatus(false, false);
    }
  }

  async function loadStats() {
    try {
      const data = await fetchJson(`${API_PREFIX}/stats`);
      el.peersNow.textContent = data.peersNow ?? '--';
      el.nodesTotal.textContent = data.nodesSeenTotal ?? '--';
      el.nodesOnline.textContent = data.nodesOnline ?? '--';
      el.lastUpdate.textContent = data.lastUpdate ? formatTime(data.lastUpdate) : '?';

      chartCountries = renderChart(
        chartCountries,
        document.getElementById('chartCountries'),
        (data.topCountries || []).map(item => item.country),
        (data.topCountries || []).map(item => item.online),
        'Online nodes'
      );

      const asnLabels = (data.topASNs || []).map(item => {
        if (!item.asn) {
          return item.org && item.org !== 'UNKNOWN' ? `UNKNOWN ${item.org}` : 'UNKNOWN';
        }
        const org = item.org ? ` ${item.org}` : '';
        return `AS${item.asn}${org}`.trim();
      });

      chartAsn = renderChart(
        chartAsn,
        document.getElementById('chartAsn'),
        asnLabels,
        (data.topASNs || []).map(item => item.online),
        'Online nodes'
      );

      chartClients = renderChart(
        chartClients,
        document.getElementById('chartClients'),
        (data.topClients || []).map(item => item.client),
        (data.topClients || []).map(item => item.count),
        'Nodes',
        false
      );
    } catch (err) {
      // ignore
    }
  }

  function renderNodes(items, page, pageSize, total) {
    const tbody = el.nodesBody;
    tbody.innerHTML = '';

    if (!items || items.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 9;
      cell.className = 'empty';
      cell.textContent = 'No nodes yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      el.pageInfo.textContent = 'Page 1';
      return;
    }

    items.forEach(item => {
      const row = document.createElement('tr');

      const country = document.createElement('td');
      country.textContent = formatCountry(item);

      const asn = document.createElement('td');
      asn.textContent = formatAsn(item);

      const client = document.createElement('td');
      client.textContent = item.client_name || 'UNKNOWN';

      const ip = document.createElement('td');
      ip.textContent = item.ip || '?';

      const port = document.createElement('td');
      port.textContent = item.tcp_port || '?';

      const seen = document.createElement('td');
      seen.textContent = item.seen_count || 0;

      const firstSeen = document.createElement('td');
      firstSeen.textContent = formatTime(item.first_seen);

      const lastSeen = document.createElement('td');
      lastSeen.textContent = formatTime(item.last_seen);

      const enode = document.createElement('td');
      const enodeWrap = document.createElement('div');
      enodeWrap.className = 'enode';
      const enodeText = document.createElement('span');
      enodeText.textContent = truncateEnode(item.enode);
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.enode || '');
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1200);
      });
      enodeWrap.appendChild(enodeText);
      enodeWrap.appendChild(copyBtn);
      enode.appendChild(enodeWrap);

      row.appendChild(country);
      row.appendChild(asn);
      row.appendChild(client);
      row.appendChild(ip);
      row.appendChild(port);
      row.appendChild(seen);
      row.appendChild(firstSeen);
      row.appendChild(lastSeen);
      row.appendChild(enode);

      tbody.appendChild(row);
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    el.pageInfo.textContent = `Page ${page} of ${totalPages}`;
    el.prevPage.disabled = page <= 1;
    el.nextPage.disabled = page >= totalPages;
  }

  async function loadNodes() {
    try {
      const query = buildQuery();
      const data = await fetchJson(`${API_PREFIX}/nodes?${query}`);
      renderNodes(data.items, data.page, data.pageSize, data.total);
    } catch (err) {
      // ignore
    }
  }

  async function refreshAll() {
    await loadHealth();
    await loadStats();
    await loadNodes();
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  el.ipToggle.addEventListener('click', () => {
    state.hideIp = !state.hideIp;
    el.ipToggle.setAttribute('aria-pressed', state.hideIp ? 'true' : 'false');
    state.page = 1;
    loadNodes();
  });

  el.searchInput.addEventListener('input', debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadNodes();
  }, 400));

  el.clientFilter.addEventListener('input', debounce((event) => {
    state.client = event.target.value.trim();
    state.page = 1;
    loadNodes();
  }, 400));

  el.countryFilter.addEventListener('input', debounce((event) => {
    state.country = event.target.value.trim();
    state.page = 1;
    loadNodes();
  }, 400));

  el.asnFilter.addEventListener('input', debounce((event) => {
    state.asn = event.target.value.trim();
    state.page = 1;
    loadNodes();
  }, 400));

  el.statusFilter.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadNodes();
  });

  el.sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    loadNodes();
  });

  el.pageSizeSelect.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value) || 25;
    state.page = 1;
    loadNodes();
  });

  el.prevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      loadNodes();
    }
  });

  el.nextPage.addEventListener('click', () => {
    state.page += 1;
    loadNodes();
  });

  refreshAll();
  setInterval(refreshAll, POLL_MS);
})();




