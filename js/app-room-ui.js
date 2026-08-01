/**
 * 圆圈地图 - 多人房间 UI 渲染
 * ============================================
 * 追加 App.prototype 方法：玩家列表、队伍、位置共享、统一开始
 * 加载顺序：app-core.js 之后
 */

/* ── 共享按钮 ───────────────────────────────────────── */

App.prototype._updateSharingBtn = function () {
  if (!this._roomSharingBtn || !this.roomManager) return;
  const sharing = this.roomManager.isSharingEnabled();
  const npc = this.roomManager.isNpcTeam();
  if (npc) {
    this._roomSharingBtn.textContent = ' NPC 持续共享中';
    this._roomSharingBtn.classList.add('sharing-off');
    this._roomSharingBtn.disabled = true;
    return;
  }
  this._roomSharingBtn.disabled = false;
  this._roomSharingBtn.textContent = sharing ? ' 共享定位' : ' 定位已关闭';
  this._roomSharingBtn.classList.toggle('sharing-off', !sharing);
};

/* ── 队伍管理 UI ────────────────────────────────────── */

App.prototype._updateTeamPresetActive = function (color) {
  if (!this._roomTeamPresets) return;
  const norm = (color || '').toUpperCase();
  this._roomTeamPresets.querySelectorAll('.room-team-preset').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.color || '').toUpperCase() === norm);
  });
};

App.prototype._roomCreateTeam = function () {
  if (!this.roomManager || !this.roomManager.isConnected()) return;
  const name = (this._roomTeamNameInput.value || '').trim() || '我的队伍';
  const color = this._roomTeamSelectedColor;
  const isNpc = this._roomTeamNpcCheckbox ? this._roomTeamNpcCheckbox.checked : false;
  try {
    this.roomManager.createTeam(name, color, isNpc);
    this._roomTeamNameInput.value = '';
    if (this._roomTeamNpcCheckbox) this._roomTeamNpcCheckbox.checked = false;
    this._roomTeamCreateForm.classList.add('hidden');
    this._updateTeamUI();
    this._updateRoomPlayerList();
    this._updateSharingBtn();
    Toast.show(isNpc ? ` 已创建 NPC 队（持续共享）：${name}` : ` 已创建队伍：${name}`);
  } catch (e) {
    Toast.show(' 创建队伍失败');
  }
};

App.prototype._roomJoinTeam = function (teamId) {
  if (!this.roomManager) return;
  const myTeamId = this.roomManager.getMyTeamId();
  if (myTeamId) {
    Toast.show(' 请先离开当前队伍');
    return;
  }
  this.roomManager.joinTeam(teamId);
  this._updateTeamUI();
  this._updateRoomPlayerList();
  Toast.show(' 已加入队伍');
};

App.prototype._roomLeaveTeam = function (teamId) {
  if (!this.roomManager) return;
  this.roomManager.leaveTeam(teamId);
  this._updateTeamUI();
  this._updateRoomPlayerList();
  Toast.show(' 已离开队伍');
};

