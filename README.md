# Proof of Price

**[proofofprice.vercel.app](https://proofofprice.vercel.app)** — search
RedStone's oracle, signature by signature.

Every price RedStone publishes is signed by five independent nodes before it
reaches a blockchain. Those signatures are what make the price trustworthy, and
they are normally invisible. This page makes them visible, for any of the 868
feeds RedStone publishes, and checks them in front of you.

## What you can do on it

- **Search the whole oracle.** Type any symbol and get its seven-day chart, the
  value each of the five nodes is signing right now, and how far each sits from
  the median in basis points.
- **See who signed.** Each signature's address is recovered in your browser and
  matched to a named node — `wayfarer`, `morpheus`, `ciri`, `altair`, `node-5`.
  The gateway's own label is never taken on trust.
- **See what a contract would actually use.** RedStone's SDK ranks packages by
  distance from the median and hands a consumer only the closest few. The page
  shows that ranking rather than applying it, so you can watch which signatures
  get dropped.
- **Take the evidence with you.** Export the chosen packages as the exact bytes
  a consumer contract would receive.
- **Check the plumbing.** Every host the page depends on is named, with the time
  it took to answer, including the one that does not resolve from some networks.

## How it works

No API key, no backend, no tracking. Prices and signatures come from RedStone's
public gateways; the node registry ships inside `@redstone-finance/sdk`; and
signature recovery is ECDSA run client side, in the tab you have open. The page
refreshes itself every fifteen seconds.

The seven-day line is the one exception and is labelled as such in the
interface: it comes from the API behind RedStone's own dashboard and carries no
signature to check.

## Running it

`index.html` is the whole site — one self-contained file that carries its own
scripts, fonts and images. Open it in a browser, or serve the directory. There
is nothing to install and nothing to build, and `vercel.json` is there to keep
it that way.

`react-app/` holds an earlier Vite build of the same idea. It is not deployed.

## Notes

Not affiliated with RedStone. Prices are shown for inspection, not for trading.

Built by [@Hellishnum1](https://x.com/Hellishnum1).
