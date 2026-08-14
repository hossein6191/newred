import {
  requestDataPackages,
  getSignersForDataServiceId,
} from '@redstone-finance/sdk';
import { recoverSignerAddress } from '@redstone-finance/protocol';

export const DATA_SERVICE_ID = 'redstone-primary-prod';

// Feeds shown on the page. Kept small on purpose: each one is a separate
// gateway round trip, and the point is depth per feed, not breadth.
export const FEEDS = [
  { id: 'ETH', label: 'Ether' },
  { id: 'BTC', label: 'Bitcoin' },
  { id: 'XAU', label: 'Gold, troy ounce' },
];

/** Official node addresses, bundled inside the SDK — no network call. */
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

/**
 * Fetch signed packages for one feed and normalise them for the UI.
 * Signature verification is deliberately left to the browser (see verify()).
 */
export async function fetchFeed(feedId, signersCount = 3) {
  const res = await requestDataPackages({
    dataServiceId: DATA_SERVICE_ID,
    dataPackagesIds: [feedId],
    uniqueSignersCount: signersCount,
    authorizedSigners: getSignersForDataServiceId(DATA_SERVICE_ID, true),
    skipSignatureVerification: true,
    waitForAllGatewaysTimeMs: 2500,
  });

  const packages = res?.[feedId] ?? [];

  const signers = packages.map((pkg, i) => {
    const dp = pkg.dataPackage ?? pkg;
    const value = readValue(dp?.dataPoints?.[0]);
    return {
      key: `${feedId}-${i}`,
      value,
      timestamp: dp?.timestampMilliseconds ?? null,
      raw: pkg,
      address: null, // filled in by verify()
      status: 'unverified', // unverified | ok | bad
    };
  });

  const values = signers.map((s) => s.value).filter((v) => v !== null);
  const median = values.length ? computeMedian(values) : null;
  const spread =
    values.length > 1
      ? ((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100
      : 0;

  return {
    feedId,
    signers,
    median,
    spread,
    timestamp: signers[0]?.timestamp ?? null,
  };
}

function computeMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Recover each signer address from its signature, right here in the browser,
 * and check it against the official list. This is the whole point of the page.
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

export function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

export function formatPrice(v) {
  if (v === null || v === undefined) return '—';
  const decimals = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
