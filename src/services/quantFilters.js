/**
 * Quantitative Trading Filters & Momentum Sniper Indicators
 * Modular statistical tools for institutional breakout validation
 */

/**
 * Calculates Exponential Moving Average (EMA)
 * @param {number[]} prices - Array of sequential prices (chronological order: oldest to newest)
 * @param {number} period - EMA period (default 20)
 * @returns {number|null} Latest calculated EMA
 */
function calculateEMA(prices, period = 20) {
  if (!prices || prices.length === 0) return null;
  if (prices.length < period) {
    // If not enough periods, return simple average of available data
    const sum = prices.reduce((acc, p) => acc + p, 0);
    return sum / prices.length;
  }

  const k = 2 / (period + 1);
  // Initial SMA as baseline
  let ema = prices.slice(0, period).reduce((acc, p) => acc + p, 0) / period;

  // Compute EMA iteratively
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }

  return ema;
}

/**
 * Calculates Relative Strength Index (RSI) using Wilder's smoothing
 * @param {number[]} prices - Array of sequential close prices
 * @param {number} period - RSI period (default 14)
 * @returns {number} RSI value between 0 and 100
 */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) {
    return 50; // Neutral default if insufficient data
  }

  let gains = 0;
  let losses = 0;

  // First period calculations
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Subsequent smoothed values
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? Math.abs(change) : 0;

    avgGain = ((avgGain * (period - 1)) + currentGain) / period;
    avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculates Simple Moving Average of Volume
 * @param {number[]} volumes - Array of historical volume readings
 * @param {number} period - Number of periods to average
 * @returns {number} Average volume
 */
function calculateVolumeMA(volumes, period = 20) {
  if (!volumes || volumes.length === 0) return 0;
  const slice = volumes.slice(-period);
  const sum = slice.reduce((acc, v) => acc + (v || 0), 0);
  return sum / slice.length;
}

/**
 * Calculates Average True Range (ATR)
 * @param {Array<{high: number, low: number, close: number}>} candles - Array of candle objects
 * @param {number} period - ATR period (default 14)
 * @returns {number} Average True Range value
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length === 0) return 0;
  if (candles.length === 1) {
    return Math.max(0.000001, (candles[0].high || 0) - (candles[0].low || 0));
  }

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const high = curr.high || curr.price || curr.close || 0;
    const low = curr.low || curr.price || curr.close || 0;
    const prevClose = prev.close || prev.price || high;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  const slice = trs.slice(-period);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length;
}

/**
 * Upper/Lower Wick Rejection Filter
 * Prevents buying into local tops where buyers have been rejected and sellers stepped in.
 * 
 * TotalRange = High - Low
 * UpperWick = High - Max(Open, Close)
 * LowerWick = Min(Open, Close) - Low
 * 
 * @param {Object} params
 * @param {number} params.high - Highest price reached in candle/window
 * @param {number} params.low - Lowest price reached in candle/window
 * @param {number} params.open - Reference open price
 * @param {number} params.close - Current / close price
 * @param {string} params.side - 'BULLISH' or 'BEARISH'
 * @param {number} params.maxWickRatio - Threshold (default 0.35 = 35%)
 * @returns {Object} Rejection metrics
 */
function checkWickRejection({ high, low, open, close, side = 'BULLISH', maxWickRatio = 0.35 }) {
  const totalRange = high - low;
  if (totalRange <= 0) {
    return { rejected: false, wickRatio: 0, upperWick: 0, lowerWick: 0, totalRange: 0 };
  }

  if (side === 'BULLISH') {
    // For Bullish Longs: check if price rejected from high
    const bodyTop = Math.max(open, close);
    const upperWick = Math.max(0, high - bodyTop);
    const wickRatio = upperWick / totalRange;

    return {
      rejected: wickRatio > maxWickRatio,
      wickRatio: parseFloat(wickRatio.toFixed(3)),
      upperWick,
      lowerWick: Math.max(0, Math.min(open, close) - low),
      totalRange,
      threshold: maxWickRatio,
      rejectionType: 'UPPER_WICK_REJECTION'
    };
  } else {
    // For Bearish Shorts: check if price bounced from low
    const bodyBottom = Math.min(open, close);
    const lowerWick = Math.max(0, bodyBottom - low);
    const wickRatio = lowerWick / totalRange;

    return {
      rejected: wickRatio > maxWickRatio,
      wickRatio: parseFloat(wickRatio.toFixed(3)),
      upperWick: Math.max(0, high - Math.max(open, close)),
      lowerWick,
      totalRange,
      threshold: maxWickRatio,
      rejectionType: 'LOWER_WICK_REJECTION'
    };
  }
}

/**
 * Checks price extension relative to EMA
 * DistanceEMA = ((Price - EMA) / EMA) * 100
 * 
 * @param {Object} params
 * @param {number} params.price - Current asset price
 * @param {number} params.ema - Current EMA value
 * @param {number} params.maxEmaDistancePct - Maximum allowable deviation % (default 2.5%)
 * @returns {Object} Extension analysis
 */
