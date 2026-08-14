import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FEEDS,
  fetchFeed,
  knownSigners,
  verify,
  shortAddr,
  formatPrice,
} from './oracle';

const REFRESH_MS = 15000;

function Signer({ signer, median }) {
  const delta =
    signer.value !== null && median
      ? ((signer.value - median) / median) * 100
      : 0;
  const cls =
    signer.status === 'ok' ? 'signer ok' : signer.status === 'bad' ? 'signer bad' : 'signer';

  return (
    <div className={cls}>
      <span className="seal-dot" aria-hidden="true" />
      <span className="addr">
        {signer.address ? shortAddr(signer.address) : 'signature not opened yet'}
        {signer.status === 'bad' && (
          <span className="unknown">not on the official list</span>
        )}
        {signer.status === 'unverified' && (
          <span className="pending">press verify to recover this address</span>
        )}
      </span>
      <span className="signed-val">{formatPrice(signer.value)}</span>
      <span className={delta === 0 ? 'delta' : 'delta nonzero'}>
        {delta === 0 ? 'exact' : `${delta > 0 ? '+' : ''}${delta.toFixed(4)}%`}
      </span>
    </div>
  );
}

function Feed({ feed, meta, known }) {
  const [signers, setSigners] = useState(feed.signers);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    setSigners(feed.signers);
    setVerified(false);
  }, [feed]);

  const runVerify = () => {
    setSigners(verify(signers, known));
    setVerified(true);
  };

  const okCount = signers.filter((s) => s.status === 'ok').length;
  const split = feed.spread > 0.05;

  return (
    <section className="feed">
      <div className="feed-head">
        <div>
          <p className="symbol">
            {feed.feedId} · {meta?.label ?? ''}
          </p>
          <p className="median">
            <span className="cur">$</span>
            {formatPrice(feed.median)}
          </p>
        </div>
        <div className="agreement">
          <b className={split ? 'split' : ''}>
            {split ? `${feed.spread.toFixed(3)}% apart` : 'identical'}
          </b>
          {signers.length} independent signatures
        </div>
      </div>

      <div className="signers">
        {signers.map((s) => (
          <Signer key={s.key} signer={s} median={feed.median} />
        ))}
      </div>

      <div className="verify-bar">
        <button className="verify-btn" onClick={runVerify} disabled={verified}>
          {verified ? 'Verified' : 'Verify signatures'}
        </button>
        <span className={verified ? 'verify-note done' : 'verify-note'}>
          {verified
            ? `${okCount} of ${signers.length} addresses matched RedStone's official node list`
            : 'runs in your browser — nothing is sent anywhere'}
        </span>
      </div>
    </section>
  );
}

export default function App() {
  const [feeds, setFeeds] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [signersCount, setSignersCount] = useState(3);
  const timer = useRef(null);

  const known = useMemo(() => knownSigners(), []);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        FEEDS.map((f) => fetchFeed(f.id, signersCount))
      );
      setFeeds(results.filter((r) => r.signers.length > 0));
      setUpdatedAt(Date.now());
      setStatus('ready');
      setError('');
    } catch (e) {
      setStatus('error');
      setError(e?.message ? String(e.message).slice(0, 160) : 'unknown error');
    }
  }, [signersCount]);

  useEffect(() => {
    setStatus('loading');
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

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
            data service <b>redstone-primary-prod</b>
          </span>
          <span>
            official node addresses <b>{known.length}</b>
          </span>
          <span>
            refresh <b>every {REFRESH_MS / 1000}s</b>
          </span>
        </div>
      </header>

      <div className="controls">
        <span className="tick">signatures per feed</span>
        {[1, 3, 5].map((n) => (
          <button
            key={n}
            className="chip"
            aria-pressed={signersCount === n}
            onClick={() => setSignersCount(n)}
          >
            {n}
          </button>
        ))}
        <span className="spacer" />
        <span className="tick">
          {updatedAt
            ? `updated ${new Date(updatedAt).toLocaleTimeString('en-GB')}`
            : ''}
        </span>
      </div>

      {status === 'loading' && <p className="state">Asking the gateway…</p>}

      {status === 'error' && (
        <p className="state error">
          The gateway didn't answer.
          <span className="retry">{error}</span>
        </p>
      )}

      {status === 'ready' &&
        feeds.map((f) => (
          <Feed
            key={f.feedId}
            feed={f}
            meta={FEEDS.find((x) => x.id === f.feedId)}
            known={known}
          />
        ))}

      <section className="explainer">
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
      </section>

      <footer className="colophon">
        Built on the public RedStone SDK. No API key, no backend, no tracking.
        Addresses are recovered from signatures in your browser and compared
        against the node list bundled in the SDK.
        <br />
        Not affiliated with RedStone. Prices shown for inspection, not for
        trading.
      </footer>
    </div>
  );
}
