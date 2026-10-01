# Research price basis and MACD divergence, 01/10/2026

## Price evidence

`daily_prices` remains the mixed-source observation series used by the
published engine; the targeted TRC repair archives its overwritten originals.
`research_price_bars` is a separate KBS historical
series fetched in one consistent thousand-VND/share basis. Every observation
has source URL, collection time, source version, and a quality flag. A sync
status row records date coverage against stored prices and quarantined jumps.
Research replay and recalculated outcomes require `MATCHED` coverage and the
expected KBS version. An unmatched date or a vendor price jump blocks that
symbol's research cohort; it is never silently filled or scaled.

KBS does not expose a usable complete corporate-action ledger through the
endpoint tested on 01/10/2026. The vendor-rebased series improves historical
price consistency, but it is **not proof** that every cash dividend, stock
dividend, split, and rights issue is correctly adjusted. VSDC confirms TRC's
1:3 bonus issue and 16/09/2026 record date; the 15/09/2026 ex-rights session
is corroborated separately. The event is stored with its source URL. The full
universe still needs an authoritative, licensed event/factor feed and a
reconciliation audit before corporate-action coverage can be called complete.
TRC was repaired after its own matched KBS sync: 1,337 source bars passed
date matching and jump checks. Its original stored rows are archived before
the verified 1:3 bonus price basis and reciprocal pre-ex-rights share volume
are applied. The volume adjustment is calculated from the official bonus
ratio, not supplied as an adjusted-volume field by KBS.

The original 2025–2026 funnel results remain under version
`MTF_FUNNEL_SHADOW_V1`. Replays on the separate KBS series use a distinct
`_KBS_REBASED` version, so they cannot silently overwrite the original
cohort. They include next-session open entry and fixed fees, tax, and slippage
for a comparable fixed-horizon net return. Existing engine outcomes are stale
until recomputed on matched KBS histories.
The full vendor series is refreshed weekly outside market hours so later
vendor revisions cannot remain permanently invisible.

## MACD divergence lane

`MACD_BULLISH_DIVERGENCE_SHADOW_V2` scans confirmed price lows and compares
the MACD line and histogram separately as a percentage of each session's close,
so the recovery threshold is comparable across share price levels. It records two- or three-swing
evidence, a fixed price trigger, invalidation, expiry, and point-in-time pivot
confirmation. A setup cannot be revived after invalidation. Research replay
uses the KBS series and next-session fills with the same cost assumptions.
The lane does not emit `signals` or `consolidated_signals` and cannot initiate
trades. The Screener displays the setup and the exact pivot evidence.
V1 observations remain in the audit table; the panel prefers V2 on the
matched KBS price basis when both versions exist.

NT2 is an important audit case: on the normalized V2 definition, its KBS
series produced a three-swing MACD-line candidate from 20/05, 03/06, and
23/07/2026 price lows, confirmed after two closed sessions on 27/07. It
required a close above 23.25 and was invalidated below 20.5 before any price
trigger. A separate two-swing histogram candidate was also invalidated.
The algorithm therefore
does not convert the 30/09 rebound into a buy signal from that old setup.

## Activation gate

The new funnel and divergence lane remain research-only. Historical years
already inspected while designing the rules cannot be relabeled as untouched
out-of-sample evidence. Activation needs a reconciled corporate-action ledger,
matched replay of the existing engine on the same universe and dates, frozen
parameters, and then a prospective period using next-session fills and costs.