App.prototype._updateTeamUI = function () {
  if (!this._roomTeamList || !this.roomManager) return;
  const teams = this.roomManager.getTeams();
  const myTeamId = this.roomManager.getMyTeamId();
  const myInfo = this.roomManager.getMyInfo();

  if (!Object.keys(teams).length) {
    this._roomTeamList.innerHTML = '<div class="room-team-empty">暂无队伍，点击上方创建</div>';
    return;
  }

  let html = '';
  const broadcasterId = this.roomManager.getTeamBroadcasterId();
  Object.values(teams).forEach((team) => {
    const members = this.roomManager.getTeamMembers(team.id);
    const isMyTeam = team.id === myTeamId;
    const isCreator = team.creatorId === myInfo.id;
    const isSharing = broadcasterId && members.some(m => m.id === broadcasterId);
    let actionBtn = '';
    if (isMyTeam) {
      actionBtn = `<button class="room-btn mini danger" data-team-id="${team.id}" data-action="leave">离开</button>`;
    } else if (!myTeamId) {
      actionBtn = `<button class="room-btn mini primary" data-team-id="${team.id}" data-action="join">加入</button>`;
    }

    const teamColor = this._sanitizeColor(team.color);
    const teamDot = isMyTeam
      ? `<span class="room-team-dot" style="background:${teamColor}"></span>`
      : `<svg class="room-team-dot-radar" viewBox="0 0 24 24" width="14" height="14">
          <circle cx="12" cy="12" r="11" fill="none" stroke="${teamColor}" stroke-opacity="0.6" stroke-width="2"/>
          <circle cx="12" cy="12" r="8" fill="none" stroke="${teamColor}" stroke-opacity="0.35" stroke-width="1.2"/>
          <circle cx="12" cy="12" r="5" fill="none" stroke="${teamColor}" stroke-opacity="0.2" stroke-width="1"/>
          <circle cx="12" cy="12" r="3" fill="${teamColor}" fill-opacity="0.9"/>
        </svg>`;
    const firstChar = (team.name || '?').trim().charAt(0) || '?';
    const shareBadge = isSharing
      ? `<span class="room-team-share" style="--tc:${teamColor}" title="位置共享中">${this._escapeHtml(firstChar)}</span>`
      : '';

    html += `<div class="room-team-card${isSharing ? ' is-sharing' : ''}">
      <div class="room-team-card-header">
        ${teamDot}
        <span class="room-team-name">${this._escapeHtml(team.name)}</span>
        ${shareBadge}
        <span class="room-team-meta">${members.length}人${isCreator ? ' · 队长' : ''}</span>
        <div class="room-team-actions">${actionBtn}</div>
      </div>
      <div class="room-team-members">
        ${members.map(m => `<span class="room-team-member">${this._escapeHtml(m.name)}</span>`).join('')}
      </div>
    </div>`;
  });
  this._roomTeamList.innerHTML = html;

  this._roomTeamList.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const teamId = btn.dataset.teamId;
      if (btn.dataset.action === 'join') this._roomJoinTeam(teamId);
      else if (btn.dataset.action === 'leave') this._roomLeaveTeam(teamId);
    });
  });
};

/* ── 绑定 RoomManager 事件回调 ──────────────────────── */

App.prototype._bindRoomEvents = function () {
  if (!this.roomManager) return;

  this.roomManager.onPositionUpdate = (players, changedIds) => {
    this._updateRoomPlayerList();
    const myInfo = this.roomManager.getMyInfo();
    const now = Date.now();
    const POSITION_STALE_MS = 30000;

    if (changedIds && changedIds.size > 0) {
      for (const id of changedIds) {
        const p = players[id];
        if (!p || p.id === myInfo.id || !p.online || p.spectator) {
          this.mapManager.removePlayerMarker(id);
          this.mapManager.removePlayerPrediction(id);
        } else {
          this._renderPlayerMarker(p, myInfo, now, POSITION_STALE_MS);
        }
      }
    } else {
      this.mapManager.clearPlayerMarkers();
      this.mapManager.clearPlayerPredictions();
      Object.values(players).forEach((p) => {
        if (p.id !== myInfo.id && p.online && !p.spectator) {
          this._renderPlayerMarker(p, myInfo, now, POSITION_STALE_MS);
        }
      });
    }
  };

  this.roomManager.onTeamUpdate = (teams, myTeamId) => {
    this._updateTeamUI();
    this._updateRoomPlayerList();
    if (this.roomManager) {
      const myInfo = this.roomManager.getMyInfo();
      const players = this.roomManager.getPlayers();
      const now = Date.now();
      const POSITION_STALE_MS = 30000;
      this.mapManager.clearPlayerMarkers();
      this.mapManager.clearPlayerPredictions();
      Object.values(players).forEach((p) => {
        if (p.id !== myInfo.id && p.online && !p.spectator) {
          this._renderPlayerMarker(p, myInfo, now, POSITION_STALE_MS);
        }
      });
    }
  };

  this.roomManager.onConnectionChange = (connected) => {
    if (this._roomConnDot) {
      this._roomConnDot.classList.toggle('online', connected);
    }
    if (connected) this._updateSharingBtn();
  };

  this.roomManager.onRoomError = (msg) => {
    Toast.show(' ' + msg);
  };

  this.roomManager.onBurstPhaseChange = (phase, phaseEnd) => {
    if (this._burstPhaseInterval) {
      clearInterval(this._burstPhaseInterval);
      this._burstPhaseInterval = null;
    }
    if (!this._roomBurstPhase) return;
    if (!phase) {
      this._roomBurstPhase.textContent = '未激活';
      return;
    }
    // 统一开始 / 手动开启时同步开关状态，避免 UI 漂移
    if (this._roomBurstEnable) this._roomBurstEnable.checked = true;
    this._burstPhase = phase;
    this._burstPhaseEnd = phaseEnd;
    const updatePhase = () => {
      const rem = Math.max(0, this._burstPhaseEnd - Date.now());
      const m = Math.floor(rem / 60000);
      const s = Math.floor((rem % 60000) / 1000);
      const t = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      this._roomBurstPhase.textContent = this._burstPhase === 'silent' ? ` 静默中 ${t}` : ` 共享中 ${t}`;
    };
    updatePhase();
    this._burstPhaseInterval = setInterval(updatePhase, 1000);
  };

  this.roomManager.onGameTimerUpdate = (startAt) => {
    if (!this._roomTimerSection) return;
    this._roomTimerSection.classList.add('visible');
    if (this._roomTimerInput) {
      const d = new Date(startAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      this._roomTimerInput.value = `${hh}:${mm}`;
    }
    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => this._updateTimerCountdown(), 1000);
    this._updateTimerCountdown();
  };

  this.roomManager.onGameTimerAborted = () => {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    if (this._roomTimerInput) this._roomTimerInput.value = '';
    this._roomTimerValue.textContent = '--:--';
    this._roomTimerCountdown.classList.add('hidden');
    this._roomTimerSetFrm.classList.remove('hidden');
    this._roomTimerAbortBtn.classList.add('hidden');
  };

  this.roomManager.onCircleSync = (circles) => {
    this.mapManager.setRemoteCircles(circles);
  };
  this.roomManager.onRequestCircles = () => {
    this.mapManager.getCircles().forEach((c) => this.roomManager.publishCircle('add', c));
  };
};

