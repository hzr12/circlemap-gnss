/**
 * 圆圈地图 - 主应用控制器
 * ============================================
 * 协调 MapManager、GPSManager 与 UI 交互
 * 是所有模块的入口
 */

class App {
  constructor() {
    this.mapManager = new MapManager();
    this.gpsManager = new GPSManager();
    this.circleRadius = CONFIG.DEFAULT_RADIUS;
    this.center = null;          // 当前标记位置
    this.myPosition = null;      // 我的位置（GCJ-02，由 GPS 定位设置）
    this.myPositionTime = null;  // 上次定位成功时间戳（毫秒）
    this.mode = 'click';
    this._circleListEl = null;   // 圆列表 DOM
    this._statusEl = null;       // GPS 状态条
    this._isWatching = false;    // 持续追踪开关
    this._prevDistances = {};    // circleId → 上次距离（米），用于趋势判断
    this._firstFix = true;       // 是否是首次定位
    this._relocating = false;    // 是否正在自动重定位
    this._lastRelocateAttempt = 0; // 上次自动重定位时间戳
    this._lastRawPos = null;     // 上次原始 WGS84 坐标，用于移动距离判断
    this._panelCollapsed = window.innerWidth <= 480; // 移动端面板默认收起
    this._watchingBeforeHide = false; // 切后台前是否在追踪
    this._restoringView = false;      // 从后台恢复时不飞地图
  }

