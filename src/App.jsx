import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DATA_SERVICE_ID,
  DEFAULT_FEEDS,
  FEED_LABELS,
  GATEWAYS,
  buildPayload,
  fetchCatalogue,
  fetchFeeds,
  fetchFeedsAt,
  fetchOnChainDeployments,
  fetchSourceLogoIndex,
  fetchWeekHistory,
  formatAge,
  formatDuration,
  probeGateways,
  sourceLogoUrl,
  symbolLogoCandidates,
  formatPrice,
  formatVolume,
  knownSigners,
  registryNodes,
  shortAddr,
  verify,
} from './oracle';

const REFRESH_MS = 15000;
const HISTORY_CAP = 480; // two hours at the refresh rate
const SEED_POINTS = 12;
const SEED_STEP_MS = 5 * 60 * 1000;
const MAX_FEEDS = 8;

/**
 * `navigator.clipboard` needs a secure context and a permission the browser can
 * refuse; the old selection trick needs neither. Try the good one, keep the old
 * one for when it isn't there.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- logo */

/**
 * RedStone files its logos under a lot of different extensions, and there is no
 * manifest small enough to be worth downloading for the symbol set. So try each
 * extension in turn and step aside quietly if none of them exist.
 */
function Logo({ candidates, alt, className = 'logo' }) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  const key = list.join('|');

  // The progress is tracked against the url list itself rather than reset by an
  // effect: the caller builds a fresh array every render, so an effect keyed on
  // it would restart the image on every tick of the clock — and would retry a
  // missing logo forever.
  const [state, setState] = useState({ key, attempt: 0 });
  const attempt = state.key === key ? state.attempt : 0;

  if (!list.length || attempt >= list.length) {
    return <span className={`${className} logo-blank`} aria-hidden="true" />;
  }

  return (
    <img
      className={className}
      src={list[attempt]}
      alt={alt}
      onError={() => setState({ key, attempt: attempt + 1 })}
    />
  );
}

/* ------------------------------------------------------------------ intro */