function checkExtension({ price, ema, maxEmaDistancePct = 2.5 }) {
  if (!ema || ema <= 0 || !price || price <= 0) {
    return { extended: false, distancePct: 0, ema: price };
  }

  const distancePct = ((price - ema) / ema) * 100;
  const isExtended = Math.abs(distancePct) > maxEmaDistancePct;

  return {
    extended: isExtended,
    distancePct: parseFloat(distancePct.toFixed(2)),
    ema: parseFloat(ema.toFixed(6)),
    threshold: maxEmaDistancePct,
    isOverExtended: distancePct > maxEmaDistancePct,
    isUnderExtended: distancePct < -maxEmaDistancePct
  };
}

/**
 * Determines the expected trade direction (LONG/SHORT) from RSI(14) levels.
 * - Oversold (RSI <= oversold, e.g. < 20 or 30): Sellers exhausted -> Expected direction is LONG (rebound/rebote).
 * - Overbought (RSI >= overbought, e.g. > 70 or 75): Buyers exhausted -> Expected direction is SHORT (pullback/rejection).
 * - Neutral (30 < RSI < 70): Follows prevailing momentum or defaultSide.
 * 
 * @param {number} rsi - Current RSI(14) value (0-100)
 * @param {Object} [options]
 * @param {number} [options.rsiOverbought=70] - Overbought threshold
 * @param {number} [options.rsiOversold=30] - Oversold threshold
 * @param {string} [options.defaultSide='BULLISH'] - Default side if neutral
 * @returns {string} 'LONG' | 'SHORT'
 */
function determineDirectionFromRSI(rsi, options = {}) {
  const rsiVal = typeof rsi === 'number' && !isNaN(rsi) ? rsi : 50;
  const overbought = options.rsiOverbought !== undefined ? options.rsiOverbought : 70;
  const oversold = options.rsiOversold !== undefined ? options.rsiOversold : 30;

  // Condición corregida:
  // Sobreventa extrema (RSI <= oversold): Espera REBOTE -> LONG (no SHORT)
  if (rsiVal <= oversold) {
    return 'LONG';
  }

  // Sobrecompra extrema (RSI >= overbought): Espera RETROCESO -> SHORT (no LONG)
  if (rsiVal >= overbought) {
    return 'SHORT';
  }

  // Zona neutral intermedia: sigue la tendencia/momentum original
  if (options.defaultSide) {
    const cleanDefault = options.defaultSide.toUpperCase();
    if (cleanDefault === 'BEARISH' || cleanDefault === 'SHORT') {
      return 'SHORT';
    }
    return 'LONG';
  }

  return rsiVal >= 50 ? 'LONG' : 'SHORT';
}

/**
 * Comprehensive Evaluation: Dispatches Mode A (Immediate Entry) vs Mode B (Pullback Alert)
 * 
 * @param {Object} params
 * @returns {Object} Evaluated Signal Classification & Trade Architecture
 */