/* ── 渲染玩家标记 ───────────────────────────────────── */

App.prototype._renderPlayerMarker = function (p, myInfo, now, staleMs) {
  if (!this.roomManager) return;
  const teams = this.roomManager.getTeams();
  const broadcasterId = this.roomManager.getTeamBroadcasterId();
  const myTeamId = this.roomManager.getMyTeamId();

  if (p.teamId && p.teamId === myTeamId && p.id !== broadcasterId && !p.teamSeparation) return;
  const stale = p.lastPosUpdate && (now - p.lastPosUpdate > staleMs);
  const color = p.teamId && teams[p.teamId] ? teams[p.teamId].color : p.color;
  let opacity = stale ? 0.3 : p.teamSeparation ? 0.5 : 1;
  const teamLabel = (p.teamId && teams[p.teamId]) ? (teams[p.teamId].name || '').trim().charAt(0) || '' : '';
  this.mapManager.updatePlayerMarker(p.id, p.lat, p.lng, p.name, color, opacity, p.acc, teamLabel);
  if (!stale && p.lat != null && p.lng != null && p.bearing != null) {
    this.mapManager.setPlayerPrediction(p.id, p.lat, p.lng, p.bearing, p.speed || 0, p.acc || 0);
  }
};

/* ── 显示房间码 ─────────────────────────────────────── */

App.prototype._showRoomCode = function (code) {
  if (this._roomCodeDisplay) this._roomCodeDisplay.classList.remove('hidden');
  if (this._roomCodeValue) {
    this._roomCodeValue.textContent = code;
    this._roomCodeValue.title = '点击复制房间码';
  }
  if (this._roomStatus) this._roomStatus.classList.remove('hidden');
  if (this._roomTeamsSection) this._roomTeamsSection.classList.remove('hidden');
  this._updateSharingBtn();
  if (this.roomManager && this._roomJoined) {
    this.mapManager.getCircles().forEach((c) => this.roomManager.publishCircle('add', c));
  }
};

/* ── 更新参与者列表 ─────────────────────────────────── */

