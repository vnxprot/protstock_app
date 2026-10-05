# Prot Stock v1.0.0

This release consolidates the existing Prot Stock application under the v1.0.0 product version. System structure labels in the interface use v1.0. The three Core Engine variants retain separate descriptive names so users can still distinguish their roles.

The release changes presentation labels, package metadata, PWA metadata, and the service worker cache key. It does not change quantitative thresholds, algorithms, active rule configuration, stored engine names, source revisions, database schemas, EOD workflows, or historical signals. Internal identifiers such as `core-rules-v4.0.0`, `health-v4.0.0`, and `MACD_BULLISH_DIVERGENCE_ZONE_V4` remain necessary to join and reproduce stored data. The UI shows v1.0 for these structures; underlying identifiers remain available in source data and, where practical, element details.

Personal thesis and user rule version numbers remain their actual sequence numbers. These are audit history, not system release labels.

Validation: production web build, JavaScript tests, Python tests, universe validation, and migration smoke test. Deployment verification should confirm the production page, manifest, and service worker reflect v1.0.0.
