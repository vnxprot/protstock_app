# Research price basis and MACD divergence, 01/10/2026

## Price evidence

`daily_prices` remains the original, mixed-source observation archive used by
the published engine. `research_price_bars` is a separate KBS historical
series fetched in one consistent thousand-VND/share basis. Every observation
has source URL, collection time, source version, and a quality flag. A sync
status row records date coverage against stored prices and quarantined jumps.
Research replay and recalculated outcomes require `MATCHED` coverage and the
expected KBS version. An unmatched date or a vendor price jump blocks that
symbol's research cohort; it is never silently filled or scaled.

KBS does not expose a usable complete corporate-action ledger through the
endpoint tested on 01/10/2026. The vendor-rebased series improves historical
price consistency, but it is **not proof** that every cash dividend, stock
dividend, split, and rights issue is correctly adjusted. The verified VSDC TRC
1:3 bonus issue (ex-date 15/09/2026) is stored with its source URL. The full
universe still needs an authoritative, licensed event/factor feed and a
reconciliation audit before corporate-action coverage can be called complete.

The original 2025–2026 funnel results remain under version
`MTF_FUNNEL_SHADOW_V1`. Replays on the separate KBS series use a distinct
`_KBS_REBASED` version, so they cannot silently overwrite the original
cohort. They include next-session open entry and fixed fees, tax, and slippage
for a comparable fixed-horizon net return. Existing engine outcomes are stale
until recomputed on matched KBS histories.

## MACD divergence lane

`MACD_BULLISH_DIVERGENCE_SHADOW_V1` scans confirmed price lows and compares
the MACD line and histogram separately. It records two- or three-swing
evidence, a fixed price trigger, invalidation, expiry, and point-in-time pivot
confirmation. A setup cannot be revived after invalidation. Research replay
uses the KBS series and next-session fills with the same cost assumptions.
The lane does not emit `signals` or `consolidated_signals` and cannot initiate
trades. The Screener displays the setup and the exact pivot evidence.

NT2 is an important audit case: the KBS series produced a three-swing MACD
line candidate on 30/07/2026, requiring a close above 23.25. That historical
setup was later invalidated before such confirmation. The algorithm therefore
does not convert the 30/09 rebound into a buy signal from that old setup.

## Activation gate

The new funnel and divergence lane remain research-only. Historical years
already inspected while designing the rules cannot be relabeled as untouched
out-of-sample evidence. Activation needs a reconciled corporate-action ledger,
matched replay of the existing engine on the same universe and dates, frozen
parameters, and then a prospective period using next-session fills and costs.
