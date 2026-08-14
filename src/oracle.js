import {
  requestDataPackages,
  getSignersForDataServiceId,
  getOracleRegistryStateSync,
  convertDataPackagesResponse,
} from '@redstone-finance/sdk';
import { recoverSignerAddress } from '@redstone-finance/protocol';

export const DATA_SERVICE_ID = 'redstone-primary-prod';

/**
 * The gateways the SDK resolves for this data service, in its own order.
 * Named here only so the page can show them; the SDK still does the resolving,
 * races them, and takes the freshest answer.
 */
export const GATEWAYS = [
  'https://oracle-gateway-1.a.redstone.vip',
  'https://oracle-gateway-1.a.redstone.finance',
  'https://oracle-gateway-2.a.redstone.finance',
];

/**
 * Only these two serve the /historical route. Ordered with the one that has
 * answered most reliably first — the SDK takes whichever replies.
 */
const HISTORICAL_GATEWAYS = [
  'https://oracle-gateway-2.a.redstone.finance',
  'https://oracle-gateway-1.a.redstone.vip',
];

/** Historical timestamps must be a whole multiple of this. */
export const HISTORICAL_STEP_MS = 10000;

/** Feeds the page opens with. Everything else is one search away. */
export const DEFAULT_FEEDS = ['ETH', 'BTC', 'XAU'];

/** Labels for the handful of feeds worth spelling out. */
export const FEED_LABELS = {
  ETH: 'Ether',
  BTC: 'Bitcoin',
  XAU: 'Gold, troy ounce',
  XAG: 'Silver, troy ounce',
  SOL: 'Solana',
  EUR: 'Euro',
  GBP: 'Pound sterling',
  USDT: 'Tether',
  USDC: 'USD Coin',
  DAI: 'Dai',
  PAXG: 'Pax Gold',
  stETH: 'Lido staked Ether',
  wstETH: 'Wrapped staked Ether',
  WBTC: 'Wrapped Bitcoin',
  TSLA: 'Tesla',
  AAPL: 'Apple',
  NVDA: 'Nvidia',
};

/**
 * Every node RedStone has registered for this data service, with the name it
 * registered under. This comes out of the registry snapshot bundled inside the
 * SDK package — there is no network call and no API key involved.
 *
 * `internal` marks the nodes RedStone added before its 2024-01-02 cutoff, which
 * is the set the SDK hands back when you ask for internal signers only.
 */
export function registryNodes() {
  try {
    const state = getOracleRegistryStateSync();
    const internal = new Set(
      getSignersForDataServiceId(DATA_SERVICE_ID, false).map((a) =>
        a.toLowerCase()
      )
    );
    return Object.values(state.nodes)
      .filter((n) => n.dataServiceId === DATA_SERVICE_ID)
      .map((n) => ({
        address: n.evmAddress,
        lower: n.evmAddress.toLowerCase(),
        name: n.name ?? '',
        short: shortNodeName(n.name ?? ''),
        dateAdded: n.dateAdded ?? '',
        internal: internal.has(n.evmAddress.toLowerCase()),
      }))
      .sort((a, b) => String(a.dateAdded).localeCompare(String(b.dateAdded)));
  } catch {
    return [];
  }
}

/** `redstone-primary-prod-ciri` reads better as `ciri`. */
function shortNodeName(name) {
  return name.replace(`${DATA_SERVICE_ID}-`, '') || 'unnamed';
}

/** Every registered node address, lowercased — what a signature is checked against. */
export function knownSigners() {
  try {
    return getSignersForDataServiceId(DATA_SERVICE_ID, true).map((a) =>
      a.toLowerCase()
    );
  } catch {
    return [];
  }
}

