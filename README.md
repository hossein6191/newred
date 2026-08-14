# Proof of Price

An open window into RedStone's oracle. Every price RedStone publishes is signed
by five independent nodes before it reaches a blockchain. Those signatures are
normally invisible. This page shows them.

## How this repo is laid out

`index.html` **is** the site — a single self-contained page. It carries its own
scripts, fonts and images inside itself and unpacks them in the browser, so
there is no build step and no dependencies to install. Vercel serves it as-is.

```
index.html     the live site
vercel.json    tells Vercel not to build anything
react-app/     an earlier version, kept for reference — not deployed
```

## Deploying

Push to `main`. Vercel serves `index.html` from the repo root. Nothing is
compiled, so a deploy is only as slow as the upload.

To replace the site, replace `index.html`. Do not add a build step for it — the
file is already complete, and running it through a bundler is what broke the
deploy the first time.

## The earlier version

`react-app/` holds a Vite and React build of the same idea, which reads the
RedStone SDK directly and verifies signatures live in the browser. It is not
deployed. To run it:

```bash
cd react-app
npm install
npm run dev
```

What it does that is worth keeping in mind:

- recovers each signer address from its signature in the browser and checks it
  against the node registry bundled in `@redstone-finance/sdk`
- shows which signatures a consumer contract would actually use and which get
  dropped, by distance from the median
- opens each node's exchange sources with bid, ask and volume
- lists where each feed is written on-chain, with the deviation and heartbeat
  that trigger a rewrite

## Notes on RedStone's endpoints

Findings from reading RedStone's own gateway source, kept here because they are
not in the public docs:

- `/v2/data-packages/latest/<service>` returns **all** feeds whatever you ask
  for — there is no deployed per-feed route yet, though
  `latest-by-data-feeds/<service>?dataFeedIds=…` exists in `main`
- the all-feeds and `show-metadata` routes are guarded in source by
  `validateAllFeedsAccess` and `validateMetadataAccess`, which require an admin
  API key. They answer without one today only because the key pattern is unset
  in the deployed config
- `redstone-primary-prod` has 11 registered nodes but only 5 ever sign
- the historical gateway route keeps roughly a day; the API behind RedStone's
  own dashboard serves a week of hourly prices, unsigned
- every gateway sends `access-control-allow-origin: *` and needs no key

## Notes

Not affiliated with RedStone. Prices are shown for inspection, not for trading.
