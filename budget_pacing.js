/**
 * Budget Pacing and Spend Monitoring Script
 * ==========================================
 * Monitors daily spend across campaigns and adjusts budgets dynamically
 * to hit monthly targets without overspending.
 * 
 * Features:
 * - Tracks actual spend vs. ideal pacing
 * - Auto-adjusts daily budgets to stay on track
 * - Sends alerts when spend deviates >15% from target
 * - Prevents month-end budget exhaustion
 * 
 * Setup:
 * 1. Set MONTHLY_BUDGET_TARGET
 * 2. Configure EMAIL_RECIPIENTS
 * 3. Schedule to run daily at 9 AM
 * 
 * Author: Marketing Analyst
 * Last Updated: 2025
 */

const CONFIG = {
  MONTHLY_BUDGET_TARGET: 100000, // Total monthly budget in account currency
  PACING_TOLERANCE: 0.15,        // Alert if >15% off target
  EMAIL_RECIPIENTS: ['marketing@company.com'],
  ADJUSTMENT_ENABLED: true,      // Set false for monitoring only
  MIN_DAILY_BUDGET: 10,          // Minimum campaign daily budget
  MAX_DAILY_BUDGET: 5000         // Maximum campaign daily budget
};

function main() {
  Logger.log('=== Budget Pacing Script Started ===');
  
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const daysRemaining = daysInMonth - dayOfMonth + 1;
  
  // Calculate ideal pacing
  const idealSpendToDate = CONFIG.MONTHLY_BUDGET_TARGET * (dayOfMonth / daysInMonth);
  const idealDailyBudget = CONFIG.MONTHLY_BUDGET_TARGET / daysInMonth;
  
  // Get actual spend
  const actualSpend = getMonthToDateSpend();
  const spendDeviation = actualSpend - idealSpendToDate;
  const deviationPct = spendDeviation / idealSpendToDate;
  
  Logger.log('Month: ' + (today.getMonth() + 1) + '/' + today.getFullYear());
  Logger.log('Day ' + dayOfMonth + ' of ' + daysInMonth + ' (' + daysRemaining + ' days remaining)');
  Logger.log('Ideal spend to date: $' + idealSpendToDate.toFixed(2));
  Logger.log('Actual spend to date: $' + actualSpend.toFixed(2));
  Logger.log('Deviation: $' + spendDeviation.toFixed(2) + ' (' + (deviationPct * 100).toFixed(1) + '%)');
  
  // Calculate adjusted daily budget for remaining days
  const remainingBudget = CONFIG.MONTHLY_BUDGET_TARGET - actualSpend;
  const adjustedDailyBudget = remainingBudget / daysRemaining;
  
  Logger.log('Remaining budget: $' + remainingBudget.toFixed(2));
  Logger.log('Adjusted daily budget target: $' + adjustedDailyBudget.toFixed(2));
  
  // Adjust campaign budgets if enabled
  if (CONFIG.ADJUSTMENT_ENABLED) {
    adjustCampaignBudgets(adjustedDailyBudget);
  }
  
  // Send alert if significantly off pace
  if (Math.abs(deviationPct) > CONFIG.PACING_TOLERANCE) {
    sendPacingAlert({
      dayOfMonth: dayOfMonth,
      daysInMonth: daysInMonth,
      idealSpend: idealSpendToDate,
      actualSpend: actualSpend,
      deviation: spendDeviation,
      deviationPct: deviationPct,
      adjustedDailyBudget: adjustedDailyBudget
    });
  }
  
  Logger.log('=== Budget Pacing Script Completed ===');
}

function getMonthToDateSpend() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const dateFrom = Utilities.formatDate(firstDayOfMonth, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
  const dateTo = Utilities.formatDate(today, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
  
  const report = AdsApp.report(
    'SELECT Cost ' +
    'FROM ACCOUNT_PERFORMANCE_REPORT ' +
    'WHERE Cost > 0 ' +
    'DURING ' + dateFrom + ',' + dateTo
  );
  
  const rows = report.rows();
  let totalCost = 0;
  
  while (rows.hasNext()) {
    const row = rows.next();
    totalCost += parseFloat(row['Cost'].replace(/,/g, ''));
  }
  
  return totalCost;
}

function adjustCampaignBudgets(targetDailyBudget) {
  Logger.log('\n--- Adjusting Campaign Budgets ---');
  
  const campaignIterator = AdsApp.campaigns()
    .withCondition('Status = ENABLED')
    .withCondition('AdvertisingChannelType = SEARCH')
    .get();
  
  const totalCampaigns = campaignIterator.totalNumEntities();
  const budgetPerCampaign = targetDailyBudget / totalCampaigns;
  
  Logger.log('Active campaigns: ' + totalCampaigns);
  Logger.log('Target budget per campaign: $' + budgetPerCampaign.toFixed(2));
  
  let adjusted = 0;
  
  while (campaignIterator.hasNext()) {
    const campaign = campaignIterator.next();
    const currentBudget = campaign.getBudget().getAmount();
    
    // Apply min/max constraints
    let newBudget = budgetPerCampaign;
    if (newBudget < CONFIG.MIN_DAILY_BUDGET) {
      newBudget = CONFIG.MIN_DAILY_BUDGET;
    } else if (newBudget > CONFIG.MAX_DAILY_BUDGET) {
      newBudget = CONFIG.MAX_DAILY_BUDGET;
    }
    
    // Only adjust if change is > 5%
    const changePercent = Math.abs((newBudget - currentBudget) / currentBudget);
    
    if (changePercent > 0.05) {
      campaign.getBudget().setAmount(newBudget);
      Logger.log(campaign.getName() + ': $' + currentBudget.toFixed(2) + ' -> $' + newBudget.toFixed(2));
      adjusted++;
    }
  }
  
  Logger.log('Adjusted ' + adjusted + ' campaign budgets');
}

function sendPacingAlert(data) {
  const subject = '⚠️ Google Ads Budget Pacing Alert';
  
  let status = 'OVERSPENDING';
  let recommendation = 'Reduce daily budgets to avoid exhausting monthly budget.';
  
  if (data.deviationPct < 0) {
    status = 'UNDERSPENDING';
    recommendation = 'Increase daily budgets to hit monthly target.';
  }
  
  const body = 
    'Budget Pacing Alert: ' + status + '\n' +
    '=====================================\n\n' +
    'Current Status (Day ' + data.dayOfMonth + ' of ' + data.daysInMonth + '):\n' +
    '- Ideal spend to date: $' + data.idealSpend.toFixed(2) + '\n' +
    '- Actual spend to date: $' + data.actualSpend.toFixed(2) + '\n' +
    '- Deviation: $' + data.deviation.toFixed(2) + ' (' + (data.deviationPct * 100).toFixed(1) + '%)\n\n' +
    'Adjusted Action:\n' +
    '- New daily budget target: $' + data.adjustedDailyBudget.toFixed(2) + '\n\n' +
    'Recommendation:\n' +
    recommendation + '\n\n' +
    'This is an automated alert from Google Ads Scripts.';
  
  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS.join(','),
    subject: subject,
    body: body
  });
  
  Logger.log('Alert email sent to: ' + CONFIG.EMAIL_RECIPIENTS.join(', '));
}