/** Pull the numeric value out of a data point, whatever shape it arrives in. */
function readValue(dataPoint) {
  if (!dataPoint) return null;
  const obj = typeof dataPoint.toObj === 'function' ? dataPoint.toObj() : dataPoint;
  const raw = obj?.value ?? obj?.numericValue;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

/** The per-exchange breakdown, present only when sources are switched on. */
function readSources(dataPoint) {
  const obj = typeof dataPoint?.toObj === 'function' ? dataPoint.toObj() : dataPoint;
  const meta = obj?.metadata;
  const sourceMetadata = meta?.sourceMetadata;
  if (!sourceMetadata) return null;

  const rows = Object.entries(sourceMetadata)
    .map(([name, entry]) => {
      const value = Number(entry?.value);
      const trade = entry?.tradeInfo ?? {};
      return {
        name,
        value: Number.isFinite(value) ? value : null,
        bid: Number(trade.bidPrice),
        ask: Number(trade.askPrice),
        volumeUsd: Number(trade.volumeInUsd),
      };
    })
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0));

  return {
    rows,
    aggregated: meta?.value ?? null,
    nodeLabel: meta?.nodeLabel ?? null,
  };
}

function computeMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The same ordering the SDK applies when it hands a contract N packages:
 * sort by relative distance from the median and take the first N. Replicated
 * here so the page can show the ranking instead of hiding it.
 */
function rankByMedianDistance(signers) {
  const values = signers.map((s) => s.value).filter((v) => v !== null);
  const median = values.length ? computeMedian(values) : null;

  const ranked = signers
    .map((s) => ({
      ...s,
      distance:
        s.value === null || !median ? Infinity : Math.abs(s.value - median) / median,
    }))
    .sort((a, b) => a.distance - b.distance)
    .map((s, i) => ({ ...s, rank: i }));

  return { ranked, median };
}

function normalisePackages(feedId, packages, at) {
  // A handful of ids are bundles rather than prices — one package carrying
  // dozens of feeds at once. Counted here so the page can say so instead of
  // showing the first of seventy-two numbers as if it were the price.
  const points = Math.max(
    ...packages.map((pkg) => (pkg.dataPackage ?? pkg)?.dataPoints?.length ?? 0),
    0
  );

  const signers = packages.map((pkg, i) => {
    const dp = pkg.dataPackage ?? pkg;
    const point = dp?.dataPoints?.[0];
    return {
      key: `${feedId}-${at}-${i}`,
      value: readValue(point),
      sources: readSources(point),
      timestamp: dp?.timestampMilliseconds ?? null,
      raw: pkg,
      address: null, // filled in by verify()
      status: 'unverified', // unverified | ok | bad
    };
  });

  const { ranked, median } = rankByMedianDistance(signers);
  const values = ranked.map((s) => s.value).filter((v) => v !== null);

  // Spread against the median, not the minimum: this number sits under the
  // headline price, so it should be measured from the same place.
  const spread =
    values.length > 1 && median
      ? ((Math.max(...values) - Math.min(...values)) / median) * 100
      : 0;

  return {
    feedId,
    signers: ranked,
    median,
    spread,
    spreadBps: spread * 100,
    points,
    timestamp: ranked[0]?.timestamp ?? null,
  };
}

/**
 * Fetch every requested feed in ONE round of gateway calls.
 *
 * The gateway has no per-feed route: `/v2/data-packages/latest/<service>` hands
 * back all 868 feeds whatever you ask for. Asking feed by feed downloaded the
 * same payload once per feed per gateway, so this asks once for all of them.
 *
 * `disableMedianSelection` keeps every package rather than the N closest to the
 * median, because which ones get dropped is part of what the page is showing.
 */
export async function fetchFeeds(feedIds, { withSources = false } = {}) {
  if (!feedIds.length) return [];

  const res = await requestDataPackages({
    dataServiceId: DATA_SERVICE_ID,
    dataPackagesIds: feedIds,
    uniqueSignersCount: 1,
    authorizedSigners: getSignersForDataServiceId(DATA_SERVICE_ID, true),
    disableMedianSelection: true,
    ignoreMissingFeed: true,
    hideMetadata: withSources ? false : undefined,
    waitForAllGatewaysTimeMs: 2500,
  });

  const at = Date.now();
  return feedIds
    .map((id) => {
      const packages = res?.[id] ?? [];
      return packages.length ? normalisePackages(id, packages, at) : null;
    })
    .filter(Boolean);
}

