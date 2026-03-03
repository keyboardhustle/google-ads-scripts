/**
 * Google Ads Script: Intra-Day Anomaly Detector
 * ===============================================
 * Problem:  Google Ads native alerts are too slow (24h+ lag) and don't compare
 *           today's performance to a meaningful baseline. This script runs hourly,
 *           compares today's CPA, CTR, conversions, and spend to the 14-day same-
 *           hour average, and alerts you immediately when something is wrong.
 *
 * Schedule: Hourly
 * Author:   keyboardhustle
 */

// ================================================================
// CONFIG - Edit only this block
// ================================================================
var CONFIG = {
  ALERT_EMAIL: 'your-email@company.com',   // Where to send alerts
  ACCOUNT_NAME: 'My B2B SaaS Account',      // For email subject line
  DRY_RUN: false,                           // true = log only, no emails

  // Threshold multipliers. Alert fires when today > baseline * threshold.
  // 1.5 = 50% above/below baseline triggers alert.
  CPA_SPIKE_THRESHOLD: 1.5,     // CPA 50% above baseline
  CTR_DROP_THRESHOLD:  0.6,     // CTR 40% below baseline
  CONV_DROP_THRESHOLD: 0.5,     // Conversions 50% below baseline
  SPEND_SPIKE_THRESHOLD: 1.4,   // Spend 40% above expected pace

  BASELINE_DAYS: 14,            // How many days back for baseline
  MIN_IMPRESSIONS: 100,         // Ignore hours with fewer impressions (low volume = noisy)
  LOG_SHEET_URL: '',            // Optional: Google Sheet URL to log anomalies
};
// ================================================================

function main() {
  var results = [];
  var today = new Date();
  var currentHour = today.getHours();

  Logger.log('Running anomaly detection for hour: ' + currentHour);

  // Get today's stats up to current hour
  var todayStats = getHourlyStats(0, currentHour);

  // Get baseline: same hour range, averaged over last BASELINE_DAYS days
  var baselineStats = getBaselineStats(currentHour);

  if (!todayStats || !baselineStats) {
    Logger.log('Insufficient data. Skipping.');
    return;
  }

  Logger.log('Today - Spend: ' + todayStats.spend + ' | CPA: ' + todayStats.cpa +
             ' | CTR: ' + todayStats.ctr + ' | Convs: ' + todayStats.conversions);
  Logger.log('Baseline - Spend: ' + baselineStats.spend + ' | CPA: ' + baselineStats.cpa +
             ' | CTR: ' + baselineStats.ctr + ' | Convs: ' + baselineStats.conversions);

  // Check each metric
  if (baselineStats.cpa > 0 && todayStats.cpa > baselineStats.cpa * CONFIG.CPA_SPIKE_THRESHOLD) {
    results.push(formatAlert('CPA SPIKE',
      'CPA is ' + pct(todayStats.cpa, baselineStats.cpa) + '% above ' + CONFIG.BASELINE_DAYS + '-day baseline.',
      todayStats.cpa, baselineStats.cpa, 'NOK'));
  }

  if (baselineStats.ctr > 0 && todayStats.ctr < baselineStats.ctr * CONFIG.CTR_DROP_THRESHOLD) {
    results.push(formatAlert('CTR DROP',
      'CTR is ' + pct(todayStats.ctr, baselineStats.ctr) + '% below baseline. Check ad serving, policy flags, or Quality Score issues.',
      todayStats.ctr, baselineStats.ctr, '%'));
  }

  if (baselineStats.conversions > 0 && todayStats.conversions < baselineStats.conversions * CONFIG.CONV_DROP_THRESHOLD) {
    results.push(formatAlert('CONVERSION DROP',
      'Conversions are tracking ' + pct(todayStats.conversions, baselineStats.conversions) + '% below baseline. Check landing page, tracking tag, or campaign status.',
      todayStats.conversions, baselineStats.conversions, ''));
  }

  if (baselineStats.spend > 0 && todayStats.spend > baselineStats.spend * CONFIG.SPEND_SPIKE_THRESHOLD) {
    results.push(formatAlert('SPEND SPIKE',
      'Spend is ' + pct(todayStats.spend, baselineStats.spend) + '% above expected pace.',
      todayStats.spend, baselineStats.spend, 'NOK'));
  }

  if (results.length > 0) {
    var subject = '[ALERT] Google Ads Anomaly: ' + CONFIG.ACCOUNT_NAME + ' - ' + results.length + ' issue(s) detected';
    var body = buildEmailBody(results, today, currentHour);
    Logger.log('ANOMALIES DETECTED:\n' + body);
    if (!CONFIG.DRY_RUN) {
      MailApp.sendEmail(CONFIG.ALERT_EMAIL, subject, body);
      Logger.log('Alert email sent to: ' + CONFIG.ALERT_EMAIL);
    }
    if (CONFIG.LOG_SHEET_URL) {
      logToSheet(results, today);
    }
  } else {
    Logger.log('No anomalies detected. All metrics within thresholds.');
  }
}


