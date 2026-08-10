import yfinance as yf, pandas as pd

raw = yf.download(
    ["SPY", "RSP", "^VIX", "HYG", "LQD"],
    start="2020-01-01",
    interval="1wk",
    auto_adjust=True,
    progress=False,
)

print("type(raw.columns):", type(raw.columns))
print("columns sample:", raw.columns[:8].tolist())
print()

# Test the two lookup patterns
for t in ["SPY", "RSP", "^VIX", "HYG", "LQD"]:
    found_a = ("Close", t) in raw.columns
    found_b = (t, "Close") in raw.columns
    print(f"{t:6s}  ('Close',t)={found_a}  (t,'Close')={found_b}")
