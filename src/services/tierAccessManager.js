const config = require('../config');

/**
 * Enterprise Tier & Monetization Access Manager (Requerimiento 9)
 * Decoupled middleware to enforce tier-based feature gating and alert adaptation.
 */
class TierAccessManager {
  constructor(options = {}) {
    this.tiers = options.tiers || config.tiers;
    this.featureFlags = options.featureFlags || config.featureFlags;
  }

  /**
   * Checks if a given tier has access to a specific system feature
   * @param {string} tierKey - 'FREE' | 'VIP' | 'PRO'
   * @param {string} feature - Feature identifier
   * @returns {boolean}
   */
  checkAccess(tierKey = 'FREE', feature) {
    if (!this.featureFlags.enableTierGating) {
      // If monetization gating is turned off, grant full access
      return true;
    }

    const tier = this.tiers[tierKey.toUpperCase()];
    if (!tier) return false;

    switch (feature) {
      case 'instant_alerts':
        return tier.delaySeconds === 0;

      case 'dynamic_tp2':
        return !!tier.enableTp2;

      case 'dynamic_sl':
        return !!tier.enableDynamicSl;

      case 'radar_observation':
        return tier.allowedStates.includes('OBSERVATION');

      case 'results_channel':
        return !!tier.enableResultsTracking;

      case 'all_states':
        return tier.allowedStates.length >= 3;

      default:
        return false;
    }
  }

  /**
   * Adapts alert payload to match user or channel tier permissions
   * @param {Object} alertData - Original alert signal
   * @param {string} tierKey - Target tier
   * @returns {Object|null} Filtered alertData or null if state not allowed for tier
   */
  filterAlertForTier(alertData, tierKey = 'VIP') {
    if (!this.featureFlags.enableTierGating) {
      return alertData;
    }

    const tier = this.tiers[tierKey.toUpperCase()] || this.tiers.FREE;

    // 1. Verify if this state is allowed for the tier
    if (!tier.allowedStates.includes(alertData.state)) {
      return null; // Suppressed for this tier (e.g. OBSERVATION hidden from FREE)
    }

    // 2. Clone to avoid mutating original signal
    const adapted = JSON.parse(JSON.stringify(alertData));

    // 3. Mask TP2 if tier does not have TP2 access
    if (!tier.enableTp2 && adapted.quant && adapted.quant.tradeLevels) {
      adapted.quant.tradeLevels.takeProfit2 = null;
      adapted.quant.tradeLevels.rrRatioTp2 = null;
    }

    // 4. Mask Dynamic SL details if tier does not have dynamic SL access
    if (!tier.enableDynamicSl && adapted.quant && adapted.quant.tradeLevels) {
      adapted.quant.tradeLevels.riskPct = null;
      adapted.quant.tradeLevels.atr = null;
    }

    return adapted;
  }

  /**
   * Get delay in milliseconds required before sending alert to this tier
   * @param {string} tierKey
   * @returns {number} Delay in ms
   */
  getTierDelayMs(tierKey = 'FREE') {
    if (!this.featureFlags.enableTierGating) return 0;
    const tier = this.tiers[tierKey.toUpperCase()] || this.tiers.FREE;
    return (tier.delaySeconds || 0) * 1000;
  }
}

module.exports = TierAccessManager;