App.prototype._updateRoomPlayerList = function () {
  if (!this._roomPlayerList || !this.roomManager) return;
  const players = this.roomManager.getPlayers();
  const teams = this.roomManager.getTeams();
  const myInfo = this.roomManager.getMyInfo();
  const mySharing = this.roomManager.isSharingEnabled();
  const myTeamId = this.roomManager.getMyTeamId();
  const count = Object.values(players).filter(p => p.online).length + (this.roomManager.isConnected() ? 1 : 0);
  if (this._roomPlayerCount) this._roomPlayerCount.textContent = String(count);

  const broadcasterId = this.roomManager.getTeamBroadcasterId();
  const amBroadcaster = this.roomManager.isTeamBroadcaster();
  const amSeparated = this.roomManager.isTeamSeparated();

  const grouped = {};
  const ungrouped = [];
  const myself = {
    id: myInfo.id,
    name: this._escapeHtml(myInfo.name) + ' (我)',
    color: myInfo.color,
    teamId: myTeamId,
    spectator: this.roomManager.isSpectator(),
    isNpc: this.roomManager.isNpcTeam(),
    statusText: this.roomManager.isSpectator() ? '观战中' : (mySharing ? '在线' : '定位关闭'),
    statusClass: this.roomManager.isSpectator() ? 'spectator' : (mySharing ? 'online' : 'sharing-off'),
    isSelf: true,
    isBroadcaster: amBroadcaster,
    teamSeparation: amSeparated,
  };
  const POSITION_STALE_MS = 30000;
  Object.values(players).forEach((p) => {
    if (p.id === myInfo.id) return;
    const stale = p.lastPosUpdate && (Date.now() - p.lastPosUpdate > POSITION_STALE_MS);
    let statusText = '离线';
    let statusClass = '';
    if (p.spectator) {
      statusText = '观战中';
      statusClass = 'spectator';
    } else if (p.online) {
      if (p.sharing === false) {
        statusText = '定位关闭';
        statusClass = 'sharing-off';
      } else if (stale) {
        statusText = '位置过期';
        statusClass = 'stale';
      } else {
        statusText = '在线';
        statusClass = 'online';
      }
    }
    const entry = {
      id: p.id,
      name: this._escapeHtml(p.name),
      color: p.teamId && teams[p.teamId] ? teams[p.teamId].color : p.color,
      teamId: p.teamId,
      statusText,
      statusClass,
      isSelf: false,
      isBroadcaster: p.teamBroadcaster === true,
      teamSeparation: p.teamSeparation === true,
      spectator: p.spectator === true,
    };
    if (p.teamId && teams[p.teamId]) {
      if (!grouped[p.teamId]) grouped[p.teamId] = [];
      grouped[p.teamId].push(entry);
    } else {
      ungrouped.push(entry);
    }
  });

  let html = '';

  if (myTeamId && teams[myTeamId]) {
    const team = teams[myTeamId];
    html += `<div class="room-player-group">
      <div class="room-player-group-label" style="color:${team.color}">
        <span class="room-team-dot" style="background:${this._sanitizeColor(team.color)}"></span>
        ${this._escapeHtml(team.name)} (<span class="room-player-group-count">${1 + (grouped[myTeamId] ? grouped[myTeamId].length : 0)} 人</span>)
      </div>
      <div class="room-player-item">
        <span class="room-player-dot" style="background:${this._sanitizeColor(myself.color)}"></span>
        <span class="room-player-name self">${this._escapeHtml(myself.name)}</span>
        <span class="room-player-status ${myself.statusClass}">${this._getPlayerTagsHtml(myself)}${myself.statusText}</span>
      </div>`;
    if (grouped[myTeamId]) {
      grouped[myTeamId].forEach(p => {
        html += `<div class="room-player-item">
          <span class="room-player-dot" style="background:${this._sanitizeColor(p.color)}"></span>
          <span class="room-player-name">${this._escapeHtml(p.name)}</span>
          <span class="room-player-status ${p.statusClass}">${this._getPlayerTagsHtml(p)}${p.statusText}</span>
        </div>`;
      });
    }
    html += `</div>`;
    delete grouped[myTeamId];
  } else {
    ungrouped.unshift(myself);
  }

  Object.entries(grouped).forEach(([teamId, members]) => {
    const team = teams[teamId];
    if (!team) return;
    html += `<div class="room-player-group">
      <div class="room-player-group-label" style="color:${team.color}">
        <span class="room-team-dot" style="background:${this._sanitizeColor(team.color)}"></span>
        ${this._escapeHtml(team.name)} (<span class="room-player-group-count">${members.length} 人</span>)
      </div>`;
    members.forEach(p => {
      html += `<div class="room-player-item">
        <span class="room-player-dot" style="background:${this._sanitizeColor(p.color)}"></span>
        <span class="room-player-name">${this._escapeHtml(p.name)}</span>
        <span class="room-player-status ${p.statusClass}">${this._getPlayerTagsHtml(p)}${p.statusText}</span>
      </div>`;
    });
    html += `</div>`;
  });

  if (ungrouped.length > 0) {
    html += `<div class="room-player-group">
      <div class="room-player-group-label room-player-group-label-none"> 无队伍（<span class="room-player-group-count">${ungrouped.length} 人</span>）</div>`;
    ungrouped.forEach(p => {
      html += `<div class="room-player-item">
        <span class="room-player-dot" style="background:${this._sanitizeColor(p.color)}"></span>
        <span class="room-player-name${p.isSelf ? ' self' : ''}">${this._escapeHtml(p.name)}</span>
        <span class="room-player-status ${p.statusClass}">${this._getPlayerTagsHtml(p)}${p.statusText}</span>
      </div>`;
    });
    html += `</div>`;
  }

  if (Object.keys(players).length === 0 && this.roomManager.isConnected()) {
    html = `<div class="room-empty">等待队友加入...</div>`;
  }
  this._roomPlayerList.innerHTML = html;
};

