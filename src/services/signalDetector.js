const config = require('../config');
const {
  calculateEMA,
  calculateRSI,
  calculateVolumeMA,
  checkWickRejection,
  checkExtension,
  evaluateSignalType
} = require('./quantFilters');
const CooldownTracker = require('./cooldownTracker');

class SignalDetector {
  constructor(onAlertTriggered) {
    this.onAlertTriggered = onAlertTriggered;
    // Map of symbol -> Array of tick samples: [ { price, high, low, volume, time } ]
    this.symbolTickHistory = new Map();
    // Map of symbol -> Array of sequential close prices for indicators (EMA/RSI)
    this.symbolPriceSeries = new Map();
    // Map of symbol -> Array of sequential candle volumes for Volume SMA
    this.symbolVolumeSeries = new Map();
    // Map of symbol -> last candle timestamp & volume for 1m boundary tracking
    this.lastCandleTimes = new Map();
    this.lastCandleVolumes = new Map();
    // Map of symbol -> baseline volume tracking
    this.volumeBaseline = new Map();

    // Requerimiento 2: Cooldown Inteligente con Persistencia y Bypass de Estado
    this.cooldownTracker = new CooldownTracker({
      cooldownMinutes: config.scanner.cooldownMinutes || 15
    });
  }

  processTickerData(data) {
    const { symbol, price, openPrice, high, low, volume } = data;
    const cleanSymbol = symbol.toUpperCase();

    if (!price || price <= 0) return;

    const now = Date.now();

    // 1. Maintain Sample History for the 5-Minute Analytical Window
    if (!this.symbolTickHistory.has(cleanSymbol)) {
      this.symbolTickHistory.set(cleanSymbol, []);
    }
    const history = this.symbolTickHistory.get(cleanSymbol);

    history.push({
      price: price,
      high: high || price,
      low: low || price,
      volume: volume || 1,
      time: now
    });

    // 5-Minute Rolling Analytical Window
    const windowMs = 5 * 60 * 1000;
    while (history.length > 0 && now - history[0].time > windowMs) {
      history.shift();
    }

    // 2. Maintain Sequential Price Series for EMA(20) & RSI(14)
    if (!this.symbolPriceSeries.has(cleanSymbol)) {
      this.symbolPriceSeries.set(cleanSymbol, []);
    }
    const priceSeries = this.symbolPriceSeries.get(cleanSymbol);
    priceSeries.push(price);
    if (priceSeries.length > 100) {
      priceSeries.shift();
    }

    // 3. Maintain Real Closed Candle Volumes for Volume Moving Average (Requerimiento 6)
    if (!this.symbolVolumeSeries.has(cleanSymbol)) {
      this.symbolVolumeSeries.set(cleanSymbol, []);
    }
    const volumeSeries = this.symbolVolumeSeries.get(cleanSymbol);

    const candleTime = data.candleTime || (Math.floor(now / 60000) * 60000);
    const lastTime = this.lastCandleTimes.get(cleanSymbol);

    if (lastTime && lastTime !== candleTime) {
      // A completed 1-minute candle finished! Save its final volume into historical series
      const completedVol = this.lastCandleVolumes.get(cleanSymbol) || volume;
      if (completedVol && completedVol > 0) {
        volumeSeries.push(completedVol);
        if (volumeSeries.length > 30) {
          volumeSeries.shift();
        }
      }
    }
    this.lastCandleTimes.set(cleanSymbol, candleTime);
    this.lastCandleVolumes.set(cleanSymbol, volume);

    // Need minimal sample density
    if (history.length < 3) return;

    const oldestTick = history[0];
    const latestTick = history[history.length - 1];

    // Price change: Evaluate both 5-minute rolling window delta and current 1-minute impulse
    const windowChangePct = oldestTick.price > 0 ? ((latestTick.price - oldestTick.price) / oldestTick.price) * 100 : 0;
    const candleChangePct = (openPrice && openPrice > 0) ? ((latestTick.price - openPrice) / openPrice) * 100 : 0;
    const priceChangePct = Math.abs(candleChangePct) > Math.abs(windowChangePct) ? candleChangePct : windowChangePct;

    // Requerimiento 6: Validación de Volumen Relativo y Liquidez Base
    // Enforce quote volume in USDT & protect against anomalous base token quantities
    let nominalVolume = latestTick.volume || 0;
    if (nominalVolume > 1000000 && latestTick.price < 0.01) {
      // Sub-penny coin (e.g. PEPE, SHIB, BONK) safeguard: convert token count to USDT turnover
      nominalVolume = nominalVolume * latestTick.price;
    }

    const volumeMaPeriod = config.scanner.volumeMaPeriod || 20;
    const minBaselineQuoteVolume = config.scanner.minBaselineQuoteVolume || 15000;

    let effectiveBaseline;
    if (volumeSeries.length >= 2) {
      effectiveBaseline = Math.max(calculateVolumeMA(volumeSeries, volumeMaPeriod), minBaselineQuoteVolume);
    } else {
      // Startup baseline: initialize from first observed candle volume or liquidity floor
      if (!this.volumeBaseline.has(cleanSymbol)) {
        this.volumeBaseline.set(cleanSymbol, Math.max(nominalVolume, minBaselineQuoteVolume));
      }
      effectiveBaseline = Math.max(this.volumeBaseline.get(cleanSymbol), minBaselineQuoteVolume);
    }

    // Relative volume multiplier with institutional sanity cap (max 50.0x) & anomaly audit
    const rawMultiplier = effectiveBaseline > 0 ? (nominalVolume / effectiveBaseline) : 1.0;
    let volumeMultiplier;
    let isDataAnomaly = false;

    if (rawMultiplier >= 50.0) {
      volumeMultiplier = 50.0;
      if (rawMultiplier > 100.0) {
        isDataAnomaly = true;
        console.warn(`🚨 [ANOMALÍA DE DATOS DE VOLUMEN] ${cleanSymbol}: Multiplicador crudo absurdamente alto (${rawMultiplier.toFixed(1)}x | VolNominal: $${nominalVolume.toFixed(2)} USDT | Base: $${effectiveBaseline.toFixed(2)} USDT). Indicio de anomalía de feed/datos, no de mercado real. Cap de seguridad forzado a 50.0x.`);
      } else {
        console.log(`📊 [CAP DE VOLUMEN ORGÁNICO] ${cleanSymbol}: Movimiento con volumen real extremo (${rawMultiplier.toFixed(1)}x alcanzado de forma orgánica). Ajustado a tope de 50.0x.`);
      }
    } else {
      volumeMultiplier = parseFloat(rawMultiplier.toFixed(2));
    }

    // Strict Institutional Breakout Thresholds
    const minMultiplier = config.scanner.minVolumeMultiplier || 1.8;
    const minPricePct = config.scanner.minPriceChangePct || 0.70;

    let side = null;
    let baseType = null;
    let emoji = null;

    if (priceChangePct >= minPricePct && volumeMultiplier >= minMultiplier) {
      side = 'BULLISH';
      baseType = 'MOMENTUM SNIPER';
      emoji = '🚀';
    } else if (priceChangePct <= -minPricePct && volumeMultiplier >= minMultiplier) {
      side = 'BEARISH';
      baseType = 'DUMP DETECTOR';
      emoji = '📉';
    }

    if (!side) return;

    // 3. Compute High & Low over the rolling progression
    const windowHigh = Math.max(...history.map(t => t.high || t.price));
    const windowLow = Math.min(...history.map(t => t.low || t.price));
    const windowOpen = openPrice || oldestTick.price;

    // 4. Quantitative Analysis (Wick Rejection, EMA20 Extension, RSI14 Climax, Dynamic ATR)
    const quantAnalysis = evaluateSignalType({
      price: latestTick.price,
      high: windowHigh,
      low: windowLow,
      open: windowOpen,
      side,
      priceHistory: priceSeries,
      candleHistory: history,
      settings: config.scanner
    });

    const signalState = quantAnalysis.isModeA ? 'ACTIVE_ENTRY' : 'OBSERVATION';
    const effectiveTradeSide = quantAnalysis.side; // 'BULLISH' for LONG, 'BEARISH' for SHORT
    const effectiveTradeDir = quantAnalysis.direction; // 'LONG' | 'SHORT'

    // Adjust alert type based on whether it's a momentum breakout or mean reversion rebound
    let resolvedType = baseType;
    if (effectiveTradeDir === 'LONG') {
      resolvedType = priceChangePct < 0 ? 'REBOUND RADAR' : 'MOMENTUM SNIPER';
    } else {
      resolvedType = priceChangePct > 0 ? 'PULLBACK SNIPER' : 'DUMP DETECTOR';
    }

    // 5. Intelligent Cooldown Check (Requerimiento 2)
    const cooldownCheck = this.cooldownTracker.canTriggerAlert({
      symbol: cleanSymbol,
      state: signalState,
      side: effectiveTradeSide
    });

    if (!cooldownCheck.allowed) {
      // Cooldown activo para la misma alerta repetida, ignorar silenciosamente
      return;
    }

    // 6. Structure Alert Signal Payload
    const alertSignal = {
      symbol: cleanSymbol,
      type: resolvedType,
      state: signalState, // 'ACTIVE_ENTRY' | 'OBSERVATION'
      stateReason: cooldownCheck.reason, // 'INITIAL_SIGNAL' | 'STATE_TRANSITION_BYPASS' | 'COOLDOWN_EXPIRED'
      emoji: quantAnalysis.isModeA ? (effectiveTradeDir === 'SHORT' ? '📉' : '🚀') : '⏳',
      side: effectiveTradeSide, // Enforce correct trade direction (BULLISH for LONG, BEARISH for SHORT)
      price: latestTick.price,
      priceChangePct,
      volumeMultiplier,
      rawVolumeMultiplier: parseFloat(rawMultiplier.toFixed(2)),
      isDataAnomaly,
      nominalVolume,
      baselineVolume: effectiveBaseline,
      exchange: data.exchange || 'Bybit / Binance',
      timestamp: new Date(),
      quant: quantAnalysis
    };

    // Record alert in persistent tracker
    this.cooldownTracker.recordAlert({
      symbol: cleanSymbol,
      state: signalState,
      side: effectiveTradeSide,
      price: latestTick.price
    });

    const logPrefix = quantAnalysis.isModeA ? '⚡ [ENTRADA CONFIRMADA]' : '⏳ [RADAR OBSERVACIÓN]';
    console.log(`${logPrefix} ${alertSignal.type} on ${alertSignal.symbol} (${effectiveTradeDir} | ${priceChangePct.toFixed(2)}% | Vol: ${volumeMultiplier.toFixed(1)}x${rawMultiplier > 50.0 ? ` [Cap de ${rawMultiplier.toFixed(0)}x]` : ''} | State: ${signalState} [${cooldownCheck.reason}])`);
    
    this.onAlertTriggered(alertSignal);
  }
}

module.exports = SignalDetector;