/**
 * The same call against a past timestamp. The gateway keeps roughly a day of
 * these; anything older comes back as a gateway error.
 */
export async function fetchFeedsAt(feedIds, timestamp) {
  const historicalTimestamp =
    Math.floor(timestamp / HISTORICAL_STEP_MS) * HISTORICAL_STEP_MS;

  const res = await requestDataPackages({
    dataServiceId: DATA_SERVICE_ID,
    dataPackagesIds: feedIds,
    uniqueSignersCount: 1,
    authorizedSigners: getSignersForDataServiceId(DATA_SERVICE_ID, true),
    disableMedianSelection: true,
    ignoreMissingFeed: true,
    historicalTimestamp,
    urls: HISTORICAL_GATEWAYS,
  });

  return feedIds
    .map((id) => {
      const packages = res?.[id] ?? [];
      return packages.length
        ? normalisePackages(id, packages, historicalTimestamp)
        : null;
    })
    .filter(Boolean);
}

/**
 * One plain read of the gateway to list everything it is publishing right now.
 * Used for the feed picker; deliberately not routed through the SDK, since all
 * this needs is the names.
 */
export async function fetchCatalogue() {
  const hosts = [
    'https://oracle-gateway-1.a.redstone.finance',
    'https://oracle-gateway-2.a.redstone.finance',
  ];

  let lastError = null;
  for (const host of hosts) {
    try {
      const r = await fetch(
        `${host}/v2/data-packages/latest/${DATA_SERVICE_ID}`,
        { headers: { accept: 'application/json' } }
      );
      if (!r.ok) throw new Error(`gateway responded ${r.status}`);
      const body = await r.json();

      return Object.entries(body)
        .map(([id, packages]) => ({
          id,
          label: FEED_LABELS[id] ?? '',
          packages: packages.length,
          points: packages?.[0]?.dataPoints?.length ?? 0,
          value: packages?.[0]?.dataPoints?.[0]?.value ?? null,
        }))
        .filter((f) => f.points === 1) // bundles aren't prices; keep them out
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('no gateway answered');
}

/**
 * Ask each gateway whether it is there at all. Its root replies with one short
 * line, so this costs nothing next to a data request.
 *
 * Worth showing rather than hiding: from some networks one of the three does
 * not resolve, and a page arguing for transparency should say which of its own
 * sources answered instead of quietly leaning on the survivors.
 */
export async function probeGateways() {
  return Promise.all(
    GATEWAYS.map(async (url) => {
      const started = Date.now();
      try {
        const r = await fetch(`${url}/`, { cache: 'no-store' });
        return { url, ok: r.ok, ms: Date.now() - started };
      } catch {
        return { url, ok: false, ms: null };
      }
    })
  );
}

/**
 * Recover each signer address from its signature, right here in the browser,
 * and check it against the registry. This is the whole point of the page.
 */
export function verify(signers, known) {
  return signers.map((s) => {
    try {
      const addr = recoverSignerAddress(s.raw);
      const lower = String(addr).toLowerCase();
      return {
        ...s,
        address: addr,
        status: known.includes(lower) ? 'ok' : 'bad',
      };
    } catch {
      return { ...s, address: null, status: 'bad' };
    }
  });
}

/**
 * The exact bytes a contract would receive: the top-N packages packed into a
 * RedStone payload. Handing this over is the difference between saying the
 * evidence exists and letting someone walk away with it.
 */
export function buildPayload(feed, count) {
  const chosen = feed.signers
    .filter((s) => s.rank < count)
    .map((s) => s.raw);
  if (!chosen.length) return null;
  try {
    return convertDataPackagesResponse({ [feed.feedId]: chosen }, 'hex');
  } catch {
    return null;
  }
}

export function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

export function formatPrice(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const decimals =
    abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : abs > 0 ? 8 : 2;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatVolume(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}b`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function formatAge(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