  /**
   * 应用入口
   */
  init() {
    // 初始化地图
    this.mapManager.init('map', CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);

    // 注册中心点变化回调（含选中圆圈回调）
    this.mapManager.onCenterChange = (center, circle) => this._onCenterChanged(center, circle);

    // 初始化 UI
    this._setupUI();

    // 移动端面板默认收起
    if (this._panelCollapsed) {
      document.getElementById('bottomPanel').classList.add('collapsed');
    }

    // 读取 URL 参数
    this._checkUrlParams();

    // 从 localStorage 恢复数据
    this._loadState();

    // 进入页面后自动启动持续 GPS 追踪
    this._startWatching();

    // 页面可见性变化：后台停 GPS，前台恢复
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this._isWatching) {
          this._watchingBeforeHide = true;
          this._stopWatching();
        }
      } else if (this._watchingBeforeHide) {
        this._watchingBeforeHide = false;
        this._restoringView = true;
        this._startWatching();
      }
    });

    // 每分钟刷新状态 & 持久化 & 自动重定位
    setInterval(() => {
      if (this.myPosition) {
        this._updateStatusBar();
        this._updateInfo();
        this._updateCircleList();
        // 定位已过期且未在持续追踪 → 自动尝试重定位一次
        if (this._isPositionStale() && !this._isWatching) {
          this._autoRelocate();
        }
      }
      this._saveState();
    }, 60 * 1000);

    console.log('[App] 初始化完成');
  }

  /* ============= UI 事件绑定 ============= */

  _setupUI() {
    // —— 模式切换 ——
    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._setMode(btn.dataset.mode));
    });

    // —— 坐标输入 ——
    const latInput = document.getElementById('lat');
    const lngInput = document.getElementById('lng');

    // 防抖处理输入变化
    let inputTimer;
    const handleCoordInput = () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => this._onCoordInput(), 400);
    };

    latInput.addEventListener('input', handleCoordInput);
    lngInput.addEventListener('input', handleCoordInput);

    // —— 智能粘贴：自动解析多种坐标格式 ——
    const handlePaste = (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const parsed = this._parseCoordText(text);
      if (!parsed) return;
      e.preventDefault();
      latInput.value = parsed.lat.toFixed(6);
      lngInput.value = parsed.lng.toFixed(6);
      this._onCoordInput();
      this._showToast('✅ 已识别坐标');
    };
    latInput.addEventListener('paste', handlePaste);
    lngInput.addEventListener('paste', handlePaste);

    // —— 智能解析输入框：粘贴/输入自动读取 ——
    const parseInput = document.getElementById('parse-input');
    let parseTimer;
    parseInput.addEventListener('input', () => {
      clearTimeout(parseTimer);
      parseTimer = setTimeout(() => {
        const text = parseInput.value.trim();
        if (!text) return;
        const parsed = this._parseCoordText(text);
        if (!parsed) return;
        latInput.value = parsed.lat.toFixed(6);
        lngInput.value = parsed.lng.toFixed(6);
        this._onCoordInput();
        this._showToast('✅ 已识别坐标');
      }, 300);
    });
    // 回车直接解析
    parseInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(parseTimer);
        const text = parseInput.value.trim();
        if (!text) return;
        const parsed = this._parseCoordText(text);
        if (!parsed) return;
        latInput.value = parsed.lat.toFixed(6);
        lngInput.value = parsed.lng.toFixed(6);
        this._onCoordInput();
        this._showToast('✅ 已识别坐标');
      }
    });

    // —— 半径滑块 & 数字输入双向绑定 ——
    const radiusSlider = document.getElementById('radius-slider');
    const radiusInput = document.getElementById('radius-input');

    radiusSlider.addEventListener('input', () => {
      const val = parseInt(radiusSlider.value, 10);
      radiusInput.value = val;
      this.circleRadius = val;
      // 若有选中圆，实时更新其半径
      const sel = this.mapManager.getSelectedCircle();
      if (sel) {
        this.mapManager.updateCircleRadius(sel.id, val);
        this._updateInfo();
        this._updateCircleList();
      }
    });

    radiusInput.addEventListener('change', () => {
      let val = parseInt(radiusInput.value, 10);
      if (isNaN(val) || val < CONFIG.MIN_RADIUS) val = CONFIG.MIN_RADIUS;
      if (val > CONFIG.MAX_RADIUS) val = CONFIG.MAX_RADIUS;
      radiusInput.value = val;
      radiusSlider.value = val;
      this.circleRadius = val;
      // 若有选中圆，更新其半径
      const sel = this.mapManager.getSelectedCircle();
      if (sel) {
        this.mapManager.updateCircleRadius(sel.id, val);
        this._updateCircleList();
        this._updateInfo();
      }
    });

    // —— 绘制按钮 ——
    document.getElementById('draw-btn').addEventListener('click', () => this._drawCircle());

    // —— 清除按钮 ——
    document.getElementById('clear-btn').addEventListener('click', () => this._clearAll());

    // —— GPS 状态条缓存 ——
    this._statusEl = document.getElementById('gps-status');

    // —— GPS 按钮：短按单次定位，长按切换持续追踪 ——
    const gpsBtn = document.getElementById('gps-btn');
    let pressTimer = null;
    let isLongPress = false;
    gpsBtn.addEventListener('pointerdown', () => {
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        this._toggleGps();
        pressTimer = null;
      }, 600);
    });
    gpsBtn.addEventListener('pointerup', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (!isLongPress) this._locateMe();
    });
    gpsBtn.addEventListener('pointerleave', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });

    // —— 底部面板折叠切换 ——
    const panel = document.getElementById('bottomPanel');
    document.querySelector('.panel-handle').addEventListener('click', () => {
      this._panelCollapsed = !this._panelCollapsed;
      panel.classList.toggle('collapsed', this._panelCollapsed);
    });

    // —— 圆列表事件委托（选中/编辑/删除） ——
    this._circleListEl = document.getElementById('circle-list');
    this._circleListEl.addEventListener('click', (e) => {
      const item = e.target.closest('.circle-item');
      const editBtn = e.target.closest('.circle-edit');
      const delBtn = e.target.closest('.circle-del');
      if (!item) return;
      const id = parseInt(item.dataset.id);
      if (editBtn) {
        this._editCircle(id);
      } else if (delBtn) {
        this._deleteCircle(id);
      } else {
        this._selectCircle(id);
      }
    });

    // —— 点击坐标复制 ——
    document.getElementById('info-center').addEventListener('click', function () {
      const text = this.textContent;
      if (!text || text === '--') return;
      navigator.clipboard.writeText(text).then(() => {
        const app = window.app;
        if (app) app._showToast('✅ 已复制坐标');
      }).catch(() => {
        // clipboard API 可能被拒绝，降级
      });
    });
  }

  /* ============= 核心交互方法 ============= */

  /**
   * 切换选择模式
   * @param {'click'|'input'} mode
   */
  _setMode(mode) {
    this.mode = mode;
    this.mapManager.setMode(mode);

    // 切换标签状态
    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // 显示/隐藏输入区
    const inputGroup = document.getElementById('inputGroup');
    inputGroup.classList.toggle('visible', mode === 'input');

    // 显示/隐藏点击提示
    const clickHint = document.getElementById('clickHint');
    clickHint.classList.toggle('hidden', mode === 'input');
  }

  /**
   * 中心点变更 / 圆圈选中的回调
   * @param {{lat:number,lng:number}} center
   * @param {object} [circle] - 选中的圆圈对象
   */
  _onCenterChanged(center, circle) {
    this.center = center;

    // 同步到输入框
    document.getElementById('lat').value = center.lat.toFixed(6);
    document.getElementById('lng').value = center.lng.toFixed(6);

    if (circle) {
      // 通过点击圆心选中 → 更新半径滑块和信息面板
      document.getElementById('radius-slider').value = circle.maxRadius;
      document.getElementById('radius-input').value = circle.maxRadius;
      this.circleRadius = circle.maxRadius;
    }
    this._updateInfo();
    this._updateCircleList();
  }

  /**
   * 智能解析粘贴文本中的经纬度
   * 支持格式：
   *   "23.1291, 113.2644"         → 逗号分隔
   *   "23.1291 113.2644"           → 空格分隔
   *   "lat 23.1291 lng 113.2644"   → 带标签
   *   "纬度:23.1291 经度:113.2644" → 中文标签
   *   "39.9°N 116.4°E"             → 度分秒简写
   * @param {string} text
   * @returns {{lat:number,lng:number}|null}
   */
  _parseCoordText(text) {
    if (!text) return null;
    // 提取所有数字（含负号和小数点）
    const nums = text.match(/-?\d+\.?\d*/g);
    if (!nums || nums.length < 2) return null;

    // 判断是否带 N/S/E/W 方向标识
    const hasNS = /[北北ns]/i.test(text);
    const hasEW = /[东东ew]/i.test(text);

    // 根据上下文确定 lat/lng
    if (hasNS && hasEW) {
      // 方向标识模式：找到含 N/S 的作为纬度，含 E/W 的作为经度
      const parts = text.split(/[,，\s]+/).filter(Boolean);
      let lat, lng;
      for (const p of parts) {
        const n = parseFloat(p);
        if (isNaN(n)) continue;
        if (/[北ns]/i.test(p)) lat = n;
        if (/[东ew]/i.test(p)) lng = n;
      }
      if (lat != null && lng != null) return { lat, lng };
    }

    // 检测中文/英文标签
    const hasLatLabel = /(纬度?|lat)/i.test(text);
    const hasLngLabel = /(经度?|lng|lon|long)/i.test(text);

    if (hasLatLabel || hasLngLabel) {
      const latMatch = text.match(/(?:纬度?|lat)\s*[:：=\s]*(-?\d+\.?\d*)/i);
      const lngMatch = text.match(/(?:经度?|lng|lon|long)\s*[:：=\s]*(-?\d+\.?\d*)/i);
      const lat = latMatch ? parseFloat(latMatch[1]) : NaN;
      const lng = lngMatch ? parseFloat(lngMatch[1]) : NaN;
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }

    // 默认：取前两个数字作 lat, lng
    const lat = parseFloat(nums[0]);
    const lng = parseFloat(nums[1]);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };

    return null;
  }

  /**
   * 手动输入坐标 → 仅定位，不自动绘制
   */
  _onCoordInput() {
    const lat = parseFloat(document.getElementById('lat').value);
    const lng = parseFloat(document.getElementById('lng').value);

    if (!isNaN(lat) && !isNaN(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180) {
      this.center = { lat, lng };
      this.mapManager.setCenter(this.center);
    }
  }

  /**
   * 添加一个同心圆
   */
  _drawCircle() {
    if (!this.center) {
      this._showToast('请先选择中心点（点击地图或输入坐标）');
      return;
    }
    if (this.circleRadius <= 0) {
      this._showToast('请输入有效的半径');
      return;
    }

    this.mapManager.addCircle(this.center, this.circleRadius);
    this._updateInfo();
    this._updateCircleList();
    this._updateStatusBar();
    this._saveState();
    this._showToast(`已创建同心圆，半径 ${
      this.circleRadius >= 1000
        ? (this.circleRadius / 1000).toFixed(1) + ' km'
        : this.circleRadius + ' m'
    }`);
  }

  /**
   * 切换持续追踪（长按 GPS 按钮）
   */
  _toggleGps() {
    if (this._isWatching) {
      this._stopWatching();
    } else {
      this._startWatching();
    }
  }

  /**
   * 单次定位（短按 GPS 按钮）
   * 获取一次位置并飞到该处，不开启持续追踪
   */
  async _locateMe() {
    const btn = document.getElementById('gps-btn');
    if (this._isWatching) return; // 追踪中不干扰
    if (this._relocating) return;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const pos = await this.gpsManager.getCurrentPosition();
      const convPos = this.mapManager.wgs84ToGcj02(pos);

      this.center = convPos;
      this.myPosition = convPos;
      this.myPositionTime = Date.now();

      this.mapManager.setCenter(convPos);
      this.mapManager.setLocation(convPos);
      this.mapManager.flyTo(convPos);

      document.getElementById('lat').value = convPos.lat.toFixed(6);
      document.getElementById('lng').value = convPos.lng.toFixed(6);

      this._updateStatusBar();
      this._updateCircleList();
      this._updateInfo();

      btn.classList.add('located');
      setTimeout(() => btn.classList.remove('located'), 3000);

      this._showToast(`✅ 定位成功（精度 ±${pos.accuracy.toFixed(0)} 米）`);
    } catch (err) {
      this._showToast('❌ ' + err.message);
      btn.classList.remove('located');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  /**
   * 启动持续 GPS 追踪（纯 watchPosition）
   */
  _startWatching() {
    if (this._isWatching) return;

    this._isWatching = true;
    this._firstFix = true;

    const btn = document.getElementById('gps-btn');
    btn.classList.add('watching');
    btn.title = '正在持续追踪位置';

    this.gpsManager.onPositionChange = (pos) => this._processPosition(pos);
    this.gpsManager.onError = (err) => {
      console.warn('[GPS] 追踪出错:', err.message);
      this._showToast('⚠️ GPS 追踪异常：' + err.message);
    };
    this.gpsManager.startWatching();

    this._showToast('📍 持续追踪已开启');
  }

  /**
   * 停止持续 GPS 追踪
   */
  _stopWatching() {
    if (!this._isWatching) return;
    this._isWatching = false;

    this.gpsManager.stopWatching();
    this._prevDistances = {};

    const btn = document.getElementById('gps-btn');
    btn.classList.remove('watching');
    btn.title = '定位到我的位置';

    this._showToast('⏹ 持续追踪已关闭');
  }

  /* ========== 通用位置处理 ========== */

  /**
   * 处理位置数据：GCJ-02 转换 + UI 刷新
   */
  _processPosition(pos) {
    // 跟踪原始坐标用于下次位移判断
    if (this._lastRawPos) {
      this._prevDistances = {}; // 位置变了，重置趋势缓存
    }
    this._lastRawPos = {lat: pos.lat, lng: pos.lng};

    const convPos = this.mapManager.wgs84ToGcj02(pos);

    // 保存定位信息
    this.myPosition = convPos;
    this.myPositionTime = Date.now();

    // 更新位置标记
    this.mapManager.setLocation(convPos);

    if (this._firstFix) {
      this._firstFix = false;

      if (this._restoringView) {
        // 从后台恢复：更新位置但不飞地图，不弹 toast
        this._restoringView = false;
      } else {
        // 首次定位或手动开启追踪：飞到我的位置
        this.center = convPos;
        this.mapManager.setCenter(convPos);

        // 同步到输入框
        document.getElementById('lat').value = convPos.lat.toFixed(6);
        document.getElementById('lng').value = convPos.lng.toFixed(6);

        const btn = document.getElementById('gps-btn');
        btn.classList.add('located');
        setTimeout(() => btn.classList.remove('located'), 3000);

        this._showToast(`✅ 定位成功（精度 ±${pos.accuracy.toFixed(0)} 米）`);
        console.log('[GPS] 首次定位:', pos.lat.toFixed(4), pos.lng.toFixed(4));
      }
    }

    // 刷新所有显示
    this._updateStatusBar();
    this._updateCircleList();
    this._updateInfo();
  }

  /**
   * 定位过期时的自动重定位（单次尝试，不开启追踪）
   * 由 60s 定时器触发，仅当位置过期且未在追踪时执行
   */
  async _autoRelocate() {
    // 防止并发 / 频繁重试（失败后至少等 5 分钟）
    if (this._relocating) return;
    if (Date.now() - this._lastRelocateAttempt < 5 * 60 * 1000) return;

    this._relocating = true;
    this._showToast('⏳ 定位已过期，正在重新定位...');

    try {
      const pos = await this.gpsManager.getCurrentPosition();
      const convPos = this.mapManager.wgs84ToGcj02(pos);

      this.myPosition = convPos;
      this.myPositionTime = Date.now();
      this.mapManager.setLocation(convPos);
      this._prevDistances = {}; // 重置趋势缓存

      this._updateStatusBar();
      this._updateCircleList();
      this._updateInfo();

      console.log('[AutoRelocate] 重定位成功:', pos.lat.toFixed(4), pos.lng.toFixed(4));
    } catch (err) {
      console.warn('[AutoRelocate] 重定位失败:', err.message);
      // 失败后留待下一个周期再试（依靠 _lastRelocateAttempt 控制频率）
    } finally {
      this._relocating = false;
      this._lastRelocateAttempt = Date.now();
    }
  }

  /**
   * 清除所有同心圆（保留标记位置）
   */
  _clearAll() {
    this.mapManager.clearCircles();
    document.getElementById('infoArea').classList.add('hidden');
    this._updateCircleList();
    this._updateStatusBar();
    this._saveState();
  }

  /* ============= 状态 & 信息更新 ============= */

  /** 定位过期阈值（毫秒） */
  get POSITION_STALE_MS() { return 10 * 60 * 1000; } // 10 分钟

  /**
   * 检查上次定位是否已过期
   */
  _isPositionStale() {
    return this.myPositionTime !== null && (Date.now() - this.myPositionTime) > this.POSITION_STALE_MS;
  }

  /**
   * 格式化解上次定位已过时间
   */
  _formatElapsed() {
    if (this.myPositionTime === null) return '';
    const diff = Date.now() - this.myPositionTime;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}小时${m}分钟前` : `${h}小时前`;
  }

  /* ============= 数据持久化 ============= */

  /**
   * 保存状态到 localStorage（circles + 设置）
   */
  _saveState() {
    try {
      const data = {
        circles: this.mapManager.getCircles().map(c => ({
          id: c.id,
          center: c.center,
          maxRadius: c.maxRadius,
          interval: c.interval
        })),
        selectedCircleId: this.mapManager.selectedCircleId,
        circleRadius: this.circleRadius,
        center: this.center
      };
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[App] 保存状态失败:', e.message);
    }
  }

  /**
   * 从 localStorage 恢复状态（页面启动时调用）
   */
  _loadState() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (!data) return;

      // 恢复设置
      if (data.circleRadius && !isNaN(data.circleRadius)) {
        this.circleRadius = data.circleRadius;
        document.getElementById('radius-slider').value = data.circleRadius;
        document.getElementById('radius-input').value = data.circleRadius;
      }

      if (data.center) {
        this.center = data.center;
        this.mapManager.setCenter(data.center);
      }

      // 恢复圆圈
      if (data.circles && Array.isArray(data.circles) && data.circles.length > 0) {
        for (const c of data.circles) {
          this.mapManager.circles.push({
            id: c.id,
            center: c.center,
            maxRadius: c.maxRadius,
            interval: c.interval || CONFIG.CONCENTRIC_INTERVAL
          });
        }
        // 恢复选中状态
        if (data.selectedCircleId && this.mapManager.circles.some(c => c.id === data.selectedCircleId)) {
          this.mapManager.selectedCircleId = data.selectedCircleId;
        }
        this._updateInfo();
        this._updateCircleList();
        this._updateStatusBar();
        this.mapManager._scheduleRedraw();
        console.log('[App] 从 localStorage 恢复', data.circles.length, '个圆');
      }
    } catch (e) {
      console.warn('[App] 恢复状态失败:', e.message);
    }
  }

  /* ============= 状态 & 信息更新 ============= */

  /**
   * 更新顶部 GPS 状态条
   */
  _updateStatusBar() {
    if (!this._statusEl) return;
    if (!this.myPosition) {
      this._statusEl.innerHTML = '<span class="gps-offline">⊙ 未定位，点击 GPS 按钮定位</span>';
      return;
    }
    // 找最近圆
    const circles = this.mapManager.getCircles();
    let nearest = null;
    let nearDist = Infinity;
    for (const c of circles) {
      const d = calcDistance(this.myPosition, c.center);
      if (d < nearDist) { nearDist = d; nearest = c; }
    }
    let nearStr = '';
    if (nearest) {
      const within = nearDist <= nearest.maxRadius;
      nearStr = within
        ? `｜最近圆 ≤ ${formatDistance(nearest.maxRadius)} ✅`
        : `｜最近圆 ${formatDistance(nearDist)}`;
    }
    const elapsed = this._formatElapsed();
    const watchingIcon = this._isWatching ? ' <span class="gps-tracking">◉</span>' : '';
    const stale = this._isPositionStale();
    const staleIcon = stale ? ' <span class="gps-stale">⚠️ 已过期</span>' : '';
    this._statusEl.innerHTML =
      `<span class="gps-online">◉ 已定位</span>${watchingIcon} <span class="gps-elapsed">(${elapsed})</span>${staleIcon}${nearStr}`;
  }

  /**
   * 更新信息展示区（显示选中圆圈的信息）
   */
  _updateInfo() {
    const infoArea = document.getElementById('infoArea');
    const sel = this.mapManager.getSelectedCircle();

    if (!sel) {
      infoArea.classList.add('hidden');
      return;
    }

    infoArea.classList.remove('hidden');

    document.getElementById('info-center').textContent =
      `${sel.center.lat.toFixed(6)}, ${sel.center.lng.toFixed(6)}`;

    document.getElementById('info-radius').textContent =
      sel.maxRadius >= 1000
        ? `${(sel.maxRadius / 1000).toFixed(2)} km`
        : `${sel.maxRadius} m`;

    const area = Math.PI * sel.maxRadius * sel.maxRadius;
    document.getElementById('info-area').textContent =
      area >= 1e6
        ? `${(area / 1e6).toFixed(2)} km²`
        : `${area.toFixed(0)} m²`;

    const ringCount = Math.ceil(sel.maxRadius / sel.interval);
    document.getElementById('info-rings').textContent = `${ringCount} 圈`;

    // —— 距我距离 ——
    const distEl = document.getElementById('info-distance');
    if (this.myPosition && distEl) {
      const dist = calcDistance(this.myPosition, sel.center);
      const within = dist <= sel.maxRadius;
      const stale = this._isPositionStale();
      // 趋势箭头
      let trend = '';
      if (!stale && sel.id in this._prevDistances) {
        const diff = dist - this._prevDistances[sel.id];
        if (Math.abs(diff) > 1) {
          trend = diff < 0
            ? ' <span class="trend-up">↑ 靠近中</span>'
            : ' <span class="trend-down">↓ 远离中</span>';
        }
      }
      this._prevDistances[sel.id] = dist;
      distEl.innerHTML = `${formatDistance(dist)}${trend}${within ? ' <span class="tag-inrange">范围内</span>' : ''}${stale ? ' <span class="tag-stale">可能过期</span>' : ''}`;
    } else if (distEl) {
      distEl.textContent = '--';
    }
  }

  /* ============= 圆列表管理 ============= */

  /**
   * 选中一个圆
   */
  _selectCircle(id) {
    this.mapManager.selectCircle(id);
    const sel = this.mapManager.getSelectedCircle();
    if (sel) {
      // 同步半径滑块到该圆的数值
      document.getElementById('radius-slider').value = sel.maxRadius;
      document.getElementById('radius-input').value = sel.maxRadius;
      this.circleRadius = sel.maxRadius;
      // 地图飞到圆心
      this.mapManager.setCenter(sel.center);
    }
    this._updateInfo();
    this._updateCircleList();
    this._updateStatusBar();
  }

  /**
   * 删除一个圆
   */
  _deleteCircle(id) {
    this.mapManager.removeCircle(id);
    this._updateInfo();
    this._updateCircleList();
    this._updateStatusBar();
    this._saveState();
    // 清除已删除圆的趋势缓存
    delete this._prevDistances[id];
    if (this.mapManager.getCircles().length === 0) {
      this._showToast('已清除全部');
    }
  }

  /**
   * 编辑圆的半径（选中 + 跳转到半径滑块）
   */
  _editCircle(id) {
    this._selectCircle(id);
    // 滚动面板到半径设置区
    const panel = document.getElementById('bottomPanel');
    const radiusSection = document.querySelector('.radius-section');
    if (radiusSection && panel) {
      panel.scrollTo({
        top: radiusSection.offsetTop - panel.offsetTop - 10,
        behavior: 'smooth'
      });
    }
    // 高亮滑块提示可调
    const slider = document.getElementById('radius-slider');
    slider.classList.add('editing');
    // 聚焦数字输入
    document.getElementById('radius-input').focus();
    setTimeout(() => slider.classList.remove('editing'), 2000);
    this._showToast('✏️ 拖动滑块调整半径');
  }

  /**
   * 渲染圆列表
   */
  _updateCircleList() {
    const circles = this.mapManager.getCircles();
    const selId = this.mapManager.selectedCircleId;

    if (!circles.length) {
      this._circleListEl.innerHTML = `<div class="empty-state">暂无同心圆，点击「绘制圆形」添加</div>`;
      document.getElementById('circle-count').textContent = '0';
      return;
    }

    document.getElementById('circle-count').textContent = circles.length;

    let html = '';
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const isSel = c.id === selId;
      const ringCount = Math.max(1, Math.floor(c.maxRadius / c.interval));
      const radiusStr = c.maxRadius >= 1000
        ? (c.maxRadius / 1000).toFixed(1) + ' km'
        : c.maxRadius + ' m';
      const coordStr = c.center.lat.toFixed(4) + ', ' + c.center.lng.toFixed(4);

      // 距离信息 + 趋势
      let distStr = '';
      let distClass = '';
      if (this.myPosition) {
        const dist = calcDistance(this.myPosition, c.center);
        const within = dist <= c.maxRadius;
        const stale = this._isPositionStale();
        let trend = '';
        if (!stale && c.id in this._prevDistances) {
          const diff = dist - this._prevDistances[c.id];
          if (Math.abs(diff) > 1) {
            trend = diff < 0 ? ' ↑' : ' ↓';
          }
        }
        this._prevDistances[c.id] = dist;
        distStr = formatDistance(dist) + trend + (stale ? ' ⚠' : '');
        distClass = within ? 'dist-within' : '';
      }

      html += `<div class="circle-item${isSel ? ' active' : ''}" data-id="${c.id}">
        <span class="circle-idx">#${i + 1}</span>
        <div class="circle-summary">
          <div class="circle-name">${radiusStr}</div>
          <div class="circle-meta">${ringCount}圈 · ${coordStr}</div>
        </div>
        <span class="circle-dist ${distClass}">${distStr}</span>
        <button class="circle-edit" aria-label="编辑半径">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            <path d="m15 5 4 4"/>
          </svg>
        </button>
        <button class="circle-del" aria-label="删除此圆">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;
    }
    this._circleListEl.innerHTML = html;
  }

  /* ============= URL 参数 ============= */

  /**
   * 从 URL 参数读取初始状态
   * 支持：?lat=39.9&lng=116.4&radius=1000
   */
  _checkUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const lat = parseFloat(params.get('lat'));
      const lng = parseFloat(params.get('lng'));
      const radius = parseInt(params.get('radius'), 10);

      if (!isNaN(lat) && !isNaN(lng) &&
          lat >= -90 && lat <= 90 &&
          lng >= -180 && lng <= 180) {
        this.center = { lat, lng };
        this.mapManager.setCenter(this.center);

        if (!isNaN(radius) && radius >= CONFIG.MIN_RADIUS && radius <= CONFIG.MAX_RADIUS) {
          this.circleRadius = radius;
          document.getElementById('radius-slider').value = radius;
          document.getElementById('radius-input').value = radius;
          this.mapManager.addCircle(this.center, radius);
          this._updateInfo();
          this._updateCircleList();
        }
      }
    } catch (e) {
      // 静默忽略 URL 解析错误
    }
  }

  /* ============= Toast 提示 ============= */

  /**
   * 显示短暂提示
   */
  _showToast(message) {
    // 移除已有 toast
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // 自动消失
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/* ============= 启动 ============= */

// DOM 就绪后启动
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
  // 暴露到全局便于调试
  window.app = app;
});

// 如果 DOM 已经加载，直接启动
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  const app = new App();
  app.init();
  window.app = app;
}
