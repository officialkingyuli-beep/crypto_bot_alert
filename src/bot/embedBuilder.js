const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

/**
 * Format price cleanly according to decimal magnitude
 */
function formatPrice(price) {
  if (price === undefined || price === null || isNaN(price)) return '$0.00';
  if (price < 0.0001) {
    return `$${price.toFixed(8)}`;
  } else if (price < 1) {
    return `$${price.toFixed(6)}`;
  } else if (price < 10) {
    return `$${price.toFixed(4)}`;
  } else {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/**
 * Format volume in readable K/M USDT notation
 */
function formatVolume(vol) {
  if (!vol || isNaN(vol) || vol <= 0) return null;
  if (vol >= 1000000) return `$${(vol / 1000000).toFixed(2)}M`;
  if (vol >= 1000) return `$${(vol / 1000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

/**
 * Professional, Compact Crypto Alert Embed Builder
 * Explicit & Consistent States (Requerimientos 3 & 4):
 * - 🟡 EN OBSERVACIÓN (Pullback / Setup en formación)
 * - 🟢 ENTRADA ACTIVA (Gatillo confirmado a mercado)
 * - 🔴 INVALIDADA (Escenario técnico cancelado)
 */
function createAlertCard(alertData, isVipAlert = true) {
  const {
    symbol,
    type = 'MOMENTUM SNIPER',
    state = 'ACTIVE_ENTRY', // 'ACTIVE_ENTRY' | 'OBSERVATION' | 'INVALIDATED'
    volumeMultiplier = 3.5,
    price = 0,
    priceChangePct = 0,
    exchange = 'Bybit / Binance',
    side = 'BULLISH',
    timestamp = new Date(),
    quant = null
  } = alertData;

  const cleanSymbol = symbol.toUpperCase();
  const formattedPrice = formatPrice(price);

  const indicators = quant ? quant.indicators : {};
  const tradeLevels = quant ? quant.tradeLevels : {};
  const reasons = (quant && quant.reasons && quant.reasons.length > 0) ? quant.reasons : [];
  const timeframe = config.scanner.timeframe || '5m';

  // Affiliate Trading Links
  const bybitRefCode = config.monetization.bybitAffiliateUrl.includes('ref=')
    ? config.monetization.bybitAffiliateUrl.split('ref=')[1].split('&')[0]
    : 'KYADJWY';

  const binanceRefCode = config.monetization.binanceAffiliateUrl.includes('ref=')
    ? config.monetization.binanceAffiliateUrl.split('ref=')[1].split('&')[0]
    : 'R8ZUODTR';

  const bybitTradeUrl = `https://www.bybit.com/trade/usdt/${cleanSymbol}?ref=${bybitRefCode}`;
  const binanceTradeUrl = `https://www.binance.com/en/futures/${cleanSymbol}?ref=${binanceRefCode}`;

  const dateObj = (timestamp instanceof Date) ? timestamp : new Date(timestamp || Date.now());
  const unixSec = Math.floor(dateObj.getTime() / 1000);

  let embedColor;
  let cardTitle;
  let descriptionText;
  const effectiveDirection = (quant && quant.direction)
    ? quant.direction
    : (side === 'BEARISH' || type.includes('DUMP') ? 'SHORT' : 'LONG');

  const isShort = effectiveDirection === 'SHORT';

  // Invalidation Condition Formatting
  const invalidationRule = isShort
    ? `Cierre de vela de ${timeframe} sobre ${formatPrice(tradeLevels.invalidationPrice || price * 1.015)}`
    : `Cierre de vela de ${timeframe} bajo ${formatPrice(tradeLevels.invalidationPrice || price * 0.985)}`;

  if (state === 'INVALIDATED') {
    // -------------------------------------------------------------
    // 🔴 ESTADO: INVALIDADA
    // -------------------------------------------------------------
    embedColor = 0x888888; // Neutral / Grey
    cardTitle = `🔴 IDEA INVALIDADA • ${cleanSymbol}`;

    descriptionText =
      `🛑 **EL ESCENARIO TÉCNICO YA NO APLICA**\n` +
      `*El precio violó la condición de estructura técnica para ${cleanSymbol}.*\n\n` +
      `📌 **Estado:** \`🔴 INVALIDADA\`\n` +
      `💵 **Precio Actual:** \`${formattedPrice}\`\n` +
      `🚫 **Causa de Invalidación:** \`${alertData.invalidationReason || invalidationRule}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;

  } else if (state === 'OBSERVATION') {
    // -------------------------------------------------------------
    // 🟡 ESTADO: EN OBSERVACIÓN (PULLBACK / SETUP EN FORMACIÓN)
    // -------------------------------------------------------------
    embedColor = 0xFFAA00; // Amber / Gold
    cardTitle = isShort ? `⏳ RADAR OBSERVACIÓN • ${cleanSymbol} (SHORT)` : `⏳ RADAR OBSERVACIÓN • ${cleanSymbol} (LONG)`;

    const entryOptima = tradeLevels.suggestedEntryPrice ? formatPrice(tradeLevels.suggestedEntryPrice) : formattedPrice;
    const stopLoss = tradeLevels.suggestedStopLoss ? formatPrice(tradeLevels.suggestedStopLoss) : 'Ajustado';
    const tp1 = tradeLevels.takeProfit1 ? formatPrice(tradeLevels.takeProfit1) : 'Resistencia';
    const tp2 = tradeLevels.takeProfit2 ? formatPrice(tradeLevels.takeProfit2) : null;
    const riskPctStr = tradeLevels.riskPct ? ` (-${tradeLevels.riskPct}%)` : '';
    const rr1 = tradeLevels.rrRatioTp1 || '1:1.5';
    const rr2 = tradeLevels.rrRatioTp2 || '1:2.5';
    const reasonSummary = reasons.length > 0 ? reasons.join(' • ') : 'Esperar retesteo a la media';

    const rsiVal = indicators.rsi14;
    const hasRsi = typeof rsiVal === 'number' && !isNaN(rsiVal);
    let dirLabel;
    if (isShort) {
      dirLabel = (hasRsi && rsiVal >= 70) ? '🔴 SHORT (Agotamiento RSI Sobrecompra)' : '🔴 SHORT (Quiebre Bajista)';
    } else {
      dirLabel = (hasRsi && rsiVal <= 30) ? '🟢 LONG (Rebote RSI Sobreventa)' : '🟢 LONG (Ruptura Alcista)';
    }

    const volNominal = alertData.nominalVolume ? ` (${formatVolume(alertData.nominalVolume)})` : '';

    descriptionText =
      `⚠️ **SETUP EN FORMACIÓN (Esperar retroceso / Pullback)**\n` +
      `*Atención:* \`${reasonSummary}\`\n\n` +
      `📌 **Estado:** \`🟡 EN OBSERVACIÓN\` | **Dir:** \`${dirLabel}\`\n` +
      `📊 **Vol:** \`${volumeMultiplier.toFixed(1)}x\`${volNominal} | **Actual:** \`${formattedPrice}\` (\`${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%\`)\n` +
      `⏱️ **Marco:** \`${timeframe}\` | **EMA(20):** \`${formatPrice(indicators.ema20)}\` | **RSI(14):** \`${indicators.rsi14 || 50}\`\n` +
      `🎯 **Entrada Límite Sugerida:** \`${entryOptima}\`\n` +
      `🛑 **SL:** \`${stopLoss}\`${riskPctStr} | 🎯 **TP1:** \`${tp1}\` (\`R:R ${rr1}\`)\n` +
      (tp2 ? `🎯 **TP2:** \`${tp2}\` (\`R:R ${rr2}\`)\n` : '') +
      `🚫 **Invalida si:** \`${invalidationRule}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n\n` +
      `**👇 PREPARAR ORDEN (1-CLIC):**\n` +
      `> 🚀 [ **Bybit ➔** ](${bybitTradeUrl})   •   🟡 [ **Binance ➔** ](${binanceTradeUrl})\n`;

  } else {
    // -------------------------------------------------------------
    // 🟢 ESTADO: ENTRADA ACTIVA (CONFIRMADA)
    // -------------------------------------------------------------
    embedColor = isShort ? 0xFF0055 : 0x00FF66;
    cardTitle = isShort ? `📉 SEÑAL CONFIRMADA • ${cleanSymbol} (SHORT)` : `🚀 SEÑAL CONFIRMADA • ${cleanSymbol} (LONG)`;

    const rsiVal = indicators.rsi14;
    const hasRsi = typeof rsiVal === 'number' && !isNaN(rsiVal);
    let dirLabel;
    if (isShort) {
      dirLabel = (hasRsi && rsiVal >= 70) ? '🔴 SHORT (Agotamiento RSI Sobrecompra)' : '🔴 SHORT (Quiebre Bajista)';
    } else {
      dirLabel = (hasRsi && rsiVal <= 30) ? '🟢 LONG (Rebote RSI Sobreventa)' : '🟢 LONG (Ruptura Alcista)';
    }
    const stopLoss = tradeLevels.suggestedStopLoss ? formatPrice(tradeLevels.suggestedStopLoss) : 'Dinámico';
    const tp1 = tradeLevels.takeProfit1 ? formatPrice(tradeLevels.takeProfit1) : 'Objetivo 1';
    const tp2 = tradeLevels.takeProfit2 ? formatPrice(tradeLevels.takeProfit2) : null;
    const riskPctStr = tradeLevels.riskPct ? ` (-${tradeLevels.riskPct}%)` : '';
    const rr1 = tradeLevels.rrRatioTp1 || '1:1.5';
    const rr2 = tradeLevels.rrRatioTp2 || '1:2.5';
    const volNominal = alertData.nominalVolume ? ` (${formatVolume(alertData.nominalVolume)})` : '';

    descriptionText =
      `📌 **Estado:** \`🟢 ENTRADA ACTIVA\` | **Dir:** \`${dirLabel}\`\n` +
      `📊 **Vol:** \`${volumeMultiplier.toFixed(1)}x\`${volNominal} | **Precio:** \`${formattedPrice}\` (\`${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%\`)\n` +
      `⏱️ **Marco:** \`${timeframe}\` | **EMA(20):** \`${formatPrice(indicators.ema20)}\` | **RSI(14):** \`${indicators.rsi14 || 50}\`\n` +
      `🛑 **SL:** \`${stopLoss}\`${riskPctStr} | 🎯 **TP1:** \`${tp1}\` (\`R:R ${rr1}\`)\n` +
      (tp2 ? `🎯 **TP2:** \`${tp2}\` (\`R:R ${rr2}\`)\n` : '') +
      `🚫 **Invalida si:** \`${invalidationRule}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n\n` +
      `**👇 OPERAR AHORA (1-CLIC):**\n` +
      `> 🚀 [ **Bybit ➔** ](${bybitTradeUrl})   •   🟡 [ **Binance ➔** ](${binanceTradeUrl})\n`;
  }

  const disclaimerText = config.legalDisclaimer || 'Alpha Sniper System • No constituye asesoría financiera.';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(cardTitle)
    .setDescription(descriptionText)
    .setFooter({ text: `${exchange} • ${disclaimerText}` })
    .setTimestamp(timestamp);

  // Link Buttons
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`🔥 Bybit: ${cleanSymbol}`)
      .setStyle(ButtonStyle.Link)
      .setURL(bybitTradeUrl),
    new ButtonBuilder()
      .setLabel(`🟡 Binance: ${cleanSymbol}`)
      .setStyle(ButtonStyle.Link)
      .setURL(binanceTradeUrl)
  );

  return { embed, components: [actionRow] };
}

