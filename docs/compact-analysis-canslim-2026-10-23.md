# Compact stock analysis and CANSLIM

Analysis uses three regions: company context, chart and flow evidence, decisions
and price levels. Two/one-region layouts respond to available content width.
CANSLIM uses an inline rule table, grouped supply parameters, compact coverage
filters and a valuation view, with shared Prot Stock theme tokens.

The existing VCI refresh now stores a shared company overview in
`canslim_vci_data.overview`. VCI company details supply market capitalization,
shares and free float directly. `statistics-financial` supplies TTM ratios;
fractions become percentages. Yearly ROE uses the VCI Q4 TTM observation.
EPS is the latest available vendor basic EPS, with its actual quarter/year shown;
it is never labelled TTM or summed across periods. Older saved ROE labels remain
visible until refresh. The actual VCI `EPS basic/diluted (VND)` labels are mapped.

Missing data stays null. Overview failures preserve the last successful overview
and independently record the refresh error. Existing authenticated read and
service-only write policies apply to the added columns. Historical analysis
explicitly identifies the company overview as the current snapshot.

Release: push main for the existing Vercel Git integration; dispatch
`canslim-vci.yml` to apply migrations first, then refresh all active symbols in
four shards. No backtest or notification job is dispatched. Per user request,
do not poll deployment, migration or refresh progress after dispatch.
