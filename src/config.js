require('dotenv').config();

const rawToken = process.env.DISCORD_TOKEN || '';
const cleanToken = rawToken.trim().replace(/^["']|["']$/g, '');

const defaultWebhook = process.env.DISCORD_WEBHOOK_URL || 'https://divine-sky-36cc.officialkingyuli.workers.dev/api/webhooks/1544920684025872404/xL4BalWy4kDZ07_Ki3V5tXNOhFNQY6GiJM44ul6GmF7F2udGMXgW8Wkx3vq78ghpnez7';

// ====================================================================
// 🎯 QUANTITATIVE SNIPER & MOMENTUM SETTINGS
// ====================================================================
const SCANNER_CONFIG = {
  // Volume & Institutional Breakout Thresholds
  minVolumeMultiplier: parseFloat(process.env.MIN_VOLUME_MULTIPLIER || '1.8'),
  minPriceChangePct: parseFloat(process.env.MIN_PRICE_CHANGE_PCT || '0.45'),
  minBaselineQuoteVolume: parseFloat(process.env.MIN_BASELINE_QUOTE_VOL || '15000'), // Mínimo $15K USDT de volumen base
  volumeMaPeriod: parseInt(process.env.VOLUME_MA_PERIOD || '20', 10),
  cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES || '15', 10),
  publicDelaySec: parseInt(process.env.PUBLIC_ALERT_DELAY_SEC || '0', 10),

  // 1. Upper/Lower Wick Rejection Filter (Max 35% of total candle range)
  maxWickRatio: parseFloat(process.env.MAX_WICK_RATIO || '0.35'),

  // 2. EMA Extension Filter (Max 2.5% distance to EMA 20)
  maxEmaDistancePct: parseFloat(process.env.MAX_EMA_DISTANCE_PCT || '2.5'),
  emaPeriod: parseInt(process.env.EMA_PERIOD || '20', 10),

  // 3. Momentum Overbought/Oversold Climax (RSI 14)
  rsiPeriod: parseInt(process.env.RSI_PERIOD || '14', 10),
  rsiOverbought: parseFloat(process.env.RSI_OVERBOUGHT || '70'),
  rsiOversold: parseFloat(process.env.RSI_OVERSOLD || '30'),

  // 4. Volatility & Dynamic Stop-Loss (ATR 14) - Requerimiento 7
  atrPeriod: parseInt(process.env.ATR_PERIOD || '14', 10),
  atrMultiplier: parseFloat(process.env.ATR_MULTIPLIER || '0.5'),

  // Analysis Base Timeframe (Explicit)
  timeframe: process.env.ANALYSIS_TIMEFRAME || '5m'
};

// Requerimiento 9: Arquitectura de Tiers y Permisos para Monetización
const TIERS_CONFIG = {
  FREE: {
    name: 'Free Member',
    delaySeconds: parseInt(process.env.FREE_ALERT_DELAY_SEC || '120', 10), // 2 min delay
    allowedStates: ['ACTIVE_ENTRY'], // Solo entradas confirmadas (sin radar temprano)
    enableTp2: false,
    enableDynamicSl: false,
    enableResultsTracking: false,
    channels: ['free']
  },
  VIP: {
    name: 'VIP Trader',
    delaySeconds: 0, // Tiempo real instantáneo
    allowedStates: ['ACTIVE_ENTRY', 'INVALIDATED'],
    enableTp2: true,
    enableDynamicSl: true,
    enableResultsTracking: true,
    channels: ['confirmed', 'results']
  },
  PRO: {
    name: 'Institutional Pro',
    delaySeconds: 0, // Tiempo real instantáneo
    allowedStates: ['ACTIVE_ENTRY', 'OBSERVATION', 'INVALIDATED'],
    enableTp2: true,
    enableDynamicSl: true,
    enableResultsTracking: true,
    channels: ['observation', 'confirmed', 'results', 'webhooks']
  }
};

const FEATURE_FLAGS = {
  enableMultiChannelRouting: true,
  enableTradeTracking: true,
  enableRateLimitQueue: true,
  enableAntiSpamBypass: true,
  enableAtrDynamicSl: true,
  enableVolumeLiquidityFilter: true,
  enableTierGating: process.env.ENABLE_TIER_GATING === 'true' // Desactivado por defecto hasta activar monetización
};

// Requerimiento 8: Disclaimer Legal Centralizado
const LEGAL_DISCLAIMER = process.env.LEGAL_DISCLAIMER || 'Alpha Sniper System • Bybit / Binance Futures • No constituye asesoría financiera. Opere con gestión de riesgo.';

module.exports = {
  discord: {
    token: cleanToken,
    clientId: process.env.CLIENT_ID || '1536414345917890640',
    freeChannelId: process.env.DISCORD_FREE_CHANNEL_ID || '1470787821181866046',
    vipChannelId: process.env.DISCORD_VIP_CHANNEL_ID || '1470787821181866046',
    webhookUrl: defaultWebhook,

    // Requerimiento 3: Separación Multicanal Configurable
    channels: {
      observation: process.env.DISCORD_OBSERVATION_CHANNEL_ID || process.env.DISCORD_VIP_CHANNEL_ID || '1470787821181866046',
      confirmed: process.env.DISCORD_CONFIRMED_CHANNEL_ID || process.env.DISCORD_VIP_CHANNEL_ID || '1470787821181866046',
      results: process.env.DISCORD_RESULTS_CHANNEL_ID || process.env.DISCORD_VIP_CHANNEL_ID || '1470787821181866046'
    },
    webhooks: {
      observation: process.env.DISCORD_WEBHOOK_OBSERVATION || defaultWebhook,
      confirmed: process.env.DISCORD_WEBHOOK_CONFIRMED || defaultWebhook,
      results: process.env.DISCORD_WEBHOOK_RESULTS || defaultWebhook
    }
  },
  monetization: {
    binanceAffiliateUrl: process.env.BINANCE_AFFILIATE_URL || 'https://www.binance.com/register?ref=R8ZUODTR',
    bybitAffiliateUrl: process.env.BYBIT_AFFILIATE_URL || 'https://www.bybit.com/invite?ref=KYADJWY',
    mexcAffiliateUrl: process.env.MEXC_AFFILIATE_URL || 'https://www.mexc.com',
    vipPaymentUrl: process.env.VIP_PAYMENT_URL || 'https://discord.gg',
  },
  scanner: SCANNER_CONFIG,
  tiers: TIERS_CONFIG,
  featureFlags: FEATURE_FLAGS,
  legalDisclaimer: LEGAL_DISCLAIMER,
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  }
};
