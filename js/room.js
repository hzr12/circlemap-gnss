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
  // 备用 Broker 链（按序尝试）：HiveMQ 公共 Broker → Eclipse Mosquitto 公共测试服务
  // 注意：test.mosquitto.org 的加密 WebSocket(8081)在其配置中已被注释禁用，
  //       仅 8080 明文 ws 可用；在 https/本地页面下浏览器会因混合内容拦截 ws://，
  //       故该备用仅在 file:// 直开或 http:// 页面下才真正可达。
  BROKER_FALLBACKS: [
    'wss://broker.mqtt-dashboard.com:8884/mqtt',
    'ws://test.mosquitto.org:8080/',
  ],
  TOPIC_PREFIX: 'circlemap',
  ROOM_CODE_LEN: 6,
  RECONNECT_DELAY: 5000,         // 重连间隔（ms）
  POSITION_INTERVAL: 10000,      // 坐标发布基准间隔（ms）；自适应下限（移动时不短于它）
  POSITION_INTERVAL_MAX: 15000,  // 自适应：静止时的下发间隔上限（到点后最多 15s 发一次）
  POS_STILL_SPEED: 0.5,          // 低于此速度(m/s)视为静止 → 用最长间隔
  POS_FAST_SPEED: 3,             // 高于此速度(m/s)视为快速移动 → 用基准间隔
  HEARTBEAT_INTERVAL: 15000,     // 心跳保活间隔（ms），二进制 ping 维持在线 + 发报员选举
  PRESENCE_INTERVAL: 30000,       // 在场广播间隔（ms），低频回填静态身份
  OFFLINE_GRACE_MS: 60000,        // 离线宽限（ms）：收到 offline 后不立即删除，宽限期内收到任意消息视为「没真走」
  NPC_POSITION_INTERVAL: 60000,  // NPC 队坐标发布间隔（ms），持续共享（1 分钟/次）
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

    this._posTimer = null;          // 自适应位置定时器（setTimeout 自调度）
    this._heartbeatTimer = null;    // 心跳定时器（setInterval）
    this._presenceTimer = null;     // 在场广播定时器（setInterval）
    this._npcTimer = null;          // NPC 队强制共享定时器（setInterval）
    this._offlineTimers = {};       // 离线宽限定时器（id → setTimeout），防抖避免抖动/重加闪烁
    this._lastPosition = null;      // 最近一次 GPS 坐标
    this._lastSentPos = null;       // 最近一次实际下发的坐标（自适应位移判定用）
    this._lastSentSpeed = null;     // 最近一次下发时的速度（静止→移动 瞬间判定用）
    this._sharingEnabled = false;     // 默认关闭，游戏开始时自动开启并锁定

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

      // 尝试主用 Broker；失败时按 BROKER_FALLBACKS 顺序依次尝试
      this._tryConnect(ROOM_CONFIG.BROKER_URL, ROOM_CONFIG.BROKER_FALLBACKS.slice(), shortId, resolve, reject);
    });
  }

  /**
   * 尝试连接指定 Broker（失败时按 fallbacks 数组依次尝试下一个）
   * @param {string} brokerUrl 当前要连接的 Broker URL
   * @param {string[]} fallbacks 剩余备用 Broker URL 列表（会被 shift 消费）
   */
  _tryConnect(brokerUrl, fallbacks, clientId, resolve, reject) {
    const discarded = { current: false };
    let errCount = 0;
    let lastErr = null;

    console.log('[Room] 正在连接 MQTT:', brokerUrl, 'clientId:', clientId);

    try {
      // 遗嘱消息（Last-Will）：异常断开（刷新页面 / 关闭标签页 / 系统杀进程）时，
      // Broker 会代发该离线通知，他人端走现有 offline 分支（见 _handleMessage）直接清掉幽灵标记。
      // 正常 leaveRoom() 会先发显式 offline 再优雅断开，不会触发本遗嘱。
      const willTopic = this._roomCode
        ? `${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/${this._deviceId}`
        : null;

      this._client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: ROOM_CONFIG.RECONNECT_DELAY,
        connectTimeout: ROOM_CONFIG.CONNECT_TIMEOUT,
        keepalive: 30,
        ...(willTopic ? {
          will: {
            topic: willTopic,
            payload: JSON.stringify({ id: this._deviceId, offline: true }),
            qos: 1,
            retain: false,
          },
        } : {}),
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
        lastErr = err;
        console.error(`[Room] MQTT 错误 (${errCount}/${ROOM_CONFIG.MAX_RETRY}):`, err && err.message);

        if (errCount >= ROOM_CONFIG.MAX_RETRY) {
          discarded.current = true;

          if (!fallbacks || fallbacks.length === 0) {
            reject(new Error(this._formatMqttError(err, `已尝试所有 Broker，连续失败 ${ROOM_CONFIG.MAX_RETRY} 次`)));
            return;
          }

          // 当前 Broker 失败后给出明确提示再切下一个备用（只提示一次，避免刷屏）
          const next = fallbacks.shift();
          if (this.onRoomError) this.onRoomError(this._formatMqttError(err) + '，正在尝试备用服务器…');
          console.log(`[Room] 当前 Broker 连续失败 ${ROOM_CONFIG.MAX_RETRY} 次，切换到备用:`, next);
          this._disconnect();
          this._tryConnect(next, fallbacks, clientId, resolve, reject);
        }
      });

      this._client.on('message', (topic, payload) => {
        this._handleMessage(topic, payload);
      });

    } catch (e) {
      // 连接抛出同步异常 → 尝试下一个备用
      if (fallbacks && fallbacks.length > 0) {
        const next = fallbacks.shift();
        console.log('[Room] 当前 Broker 异常，尝试备用:', next);
        this._disconnect();
        this._tryConnect(next, fallbacks, clientId, resolve, reject);
      } else {
        reject(new Error(this._formatMqttError(e)));
      }
    }
  }

  /**
   * 将 MQTT 底层错误转换为中文可读提示
   * 区分「握手失败/不可达」与「超时」等常见情况
   * @param {Error} err 原始错误
   * @param {string} [suffix] 附加说明（如重试次数），拼在括号里
   * @returns {string}
   */
  _formatMqttError(err, suffix) {
    const msg = (err && err.message) || '';
    let friendly = '游戏服务器连接失败';
    if (msg.includes('WebSocket is closed') || (msg.includes('close') && msg.includes('connect'))) {
      friendly = '无法连接游戏服务器（WebSocket 握手失败），请检查网络或防火墙是否拦截 8084/8884 端口';
    } else if (msg.includes('timeout') || msg.includes('Timeout')) {
      friendly = '连接游戏服务器超时，请检查网络后重试';
    } else if (msg.includes('refused') || msg.includes('ECONNREFUSED')) {
      friendly = '游戏服务器拒绝连接（可能已满或限流）';
    } else if (msg) {
      friendly = '游戏服务器连接失败：' + msg;
    }
    return suffix ? `${friendly}（${suffix}）` : friendly;
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
  _handleMessage(topic, payload) {
    try {
      // 从 topic 提取发送者 deviceId：circlemap/<room>/<id>[/pos|/ping]
      const parts = topic.split('/');
      const senderId = parts[2];

      // 二进制坐标（…/<id>/pos）
      if (topic.endsWith('/pos')) {
        this._onPositionMsg(senderId, this._decodePos(payload));
        return;
      }
      // 二进制心跳（…/<id>/ping）
      if (topic.endsWith('/ping')) {
        this._onPingMsg(senderId, this._decodePing(payload));
        return;
      }
      // 二进制在场（…/<id>/presence）
      if (topic.endsWith('/presence')) {
        this._onPresenceMsg(senderId, this._decodePresence(payload));
        return;
      }

      const data = JSON.parse(payload.toString());

      // === 队伍控制消息 ===
      if (data.type === 'team_create') {
        this._teams[data.teamId] = {
          id: data.teamId,
          name: data.teamName,
          color: data.teamColor,
          creatorId: data.id,
          isNpc: data.isNpc === true,
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
        // 房主已在 startGame() 本地处理，跳过自身回声避免重复初始化事件
        if (data.id === this._deviceId) return;
        this._resetGameState();
        this._gameState = 'playing';
        this._gameStartTs = data.ts || Date.now();
        this._gameEvents = [{ type: 'game_start', ts: this._gameStartTs }];
        if (this.onGameStateChange) this.onGameStateChange('playing');
        return;
      }

      if (data.type === 'game_end') {
        // 房主已在 endGame() 本地处理，跳过自身回声避免重复 push 事件
        if (data.id === this._deviceId) return;
        this._gameState = 'finished';
        this._gameEndTs = data.ts || Date.now();
        this._gameEvents.push({ type: 'game_end', ts: this._gameEndTs });
        // 触发统计
        if (this.onGameStateChange) this.onGameStateChange('finished');
        if (this.onGameStatsReady) this.onGameStatsReady(this._buildGameStats());
        return;
      }

      if (data.type === 'role_assign') {
        // 房主已在 assignRole() 本地处理，跳过自身回声
        if (data.id === this._deviceId) return;
        this._playerRoles[data.targetId] = data.role;
        if (this._players[data.targetId]) {
          this._players[data.targetId].role = data.role;
        }
        if (this.onRoleAssigned) this.onRoleAssigned(data.targetId, data.role, data.id);
        return;
      }

      if (data.type === 'player_caught') {
        // 房主已在 catchPlayer() 本地 push 事件，跳过自身回声避免时间线重复
        if (data.id === this._deviceId) return;
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

      // 离线消息（含 Broker 代发的遗嘱）：先进入宽限，避免网络抖动 / 刷新重加导致的闪烁
      if (data.offline) {
        this._schedulePendingOffline(data.id);
        return;
      }

      // 加入消息（携带 name/color，触发 onPlayerJoin）
      if (data.id && data.id !== this._deviceId && data.join != null) {
        this._cancelPendingOffline(data.id);
        const existing = this._players[data.id];
        const isNew = !existing;
        const player = existing ? { ...existing } : {
          id: data.id, name: data.name || '未知', color: data.color || '#888',
          online: true, sharing: true, teamId: null, teamBroadcaster: false,
          teamSeparation: false, spectator: false, isNpc: false,
          role: null, caught: false, caughtBy: null,
        };
        player.id = data.id;
        player.name = data.name || player.name || '未知';
        player.color = data.color || player.color || '#888';
        player.online = true;
        if (data.teamId) player.teamId = data.teamId;
        player.isNpc = (this._teams[player.teamId] && this._teams[player.teamId].isNpc) || false;
        this._players[data.id] = player;
        if (isNew && this.onPlayerJoin) this.onPlayerJoin(data.id, player.name);
        if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
        return;
      }
    } catch (e) {
      console.warn('[Room] 消息解析失败:', e);
    }
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
        this._client.unsubscribe(`${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/#`);
      } catch (e) { /* 静默 */ }
    }

    this._stopPublishing();
    this.stopBurstCycle();
    this._roomCode = null;
    this._players = {};
    this._lastPosition = null;
    this._lastSentPos = null;
    this._lastSentSpeed = null;
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
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${roomCode}/#`;
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
    if (this._isNpcTeam()) msg.isNpc = true;
    // 游戏状态随位置消息广播，保证迟到/漏收的玩家也能同步角色与被抓状态
    const myRole = this._playerRoles[this._deviceId];
    if (myRole) msg.role = myRole;
    if (this._caughtPlayers[this._deviceId] != null) msg.caught = true;
    this._client.publish(topic, JSON.stringify(msg), { qos: 1, retain: false });
  }

  // ============================================================
  //  接收：坐标 / 心跳（二进制）
  // ============================================================

  _onPositionMsg(senderId, pos) {
    if (senderId === this._deviceId) return;
    this._cancelPendingOffline(senderId);
    const existing = this._players[senderId];
    const isNew = !existing;
    const player = existing ? { ...existing } : {
      id: senderId, name: '未知', color: '#888', online: true, sharing: true,
      teamId: null, teamBroadcaster: false, teamSeparation: false,
      spectator: false, isNpc: false, role: null, caught: false, caughtBy: null,
    };
    player.id = senderId;
    player.ts = pos.ts || Date.now();
    player.online = true;
    player.lat = pos.lat;
    player.lng = pos.lng;
    player.acc = pos.acc || 0;
    player.speed = pos.speed || 0;
    player.bearing = pos.bearing || 0;
    player.lastPosUpdate = Date.now();
    player.isNpc = (this._teams[player.teamId] && this._teams[player.teamId].isNpc) || false;
    player.role = this._playerRoles[senderId] || player.role || null;
    player.caught = (this._caughtPlayers[senderId] != null) || player.caught || false;
    player.caughtBy = this._caughtPlayers[senderId] ? this._caughtPlayers[senderId].caughtBy : (player.caughtBy || null);
    this._players[senderId] = player;
    if (isNew && this.onPlayerJoin) this.onPlayerJoin(senderId, player.name);
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  _onPingMsg(senderId, flags) {
    if (senderId === this._deviceId) return;
    this._cancelPendingOffline(senderId);
    const existing = this._players[senderId];
    const isNew = !existing;
    const player = existing ? { ...existing } : {
      id: senderId, name: '未知', color: '#888', online: true, sharing: true,
      teamId: null, teamBroadcaster: false, teamSeparation: false,
      spectator: false, isNpc: false, role: null, caught: false, caughtBy: null,
    };
    player.id = senderId;
    player.online = true;
    player.sharing = flags.sharing;
    player.spectator = flags.spectator;
    player.teamBroadcaster = flags.teamBroadcaster;
    player.teamSeparation = flags.teamSeparation;
    // 队伍发报员选举（原 pos 分支逻辑迁移）
    if (player.teamId === this._myTeamId && flags.teamBroadcaster) {
      this._teamBroadcasterId = senderId;
      this._myAmBroadcaster = false;
      this._lastBroadcastTs = Date.now();
    }
    this._players[senderId] = player;
    if (isNew && this.onPlayerJoin) this.onPlayerJoin(senderId, player.name);
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  // 在场消息：低频回填静态身份（name/color/teamId/spectator/isNpc/role/caught）
  _onPresenceMsg(senderId, p) {
    if (senderId === this._deviceId) return;
    this._cancelPendingOffline(senderId);
    const existing = this._players[senderId];
    const player = existing ? { ...existing } : {
      id: senderId, name: p.name || '未知', color: p.color || '#888',
      online: true, sharing: true, teamId: null, teamBroadcaster: false,
      teamSeparation: false, spectator: false, isNpc: false,
      role: null, caught: false, caughtBy: null,
    };
    player.id = senderId;
    player.name = p.name || player.name || '未知';
    player.color = p.color || player.color || '#888';
    player.teamId = p.teamId || player.teamId || null;
    player.spectator = p.spectator === true;
    player.isNpc = (this._teams[player.teamId] && this._teams[player.teamId].isNpc) || p.isNpc === true;
    player.role = p.role || this._playerRoles[senderId] || player.role || null;
    player.caught = p.caught === true || (this._caughtPlayers[senderId] != null) || player.caught || false;
    player.caughtBy = this._caughtPlayers[senderId] ? this._caughtPlayers[senderId].caughtBy : (player.caughtBy || null);
    this._players[senderId] = player;
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  // ============================================================
  //  二进制编解码（零依赖，DataView）
  // ============================================================

  _asDataView(payload) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
      return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    if (payload instanceof ArrayBuffer) return new DataView(payload);
    if (payload instanceof Uint8Array) {
      return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    return new DataView(payload.buffer || payload);
  }

  // 位置包 21 字节：lat/lng Int32(×1e6)，acc Uint32(米)，speed Uint16(×100)，brg Uint16(×100)，ts Uint32(秒)，flags Uint8
  _encodePos(p) {
    const buf = new ArrayBuffer(21);
    const dv = new DataView(buf);
    dv.setInt32(0, Math.round(p.lat * 1e6), true);
    dv.setInt32(4, Math.round(p.lng * 1e6), true);
    dv.setUint32(8, Math.max(0, Math.min(0xFFFFFFFF, Math.round(p.acc || 0))), true);
    dv.setUint16(12, Math.max(0, Math.min(65535, Math.round((p.speed || 0) * 100))), true);
    dv.setUint16(14, Math.max(0, Math.min(65535, Math.round((p.bearing || 0) * 100))), true);
    dv.setUint32(16, Math.floor((p.ts || Date.now()) / 1000), true);
    dv.setUint8(20, 1);
    return new Uint8Array(buf);
  }

  _decodePos(payload) {
    const dv = this._asDataView(payload);
    return {
      lat: dv.getInt32(0, true) / 1e6,
      lng: dv.getInt32(4, true) / 1e6,
      acc: dv.getUint32(8, true),
      speed: dv.getUint16(12, true) / 100,
      bearing: dv.getUint16(14, true) / 100,
      ts: dv.getUint32(16, true) * 1000,
    };
  }

  // 心跳包 1 字节：bit0 sharing / bit1 teamBroadcaster / bit2 teamSeparation / bit3 spectator
  _encodePing(flags) {
    const buf = new ArrayBuffer(1);
    const dv = new DataView(buf);
    let b = 0;
    if (flags.sharing) b |= 1;
    if (flags.teamBroadcaster) b |= 2;
    if (flags.teamSeparation) b |= 4;
    if (flags.spectator) b |= 8;
    dv.setUint8(0, b);
    return new Uint8Array(buf);
  }

  _decodePing(payload) {
    const dv = this._asDataView(payload);
    const b = dv.getUint8(0);
    return {
      sharing: !!(b & 1),
      teamBroadcaster: !!(b & 2),
      teamSeparation: !!(b & 4),
      spectator: !!(b & 8),
    };
  }

  // 在场包：1 字节 flags + 三段变长字符串（name/color/teamId，各 1 字节长度前缀 + UTF-8）
  // flags bit0 旁观 / bit1 NPC / bit2 被抓 / bit3 有角色 / bit4 角色为鬼（其余保留）
  _encodePresence(p) {
    const nameU = new TextEncoder().encode(p.name || '');
    const colorU = new TextEncoder().encode(p.color || '');
    const teamU = new TextEncoder().encode(p.teamId || '');
    const buf = new ArrayBuffer(1 + 1 + nameU.length + 1 + colorU.length + 1 + teamU.length);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let f = 0;
    if (p.spectator) f |= 1;
    if (p.isNpc) f |= 2;
    if (p.caught) f |= 4;
    if (p.role) f |= 8;
    if (p.role === 'ghost') f |= 16;
    let o = 0;
    dv.setUint8(o, f); o += 1;
    u8[o] = nameU.length; o += 1; u8.set(nameU, o); o += nameU.length;
    u8[o] = colorU.length; o += 1; u8.set(colorU, o); o += colorU.length;
    u8[o] = teamU.length; o += 1; u8.set(teamU, o); o += teamU.length;
    return u8;
  }

  _decodePresence(payload) {
    const dv = this._asDataView(payload);
    const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    let o = 0;
    const f = u8[o]; o += 1;
    const readStr = () => {
      const len = u8[o]; o += 1;
      const s = new TextDecoder().decode(u8.subarray(o, o + len));
      o += len;
      return s;
    };
    const name = readStr();
    const color = readStr();
    const teamLen = u8[o]; o += 1;
    const teamId = teamLen ? new TextDecoder().decode(u8.subarray(o, o + teamLen)) : null;
    o += teamLen;
    const hasRole = !!(f & 8);
    return {
      name, color, teamId,
      spectator: !!(f & 1),
      isNpc: !!(f & 2),
      caught: !!(f & 4),
      role: hasRole ? ((f & 16) ? 'ghost' : 'hunter') : null,
    };
  }

  _publishPosition() {
    if (!this._client || !this._connected || !this._roomCode || !this._lastPosition) return;
    const p = this._lastPosition;
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/${this._deviceId}/pos`;
    const bytes = this._encodePos({
      lat: p.lat, lng: p.lng, acc: p.acc, speed: p.speed, bearing: p.bearing, ts: Date.now(),
    });
    this._client.publish(topic, bytes, { qos: 1, retain: false, binary: true });
    this._lastSentPos = { lat: p.lat, lng: p.lng, bearing: p.bearing, ts: Date.now() };
    this._lastSentSpeed = p.speed;
  }

  _publishPing() {
    if (!this._client || !this._connected || !this._roomCode) return;
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/${this._deviceId}/ping`;
    const bytes = this._encodePing({
      sharing: this._isSpectator ? false : this._sharingEnabled,
      teamBroadcaster: this._myAmBroadcaster,
      teamSeparation: this._teamSeparation,
      spectator: this._isSpectator,
    });
    this._client.publish(topic, bytes, { qos: 1, retain: false, binary: true });
  }

  _publishPresence() {
    // 静态身份低频回填（二进制，像 pos/ping）：name/color/teamId/spectator/isNpc/role/caught
    if (!this._client || !this._connected || !this._roomCode) return;
    const topic = `${ROOM_CONFIG.TOPIC_PREFIX}/${this._roomCode}/${this._deviceId}/presence`;
    const bytes = this._encodePresence({
      name: this._nickname,
      color: this._color,
      teamId: this._myTeamId,
      spectator: this._isSpectator,
      isNpc: this._isNpcTeam(),
      role: this._playerRoles[this._deviceId] || null,
      caught: this._caughtPlayers[this._deviceId] != null,
    });
    this._client.publish(topic, bytes, { qos: 1, retain: false, binary: true });
  }

  // ============================================================
  //  自适应位置下发
  // ============================================================

  _computePositionInterval() {
    const speed = (this._lastPosition && this._lastPosition.speed) || 0; // m/s
    const min = ROOM_CONFIG.POSITION_INTERVAL;       // 移动时最短间隔（=原基准，不更短以免增带宽）
    const max = ROOM_CONFIG.POSITION_INTERVAL_MAX;   // 静止时最长间隔
    const still = ROOM_CONFIG.POS_STILL_SPEED;
    const fast = ROOM_CONFIG.POS_FAST_SPEED;
    if (speed <= still) return max;                   // 基本静止 → 最长间隔
    if (speed >= fast) return min;                    // 快速移动 → 基准间隔
    // 0.5~3 m/s：在 [min, max] 间线性插值（始终 ≥ 原基准 10s）
    return Math.round(min + (max - min) * (1 - (speed - still) / (fast - still)));
  }

  _shouldSendPosition() {
    if (this._isSpectator || this._isNpcTeam()) return false;
    const canShare = this._sharingEnabled && this._lastPosition &&
      (!this._burstEnabled || this._burstPhase === 'sharing');
    if (!canShare) return false;
    // 游戏中（鬼抓人）取消发报员压制：每人各自广播，保证所有人互相可见
    const broadcasterOk = this._gameState === 'playing' ||
      this._myAmBroadcaster || this._teamSeparation || !this._myTeamId;
    if (!broadcasterOk) return false;
    const sinceSent = this._lastSentPos ? Date.now() - this._lastSentPos.ts : Infinity;
    return sinceSent >= this._computePositionInterval();
  }

  /** 立即补发一次当前位置（游戏开始 / 到点进入共享阶段时调用） */
  flushPositionNow() {
    if (this._shouldSendPosition()) this._publishPosition();
  }

  _positionTick() {
    this._preparePublish();
    if (this._shouldSendPosition()) {
      this._publishPosition();
    }
  }

  _schedulePositionTick() {
    const interval = this._computePositionInterval();
    this._posTimer = setTimeout(() => {
      this._positionTick();
      this._schedulePositionTick();
    }, interval);
  }

  /**
   * 设置是否共享定位
   */
  setSharingEnabled(enabled) {
    this._sharingEnabled = enabled;
    if (!enabled) {
      // 关闭共享时清除缓存的最后位置，心跳不再带坐标
      this._lastPosition = null;
      this._lastSentPos = null;
    } else {
      // 恢复共享时发一条心跳通知告知在线
      this._publishPing();
    }
  }

  isSharingEnabled() {
    return this._sharingEnabled;
  }

  /**
   * 更新并发布位置（受 sharingEnabled + 发报员模式控制）
   */
  publishPosition(lat, lng, acc, speed, bearing) {
    if (this._isSpectator) return;
    // 始终缓存最新坐标：即便共享关闭也记录，便于游戏开始立即补发（发送仍受共享开关控制）
    this._lastPosition = { lat, lng, acc, speed, bearing };
    // NPC 队：忽略静默期与共享开关，持续共享
    const npc = this._isNpcTeam();
    if (this._burstEnabled && this._burstPhase === 'silent' && !npc) return;
    if (!this._sharingEnabled && !npc) return;
    if (npc) return; // NPC 不在 GPS 回调即时发，交由 _npcTimer 按 60s 节奏统一发
    // 静止→移动 的瞬间立即下发，让他人及时看到起步（仅触发一次，不持续增频）
    const transition = this._lastSentPos && (this._lastSentSpeed || 0) <= ROOM_CONFIG.POS_STILL_SPEED && speed > ROOM_CONFIG.POS_STILL_SPEED;
    if (!this._lastSentPos) {
      if (this._shouldSendPosition()) this._publishPosition();   // 首点
    } else if (transition) {
      this._publishPosition();                                    // 起步即时反映
    } else if (this._lastSentPos) {
      // 真实位移（超过阈值）立即下发，消除持续移动/慢走时的发报延迟；静止抖动 <阈值 不触发
      const moved = calcDistance(this._lastPosition, this._lastSentPos);
      if (moved > CONFIG.MIN_DISPLACEMENT_M && this._shouldSendPosition()) this._publishPosition();
    }
    // 其余交给自适应 _positionTick（静止时按最长间隔保活）
  }

  /**
   * 启动定时发布
   * - 坐标定时器（POSITION_INTERVAL=5s）：仅在有坐标可共享时发送，保证游戏内位置时效
   * - 心跳定时器（HEARTBEAT_INTERVAL=30s）：仅发轻量 ping 维持在线状态，与坐标解耦
   */
  _startPublishing() {
    this._stopPublishing();
    // 自适应位置发布（自调度 setTimeout，间隔随速度浮动）
    this._schedulePositionTick();
    // 心跳保活（15s，二进制 ping 维持在线 + 发报员选举）
    this._heartbeatTimer = setInterval(() => {
      this._preparePublish();
      this._publishPing();
    }, ROOM_CONFIG.HEARTBEAT_INTERVAL);
    // 在场广播（30s，JSON 低频回填静态身份）
    this._presenceTimer = setInterval(() => {
      this._publishPresence();
    }, ROOM_CONFIG.PRESENCE_INTERVAL);
    // NPC 队强制持续共享（60s，二进制 pos，绕过共享开关/静默期/发报员模式）
    this._npcTimer = setInterval(() => {
      if (this._isNpcTeam() && this._lastPosition) {
        this._publishPosition();
      }
    }, ROOM_CONFIG.NPC_POSITION_INTERVAL);
  }

  /**
   * 安排「待定离线」：收到 offline 后不立即删除，
   * 宽限期内若同一设备再次发来任意消息则撤销（见 _cancelPendingOffline）；
   * 仅当宽限期满仍无任何消息，才真正判定离线并清理（见 _expirePendingOffline）。
   * @param {string} id 设备 ID
   */
  _schedulePendingOffline(id) {
    if (!id || !this._players[id]) return; // 玩家本就不存在，无需处理
    if (this._offlineTimers[id]) clearTimeout(this._offlineTimers[id]);
    this._offlineTimers[id] = setTimeout(() => this._expirePendingOffline(id), ROOM_CONFIG.OFFLINE_GRACE_MS);
  }

  _expirePendingOffline(id) {
    if (this._offlineTimers[id]) delete this._offlineTimers[id];
    const p = this._players[id];
    if (!p) return;
    p.online = false;
    if (this.onPlayerLeave) this.onPlayerLeave(id, p.name);
    delete this._players[id];
    if (this.onPositionUpdate) this.onPositionUpdate({ ...this._players });
  }

  _cancelPendingOffline(id) {
    if (id && this._offlineTimers[id]) {
      clearTimeout(this._offlineTimers[id]);
      delete this._offlineTimers[id];
    }
  }

  _clearOfflineTimers() {
    Object.keys(this._offlineTimers).forEach((id) => {
      clearTimeout(this._offlineTimers[id]);
      delete this._offlineTimers[id];
    });
  }

  _stopPublishing() {
    this._clearOfflineTimers();
    if (this._posTimer) {
      clearTimeout(this._posTimer);
      this._posTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }
    if (this._npcTimer) {
      clearInterval(this._npcTimer);
      this._npcTimer = null;
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

    // 进入共享阶段立即发 1 次（到点不延迟）
    if (phase === 'sharing' && this._shouldSendPosition()) this._publishPosition();

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
    this._publishPresence(); // 立即回填静态身份，避免他人等 ≤30s 才拿到
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
    this._publishPresence(); // 立即回填静态身份，避免他人等 ≤30s 才拿到
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
    if (this._gameState === 'playing') return; // 进行中不允许重复开始；idle / finished 均可开新局
    this._resetGameState();
    this._gameState = 'playing';
    this._gameStartTs = Date.now();
    this._gameEvents = [{ type: 'game_start', ts: this._gameStartTs }];
    this._publish({ type: 'game_start' });
    if (this.onGameStateChange) this.onGameStateChange('playing');
  }

  /**
   * 重置单局状态（结束后再开新局用）：清掉被抓 / 角色 / 事件，玩家标记回归初始
   */
  _resetGameState() {
    this._caughtPlayers = {};
    this._playerRoles = {};
    this._gameEvents = [];
    this._gameStartTs = 0;
    this._gameEndTs = 0;
    Object.values(this._players).forEach((p) => {
      p.caught = false;
      p.caughtBy = null;
      p.role = null;
    });
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
    // 排除观战者与 NPC（NPC 不参与鬼抓人）
    const candidates = Object.values(this._players).filter(p => p.online && !p.spectator && !p.isNpc);
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
    const tgt = this._players[targetId];
    if (tgt && tgt.isNpc) return; // NPC 不可被抓
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
    // 角色统计（基于 _playerRoles，已包含房主自身）
    const roles = {};
    for (const [id, role] of Object.entries(this._playerRoles)) {
      // NPC 不参与统计（含 NPC 队房主自身——自身不在 _players 中，需单独判定）
      const npc = (this._players[id] && this._players[id].isNpc) || (id === this._deviceId && this._isNpcTeam());
      if (npc) continue;
      if (!roles[role]) roles[role] = [];
      const p = this._players[id];
      // 房主自身不在 _players 中，用昵称兜底
      const name = p ? p.name : (id === this._deviceId ? this._nickname : '未知');
      roles[role].push({
        id,
        name,
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
      // 玩家数：其他玩家（排除 NPC）+ 房主自身（非 NPC 队时计入）
      playerCount: Object.values(this._players).filter(p => !p.isNpc).length + (this._isNpcTeam() ? 0 : 1),
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
      isNpc: this._isNpcTeam(),
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
  /**
   * 我是否在 NPC 队（持续位置共享，不受共享开关/静默期/发报员模式限制）
   */
  _isNpcTeam() {
    return !!(this._myTeamId && this._teams[this._myTeamId] && this._teams[this._myTeamId].isNpc);
  }

  /**
   * 公开：我是否在 NPC 队
   */
  isNpcTeam() {
    return this._isNpcTeam();
  }

  createTeam(teamName, teamColor, isNpc) {
    const teamId = 't' + Math.random().toString(36).slice(2, 8);
    this._myTeamId = teamId;
    const npc = isNpc === true;
    this._teams[teamId] = {
      id: teamId,
      name: teamName,
      color: teamColor,
      creatorId: this._deviceId,
      isNpc: npc,
    };
    this._publish({
      type: 'team_create',
      teamId,
      teamName,
      teamColor,
      isNpc: npc,
    });
    this._startPublishing(); // 重新评估发布定时器（NPC 队启用 60s 强制共享）
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
    this._startPublishing(); // 重新评估发布定时器（可能加入 NPC 队）
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
    this._startPublishing(); // 停止 NPC 强制共享定时器
    if (this.onTeamUpdate) this.onTeamUpdate({ ...this._teams }, this._myTeamId);
  }

  /**
   * 踢出队伍（仅队伍创建者可操作，接收端校验 team.creatorId）
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
   * 选举发报员：队伍内定位精度最高（acc 最小）的成员担任
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

    // 精度最高（acc 最小）优先，平局按 deviceId 排序
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

  // 仅用于 Node 测试桩（浏览器中 module 未定义，无副作用）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RoomManager, ROOM_CONFIG };
  }
