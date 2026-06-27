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

    // 读取 URL 参数
    this._checkUrlParams();

    // 进入页面后自动尝试获取一次位置（静默失败）
    this._autoLocate();

    // 每分钟检查定位是否过期，刷新过期提示
    setInterval(() => {
      if (this.myPosition) {
        this._updateStatusBar();
        this._updateInfo();
        this._updateCircleList();
      }
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

    // —— GPS 定位按钮 ——
    document.getElementById('gps-btn').addEventListener('click', () => this._locateMe());

    // —— 圆列表事件委托（选中/删除） ——
    this._circleListEl = document.getElementById('circle-list');
    this._circleListEl.addEventListener('click', (e) => {
      const item = e.target.closest('.circle-item');
      const delBtn = e.target.closest('.circle-del');
      if (!item) return;
      const id = parseInt(item.dataset.id);
      if (delBtn) {
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
    this._showToast(`已创建同心圆，半径 ${
      this.circleRadius >= 1000
        ? (this.circleRadius / 1000).toFixed(1) + ' km'
        : this.circleRadius + ' m'
    }`);
  }

  /**
   * 定位到我
   */
  async _locateMe() {
    const btn = document.getElementById('gps-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const pos = await this.gpsManager.getCurrentPosition();
      const convPos = await this.mapManager.wgs84ToGcj02(pos);

      // 切换为 click 模式（避免循环触发）
      // 但保持 UI 显示
      this.center = convPos;

      // 更新地图位置
      this.mapManager.setCenter(this.center);
      this.mapManager.setLocation(this.center);
      this.mapManager.flyTo(this.center);

      // 同步到输入框
      document.getElementById('lat').value = convPos.lat.toFixed(6);
      document.getElementById('lng').value = convPos.lng.toFixed(6);

      // 保存定位（GCJ-02）
      this.myPosition = convPos;
      this.myPositionTime = Date.now();

      // 刷新距离信息
      this._updateStatusBar();
      this._updateCircleList();
      this._updateInfo();

      // 定位成功样式
      btn.classList.add('located');

      // 3秒后移除高亮
      setTimeout(() => {
        btn.classList.remove('located');
      }, 3000);

      this._showToast(`定位成功（精度 ±${pos.accuracy.toFixed(0)} 米）`);
    } catch (err) {
      this._showToast('❌ ' + err.message);
      btn.classList.remove('located');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  /**
   * 页面加载后自动尝试定位（重试 1 次，最多 3 次）
   */
  async _autoLocate() {
    const maxRetries = 1; // 首次失败后重试 1 次 = 最多 2 次尝试
    this._showToast('⏳ 正在定位...');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const pos = await this.gpsManager.getCurrentPosition();
        const convPos = await this.mapManager.wgs84ToGcj02(pos);
        this.center = convPos;
        this.myPosition = convPos;
        this.myPositionTime = Date.now();
        this.mapManager.setCenter(this.center);
        this.mapManager.setLocation(this.center);
        this.mapManager.flyTo(this.center);
        document.getElementById('lat').value = convPos.lat.toFixed(6);
        document.getElementById('lng').value = convPos.lng.toFixed(6);
        const btn = document.getElementById('gps-btn');
        btn.classList.add('located');
        setTimeout(() => btn.classList.remove('located'), 3000);
        this._updateStatusBar();
        this._showToast(`✅ 定位成功（精度 ±${pos.accuracy.toFixed(0)} 米）`);
        console.log('[AutoLocate] 定位成功:', pos.lat.toFixed(4), pos.lng.toFixed(4));
        return;
      } catch (err) {
        if (attempt < maxRetries) {
          this._showToast('⏳ 定位失败，正在重试...');
        } else {
          this._showToast('❌ 定位失败，可手动点击定位按钮重试');
          console.warn('[AutoLocate] 定位最终失败:', err.message);
        }
      }
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
    const stale = this._isPositionStale();
    const staleIcon = stale ? ' <span class="gps-stale">⚠️ 已过期</span>' : '';
    this._statusEl.innerHTML =
      `<span class="gps-online">◉ 已定位</span> <span class="gps-elapsed">(${elapsed})</span>${staleIcon}${nearStr}`;
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
      distEl.innerHTML = `${formatDistance(dist)}${within ? ' <span class="tag-inrange">范围内</span>' : ''}${stale ? ' <span class="tag-stale">可能过期</span>' : ''}`;
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
    if (this.mapManager.getCircles().length === 0) {
      this._showToast('已清除全部');
    }
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

      // 距离信息
      let distStr = '';
      let distClass = '';
      if (this.myPosition) {
        const dist = calcDistance(this.myPosition, c.center);
        const within = dist <= c.maxRadius;
        const stale = this._isPositionStale();
        distStr = formatDistance(dist) + (stale ? ' ⚠' : '');
        distClass = within ? 'dist-within' : '';
      }

      html += `<div class="circle-item${isSel ? ' active' : ''}" data-id="${c.id}">
        <span class="circle-idx">#${i + 1}</span>
        <div class="circle-summary">
          <div class="circle-name">${radiusStr}</div>
          <div class="circle-meta">${ringCount}圈 · ${coordStr}</div>
        </div>
        <span class="circle-dist ${distClass}">${distStr}</span>
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