function getHourlyStats(startHour, endHour) {
  var dateRange = 'TODAY';
  var query = 'SELECT metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions ' +
              'FROM campaign ' +
              'WHERE segments.hour >= ' + startHour + ' AND segments.hour < ' + endHour +
              ' AND campaign.status = "ENABLED" ' +
              'DURING ' + dateRange;
  try {
    var report = AdsApp.report(query);
    return aggregateReport(report);
  } catch(e) {
    Logger.log('Error fetching today stats: ' + e);
    return null;
  }
}


function getBaselineStats(currentHour) {
  var totals = { spend: 0, conversions: 0, clicks: 0, impressions: 0 };
  var days = CONFIG.BASELINE_DAYS;

  for (var i = 1; i <= days; i++) {
    var date = new Date();
    date.setDate(date.getDate() - i);
    var dateStr = Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
    var query = 'SELECT metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions ' +
                'FROM campaign ' +
                'WHERE segments.hour < ' + currentHour +
                ' AND campaign.status = "ENABLED" ' +
                'DURING ' + dateStr;
    try {
      var report = AdsApp.report(query);
      var dayStats = aggregateReport(report);
      if (dayStats) {
        totals.spend += dayStats.spend;
        totals.conversions += dayStats.conversions;
        totals.clicks += dayStats.clicks;
        totals.impressions += dayStats.impressions;
      }
    } catch(e) {
      Logger.log('Skipping day ' + dateStr + ': ' + e);
    }
  }

  // Average over days
  return {
    spend:       totals.spend / days,
    conversions: totals.conversions / days,
    clicks:      totals.clicks / days,
    impressions: totals.impressions / days,
    ctr:         totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    cpa:         totals.conversions > 0 ? totals.spend / totals.conversions : 0,
  };
}


function aggregateReport(report) {
  var rows = report.rows();
  var totals = { spend: 0, conversions: 0, clicks: 0, impressions: 0 };
  while (rows.hasNext()) {
    var row = rows.next();
    totals.spend       += parseFloat(row['metrics.cost_micros']) / 1e6;
    totals.conversions += parseFloat(row['metrics.conversions']);
    totals.clicks      += parseFloat(row['metrics.clicks']);
    totals.impressions += parseFloat(row['metrics.impressions']);
  }
  if (totals.impressions < CONFIG.MIN_IMPRESSIONS) return null; // too low volume
  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  totals.cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
  return totals;
}


function pct(today, baseline) {
  return Math.round(Math.abs((today - baseline) / baseline) * 100);
}


function formatAlert(type, message, todayVal, baselineVal, unit) {
  return {
    type: type,
    message: message,
    today: todayVal,
    baseline: baselineVal,
    unit: unit
  };
}


function buildEmailBody(alerts, date, hour) {
  var lines = [
    'Google Ads Anomaly Report',
    'Account: ' + CONFIG.ACCOUNT_NAME,
    'Time: ' + Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd HH:mm') + ' UTC (through hour ' + hour + ')',
    '',
    alerts.length + ' anomaly/anomalies detected:',
    ''
  ];
  alerts.forEach(function(a) {
    lines.push('--- ' + a.type + ' ---');
    lines.push(a.message);
    lines.push('Today: ' + a.today.toFixed(2) + a.unit + ' | Baseline: ' + a.baseline.toFixed(2) + a.unit);
    lines.push('');
  });
  lines.push('Log in to Google Ads to investigate.');
  return lines.join('\n');
}


function logToSheet(alerts, date) {
  try {
    var ss = SpreadsheetApp.openByUrl(CONFIG.LOG_SHEET_URL);
    var sheet = ss.getSheetByName('AnomalyLog') || ss.insertSheet('AnomalyLog');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Account', 'Anomaly Type', 'Message', 'Today Value', 'Baseline Value']);
    }
    alerts.forEach(function(a) {
      sheet.appendRow([date, CONFIG.ACCOUNT_NAME, a.type, a.message, a.today, a.baseline]);
    });
  } catch(e) {
    Logger.log('Could not write to sheet: ' + e);
  }
}
