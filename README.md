# Google Ads Scripts for B2B SaaS

A collection of production-ready Google Ads Scripts that add **governance, anomaly detection, and data-driven control** on top of native Google Ads automation. Each script solves a specific operational problem that the Google Ads UI cannot handle natively.

> These scripts run inside Google Ads Scripts (JavaScript). No external tools required. Schedule them hourly or daily.

---

## Scripts in This Repo

| Script | Problem It Solves | Schedule |
|--------|-----------------|----------|
| `anomaly_detector.js` | Detects intra-day CPA, CTR, or conversion spikes/drops vs. 14-day baseline. Alerts via email. | Hourly |
| `budget_pacing_governor.js` | Tracks daily spend pace and pauses/unpauses campaigns to hit monthly budget exactly. | Every 2h |
| `pmax_asset_quality_auditor.js` | Scans all PMax campaigns, surfaces assets rated "Low", generates a Google Sheet audit report. | Daily |
| `lead_quality_score_bidder.js` | Reads a Google Sheet with CRM lead quality data and adjusts campaign targets based on offline conversion quality. | Daily |

---

## Quick Start

1. Open Google Ads → Tools & Settings → Bulk Actions → Scripts
2. Click `+` to create a new script
3. Paste the contents of the script you want
4. Update the `CONFIG` object at the top with your values
5. Authorise the script and run a preview first
6. Schedule it

---

## Design Principles

- **Config at the top.** Every script has a `CONFIG` block. You change only that block; never touch the logic.
- **Dry-run mode.** Set `CONFIG.DRY_RUN = true` to preview all actions before they take effect.
- **Audit log.** Every script writes a timestamped log to a Google Sheet for accountability.
- **Alert on failure.** Scripts email you on unexpected errors so silent failures don’t burn budget.

---

## Stack

- JavaScript (Google Ads Scripts runtime)
- Google Sheets (for config, logs, and reports)
- Google Ads API (via Scripts interface)
- Email alerts via `MailApp`
