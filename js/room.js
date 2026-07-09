/**
 * 多人实时位置共享 — RoomManager
 * ============================================
 * 基于 MQTT over WebSocket 实现设备间位置同步
 * 主用 EMQX 国内节点（腾讯云上海），备用 HiveMQ 公共 Broker
 * 均为免费公共 MQTT 服务，无需注册
 * 消息协议：每个设备发布到自己 topic，订阅房间通配符 topic
 */

const ROOM_CONFIG = {
  // 主用 EMQX 国内节点（腾讯云上海，免注册）
  BROKER_URL: 'wss://broker-cn.emqx.io:8084/mqtt',
  // 备用 HiveMQ 公共 Broker
  BROKER_FALLBACK_URL: 'wss://broker.mqtt-dashboard.com:8884/mqtt',
  TOPIC_PREFIX: 'circlemap',
  ROOM_CODE_LEN: 6,
  RECONNECT_DELAY: 5000,         // 重连间隔（ms）
  POSITION_INTERVAL: 5000,       // 位置发布间隔（ms）
  CONNECT_TIMEOUT: 20000,        // MQTT connectTimeout（ms），等 CONNACK
  MAX_RETRY: 5,                  // 连续失败几次后切备用 Broker
  PLAYER_COLORS: [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#DDA0DD', '#FFD93D', '#6BCB77', '#FF8C94',
  ],
};

/**
 * 生成随机房间码（大写字母 + 数字）
 */
function _generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CONFIG.ROOM_CODE_LEN; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * 获取随机玩家颜色
 */
function _pickColor(seed) {
  const colors = ROOM_CONFIG.PLAYER_COLORS;
  let idx;
  if (seed != null) {
    let hash = 0;
    for (let i = 0; i < String(seed).length; i++) {
      hash = ((hash << 5) - hash) + String(seed).charCodeAt(i);
      hash |= 0;
    }
    idx = Math.abs(hash) % colors.length;
  } else {
    idx = Math.floor(Math.random() * colors.length);
  }
  return colors[idx];
}

class RoomManager {
  constructor() {
    this._client = null;
    this._deviceId = this._getDeviceId();
    this._roomCode = null;
    this._nickname = '玩家';
    this._color = '#FF6B6B';
    this._connected = false;

    /** @type {Object.<string, {id:string, name:string, color:string, lat:number, lng:number, acc:number, speed:number, bearing:number, ts:number, online:boolean}>} */
    this._players = {};

    this._publishTimer = null;
    this._lastPosition = null;

    // 回调钩子
    this.onPositionUpdate = null;   // (players) → void
    this.onPlayerJoin = null;       // (playerId, nickname) → void
    this.onPlayerLeave = null;      // (playerId, nickname) → void
    this.onRoomError = null;        // (msg) → void
    this.onConnectionChange = null; // (connected) → void
  }