function Intro() {
  return (
    <section className="intro">
      <h2 className="intro-head">What this page is</h2>
      <p className="intro-lede">
        RedStone is an oracle: it carries prices from the world's exchanges onto
        blockchains, so that contracts handling real money know what things cost.
        Five independent nodes each publish a price and sign it. This page is a
        window into that machinery — it shows you the signatures, and lets you
        check them yourself.
      </p>
      <ol className="intro-steps">
        <li>
          <b>Nodes read the market.</b> Each one polls dozens of exchanges,
          aggregates what it finds, and signs the result with its own private
          key. You can open any node here and see every exchange behind its
          number, with the bid, the ask and the volume.
        </li>
        <li>
          <b>The signature travels with the price.</b> That signature is the
          proof the number came from that node and was not altered on the way.
          Press <i>verify</i> and your browser recovers the signing address from
          the signature and checks it against RedStone's public node registry.
          Nothing is sent anywhere — the check happens on your machine.
        </li>
        <li>
          <b>A contract picks a few and acts.</b> It does not take the first
          signatures it sees; it takes the ones closest to the median and drops
          the rest. The page marks which is which, and hands you the exact bytes
          a contract would receive.
        </li>
      </ol>
      <p className="intro-foot">
        Almost every price dashboard asks you to take its word for it. The point
        of this one is that you don't have to.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ chart */

function Sparkline({ points }) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const W = 1000;
    const H = 120;
    const padY = 10;

    const times = points.map((p) => p.t);
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    const span = t1 - t0 || 1;

    let lo = Math.min(...points.map((p) => p.min));
    let hi = Math.max(...points.map((p) => p.max));
    if (!(hi > lo)) {
      const eps = Math.abs(hi) * 0.0005 || 0.5;
      lo = hi - eps;
      hi = hi + eps;
    }
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;

    const x = (t) => ((t - t0) / span) * W;
    const y = (v) => H - padY - ((v - lo) / (hi - lo)) * (H - 2 * padY);

    const line = points
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.median).toFixed(2)}`)
      .join(' ');

    const band =
      points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.max).toFixed(2)}`).join(' ') +
      ' ' +
      [...points]
        .reverse()
        .map((p) => `L${x(p.t).toFixed(1)} ${y(p.min).toFixed(2)}`)
        .join(' ') +
      ' Z';

    const last = points[points.length - 1];
    const first = points[0];
    const change = first.median ? ((last.median - first.median) / first.median) * 100 : 0;

    return {
      W,
      H,
      line,
      band,
      // What the data actually reached, not the padded axis the line is drawn on.
      low: Math.min(...points.map((p) => p.min)),
      high: Math.max(...points.map((p) => p.max)),
      change,
      dotX: x(last.t),
      dotY: y(last.median),
      // Rounding a 40 second window to "0m" reads as broken, and so does
      // describing a week as 10020m.
      window:
        span < 90000
          ? `${Math.round(span / 1000)}s`
          : span < 5400000
            ? `${Math.round(span / 60000)}m`
            : span < 172800000
              ? `${(span / 3600000).toFixed(1)}h`
              : `${(span / 86400000).toFixed(1)}d`,
    };
  }, [points]);

  if (!geometry) {
    return (
      <p className="chart-empty">
        collecting points — the line starts drawing on the second reading
      </p>
    );
  }

  // The week-long series is a single price per hour with no node breakdown, so
  // "they all agreed" would be a claim the data cannot support.
  const unsigned = points.some((p) => p.unsigned);
  const worstBps = Math.max(...points.map((p) => p.spreadBps || 0));

  return (
    <div className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${geometry.W} ${geometry.H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price over the last ${geometry.window}`}
      >
        <path className="chart-band" d={geometry.band} />
        <path className="chart-line" d={geometry.line} />
        <circle className="chart-dot" cx={geometry.dotX} cy={geometry.dotY} r="7" />
      </svg>
      <div className="chart-foot">
        <span>
          high <b>{formatPrice(geometry.high)}</b>
        </span>
        <span>
          low <b>{formatPrice(geometry.low)}</b>
        </span>
        <span>
          {points.length} readings over <b>{geometry.window}</b>
        </span>
        <span>
          move{' '}
          <b className={geometry.change < 0 ? 'down' : 'up'}>
            {geometry.change >= 0 ? '+' : ''}
            {geometry.change.toFixed(3)}%
          </b>
        </span>
        <span className="chart-band-note">
          {unsigned ? (
            <>
              per-node spread <b>not published at this range</b>
            </>
          ) : worstBps >= 0.005 ? (
            <>
              widest node disagreement <b>{worstBps.toFixed(2)} bps</b>
            </>
          ) : (
            <>
              node disagreement <b>none, at any point</b>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- sources */

function SourceTable({ sources, sourceLogos }) {
  if (!sources?.rows?.length) {
    return <p className="src-empty">this node published no source breakdown</p>;
  }
  return (
    <div className="src">
      <div className="src-head">
        <span>exchange</span>
        <span>bid</span>
        <span>ask</span>
        <span>24h volume</span>
      </div>
      {sources.rows.map((r) => (
        <div className="src-row" key={r.name}>
          <span className="src-name">
            <Logo
              candidates={sourceLogoUrl(r.name, sourceLogos)}
              alt=""
              className="logo source-logo"
            />
            {r.name}
          </span>
          <span>{formatPrice(r.bid)}</span>
          <span>{formatPrice(r.ask)}</span>
          <span className="src-vol">{formatVolume(r.volumeUsd)}</span>
        </div>
      ))}
      {sources.aggregated && (
        <p className="src-note">
          aggregated to <b>{sources.aggregated}</b>
          {sources.nodeLabel ? ` by ${sources.nodeLabel}` : ''}, then rounded to
          8 decimals before signing
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ signer */

function Signer({ signer, median, count, node, showSources, sourceLogos }) {
  const [open, setOpen] = useState(false);

  const delta =
    signer.value !== null && median ? ((signer.value - median) / median) * 100 : 0;
  // Anything below this prints as +0.0000%, so calling it a difference — and
  // colouring it like one — would be the page lying about its own numbers.
  const exact = Math.abs(delta) < 0.00005;
  const used = signer.rank < count;
  const cls = [
    'signer',
    signer.status === 'ok' ? 'ok' : signer.status === 'bad' ? 'bad' : '',
    used ? 'used' : 'dropped',
  ]
    .filter(Boolean)
    .join(' ');

  const hasSources = Boolean(signer.sources?.rows?.length);

  return (
    <div className={cls}>
      <div className="signer-main">
        <span className="seal-dot" aria-hidden="true" />
        <span className="addr">
          <span className="node-name">
            {!signer.address ? 'sealed' : node ? node.short : 'unregistered node'}
          </span>
          {signer.address ? shortAddr(signer.address) : 'signature not opened yet'}
          {signer.status === 'bad' && (
            <span className="unknown">not in RedStone's node registry</span>
          )}
          {signer.status === 'unverified' && (
            <span className="pending">press verify to recover this address</span>
          )}
        </span>
        <span className="signed-val">{formatPrice(signer.value)}</span>
        <span className={exact ? 'delta' : 'delta nonzero'}>
          {exact ? 'exact' : `${delta > 0 ? '+' : ''}${delta.toFixed(4)}%`}
        </span>
        <span className={used ? 'use-tag in' : 'use-tag out'}>
          {used ? 'used' : 'dropped'}
        </span>
      </div>

      {showSources && (
        <div className="signer-sources">
          <button
            className="src-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            disabled={!hasSources}
          >
            {hasSources
              ? `${open ? 'hide' : 'show'} the ${signer.sources.rows.length} exchanges behind this number`
              : 'no source breakdown published'}
          </button>
          {open && hasSources && (
            <SourceTable sources={signer.sources} sourceLogos={sourceLogos} />
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- on-chain */

/**
 * The other half of the story. Everything above is a price sitting in a
 * gateway; this is where that price is actually written on a blockchain, and
 * the rule that decides when it gets rewritten.
 */
function OnChain({ deployments, feedId }) {
  const [open, setOpen] = useState(false);
  const rows = deployments?.[feedId];

  if (!rows?.length) return null;

  return (
    <div className="onchain">
      <button
        className="src-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'hide' : 'show'} where {feedId} is written on-chain —{' '}
        {rows.length} {rows.length === 1 ? 'chain' : 'chains'}
      </button>

      {open && (
        <div className="src">
          <div className="src-head onchain-grid">
            <span>chain</span>
            <span>price feed contract</span>
            <span>updates when</span>
          </div>
          {rows.map((r) => (
            <div className="src-row onchain-grid" key={`${r.chain}-${r.address}`}>
              <span className="src-name">{r.chain}</span>
              <span className="onchain-addr">{r.address ?? '—'}</span>
              <span className="onchain-rule">
                {r.deviation !== null ? `moves ${r.deviation}%` : 'deviation unset'}
                {r.heartbeatMs
                  ? `, or ${formatDuration(r.heartbeatMs)} passes`
                  : ''}
              </span>
            </div>
          ))}
          <p className="src-note">
            A relayer watches the signed price and rewrites the contract only
            when one of these thresholds is crossed. Between updates the number
            on-chain sits still while the one above keeps moving — which is
            exactly the gap an oracle exists to manage.
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- feed */

function Feed({
  feed,
  history,
  weekHistory,
  range,
  deployments,
  sourceLogos,
  known,
  count,
  nodes,
  showSources,
  now,
}) {
  const [verified, setVerified] = useState(false);
  const [copied, setCopied] = useState('');

  // Once someone has asked to see the addresses, keep recovering them on every
  // later reading. Making them press the button again every 15 seconds would be
  // its own small lie about how much work verifying costs.
  const signers = useMemo(
    () => (verified ? verify(feed.signers, known) : feed.signers),
    [feed, verified, known]
  );

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(''), 6000);
    return () => clearTimeout(id);
  }, [copied]);

  const nodeFor = useCallback(
    (addr) => (addr ? nodes.find((n) => n.lower === addr.toLowerCase()) : null),
    [nodes]
  );

  const copyPayload = async () => {
    const hex = buildPayload(feed, count);
    if (!hex) {
      setCopied('could not build the payload');
      return;
    }
    const ok = await copyText(hex);
    setCopied(
      ok
        ? `${hex.length} hex characters copied — ${count} signed packages`
        : 'the browser refused the clipboard'
    );
  };

  const okCount = signers.filter((s) => s.status === 'ok').length;
  const split = feed.spreadBps > 5;
  const age = feed.timestamp ? now - feed.timestamp : null;
  const stale = age !== null && age > 120000;

  return (
    <section className="feed">
      <div className="feed-head">
        <div>
          <p className="symbol">
            <Logo
              candidates={symbolLogoCandidates(feed.feedId)}
              alt=""
              className="logo symbol-logo"
            />
            {feed.feedId}
            {FEED_LABELS[feed.feedId] ? ` · ${FEED_LABELS[feed.feedId]}` : ''}
          </p>
          <p className="median">
            <span className="cur">$</span>
            {formatPrice(feed.median)}
          </p>
          <p className={stale ? 'stamp stale' : 'stamp'}>
            signed {age === null ? '—' : `${formatAge(age)} ago`}
            {stale ? ' — older than the usual cadence' : ''}
          </p>
          {feed.points > 1 && (
            <p className="stamp stale">
              this id is a bundle of {feed.points} values, not one price — only
              the first is shown
            </p>
          )}
        </div>
        <div className="agreement">
          <b className={split ? 'split' : ''}>
            {feed.spreadBps < 0.005
              ? 'identical'
              : `${feed.spreadBps.toFixed(2)} bps apart`}
          </b>
          {signers.length} independent signatures
        </div>
      </div>

      <Sparkline points={(range === 'week' ? weekHistory : history) ?? []} />

      {range === 'week' && (
        <p className="chart-warning">
          This week-long line comes from RedStone's own dashboard API, not from
          signed packages. It is here for shape and context — everything else on
          this page carries a signature you can check, and this does not.
        </p>
      )}

      <div className="signers">
        {signers.map((s) => (
          <Signer
            key={s.key}
            signer={s}
            median={feed.median}
            count={count}
            node={nodeFor(s.address)}
            showSources={showSources}
            sourceLogos={sourceLogos}
          />
        ))}
      </div>

      <OnChain deployments={deployments} feedId={feed.feedId} />

      <div className="verify-bar">
        <button
          className="verify-btn"
          onClick={() => setVerified(true)}
          disabled={verified}
        >
          {verified ? 'Verified' : 'Verify signatures'}
        </button>
        <button className="verify-btn ghost" onClick={copyPayload}>
          Copy the on-chain payload
        </button>
        <span className={verified ? 'verify-note done' : 'verify-note'}>
          {copied ||
            (verified
              ? `${okCount} of ${signers.length} addresses matched the registry`
              : 'runs in your browser — nothing is sent anywhere')}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ picker */

function FeedPicker({ catalogue, selected, onToggle }) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return catalogue.filter((f) => f.id.toUpperCase().includes(q)).slice(0, 48);
  }, [catalogue, query]);

  return (
    <div className="picker">
      <input
        className="picker-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          catalogue.length
            ? `search ${catalogue.length} live feeds — try SOL, XAG, TSLA`
            : 'loading the feed list…'
        }
        aria-label="Search feeds"
      />
      {matches.length > 0 && (
        <div className="picker-results">
          {matches.map((f) => (
            <button
              key={f.id}
              className="chip"
              aria-pressed={selected.includes(f.id)}
              onClick={() => onToggle(f.id)}
              disabled={!selected.includes(f.id) && selected.length >= MAX_FEEDS}
            >
              {f.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- registry */

function Registry({ nodes, seenNow }) {
  const [open, setOpen] = useState(false);
  const signing = nodes.filter((n) => seenNow.has(n.lower));
  const quiet = nodes.filter((n) => !seenNow.has(n.lower));

  return (
    <section className="registry">
      <button
        className="registry-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '−' : '+'} {nodes.length} nodes registered for this data service,{' '}
        {signing.length} signing right now
      </button>
      {open && (
        <div className="registry-body">
          <p className="registry-note">
            This list is a snapshot shipped inside the RedStone SDK package, not
            something the page fetched. A signature counts as genuine only if the
            address recovered from it appears here.
          </p>
          <div className="registry-grid">
            {[...signing, ...quiet].map((n) => (
              <div
                className={seenNow.has(n.lower) ? 'reg-row live' : 'reg-row'}
                key={n.lower}
              >
                <span className="reg-dot" aria-hidden="true" />
                <span className="reg-name">{n.short}</span>
                <span className="reg-addr">{shortAddr(n.address)}</span>
                <span className="reg-meta">
                  {n.internal ? 'core' : 'external'} · added {n.dateAdded}
                </span>
                <span className="reg-state">
                  {seenNow.has(n.lower) ? 'signing' : 'silent'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- app */

function readFeedsFromUrl() {
  try {
    const raw = new URLSearchParams(window.location.search).get('feeds');
    if (!raw) return null;
    // Feed ids are case sensitive — stETH and wstETH are not STETH and WSTETH.
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_FEEDS);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [selected, setSelected] = useState(() => readFeedsFromUrl() ?? DEFAULT_FEEDS);
  const [catalogue, setCatalogue] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [history, setHistory] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [count, setCount] = useState(3);
  const [showSources, setShowSources] = useState(false);
  const [seeding, setSeeding] = useState('');
  const [range, setRange] = useState('live');
  const [weekHistory, setWeekHistory] = useState({});
  const [sourceLogos, setSourceLogos] = useState(null);
  const [deployments, setDeployments] = useState({});

  const timer = useRef(null);
  const clock = useRef(null);

  const known = useMemo(() => knownSigners(), []);
  const nodes = useMemo(() => registryNodes(), []);

  // The roll call under the registry needs recovered addresses whether or not
  // anyone pressed verify on a particular feed, so it does its own pass. It is
  // the same recovery, not a shortcut: an address only counts once its
  // signature has actually produced it.
  const seenNow = useMemo(() => {
    const set = new Set();
    for (const f of feeds) {
      for (const s of verify(f.signers, known)) {
        if (s.status === 'ok' && s.address) set.add(s.address.toLowerCase());
      }
    }
    return set;
  }, [feeds, known]);

  const record = useCallback((results) => {
    setHistory((prev) => {
      const next = { ...prev };
      for (const f of results) {
        const values = f.signers.map((s) => s.value).filter((v) => v !== null);
        if (!values.length || !f.timestamp) continue;

        const point = {
          t: f.timestamp,
          median: f.median,
          min: Math.min(...values),
          max: Math.max(...values),
          spreadBps: f.spreadBps,
        };

        const series = next[f.feedId] ?? [];
        if (series.some((p) => p.t === point.t)) continue;
        next[f.feedId] = [...series, point]
          .sort((a, b) => a.t - b.t)
          .slice(-HISTORY_CAP);
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const results = await fetchFeeds(selected, { withSources: showSources });
      setFeeds(results);
      record(results);
      setUpdatedAt(Date.now());
      setStatus(results.length ? 'ready' : 'empty');
      setError('');
    } catch (e) {
      setStatus('error');
      setError(e?.message ? String(e.message).slice(0, 200) : 'unknown error');
    }
  }, [selected, showSources, record]);

  useEffect(() => {
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  useEffect(() => {
    clock.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock.current);
  }, []);

  useEffect(() => {
    if (!seeding || seeding.startsWith('reading')) return undefined;
    const id = setTimeout(() => setSeeding(''), 8000);
    return () => clearTimeout(id);
  }, [seeding]);

  useEffect(() => {
    fetchCatalogue()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
    probeGateways()
      .then(setGateways)
      .catch(() => setGateways([]));
    fetchSourceLogoIndex()
      .then(setSourceLogos)
      .catch(() => setSourceLogos({}));
    fetchOnChainDeployments()
      .then(setDeployments)
      .catch(() => setDeployments({}));
  }, []);

  // The week-long series is only worth fetching once someone asks to see it.
  useEffect(() => {
    if (range !== 'week') return;
    const missing = selected.filter((id) => !weekHistory[id]);
    if (!missing.length) return;
    fetchWeekHistory(missing)
      .then((series) => setWeekHistory((prev) => ({ ...prev, ...series })))
      .catch(() => {
        /* the line is a courtesy; the page works without it */
      });
  }, [range, selected, weekHistory]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('feeds', selected.join(','));
      window.history.replaceState(null, '', url);
    } catch {
      /* deep links are a nicety, not a requirement */
    }
  }, [selected]);

  const toggleFeed = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((f) => f !== id) : prev;
      return prev.length >= MAX_FEEDS ? prev : [...prev, id];
    });
  };

  /**
   * Fill the chart from the gateway's historical route instead of waiting for
   * live readings to pile up. Each point is a full gateway response, so this is
   * deliberately a button rather than something that happens on load.
   */
  const seedHistory = async () => {
    setSeeding('reading the last hour…');
    const base = Date.now() - SEED_POINTS * SEED_STEP_MS;
    let filled = 0;
    for (let i = 0; i < SEED_POINTS; i += 1) {
      try {
        const results = await fetchFeedsAt(selected, base + i * SEED_STEP_MS);
        record(results);
        filled += results.length ? 1 : 0;
        setSeeding(`reading the last hour… ${i + 1}/${SEED_POINTS}`);
      } catch {
        /* the gateway keeps about a day; gaps are expected at the edges */
      }
    }
    setSeeding(
      filled ? `filled ${filled} past readings` : 'the gateway returned no history'
    );
  };

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="kicker">An open window into RedStone's oracle</p>
        <h1 className="title">
          Don't trust the price.
          <br />
          <em>Open the signatures.</em>
        </h1>
        <p className="standfirst">
          Every price RedStone publishes is signed by independent nodes before it
          reaches a blockchain. Those signatures are usually invisible. Here they
          are, and you can check them yourself without leaving this page.
        </p>
        <div className="meta-row">
          <span>
            data service <b>{DATA_SERVICE_ID}</b>
          </span>
          <span>
            registered nodes <b>{nodes.length}</b>
          </span>
          <span>
            live feeds <b>{catalogue.length || '—'}</b>
          </span>
          <span title={gateways.map((g) => `${g.url} ${g.ok ? 'ok' : 'unreachable'}`).join('\n')}>
            gateways answering{' '}
            <b>
              {gateways.length
                ? `${gateways.filter((g) => g.ok).length} of ${GATEWAYS.length}`
                : `— of ${GATEWAYS.length}`}
            </b>
          </span>
          <span>
            refresh <b>every {REFRESH_MS / 1000}s</b>
          </span>
        </div>
      </header>

      <Intro />

      <div className="controls">
        <span className="tick">signatures a consumer takes</span>
        {[1, 3, 5].map((n) => (
          <button
            key={n}
            className="chip"
            aria-pressed={count === n}
            onClick={() => setCount(n)}
          >
            {n}
          </button>
        ))}

        <span className="divider" aria-hidden="true" />

        <span className="tick">chart</span>
        <button
          className="chip"
          aria-pressed={range === 'live'}
          onClick={() => setRange('live')}
          title="built from signed packages as they arrive"
        >
          signed
        </button>
        <button
          className="chip"
          aria-pressed={range === 'week'}
          onClick={() => setRange('week')}
          title="a week of hourly prices from RedStone's dashboard API — unsigned"
        >
          7 days
        </button>

        <span className="divider" aria-hidden="true" />

        <button
          className="chip"
          aria-pressed={showSources}
          onClick={() => setShowSources((v) => !v)}
        >
          exchange sources
        </button>
        <button
          className="chip"
          onClick={seedHistory}
          disabled={
            range === 'week' || (Boolean(seeding) && seeding.startsWith('reading'))
          }
          title="fetch the last hour as signed packages"
        >
          load the last hour
        </button>

        <span className="spacer" />
        <span className="tick">
          {seeding ||
            (updatedAt
              ? `updated ${new Date(updatedAt).toLocaleTimeString('en-GB')}`
              : '')}
        </span>
      </div>

      <div className="controls">
        <span className="tick">feeds</span>
        {selected.map((id) => (
          <button
            key={id}
            className="chip"
            aria-pressed="true"
            onClick={() => toggleFeed(id)}
            title="remove this feed"
          >
            {id} ×
          </button>
        ))}
        <FeedPicker
          catalogue={catalogue}
          selected={selected}
          onToggle={toggleFeed}
        />
      </div>

      {status === 'loading' && <p className="state">Asking the gateways…</p>}

      {status === 'empty' && (
        <p className="state">
          The gateways answered, but published nothing for these feeds.
        </p>
      )}

      {status === 'error' && (
        <p className="state error">
          The gateways didn't answer.
          <span className="retry">{error}</span>
        </p>
      )}

      {(status === 'ready' || status === 'empty') &&
        feeds.map((f) => (
          <Feed
            key={f.feedId}
            feed={f}
            history={history[f.feedId]}
            weekHistory={weekHistory[f.feedId]}
            range={range}
            deployments={deployments}
            sourceLogos={sourceLogos}
            known={known}
            count={count}
            nodes={nodes}
            showSources={showSources}
            now={now}
          />
        ))}

      <Registry nodes={nodes} seenNow={seenNow} />

      <section className="explainer">
        <div>
          <h3>Where the numbers come from</h3>
          <p>
            Prices and signatures come from RedStone's public gateways. The node
            registry, the exchange logos and the on-chain deployment rules come
            from RedStone's own open repositories. Nothing here is scraped or
            guessed, and no key was needed for any of it.
          </p>
        </div>
        <div>
          <h3>What a signature is</h3>
          <p>
            A node reports a price and signs it with its private key. The
            signature is proof that this exact number came from that exact node
            and hasn't been altered since.
          </p>
        </div>
        <div>
          <h3>Why open them</h3>
          <p>
            A price on a screen is a claim. A signed price is evidence. Opening
            the signature turns one into the other, and you never have to take
            anyone's word for it.
          </p>
        </div>
        <div>
          <h3>Why they usually agree</h3>
          <p>
            The nodes run separately and pull from many exchanges. Matching to
            the last decimal means the market itself is unambiguous. A gap means
            it isn't, and that is worth seeing.
          </p>
        </div>
        <div>
          <h3>Used and dropped</h3>
          <p>
            A contract asking for three signatures doesn't get the first three.
            It gets the three closest to the median, and the rest are discarded.
            That ranking is shown here rather than hidden.
          </p>
        </div>
      </section>

      <footer className="colophon">
        Built on the public RedStone SDK. No API key, no backend, no tracking.
        Addresses are recovered from signatures in your browser and compared
        against the node registry bundled in the SDK.
        <br />
        Not affiliated with RedStone. Prices shown for inspection, not for
        trading.
      </footer>
    </div>
  );
}