/* ── 玩家标签 HTML ──────────────────────────────────── */

App.prototype._getPlayerTagsHtml = function (p) {
  let tags = '';
  if (p.isNpc) {
    tags += '<span class="player-tag tag-npc"> NPC</span> ';
  } else if (p.spectator) {
    tags += '<span class="player-tag tag-spectator"> 观战</span> ';
  }
  if (p.isBroadcaster) {
    tags += '<span class="player-tag tag-broadcaster"> 发报中</span> ';
  }
  if (p.teamSeparation) {
    tags += '<span class="player-tag tag-separated">已分离 </span> ';
  }
  return tags;
};

/* ── 清理房间 UI ────────────────────────────────────── */

App.prototype._roomCleanup = function () {
  this._roomJoined = false;
  if (this._roomCodeDisplay) this._roomCodeDisplay.classList.add('hidden');
  if (this._roomStatus) this._roomStatus.classList.add('hidden');
  if (this._roomTeamsSection) this._roomTeamsSection.classList.add('hidden');
  if (this._roomTeamCreateForm) this._roomTeamCreateForm.classList.add('hidden');
  if (this._roomFormCreate) this._roomFormCreate.classList.remove('hidden');
  if (this._roomFormJoin) this._roomFormJoin.classList.remove('hidden');
  if (this._roomPlayerCount) this._roomPlayerCount.textContent = '0';
  if (this._roomPlayerList) this._roomPlayerList.innerHTML = '<div class="room-empty">尚未加入房间</div>';
  if (this._roomConnDot) this._roomConnDot.classList.remove('online');
  if (this._roomCodeValue) this._roomCodeValue.textContent = '------';
  if (this._roomSharingBtn) {
    this._roomSharingBtn.textContent = ' 共享定位';
    this._roomSharingBtn.classList.remove('sharing-off');
  }
  if (this._roomTimerSection) this._roomTimerSection.classList.remove('visible');
  if (this._roomBurstSection) this._roomBurstSection.classList.remove('visible');
  if (this._roomPredictionSection) this._roomPredictionSection.classList.remove('visible');
  if (this._roomTimerCountdown) this._roomTimerCountdown.classList.add('hidden');
  if (this._roomTimerSetFrm) this._roomTimerSetFrm.classList.remove('hidden');
  if (this._roomTimerAbortBtn) this._roomTimerAbortBtn.classList.add('hidden');
  if (this._roomTimerValue) this._roomTimerValue.textContent = '--:--';
  if (this._roomBurstPhase) this._roomBurstPhase.textContent = '未激活';
  if (this._timerInterval) {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }
  if (this._burstPhaseInterval) {
    clearInterval(this._burstPhaseInterval);
    this._burstPhaseInterval = null;
  }
};