  /**
   * 生成/恢复设备 ID（localStorage 持久化）
   */
  _getDeviceId() {
    try {
      let id = localStorage.getItem('circlemap_device_id');
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now() + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('circlemap_device_id', id);
      }
      return id;
    } catch (e) {
      return 'd' + Date.now() + Math.random().toString(36).slice(2, 8);
    }
  }

  /**
   * 连接 MQTT Broker
   * @returns {Promise<void>}
   */
  _connect() {
    return new Promise((resolve, reject) => {
      if (this._client && this._connected) {
        resolve();
        return;
      }

      // 清理旧连接
      this._disconnect();

      // 生成短 Client ID（< 23 字符，兼容 MQTT 3.1.1）
      const shortId = 'cm' + Math.random().toString(36).slice(2, 10);

      // 尝试主用 Broker；失败时自动尝试备用
      this._tryConnect(ROOM_CONFIG.BROKER_URL, shortId, resolve, reject);
    });
  }

  /**
   * 尝试连接指定 Broker
   */
  _tryConnect(brokerUrl, clientId, resolve, reject) {
    const discarded = { current: false };
    let errCount = 0;

    console.log('[Room] 正在连接 MQTT:', brokerUrl, 'clientId:', clientId);

    try {
      this._client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        protocolVersion: 5,              // 使用 MQTT 5.0（无 client ID 长度限制）
        reconnectPeriod: ROOM_CONFIG.RECONNECT_DELAY,
        connectTimeout: ROOM_CONFIG.CONNECT_TIMEOUT,
        keepalive: 30,
      });

      this._client.on('connect', () => {
        if (discarded.current) return;
        discarded.current = true;
        this._connected = true;
        if (this.onConnectionChange) this.onConnectionChange(true);
        resolve();
      });

      this._client.on('reconnect', () => {
        console.log('[Room] MQTT 重连中...');
      });

      this._client.on('close', () => {
        this._connected = false;
        if (this.onConnectionChange) this.onConnectionChange(false);
      });

      this._client.on('offline', () => {
        this._connected = false;
        if (this.onConnectionChange) this.onConnectionChange(false);
      });

      // 累计 MQTT 错误次数，连续 MAX_RETRY 次失败 → 切备用
      this._client.on('error', (err) => {
        if (discarded.current) return;
        errCount++;
        console.error(`[Room] MQTT 错误 (${errCount}/${ROOM_CONFIG.MAX_RETRY}):`, err.message);

        if (errCount >= ROOM_CONFIG.MAX_RETRY) {
          discarded.current = true;

          if (!ROOM_CONFIG.BROKER_FALLBACK_URL || brokerUrl === ROOM_CONFIG.BROKER_FALLBACK_URL) {
            reject(new Error(`MQTT 连接失败（已尝试所有 Broker，连续失败 ${ROOM_CONFIG.MAX_RETRY} 次）`));
            return;
          }

          console.log(`[Room] 主用 Broker 连续失败 ${ROOM_CONFIG.MAX_RETRY} 次，切换到备用:`, ROOM_CONFIG.BROKER_FALLBACK_URL);
          this._disconnect();
          this._tryConnect(ROOM_CONFIG.BROKER_FALLBACK_URL, clientId, resolve, reject);
        }
      });

      this._client.on('message', (topic, payload) => {
        this._handleMessage(topic, payload.toString());
      });

    } catch (e) {
      // 连接抛出同步异常 → 尝试备用
      if (ROOM_CONFIG.BROKER_FALLBACK_URL && brokerUrl !== ROOM_CONFIG.BROKER_FALLBACK_URL) {
        console.log('[Room] 主用 Broker 异常，尝试备用:', ROOM_CONFIG.BROKER_FALLBACK_URL);
        this._disconnect();
        this._tryConnect(ROOM_CONFIG.BROKER_FALLBACK_URL, clientId, resolve, reject);
      } else {
        reject(e);
      }
    }
  }

  /**
   * 断开连接
   */
  _disconnect() {
    this._stopPublishing();
    if (this._client) {
      try {
        this._client.end(true);
      } catch (e) { /* 静默 */ }
      this._client = null;
    }
    this._connected = false;
  }

  /**
   * 处理接收到的 MQTT 消息
   */
  _handleMessage(topic, raw) {
    try {
      const data = JSON.parse(raw);

      // 离线消息
      if (data.offline) {
        const player = this._players[data.id];
        if (player) {
          player.online = false;
          if (this.onPlayerLeave) this.onPlayerLeave(data.id, player.name);
          delete this._players[data.id];
          if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        }
        return;
      }

      // 位置/加入消息
      if (data.id && data.id !== this._deviceId && data.lat != null && data.lng != null) {
        const isNew = !this._players[data.id];
        this._players[data.id] = {
          id: data.id,
          name: data.name || '未知',
          color: data.color || '#888',
          lat: data.lat,
          lng: data.lng,
          acc: data.acc || 0,
          speed: data.speed || 0,
          bearing: data.bearing || 0,
          ts: data.ts || Date.now(),
          online: true,
        };

        if (isNew && this.onPlayerJoin) {
          this.onPlayerJoin(data.id, data.name || '未知');
        }
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
      }
    } catch (e) {
      console.warn('[Room] 消息解析失败:', e);
    }
  }

  /**
   * 创建房间
   * @param {string} nickname
   * @returns {Promise<string>} 房间码
   */
  async createRoom(nickname) {
    this._nickname = nickname || '玩家';
    this._color = _pickColor(this._deviceId);
    this._roomCode = _generateRoomCode();

    await this._connect();
    this._subscribeRoom(this._roomCode);
    this._startPublishing();

    // 发布加入消息
    this._publish({
      join: true,
      name: this._nickname,
      color: this._color,
    });

    return this._roomCode;
  }

  /**
   * 加入已有房间
   * @param {string} roomCode
   * @param {string} nickname
   * @returns {Promise<void>}
   */
  async joinRoom(roomCode, nickname) {
    this._nickname = nickname || '玩家';
    this._color = _pickColor(this._deviceId);
    this._roomCode = roomCode.toUpperCase();

    await this._connect();
    this._subscribeRoom(this._roomCode);
    this._startPublishing();

    // 发布加入消息
    this._publish({
      join: true,
      name: this._nickname,
      color: this._color,
    });
  }

  /**
   * 离开房间
   */
  leaveRoom() {
    // 发送离线遗言
    if (this._client && this._connected && this._roomCode) {
      this._publish({
        offline: true,
        name: this._nickname,
      });
    }

    // 取消订阅
    if (this._client && this._roomCode) {
      try {
        this._client.unsubscribe(`${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/+`);
      } catch (e) { /* 静默 */ }
    }

    this._stopPublishing();
    this._roomCode = null;
    this._players = {};
    this._lastPosition = null;
  }

  /**
   * 订阅房间主题
   */
  _subscribeRoom(roomCode) {
    if (!this._client) return;
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${roomCode}/+`;
    this._client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error('[Room] 订阅失败:', err);
        if (this.onRoomError) this.onRoomError('订阅房间失败');
      }
    });
  }

  /**
   * 发布消息到自己的 topic
   */
  _publish(data) {
    if (!this._client || !this._connected || !this._roomCode) return;
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/${this._deviceId}`;
    this._client.publish(topic, JSON.stringify({
      ...data,
      id: this._deviceId,
      name: this._nickname,
      color: this._color,
      ts: Date.now(),
    }), { qos: 1, retain: false });
  }

  /**
   * 更新并发布位置
   */
  publishPosition(lat, lng, acc, speed, bearing) {
    this._lastPosition = { lat, lng, acc, speed, bearing };
    this._publish({
      lat,
      lng,
      acc: acc || 0,
      speed: speed || 0,
      bearing: bearing || 0,
    });
  }

  /**
   * 启动定时发布（APP 端不需要，只在外部主动调用 publishPosition）
   */
  _startPublishing() {
    // 定期发送在线心跳（避免被 bridge 丢弃）
    this._stopPublishing();
    this._publishTimer = setInterval(() => {
      if (this._lastPosition) {
        this._publish({
          ...this._lastPosition,
          ping: true,
        });
      } else {
        this._publish({ ping: true });
      }
    }, ROOM_CONFIG.POSITION_INTERVAL);
  }

  _stopPublishing() {
    if (this._publishTimer) {
      clearInterval(this._publishTimer);
      this._publishTimer = null;
    }
  }

  /**
   * 获取当前房间所有玩家
   */
  getPlayers() {
    return { ...this._players };
  }

  /**
   * 获取自己在房间中的信息
   */
  getMyInfo() {
    return {
      id: this._deviceId,
      name: this._nickname,
      color: this._color,
    };
  }

  /**
   * 连接状态
   */
  isConnected() {
    return this._connected;
  }

  /**
   * 当前房间码
   */
  getRoomCode() {
    return this._roomCode;
  }

  /**
   * 在线玩家数
   */
  getPlayerCount() {
    return Object.values(this._players).filter(p => p.online).length;
  }

  /**
   * 销毁实例，清理所有资源
   */
  destroy() {
    this.leaveRoom();
    this._disconnect();
    this._players = {};
  }
}