function evaluateSignalType({
  price,
  high,
  low,
  open,
  side = 'BULLISH',
  priceHistory = [],
  candleHistory = [],
  settings = {}
}) {
  const maxWickRatio = settings.maxWickRatio || 0.35;
  const maxEmaDistancePct = settings.maxEmaDistancePct || 2.5;
  const rsiOverbought = settings.rsiOverbought || 70;
  const rsiOversold = settings.rsiOversold || 30;
  const emaPeriod = settings.emaPeriod || 20;
  const rsiPeriod = settings.rsiPeriod || 14;
  const atrPeriod = settings.atrPeriod || 14;
  const atrMultiplier = settings.atrMultiplier || 0.5;

  // 1. Calculate Technical Indicators
  const ema = calculateEMA(priceHistory, emaPeriod) || (open * 0.995);
  const rsi = calculateRSI(priceHistory, rsiPeriod);

  // 2. Determine Expected Trade Direction from RSI & Momentum
  const expectedDirection = determineDirectionFromRSI(rsi, {
    rsiOverbought,
    rsiOversold,
    defaultSide: side
  });
  const effectiveSide = expectedDirection === 'SHORT' ? 'BEARISH' : 'BULLISH';

  // 3. Volatility Measurement via ATR (Requerimiento 7)
  const candleRange = Math.max(high - low, price * 0.005);
  const calculatedAtr = calculateATR(candleHistory, atrPeriod);
  const atr = calculatedAtr > 0 ? calculatedAtr : (candleRange * 0.75);

  // 4. Run Quantitative Filters
  const wickCheck = checkWickRejection({ high, low, open, close: price, side: effectiveSide, maxWickRatio });
  const extensionCheck = checkExtension({ price, ema, maxEmaDistancePct });

  // 5. Momentum Climax Check
  const isRsiOverboughtClimax = rsi >= rsiOverbought;
  const isRsiOversoldClimax = rsi <= rsiOversold;
  const isRsiClimax = isRsiOverboughtClimax || isRsiOversoldClimax;

  // 6. Decision Engine: Mode A vs Mode B
  const reasons = [];
  if (wickCheck.rejected) {
    reasons.push(`Rechazo por mecha (${(wickCheck.wickRatio * 100).toFixed(1)}% > ${(maxWickRatio * 100).toFixed(0)}%)`);
  }
  if (extensionCheck.extended) {
    reasons.push(`Sobreextensión de EMA20 (${Math.abs(extensionCheck.distancePct).toFixed(1)}% > ${maxEmaDistancePct}%)`);
  }
  if (isRsiOverboughtClimax) {
    reasons.push(`RSI Sobrecompra Extrema (${rsi.toFixed(1)} > ${rsiOverbought}) - Esperar Retroceso SHORT`);
  } else if (isRsiOversoldClimax) {
    reasons.push(`RSI Sobreventa Extrema (${rsi.toFixed(1)} < ${rsiOversold}) - Esperar Rebote LONG`);
  }

  const isModeB = reasons.length > 0;
  const mode = isModeB ? 'MODE_B' : 'MODE_A';

  // 6. Dynamic Risk Architecture & ATR-Based Stop-Loss (Requerimiento 7)
  let suggestedEntryPrice;
  let suggestedStopLoss;
  let invalidationPrice;
  let takeProfit1;
  let takeProfit2;
  let riskPct = 0;

  if (effectiveSide === 'BULLISH') {
    // Suggested Entry: 50% retracement of the candle or EMA retest
    const midRetracement = low + (candleRange * 0.5);
    suggestedEntryPrice = isModeB ? Math.max(midRetracement, ema) : price;

    // Structural Support & Dynamic Stop-Loss
    const technicalSupport = Math.min(low, ema);
    // Invalidation: structural support strictly below entry to allow candle breath
    invalidationPrice = Math.min(technicalSupport, suggestedEntryPrice - (0.15 * atr));
    // Dynamic SL: placed strictly below invalidation level with ATR cushion
    suggestedStopLoss = invalidationPrice - (atrMultiplier * atr);

    const risk = Math.max(suggestedEntryPrice - suggestedStopLoss, suggestedEntryPrice * 0.003);
    riskPct = ((suggestedEntryPrice - suggestedStopLoss) / suggestedEntryPrice) * 100;

    // Fixed R:R Targets (1:1.5 and 1:2.5)
    takeProfit1 = suggestedEntryPrice + (risk * 1.5);
    takeProfit2 = suggestedEntryPrice + (risk * 2.5);
  } else {
    // Short: 50% retracement upwards or EMA retest
    const midRetracement = high - (candleRange * 0.5);
    suggestedEntryPrice = isModeB ? Math.min(midRetracement, ema) : price;

    // Structural Resistance & Dynamic Stop-Loss
    const technicalResistance = Math.max(high, ema);
    // Invalidation: structural resistance strictly above entry to allow candle breath
    invalidationPrice = Math.max(technicalResistance, suggestedEntryPrice + (0.15 * atr));
    // Dynamic SL: placed strictly above invalidation level with ATR cushion
    suggestedStopLoss = invalidationPrice + (atrMultiplier * atr);

    const risk = Math.max(suggestedStopLoss - suggestedEntryPrice, suggestedEntryPrice * 0.003);
    riskPct = ((suggestedStopLoss - suggestedEntryPrice) / suggestedEntryPrice) * 100;

    // Fixed R:R Targets (1:1.5 and 1:2.5)
    takeProfit1 = suggestedEntryPrice - (risk * 1.5);
    takeProfit2 = suggestedEntryPrice - (risk * 2.5);
  }

  return {
    mode, // 'MODE_A' | 'MODE_B'
    isModeA: mode === 'MODE_A',
    isModeB: mode === 'MODE_B',
    direction: expectedDirection, // 'LONG' | 'SHORT'
    side: effectiveSide, // 'BULLISH' | 'BEARISH'
    modeLabel: mode === 'MODE_A'
      ? 'ENTRADA INMEDIATA (Rompimiento Sano)'
      : 'OBSERVACIÓN / ESPERAR RETROCESO (Pullback)',
    reasons,
    indicators: {
      ema20: parseFloat(ema.toFixed(6)),
      rsi14: parseFloat(rsi.toFixed(1)),
      atr14: parseFloat(atr.toFixed(6)),
      emaDistancePct: extensionCheck.distancePct,
      wickRatio: wickCheck.wickRatio
    },
    tradeLevels: {
      suggestedEntryPrice,
      suggestedStopLoss,
      invalidationPrice,
      takeProfit1,
      takeProfit2,
      atr: parseFloat(atr.toFixed(6)),
      riskPct: parseFloat(riskPct.toFixed(2)),
      rrRatioTp1: '1:1.5',
      rrRatioTp2: '1:2.5'
    }
  };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateVolumeMA,
  calculateATR,
  determineDirectionFromRSI,
  checkWickRejection,
  checkExtension,
  evaluateSignalType
};