/* ── 显示扩展模块 ───────────────────────────────────── */

App.prototype._showRoomExtras = function () {
  if (this._roomTimerSection) this._roomTimerSection.classList.add('visible');
  if (this._roomBurstSection) this._roomBurstSection.classList.add('visible');
  if (this._roomPredictionSection) this._roomPredictionSection.classList.add('visible');
};

/* ── 统一开始倒计时 ─────────────────────────────────── */

App.prototype._roomSetTimer = function () {
  if (!this.roomManager || !this._roomTimerInput) return;
  const val = this._roomTimerInput.value;
  if (!val) { Toast.show(' 请选择时间'); return; }
  const [h, m] = val.split(':').map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const startAt = target.getTime();
  this.roomManager.setGameTimer(startAt);
  this._roomTimerSetFrm.classList.add('hidden');
  this._roomTimerAbortBtn.classList.remove('hidden');
  Toast.show(` 统一开始时间已设为 ${val}`);
};

App.prototype._roomAbortTimer = function () {
  if (!this.roomManager) return;
  this.roomManager.abortGameTimer();
  this._roomTimerSetFrm.classList.remove('hidden');
  this._roomTimerCountdown.classList.add('hidden');
  this._roomTimerAbortBtn.classList.add('hidden');
  this._roomTimerValue.textContent = '--:--';
  Toast.show(' 已取消游戏倒计时');
};

App.prototype._updateTimerCountdown = function () {
  if (!this.roomManager) return;
  const startAt = this.roomManager.getGameStartAt();
  if (!startAt) {
    this._roomTimerCountdown.classList.add('hidden');
    this._roomTimerSetFrm.classList.remove('hidden');
    return;
  }
  const remaining = Math.max(0, startAt - Date.now());
  if (remaining <= 0) {
    this._roomTimerValue.textContent = '00:00';
    this._roomTimerCountdown.classList.remove('hidden');
    this._roomTimerSetFrm.classList.add('hidden');
    Toast.show(' 统一开始！');
    if (this.roomManager.isHost()) {
      const silent = parseInt(this._roomBurstSilent.value) || 25;
      const share = parseInt(this._roomBurstShare.value) || 5;
      this.roomManager.burstStart(silent, share); // 广播 → 全员同步开启共享+爆发
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  this._roomTimerValue.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  this._roomTimerCountdown.classList.remove('hidden');
  this._roomTimerSetFrm.classList.add('hidden');
  this._roomTimerAbortBtn.classList.remove('hidden');
};

/* ── 位置共享 ───────────────────────────────────────── */

App.prototype._roomToggleBurst = function () {
  if (!this.roomManager) return;
  if (this._roomBurstEnable.checked) {
    const silent = parseInt(this._roomBurstSilent.value) || 25;
    const share = parseInt(this._roomBurstShare.value) || 5;
    if (silent < 1 || share < 1) {
      Toast.show(' 静默和共享时长必须 ≥ 1 分钟');
      this._roomBurstEnable.checked = false;
      return;
    }
    this.roomManager.startBurstCycle(silent, share);
    Toast.show(` 位置共享已开启：静默 ${silent} 分 / 共享 ${share} 分`);
  } else {
    this.roomManager.stopBurstCycle();
    this._roomBurstPhase.textContent = '未激活';
    if (this._burstPhaseInterval) {
      clearInterval(this._burstPhaseInterval);
      this._burstPhaseInterval = null;
    }
    Toast.show(' 位置共享已关闭');
  }
};

App.prototype._roomTogglePrediction = function () {
  const enabled = this._roomPredictionEnable.checked;
  CONFIG.ENABLE_PREDICTION = enabled;
  localStorage.setItem('circlemap_prediction', enabled ? '1' : '0');
  if (!enabled) {
    this.mapManager.clearPlayerPredictions();
  } else {
    this.mapManager._scheduleRedraw();
  }
  Toast.show(enabled ? ' 路径预测已开启' : ' 路径预测已关闭');
};

/* ── 工具函数 ───────────────────────────────────────── */

App.prototype._sanitizeColor = function (c) {
  if (typeof c !== 'string') return '#888';
  const s = c.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(s)) return s;
  return '#888';
};
