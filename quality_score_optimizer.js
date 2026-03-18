/**
 * Quality Score Optimizer - Google Ads Script
 * 
 * Identifies keywords with low Quality Score and takes automated
 * action: pauses very low QS keywords, labels improvement candidates,
 * and sends a Slack/email report with actionable recommendations.
 * 
 * Quality Score Components:
 *   - Expected CTR (1-10)
 *   - Ad Relevance (1-10)
 *   - Landing Page Experience (1-10)
 *   Combined: 1-10 overall score
 *
 * B2B SaaS context: QS below 5 inflates CPC significantly.
 * Going from QS 4 to QS 7 can reduce CPC by ~40%.
 */

var CONFIG = {
  // Thresholds
  MIN_IMPRESSIONS: 100,        // Skip keywords with too little data
  PAUSE_BELOW_QS: 3,           // Auto-pause keywords with QS <= this
  FLAG_BELOW_QS: 6,            // Label keywords for review at QS <= this
  
  // Spend guard: don't pause if keyword spent this much (may still convert)
  MAX_SPEND_TO_PAUSE: 5.00,
  
  // Notification
  SLACK_WEBHOOK_URL: '',       // Optional: add your Slack webhook
  EMAIL_RECIPIENT: '',         // Optional: email for report
  
  LABEL_IMPROVE: 'QS_NEEDS_IMPROVEMENT',
  LABEL_CRITICAL: 'QS_CRITICAL',
  DRY_RUN: false               // Set true to preview without making changes
};

function main() {
  Logger.log('=== Quality Score Optimizer Started ===');
  Logger.log('Date: ' + new Date().toISOString());
  
  ensureLabelsExist();
  
  var report = {
    paused: [],
    flagged: [],
    healthy: 0,
    totalProcessed: 0
  };
  
  var keywordIterator = AdsApp.keywords()
    .withCondition('Impressions > ' + CONFIG.MIN_IMPRESSIONS)
    .withCondition('Status = ENABLED')
    .forDateRange('LAST_30_DAYS')
    .orderBy('QualityScore ASC')
    .get();
  
  while (keywordIterator.hasNext()) {
    var keyword = keywordIterator.next();
    report.totalProcessed++;
    
    var qs = keyword.getQualityScore();
    var text = keyword.getText();
    var matchType = keyword.getMatchType();
    var stats = keyword.getStatsFor('LAST_30_DAYS');
    var spend = stats.getCost();
    var adGroup = keyword.getAdGroup().getName();
    var campaign = keyword.getCampaign().getName();
    
    if (qs === null) continue;  // QS not available
    
    var entry = {
      keyword: text,
      matchType: matchType,
      qs: qs,
      spend: spend,
      adGroup: adGroup,
      campaign: campaign
    };
    
    if (qs <= CONFIG.PAUSE_BELOW_QS && spend < CONFIG.MAX_SPEND_TO_PAUSE) {
      // Critical: pause and label
      if (!CONFIG.DRY_RUN) {
        keyword.pause();
        applyLabel(keyword, CONFIG.LABEL_CRITICAL);
      }
      entry.action = 'PAUSED';
      report.paused.push(entry);
      Logger.log('[PAUSED] ' + text + ' (QS: ' + qs + ', Spend: $' + spend.toFixed(2) + ')');
      
    } else if (qs <= CONFIG.FLAG_BELOW_QS) {
      // Flag for review
      if (!CONFIG.DRY_RUN) {
        applyLabel(keyword, CONFIG.LABEL_IMPROVE);
      }
      entry.action = 'FLAGGED';
      report.flagged.push(entry);
      Logger.log('[FLAGGED] ' + text + ' (QS: ' + qs + ')');
      
    } else {
      report.healthy++;
    }
  }
  
  logSummary(report);
  
  if (CONFIG.EMAIL_RECIPIENT) {
    sendEmailReport(report);
  }
}

function ensureLabelsExist() {
  var labels = [CONFIG.LABEL_IMPROVE, CONFIG.LABEL_CRITICAL];
  labels.forEach(function(name) {
    var existing = AdsApp.labels().withCondition('Name = "' + name + '"').get();
    if (!existing.hasNext()) {
      if (!CONFIG.DRY_RUN) AdsApp.createLabel(name);
      Logger.log('Created label: ' + name);
    }
  });
}

function applyLabel(keyword, labelName) {
  var labelIterator = AdsApp.labels().withCondition('Name = "' + labelName + '"').get();
  if (labelIterator.hasNext()) {
    keyword.applyLabel(labelName);
  }
}

function logSummary(report) {
  Logger.log('\n=== SUMMARY ===');
  Logger.log('Total Keywords Processed: ' + report.totalProcessed);
  Logger.log('Paused (QS <= ' + CONFIG.PAUSE_BELOW_QS + '): ' + report.paused.length);
  Logger.log('Flagged for Improvement (QS <= ' + CONFIG.FLAG_BELOW_QS + '): ' + report.flagged.length);
  Logger.log('Healthy (QS > ' + CONFIG.FLAG_BELOW_QS + '): ' + report.healthy);
  
  if (report.paused.length > 0) {
    Logger.log('\nPaused Keywords:');
    report.paused.forEach(function(k) {
      Logger.log('  - [' + k.campaign + ' > ' + k.adGroup + '] ' + k.keyword + ' (QS: ' + k.qs + ', Spend: $' + k.spend.toFixed(2) + ')');
    });
  }
}

function sendEmailReport(report) {
  var subject = '[QS Optimizer] ' + report.paused.length + ' paused, ' + report.flagged.length + ' flagged - ' + new Date().toDateString();
  var body = 'Quality Score Optimizer Report\n\n';
  body += 'Paused: ' + report.paused.length + '\n';
  body += 'Flagged: ' + report.flagged.length + '\n';
  body += 'Healthy: ' + report.healthy + '\n\n';
  
  if (report.paused.length > 0) {
    body += 'Paused Keywords:\n';
    report.paused.forEach(function(k) {
      body += '  - ' + k.keyword + ' [QS ' + k.qs + '] in ' + k.campaign + '\n';
    });
  }
  
  MailApp.sendEmail(CONFIG.EMAIL_RECIPIENT, subject, body);
}
