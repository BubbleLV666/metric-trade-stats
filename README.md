# Metric Trade Stats

Unofficial wallet statistics for [Metric](https://metric.xyz) (onchain liquidity pools).
A static page, no backend: everything runs in your browser.

- **Pools**: your liquidity positions per pool (value now, tokens, P&L, price range), pool volume for 24h / 7d / 30d / all time and your own swaps per pool.
- **Swap history**: every swap with amounts, USD value and a link to the transaction, filterable by 24 hours / 7 days / 30 days / all time.
- **Platform volume**: Metric volume over all networks (hover for the split per network).

## How to use

1. Open your address on the block explorer of the network (for example `robin.etherscan.io` for Robinhood chain) and press **Download CSV Export** on the Transactions tab.
2. Drop the CSV file on the page (or press **Load explorer CSV…**). The page reads only those transactions from the chain and decodes the Metric events.
3. Pressing Enter in the address field shows only the current positions of any address, without a CSV.

## Data sources

- `api.metric.xyz/public/v1`: pools, prices, volumes, wallet positions.
- Public RPC of the network (Robinhood: `rpc.mainnet.chain.robinhood.com`): transaction receipts. Ethereum and BSC need an RPC that allows browser access (field on the page).

USD values use the current prices of the Metric API. Liquidity shows deposits, not an exact position history. Not affiliated with Metric.

## Run locally

Any static server works, for example `python -m http.server` in this folder.
