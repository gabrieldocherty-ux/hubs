# Hyperliquid Bot (working name)

Autonomous crypto perpetuals trading bot for Hyperliquid, built for Gabe's trading experiment.
See `Desktop/Claude-Brain/Projects/Crypto-Trading.md` for the full project context/decisions log.

## STATUS: infrastructure skeleton, NOT ready to trade real money

What exists right now:
- Wallet module: encrypted local storage for an **agent (API) wallet** key, never the master key
- Hyperliquid API client wrapper (testnet by default)
- Risk manager with hard ceilings (max leverage, max position size, daily loss circuit breaker)
- Kelly-criterion position sizer (quarter-Kelly default, capped)
- Backtester scaffold that pulls real historical data
- Order executor that always attaches stop-loss/take-profit in the same order group as entry (never a naked position)
- Trade journal writer that logs to the Claude-Brain vault automatically

What does NOT exist yet and is required before this touches real money:
- An actual validated strategy (a signal with backtested, cost-inclusive, non-lookahead edge). `core/strategies/` has a placeholder only.
- A completed backtest run showing the edge is real after fees + funding + slippage
- A period of testnet or tiny-live-size trading confirming the backtest matches reality

## Security model (read before funding anything)

This bot should **never** hold your master wallet's private key. Hyperliquid supports "agent wallets" (also called API wallets): a separate keypair you approve from your master account that can place/cancel orders but **cannot withdraw funds, transfer, or approve other agents**. That's the only key this bot ever touches.

Setup:
1. On Hyperliquid (testnet first: https://app.hyperliquid-testnet.xyz), create your master account/wallet — keep that key offline, never paste it here.
2. From the master account, approve a new agent wallet (Hyperliquid UI: Settings -> API -> Generate/Approve Agent, or via `exchange.approve_agent()` in the SDK). Save the agent's private key.
3. Fund a **sub-account** dedicated to this bot with only the capital you're prepared to lose. Never point this at your main account balance.
4. Run `python wallet/agent_wallet.py setup` and paste the *agent's* private key (not your master key) when prompted. It's encrypted at rest (password-based, AES via Fernet/PBKDF2) and never stored or logged in plaintext.

## Running (testnet)

```bash
pip install -r requirements.txt
cp config/settings.example.json config/settings.json   # edit: network=testnet, risk limits
python wallet/agent_wallet.py setup
python -m core.backtester --strategy example_placeholder --days 30   # must show real edge before anything else matters
python main.py --mode paper      # paper-trades against live prices, no real orders
python main.py --mode testnet    # real orders on Hyperliquid testnet (fake funds)
python main.py --mode live       # real money - only after the above two are convincing, and only Gabe flips this
```

`--mode live` is intentionally not the default anywhere in this codebase.
