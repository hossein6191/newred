# Proof of Price

An open window into RedStone's oracle. Every price RedStone publishes is signed
by independent nodes before it reaches a blockchain. Those signatures are
normally invisible. This page shows them, and lets anyone recover and check the
signer addresses in their own browser.

## Why this exists

Most oracle dashboards show you a number. This one shows you the evidence behind
the number:

- the value each independent node signed, side by side
- which of those a consumer contract would actually use, and which get dropped
- how far apart the nodes are, in basis points, over time
- the exchanges each node aggregated, with bid, ask and volume
- the address recovered from each signature, checked against RedStone's node
  registry

No API key. No backend. No tracking. The registry ships inside the RedStone SDK,
and signature recovery happens client side.

## Run it

```bash
npm install
npm run dev
```

Open the printed localhost URL.

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Deploy

Any static host works, since there is no server component.

- **Vercel** — import the repo, framework preset `Vite`, that's it
- **Netlify** — build command `npm run build`, publish directory `dist`

## How it works

`src/oracle.js` calls `requestDataPackages` from `@redstone-finance/sdk` against
the `redstone-primary-prod` data service. A few details matter:

- **One request covers every feed on screen.** The gateway has no per-feed
  route: `/v2/data-packages/latest/<service>` returns all 868 feeds whatever you
  ask for, so asking feed by feed downloads the same payload once per feed per
  gateway. All selected feeds go in a single `dataPackagesIds` array.
- `authorizedSigners` is required, sourced from
  `getSignersForDataServiceId(DATA_SERVICE_ID, true)`.
- `disableMedianSelection: true` keeps all five packages. By default the SDK
  sorts by distance from the median and returns only the closest N — which ones
  get dropped is part of what this page exists to show, so the ranking is
  reproduced in `rankByMedianDistance` and displayed instead of applied.
- `hideMetadata: false` adds the per-exchange breakdown. It roughly doubles the
  response, so it sits behind a toggle.
- Signature verification is **not** skipped. `skipSignatureVerification: true`
  makes the SDK trust the `signerAddress` field the gateway sends instead of
  recovering it from the signature, which is the opposite of the point.

Verification is then done again, visibly, in the browser via
`recoverSignerAddress` from `@redstone-finance/protocol`, and the recovered
address is compared against the registry.

## Where the data comes from

| what | source | network call |
| --- | --- | --- |
| prices and signatures | `oracle-gateway-{1,2}.a.redstone.finance` and `oracle-gateway-1.a.redstone.vip`, raced by the SDK | yes, every 15s |
| the node registry | `registry/initial-state.json`, bundled in `@redstone-finance/sdk` | no |
| feed catalogue | one plain read of a gateway at startup | once |
| gateway health | a 29-byte read of each gateway's root | once |
| chart history | live readings as they arrive, plus an optional hour seeded from the gateway's `/historical` route | on demand |
| week-long chart | `o40uhl5zq9.execute-api.us-east-1.amazonaws.com/prices/pull/many-historical` | on demand |
| on-chain deployments | `relayer-remote-config` manifests in the RedStone monorepo | once |
| logos | `redstone-images` via jsDelivr | per icon |

The masthead reports **gateways answering N of 3** rather than assuming all three
are up, because `oracle-gateway-1.a.redstone.vip` does not resolve from every
network. The SDK races all three and takes the freshest reply, so the page keeps
working on two — but it says so instead of hiding it.

The gateways answer with `access-control-allow-origin: *` and need no key,
account or allowlist. The historical route is served only by
`oracle-gateway-2.a.redstone.finance` and `oracle-gateway-1.a.redstone.vip`, and
keeps roughly a day — beyond about 36 hours it returns a gateway error.

## Two things worth knowing before relying on this

**The all-feeds and metadata routes are meant to need a key.** RedStone's own
gateway source (`packages/cache-service/.../base-data-packages.controller.ts`)
guards them with `validateAllFeedsAccess` and `validateMetadataAccess`, both of
which demand an admin API key — the check is skipped only because the key regex
is unset in the deployed config. The feed catalogue and the exchange breakdown
here both ride on those routes. If the key is ever switched on, those two
features stop and the rest of the page carries on.

A per-feed route, `latest-by-data-feeds/<service>?dataFeedIds=…`, already exists
in `main` and is the intended public path, but is not deployed on either
production gateway yet. When it lands it should replace the all-feeds call.

**The week-long chart is unsigned.** It comes from the undocumented API behind
RedStone's own dashboard, not from signed data packages. It is labelled as such
in the interface, and the page works without it.

## Notes

Not affiliated with RedStone. Prices are shown for inspection, not for trading.
