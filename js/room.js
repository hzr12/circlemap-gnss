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

    /** @type {Object.<string, {id:string, name:string, color:string, lat:number, lng:number, acc:number, speed:number, bearing:number, ts:number, online:boolean, sharing:boolean, teamId:string|null, teamBroadcaster:boolean, teamSeparation:boolean}>} */
    this._players = {};

    /** @type {Object.<string, {id:string, name:string, color:string, creatorId:string}>} */
    this._teams = {};
    this._myTeamId = null;

    // 队伍发报员模式
    this._teamBroadcasterId = null;  // 当前发报员 deviceId
    this._lastBroadcastTs = 0;       // 上次收到发报心跳的时间戳
    this._myAmBroadcaster = false;   // 我是不是发报员
    this._teamSeparation = false;    // 我是否从发报员分离

    this._publishTimer = null;
    this._lastPosition = null;
    this._sharingEnabled = true;

    // 位置共享（静默/共享交替）
    this._burstEnabled = false;
    this._burstSilentMin = 25;       // 静默时长（分钟）
    this._burstShareMin = 5;         // 共享时长（分钟）
    this._burstPhase = 'silent';     // 'silent' | 'sharing'
    this._burstPhaseEnd = 0;         // 当前阶段结束时间戳
    this._burstTimer = null;

    // 观战模式
    this._isSpectator = false;

    // 游戏开始倒计时
    this._gameStartAt = 0;           // 游戏开始时间戳，0=未设置
    this._gameTimerAborted = false;

    // 游戏角色 — 鬼抓人
    this._gameState = 'idle';        // idle | playing | finished
    this._isHost = false;            // 创建房间的玩家为房主
    this._playerRoles = {};          // { playerId: 'ghost' | 'hunter' }
    this._caughtPlayers = {};        // { playerId: { caughtBy, ts } }
    this._gameEvents = [];           // 事件日志 [{ type, playerId, ghostId, ts }]
    this._gameStartTs = 0;
    this._gameEndTs = 0;

    // 回调钩子
    this.onPositionUpdate = null;   // (players) → void
    this.onPlayerJoin = null;       // (playerId, nickname) → void
    this.onPlayerLeave = null;      // (playerId, nickname) → void
    this.onTeamUpdate = null;       // (teams, myTeamId) → void
    this.onRoomError = null;        // (msg) → void
    this.onConnectionChange = null; // (connected) → void
    this.onBurstPhaseChange = null; // (phase, phaseEnd) → void
    this.onGameTimerUpdate = null;  // (startAt) → void
    this.onGameTimerAborted = null; // () → void
    this.onGameStateChange = null;  // (state) → void
    this.onRoleAssigned = null;     // (playerId, role, assignerId) → void
    this.onPlayerCaught = null;     // (targetId, ghostId) → void
    this.onGameStatsReady = null;   // (stats) → void
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

      // === 队伍控制消息 ===
      if (data.type === 'team_create') {
        this._teams[data.teamId] = {
          id: data.teamId,
          name: data.teamName,
          color: data.teamColor,
          creatorId: data.id,
        };
        if (this._players[data.id]) {
          this._players[data.id].teamId = data.teamId;
        }
        if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        return;
      }

      if (data.type === 'team_join') {
        if (this._players[data.id]) {
          this._players[data.id].teamId = data.teamId;
        }
        if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        return;
      }

      if (data.type === 'team_leave') {
        if (this._players[data.id]) {
          this._players[data.id].teamId = null;
        }
        if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        return;
      }

      if (data.type === 'team_kick') {
        const team = this._teams[data.teamId];
        if (team && team.creatorId === data.id) {
          if (this._players[data.targetId]) {
            this._players[data.targetId].teamId = null;
          }
          if (data.targetId === this._deviceId) {
            this._myTeamId = null;
          }
          if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
          if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        }
        return;
      }

      // 游戏倒计时消息
      if (data.type === 'game_timer_set') {
        this._gameStartAt = data.startAt;
        this._gameTimerAborted = false;
        if (this.onGameTimerUpdate) this.onGameTimerUpdate(data.startAt);
        return;
      }

      if (data.type === 'game_timer_abort') {
        this._gameStartAt = 0;
        this._gameTimerAborted = true;
        if (this.onGameTimerAborted) this.onGameTimerAborted();
        return;
      }

      // === 游戏状态消息 ===
      if (data.type === 'game_start') {
        this._gameState = 'playing';
        this._gameStartTs = data.ts || Date.now();
        this._gameEvents = [{ type: 'game_start', ts: this._gameStartTs }];
        if (this.onGameStateChange) this.onGameStateChange('playing');
        return;
      }

      if (data.type === 'game_end') {
        this._gameState = 'finished';
        this._gameEndTs = data.ts || Date.now();
        this._gameEvents.push({ type: 'game_end', ts: this._gameEndTs });
        // 触发统计
        if (this.onGameStateChange) this.onGameStateChange('finished');
        if (this.onGameStatsReady) this.onGameStatsReady(this._buildGameStats());
        return;
      }

      if (data.type === 'role_assign') {
        this._playerRoles[data.targetId] = data.role;
        if (this._players[data.targetId]) {
          this._players[data.targetId].role = data.role;
        }
        if (this.onRoleAssigned) this.onRoleAssigned(data.targetId, data.role, data.id);
        return;
      }

      if (data.type === 'player_caught') {
        const targetId = data.targetId;
        const ghostId = data.ghostId;
        this._caughtPlayers[targetId] = { caughtBy: ghostId, ts: data.ts || Date.now() };
        this._gameEvents.push({ type: 'player_caught', playerId: targetId, ghostId, ts: data.ts || Date.now() });
        if (this._players[targetId]) {
          this._players[targetId].caught = true;
          this._players[targetId].caughtBy = ghostId;
        }
        if (this.onPlayerCaught) this.onPlayerCaught(targetId, ghostId);
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        return;
      }

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

      // 位置/加入/心跳消息
      if (data.id && data.id !== this._deviceId) {
        const existing = this._players[data.id];
        const isNew = !existing;

        if (isNew || data.ping || data.join != null || data.lat != null) {
          // 构造玩家条目（保留旧位置当新消息无坐标时）
          const player = {
            id: data.id,
            name: data.name || (existing ? existing.name : '未知'),
            color: data.color || (existing ? existing.color : '#888'),
            ts: data.ts || Date.now(),
            online: true,
            sharing: data.sharing !== false,
            teamId: data.teamId || (existing ? existing.teamId : null),
            teamBroadcaster: data.teamBroadcaster === true,
            teamSeparation: data.teamSeparation === true,
            spectator: data.spectator === true,
            role: data.role || this._playerRoles[data.id] || null,
            caught: data.caught === true || (this._caughtPlayers[data.id] != null),
            caughtBy: data.caughtBy || (this._caughtPlayers[data.id] ? this._caughtPlayers[data.id].caughtBy : null),
          };
            player.lat = data.lat;
            player.lng = data.lng;
            player.acc = data.acc || 0;
            player.speed = data.speed || 0;
            player.bearing = data.bearing || 0;
            player.lastPosUpdate = Date.now();
          } else if (existing) {
            // 保留旧位置，但清空速度（不再移动）
            player.lat = existing.lat;
            player.lng = existing.lng;
            player.acc = existing.acc || 0;
            player.speed = 0;
            player.bearing = existing.bearing || 0;
            player.lastPosUpdate = existing.lastPosUpdate || 0;
          }

          this._players[data.id] = player;

          // 追踪同队发报员
          if (player.teamId === this._myTeamId && data.teamBroadcaster) {
            // 别人在发报 → 我退为跟随者
            this._teamBroadcasterId = data.id;
            this._myAmBroadcaster = false;
            this._lastBroadcastTs = Date.now();
          }

          if (isNew && this.onPlayerJoin) {
            this.onPlayerJoin(data.id, data.name || '未知');
          }
          if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        }
      }
    } catch (e) {
      console.warn('[Room] 消息解析失败:', e);
    }
  }

  /**
   * 创建房间（兼容旧接口 — 非观战模式）
   * @param {string} nickname
   * @returns {Promise<string>} 房间码
   */
  async createRoom(nickname) {
    return this._createRoomInternal(nickname);
  }

  /**
   * 加入已有房间（兼容旧接口 — 非观战模式）
   * @param {string} roomCode
   * @param {string} nickname
   * @returns {Promise<void>}
   */
  async joinRoom(roomCode, nickname) {
    return this._joinRoomInternal(roomCode, nickname);
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
    this.stopBurstCycle();
    this._roomCode = null;
    this._players = {};
    this._lastPosition = null;
    this._teams = {};
    this._myTeamId = null;
    // 重置发报员状态
    this._teamBroadcasterId = null;
    this._lastBroadcastTs = 0;
    this._myAmBroadcaster = false;
    this._teamSeparation = false;
    this._isSpectator = false;
    this._gameStartAt = 0;
    this._gameTimerAborted = false;
    this._isHost = false;
    this._gameState = 'idle';
    this._playerRoles = {};
    this._caughtPlayers = {};
    this._gameEvents = [];
    this._gameStartTs = 0;
    this._gameEndTs = 0;
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
    const msg = {
      ...data,
      id: this._deviceId,
      name: this._nickname,
      color: this._color,
      ts: Date.now(),
    };
    if (this._myTeamId) msg.teamId = this._myTeamId;
    if (this._myAmBroadcaster) msg.teamBroadcaster = true;
    if (this._teamSeparation) msg.teamSeparation = true;
    if (this._isSpectator) msg.spectator = true;
    this._client.publish(topic, JSON.stringify(msg), { qos: 1, retain: false });
  }

  /**
   * 设置是否共享定位
   */
  setSharingEnabled(enabled) {
    this._sharingEnabled = enabled;
    if (!enabled) {
      // 关闭共享时清除缓存的最后位置，心跳不再带坐标
      this._lastPosition = null;
    } else {
      // 恢复共享时发一条通知告知在线
      this._publish({ ping: true });
    }
  }

  isSharingEnabled() {
    return this._sharingEnabled;
  }

  /**
   * 更新并发布位置（受 sharingEnabled + 发报员模式控制）
   */
  publishPosition(lat, lng, acc, speed, bearing) {
    // 观战模式 / 位置共享静默期 → 不发布位置
    if (this._isSpectator) return;
    if (this._burstEnabled && this._burstPhase === 'silent') return;
    if (!this._sharingEnabled) return;
    this._lastPosition = { lat, lng, acc, speed, bearing };

    // 队伍发报员模式：非发报员且未分离 → 不传坐标（留给心跳定时器掌控）
    if (this._myTeamId && !this._myAmBroadcaster && !this._teamSeparation) return;

    this._publish({
      lat,
      lng,
      acc: acc || 0,
      speed: speed || 0,
      bearing: bearing || 0,
      sharing: true,
    });
  }

  /**
   * 启动定时发布
   */
  _startPublishing() {
    this._stopPublishing();
    this._publishTimer = setInterval(() => {
      // 每次心跳前确认发报员角色
      this._preparePublish();

      // 观战模式 → 只发纯心跳
      if (this._isSpectator) {
        this._publish({ ping: true, sharing: false, spectator: true });
        return;
      }

      // 位置共享静默期 → 不发坐标
      const canSharePosition = this._sharingEnabled && this._lastPosition &&
        (!this._burstEnabled || this._burstPhase === 'sharing');

      if (canSharePosition && (this._myAmBroadcaster || this._teamSeparation || !this._myTeamId)) {
        this._publish({
          ...this._lastPosition,
          ping: true,
          sharing: true,
        });
      } else {
        // 不共享定位 / 非发报员跟随者 → 只发纯心跳
        this._publish({ ping: true, sharing: this._sharingEnabled });
      }
    }, ROOM_CONFIG.POSITION_INTERVAL);
  }

  _stopPublishing() {
    if (this._publishTimer) {
      clearInterval(this._publishTimer);
      this._publishTimer = null;
    }
  }

  // ============================================================
  //  位置共享（静默/共享交替）
  // ============================================================

  /**
   * 启动位置共享周期
   * @param {number} silentMin 静默时长（分钟）
   * @param {number} shareMin 共享时长（分钟）
   */
  startBurstCycle(silentMin, shareMin) {
    this.stopBurstCycle();
    this._burstEnabled = true;
    this._burstSilentMin = Math.max(1, silentMin || 25);
    this._burstShareMin = Math.max(1, shareMin || 5);
    this._enterBurstPhase('silent');
  }

  /**
   * 停止位置共享，恢复连续共享
   */
  stopBurstCycle() {
    this._burstEnabled = false;
    this._burstPhase = 'silent';
    this._burstPhaseEnd = 0;
    if (this._burstTimer) {
      clearTimeout(this._burstTimer);
      this._burstTimer = null;
    }
    if (this.onBurstPhaseChange) this.onBurstPhaseChange(null, 0);
  }

  /** 进入位置共享下一阶段 */
  _enterBurstPhase(phase) {
    this._burstPhase = phase;
    const duration = phase === 'silent' ? this._burstSilentMin : this._burstShareMin;
    this._burstPhaseEnd = Date.now() + duration * 60 * 1000;

    if (this.onBurstPhaseChange) this.onBurstPhaseChange(phase, this._burstPhaseEnd);

    if (this._burstTimer) clearTimeout(this._burstTimer);
    this._burstTimer = setTimeout(() => {
      const next = phase === 'silent' ? 'sharing' : 'silent';
      this._enterBurstPhase(next);
    }, duration * 60 * 1000);
  }

  isBurstEnabled() { return this._burstEnabled; }
  getBurstPhase() { return this._burstPhase; }
  getBurstPhaseEnd() { return this._burstPhaseEnd; }

  // ============================================================
  //  观战模式
  // ============================================================

  isSpectator() { return this._isSpectator; }

  /**
   * 创建房间（支持观战模式）
   */
  async createRoom(nickname, spectator) {
    this._isSpectator = spectator === true;
    const code = await this._createRoomInternal(nickname);
    return code;
  }

  /**
   * 加入房间（支持观战模式）
   */
  async joinRoom(roomCode, nickname, spectator) {
    this._isSpectator = spectator === true;
    await this._joinRoomInternal(roomCode, nickname);
  }

  // 将原有 createRoom/joinRoom 逻辑拆为内部方法
  async _createRoomInternal(nickname) {
    this._nickname = nickname || '玩家';
    this._color = _pickColor(this._deviceId);
    this._roomCode = _generateRoomCode();
    this._isHost = true;  // 创建者自动成为房主

    await this._connect();
    this._subscribeRoom(this._roomCode);
    this._startPublishing();

    // 发布加入消息
    this._publish({ join: true, name: this._nickname, color: this._color });
    return this._roomCode;
  }

  async _joinRoomInternal(roomCode, nickname) {
    this._nickname = nickname || '玩家';
    this._color = _pickColor(this._deviceId);
    this._roomCode = roomCode.toUpperCase();

    await this._connect();
    this._subscribeRoom(this._roomCode);
    this._startPublishing();

    // 发布加入消息
    this._publish({ join: true, name: this._nickname, color: this._color });
  }

  // ============================================================
  //  游戏开始倒计时
  // ============================================================

  /**
   * 设置游戏开始时间（任何玩家可设，覆盖上一次）
   * @param {number} startAt 开始时间戳（Date.now() + 秒数*1000）
   */
  setGameTimer(startAt) {
    this._gameStartAt = startAt;
    this._gameTimerAborted = false;
    this._publish({ type: 'game_timer_set', startAt });
    if (this.onGameTimerUpdate) this.onGameTimerUpdate(startAt);
  }

  /**
   * 取消游戏倒计时
   */
  abortGameTimer() {
    this._gameStartAt = 0;
    this._gameTimerAborted = true;
    this._publish({ type: 'game_timer_abort' });
    if (this.onGameTimerAborted) this.onGameTimerAborted();
  }

  getGameStartAt() { return this._gameStartAt; }
  isGameTimerAborted() { return this._gameTimerAborted; }

  // ============================================================
  //  游戏角色 — 鬼抓人
  // ============================================================

  /**
   * 获取当前游戏状态
   * @returns {string} 'idle' | 'playing' | 'finished'
   */
  getGameState() { return this._gameState; }

  /**
   * 我是否是房主
   */
  isHost() { return this._isHost; }

  /**
   * 获取玩家角色
   * @param {string} playerId
   * @returns {string|null} 'ghost' | 'hunter' | null
   */
  getPlayerRole(playerId) {
    return this._playerRoles[playerId] || null;
  }

  /**
   * 我是否已被抓
   */
  isPlayerCaught(playerId) {
    return this._caughtPlayers[playerId] != null;
  }

  /**
   * 开始游戏（房主专用）
   * 广播 game_start → 所有人进入 playing 状态
   */
  startGame() {
    if (!this._isHost) return;
    if (this._gameState !== 'idle') return;
    this._gameState = 'playing';
    this._gameStartTs = Date.now();
    this._gameEvents = [{ type: 'game_start', ts: this._gameStartTs }];
    this._publish({ type: 'game_start' });
    if (this.onGameStateChange) this.onGameStateChange('playing');
  }

  /**
   * 结束游戏（房主专用）
   */
  endGame() {
    if (!this._isHost) return;
    if (this._gameState !== 'playing') return;
    this._gameState = 'finished';
    this._gameEndTs = Date.now();
    this._gameEvents.push({ type: 'game_end', ts: this._gameEndTs });
    this._publish({ type: 'game_end' });
    if (this.onGameStateChange) this.onGameStateChange('finished');
    if (this.onGameStatsReady) this.onGameStatsReady(this._buildGameStats());
  }

  /**
   * 分配角色（房主专用）
   * @param {string} targetId
   * @param {'ghost'|'hunter'} role
   */
  assignRole(targetId, role) {
    if (!this._isHost) return;
    if (this._gameState !== 'idle' && this._gameState !== 'playing') return;
    this._playerRoles[targetId] = role;
    if (this._players[targetId]) {
      this._players[targetId].role = role;
    }
    this._publish({ type: 'role_assign', targetId, role });
    if (this.onRoleAssigned) this.onRoleAssigned(targetId, role, this._deviceId);
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  /**
   * 随机分配角色（房主专用）
   * 默认 1 鬼，其余为人
   * @param {number} ghostCount 鬼的数量，默认1
   */
  randomAssignRoles(ghostCount = 1) {
    if (!this._isHost) return;
    // 排除观战者
    const candidates = Object.values(this._players).filter(p => p.online && !p.spectator);
    if (candidates.length < 2) return;

    // 洗牌
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const ghosts = shuffled.slice(0, Math.min(ghostCount, shuffled.length - 1));

    for (const p of candidates) {
      const role = ghosts.find(g => g.id === p.id) ? 'ghost' : 'hunter';
      this.assignRole(p.id, role);
    }
  }

  /**
   * 标记玩家被抓（房主专用）
   * @param {string} targetId 被抓玩家 ID
   * @param {string} ghostId 抓到人的鬼 ID
   */
  catchPlayer(targetId, ghostId) {
    if (!this._isHost) return;
    if (this._caughtPlayers[targetId]) return; // 已抓过
    this._caughtPlayers[targetId] = { caughtBy: ghostId, ts: Date.now() };
    this._gameEvents.push({ type: 'player_caught', playerId: targetId, ghostId, ts: Date.now() });
    if (this._players[targetId]) {
      this._players[targetId].caught = true;
      this._players[targetId].caughtBy = ghostId;
    }
    this._publish({ type: 'player_caught', targetId, ghostId });
    if (this.onPlayerCaught) this.onPlayerCaught(targetId, ghostId);
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  /**
   * 构建赛后统计数据
   */
  _buildGameStats() {
    const duration = this._gameEndTs - this._gameStartTs;
    // 角色统计
    const roles = {};
    for (const [id, role] of Object.entries(this._playerRoles)) {
      if (!roles[role]) roles[role] = [];
      const p = this._players[id];
      roles[role].push({
        id,
        name: p ? p.name : '未知',
        caught: this._caughtPlayers[id] != null,
        caughtBy: this._caughtPlayers[id] ? this._caughtPlayers[id].caughtBy : null,
        caughtTs: this._caughtPlayers[id] ? this._caughtPlayers[id].ts : null,
      });
    }

    // 被抓事件时间线
    const timeline = this._gameEvents
      .filter(e => e.type === 'player_caught')
      .map(e => ({
        ...e,
        playerName: this._players[e.playerId] ? this._players[e.playerId].name : '未知',
        ghostName: this._players[e.ghostId] ? this._players[e.ghostId].name : '未知',
        offset: this._gameStartTs ? ((e.ts - this._gameStartTs) / 1000).toFixed(0) : 0,
      }));

    // 胜负判定
    const hunters = roles.hunter ? roles.hunter.filter(h => !h.caught) : [];
    const ghosts = roles.ghost ? roles.ghost : [];
    const allCaught = roles.hunter ? roles.hunter.every(h => h.caught) : false;
    const winner = allCaught ? 'ghost' : (this._gameState === 'finished' && !allCaught ? 'hunter' : null);

    return {
      startTs: this._gameStartTs,
      endTs: this._gameEndTs,
      duration,
      durationStr: this._formatDuration(duration),
      playerCount: Object.keys(this._players).length,
      roles,
      timeline,
      survivors: hunters.length,
      totalCaught: Object.keys(this._caughtPlayers).length,
      winner,
    };
  }

  /** 毫秒→可读时长 */
  _formatDuration(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  /**
   * 获取所有被抓玩家
   */
  getCaughtPlayers() {
    return { ...this._caughtPlayers };
  }

  // ============================================================

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
      teamId: this._myTeamId,
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

  // ============================================================
  //  队伍管理
  // ============================================================

  /**
   * 创建队伍
   * @param {string} teamName
   * @param {string} teamColor
   * @returns {string} teamId
   */
  createTeam(teamName, teamColor) {
    const teamId = 't' + Math.random().toString(36).slice(2, 8);
    this._myTeamId = teamId;
    this._teams[teamId] = {
      id: teamId,
      name: teamName,
      color: teamColor,
      creatorId: this._deviceId,
    };
    this._publish({
      type: 'team_create',
      teamId,
      teamName,
      teamColor,
    });
    if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
    return teamId;
  }

  /**
   * 加入队伍
   */
  joinTeam(teamId) {
    if (!this._teams[teamId]) return;
    this._myTeamId = teamId;
    this._publish({ type: 'team_join', teamId });
    if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
  }

  /**
   * 离开队伍
   * @param {string} [teamId] 缺省时离开当前队伍
   */
  leaveTeam(teamId) {
    const targetId = teamId || this._myTeamId;
    if (!targetId) return;
    this._myTeamId = null;
    this._publish({ type: 'team_leave', teamId: targetId });
    if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
  }

  /**
   * 踢出队伍（仅房主可操作）
   */
  kickFromTeam(teamId, targetId) {
    this._publish({ type: 'team_kick', teamId, targetId });
  }

  /**
   * 获取所有队伍元数据
   */
  getTeams() {
    return { ...this._teams };
  }

  /**
   * 获取自己的队伍 ID
   */
  getMyTeamId() {
    return this._myTeamId;
  }

  /**
   * 获取指定队伍的在线成员
   */
  getTeamMembers(teamId) {
    return Object.values(this._players).filter(p => p.teamId === teamId && p.online);
  }

  // ============================================================
  //  队伍发报员模式
  // ============================================================

  /**
   * 每次心跳前的发报准备：检查超时 → 选举 → 分离检测
   */
  _preparePublish() {
    if (!this._myTeamId) return;

    // 1. 发报员超时检测（连续 3 个心跳周期无广播 → 重选）
    if (this._teamBroadcasterId && Date.now() - this._lastBroadcastTs > ROOM_CONFIG.POSITION_INTERVAL * 3) {
      this._teamBroadcasterId = null;
      this._myAmBroadcaster = false;
    }

    // 2. 无发报员 → 选举
    if (!this._teamBroadcasterId) {
      this._electBroadcaster();
    }

    // 3. 跟随者 → 分离检测
    if (this._teamBroadcasterId && this._teamBroadcasterId !== this._deviceId) {
      this._checkSeparation();
    }
  }

  /**
   * 选举发报员：队伍内精度最低的成员担任
   * 每个客户端独立计算，因规则确定，结果一致
   */
  _electBroadcaster() {
    const candidates = [];

    // 其他在线队友（需有坐标）
    Object.values(this._players).forEach(p => {
      if (p.teamId === this._myTeamId && p.online && p.lat != null) {
        candidates.push({ id: p.id, acc: p.acc != null ? p.acc : 999 });
      }
    });

    // 自己（如果有位置）
    if (this._lastPosition) {
      candidates.push({ id: this._deviceId, acc: this._lastPosition.acc != null ? this._lastPosition.acc : 999 });
    }

    if (candidates.length === 0) return;

    // 精度越低（数值越小）越优先，平局按 deviceId 排序
    candidates.sort((a, b) => {
      if (a.acc !== b.acc) return a.acc - b.acc;
      return a.id < b.id ? -1 : 1;
    });

    const bestId = candidates[0].id;
    this._teamBroadcasterId = bestId;
    this._myAmBroadcaster = (bestId === this._deviceId);
    this._lastBroadcastTs = Date.now();
  }

  /**
   * 分离检测：跟随者与发报员的距离是否 > 300m
   * 带 100m 回滞，防止频繁切换
   */
  _checkSeparation() {
    if (!this._lastPosition || !this._teamBroadcasterId) {
      this._teamSeparation = false;
      return;
    }

    // 我自己就是发报员 → 不需要检测
    if (this._teamBroadcasterId === this._deviceId) {
      this._teamSeparation = false;
      return;
    }

    const broadcaster = this._players[this._teamBroadcasterId];
    if (!broadcaster || broadcaster.lat == null) {
      this._teamSeparation = false;
      return;
    }

    const dist = calcDistance(
      this._lastPosition.lat, this._lastPosition.lng,
      broadcaster.lat, broadcaster.lng
    );

    // 回滞：300m 进入分离，100m 回到跟随
    if (this._teamSeparation) {
      this._teamSeparation = dist > 100;
    } else {
      this._teamSeparation = dist > 300;
    }
  }

  /**
   * 获取当前发报员 ID
   */
  getTeamBroadcasterId() {
    return this._teamBroadcasterId;
  }

  /**
   * 我是否是发报员
   */
  isTeamBroadcaster() {
    return this._myAmBroadcaster;
  }

  /**
   * 我是否从发报员分离
   */
  isTeamSeparated() {
    return this._teamSeparation;
  }

  /**
   * 销毁实例，清理所有资源
   */
  destroy() {
    this.leaveRoom();
    this._disconnect();
    this.stopBurstCycle();
    this._players = {};
    this._teams = {};
    this._myTeamId = null;
    this._teamBroadcasterId = null;
    this._lastBroadcastTs = 0;
    this._myAmBroadcaster = false;
    this._teamSeparation = false;
    this._isSpectator = false;
    this._gameStartAt = 0;
    this._gameTimerAborted = false;
    this._isHost = false;
    this._gameState = 'idle';
    this._playerRoles = {};
    this._caughtPlayers = {};
    this._gameEvents = [];
    this._gameStartTs = 0;
    this._gameEndTs = 0;
  }
}