/**
 * Result Card Embed Builder for #resultados channel (Requerimiento 5)
 * @param {Object} trade - Trade record object
 */
function createResultCard(trade) {
  const {
    symbol,
    side = 'BULLISH',
    entryPrice = 0,
    currentPrice = 0,
    stopLoss = 0,
    takeProfit1 = 0,
    takeProfit2 = 0,
    status = 'WIN', // 'TP1_HIT' | 'WIN' | 'LOSS' | 'INVALIDATED' | 'EXPIRED'
    pnlPct = 0,
    entryTime = Date.now(),
    closeTime = Date.now(),
    exchange = 'Bybit / Binance'
  } = trade;

  const cleanSymbol = symbol.toUpperCase();
  const isBull = side === 'BULLISH';
  const durationMin = Math.max(1, Math.round(((closeTime || Date.now()) - entryTime) / 60000));
  const pnlSign = pnlPct >= 0 ? '+' : '';
  const pnlStr = `${pnlSign}${pnlPct.toFixed(2)}%`;
  const unixSec = Math.floor((closeTime || Date.now()) / 1000);

  let embedColor;
  let title;
  let desc;

  if (status === 'WIN') {
    embedColor = 0x00FF66; // Bright Green
    title = `🏆 TAKE PROFIT 2 LOGRADO • ${cleanSymbol} (${pnlStr})`;
    desc =
      `💰 **OBJETIVO FINAL ALCANZADO (WIN COMPLETO)**\n` +
      `*El movimiento institucional completó el ciclo con éxito.*\n\n` +
      `📌 **Resultado:** \`🏆 WIN (${pnlStr})\` | **Dir:** \`${isBull ? 'LONG' : 'SHORT'}\`\n` +
      `💵 **Entrada:** \`${formatPrice(entryPrice)}\` ➔ **TP2:** \`${formatPrice(takeProfit2)}\`\n` +
      `⏱️ **Duración:** \`${durationMin}m\` | **Exchange:** \`${exchange}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;
  } else if (status === 'TP1_HIT') {
    embedColor = 0x00E5FF; // Cyan / Bright Teal
    title = `🎯 TAKE PROFIT 1 ALCANZADO • ${cleanSymbol} (${pnlStr})`;
    desc =
      `✅ **PRIMER OBJETIVO ALCANZADO (Ganancia Parcial Asegurada)**\n` +
      `*Se recomienda mover Stop-Loss a precio de entrada (Break-Even).*\n\n` +
      `📌 **Estado:** \`🎯 TP1 COMPLETADO\` | **Dir:** \`${isBull ? 'LONG' : 'SHORT'}\`\n` +
      `💵 **Entrada:** \`${formatPrice(entryPrice)}\` ➔ **TP1:** \`${formatPrice(takeProfit1)}\`\n` +
      `🎯 **Siguiente Objetivo (TP2):** \`${formatPrice(takeProfit2)}\`\n` +
      `⏱️ **Duración:** \`${durationMin}m\` | **Exchange:** \`${exchange}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;
  } else if (status === 'LOSS') {
    embedColor = 0xFF0033; // Red
    title = `🛑 STOP LOSS EJECUTADO • ${cleanSymbol} (${pnlStr})`;
    desc =
      `🛡️ **SALIDA POR GESTIÓN DE RIESGO**\n` +
      `*El Stop-Loss dinámico protegió el capital ante rechazo.*\n\n` +
      `📌 **Resultado:** \`🛑 LOSS (${pnlStr})\` | **Dir:** \`${isBull ? 'LONG' : 'SHORT'}\`\n` +
      `💵 **Entrada:** \`${formatPrice(entryPrice)}\` ➔ **SL:** \`${formatPrice(stopLoss)}\`\n` +
      `⏱️ **Duración:** \`${durationMin}m\` | **Exchange:** \`${exchange}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;
  } else if (status === 'EXPIRED') {
    embedColor = 0xAAAAAA; // Neutral Grey
    title = `⌛ TRADE EXPIRADO • ${cleanSymbol} (${pnlStr})`;
    desc =
      `⏱️ **TIEMPO MÁXIMO SUPERADO (4 HORAS)**\n` +
      `*Posición cerrada automáticamente por consolidación prolongada.*\n\n` +
      `📌 **Resultado:** \`⌛ CERRADO (${pnlStr})\` | **Dir:** \`${isBull ? 'LONG' : 'SHORT'}\`\n` +
      `💵 **Entrada:** \`${formatPrice(entryPrice)}\` ➔ **Actual:** \`${formatPrice(currentPrice)}\`\n` +
      `⏱️ **Duración:** \`${durationMin}m\` | **Exchange:** \`${exchange}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;
  } else {
    // INVALIDATED
    embedColor = 0x888888;
    title = `🚫 ESCENARIO INVALIDADO • ${cleanSymbol} (${pnlStr})`;
    desc =
      `🛑 **VIOLACIÓN DE ESTRUCTURA TÉCNICA**\n` +
      `*El activo perforó la invalidación técnica antes de llegar a objetivos.*\n\n` +
      `📌 **Resultado:** \`🚫 INVALIDADO\` | **Dir:** \`${isBull ? 'LONG' : 'SHORT'}\`\n` +
      `💵 **Entrada:** \`${formatPrice(entryPrice)}\` ➔ **Nivel:** \`${formatPrice(currentPrice)}\`\n` +
      `⏱️ **Duración:** \`${durationMin}m\` | **Exchange:** \`${exchange}\`\n` +
      `⏰ <t:${unixSec}:T> (<t:${unixSec}:R>)\n`;
  }

  const disclaimerText = config.legalDisclaimer || 'Alpha Sniper System • No constituye asesoría financiera.';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: `${exchange} • ${disclaimerText}` })
    .setTimestamp(new Date(closeTime || Date.now()));

  return { embed, components: [] };
}

module.exports = {
  createAlertCard,
  createResultCard,
  formatPrice
};
