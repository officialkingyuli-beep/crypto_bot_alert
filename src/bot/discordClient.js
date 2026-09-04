const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config');
const { createAlertCard, createResultCard } = require('./embedBuilder');
const { MessageQueueManager } = require('../services/messageQueue');

class DiscordBotClient {
  constructor(onLog) {
    this.onLog = onLog || console.log;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
      ]
    });
    this.isReady = false;
    this.alertCount = 0;
    this.presenceTimer = null;
    this.lastError = null;

    // Enterprise Per-Channel Message Queue with Rate-Limiting and 429 Backoff
    this.queueManager = new MessageQueueManager(this.onLog);
  }

  async start() {
    this.onLog('[DiscordBot] Initializing Discord Client connection...');
    if (!config.discord.token || config.discord.token === 'YOUR_DISCORD_BOT_TOKEN') {
      this.onLog('⚠️ [DiscordBot] DISCORD_TOKEN is empty! Using Direct Webhook Pipeline.');
      this.lastError = 'DISCORD_TOKEN is empty in config';
      return;
    }

    this.setupEvents();
    try {
      this.onLog(`[DiscordBot] Logging in to Discord Gateway (Token len: ${config.discord.token.length})...`);
      
      // 10-Second Non-Blocking Timeout Guard
      await Promise.race([
        this.client.login(config.discord.token),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gateway login handshake timed out (10s)')), 10000))
      ]);

      this.onLog('✅ [DiscordBot] client.login() connected successfully! Gateway Token Verified.');
      this.isReady = true;
      this.lastError = null;
    } catch (err) {
      this.lastError = err.message;
      this.onLog('⚠️ [DiscordBot Gateway Note]: ' + err.message + ' - Webhook Pipeline Active.');
    }
  }

  setupEvents() {
    const applyPresence = () => {
      try {
        if (this.client.user) {
          this.client.user.setPresence({
            status: 'online',
            activities: [{ name: '🚀 Momentum Sniper | Alpha Signals', type: 3 }]
          });
        }
      } catch (e) {}
    };

    const onReadyHandler = async () => {
      this.isReady = true;
      this.onLog(`🤖 [DiscordBot] Logged in as ${this.client.user?.tag || 'crypto_bot_alert'}! ONLINE 🟢`);

      applyPresence();

      if (this.presenceTimer) clearInterval(this.presenceTimer);
      this.presenceTimer = setInterval(applyPresence, 45000);
    };

    this.client.once('ready', onReadyHandler);
    this.client.once('clientReady', onReadyHandler);

    this.client.on('shardResume', () => {
      this.onLog('🔄 [DiscordBot] Gateway session resumed. Presence ONLINE 🟢');
      this.isReady = true;
      applyPresence();
    });

    this.client.on('shardDisconnect', () => {
      this.onLog('⚠️ [DiscordBot] Gateway disconnected, attempting auto-reconnect...');
      this.isReady = false;
    });

    this.client.on('error', (err) => {
      this.onLog('❌ [DiscordBot Client Error] ' + err.message);
    });

    this.client.on('warn', (warning) => {
      this.onLog('⚠️ [DiscordBot Warning] ' + warning);
    });
  }

  /**
   * Enqueues an alert signal to be dispatched through the rate-limited channel queue
   * @param {Object} alertData - Signal data payload
   * @param {string} channelKey - Destination channel key (e.g. 'observation', 'confirmed', 'results')
   */
  sendAlert(alertData, channelKey = null) {
    this.alertCount++;
    const { embed, components } = createAlertCard(alertData, true);
    
    // Auto-resolve target channel key based on alert state
    let targetChannel = channelKey;
    if (!targetChannel) {
      if (alertData.state === 'OBSERVATION') {
        targetChannel = 'observation';
      } else if (alertData.state === 'INVALIDATED') {
        targetChannel = 'results';
      } else {
        targetChannel = 'confirmed';
      }
    }

    // Resolve Webhook URL by channel (supports multi-channel webhooks with fallback to default)
    let webhookUrl = config.discord.webhookUrl;
    if (config.discord.webhooks && config.discord.webhooks[targetChannel]) {
      webhookUrl = config.discord.webhooks[targetChannel];
    }

    const embedPayload = embed.toJSON ? embed.toJSON() : (embed.data || embed);
    const componentsPayload = components.map(c => c.toJSON ? c.toJSON() : c);

    this.queueManager.enqueue(targetChannel, {
      url: webhookUrl,
      payload: {
        embeds: [embedPayload],
        components: componentsPayload
      },
      metadata: {
        symbol: alertData.symbol,
        type: alertData.type,
        side: alertData.side,
        price: alertData.price
      }
    });
  }

  /**
   * Enqueues a trade update or closing result to #resultados channel (Requerimiento 5)
   * @param {Object} trade - Trade record
   */
  sendTradeUpdate(trade) {
    const targetChannel = 'results';
    const { embed } = createResultCard(trade);

    let webhookUrl = config.discord.webhookUrl;
    if (config.discord.webhooks && config.discord.webhooks[targetChannel]) {
      webhookUrl = config.discord.webhooks[targetChannel];
    }

    const embedPayload = embed.toJSON ? embed.toJSON() : (embed.data || embed);

    this.queueManager.enqueue(targetChannel, {
      url: webhookUrl,
      payload: {
        embeds: [embedPayload]
      },
      metadata: {
        symbol: trade.symbol,
        type: `TRADE_${trade.status}`,
        side: trade.side,
        price: trade.currentPrice || trade.entryPrice
      }
    });
  }

  getQueueStats() {
    return this.queueManager.getStats();
  }
}

module.exports = DiscordBotClient;
