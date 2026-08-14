# Proof of Price

An open window into RedStone's oracle. Every price RedStone publishes is signed
by independent nodes before it reaches a blockchain. Those signatures are
normally invisible. This page shows them, and lets anyone recover and check the
signer addresses in their own browser.

## Why this exists

Most oracle dashboards show you a number. This one shows you the evidence behind
the number:

- the value each independent node signed, side by side
- how far apart those values are (usually zero, which is itself the story)
- the address recovered from each signature, checked against RedStone's
  official node list

No API key. No backend. No tracking. The signer list ships inside the RedStone
SDK, and signature recovery happens client side.

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
the `redstone-primary-prod` data service. Two details matter:

- `authorizedSigners` is required, sourced from
  `getSignersForDataServiceId(DATA_SERVICE_ID, true)`
- `skipSignatureVerification: true` is needed because the gateway also returns
  external fallback signers, which the SDK's internal check rejects

Verification is then done explicitly in the browser via `recoverSignerAddress`
from `@redstone-finance/protocol`, and the recovered address is compared against
the official list.

## Notes

Not affiliated with RedStone. Prices are shown for inspection, not for trading.
