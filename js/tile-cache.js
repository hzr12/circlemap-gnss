/**
 * TileCacheManager — 离线瓦片缓存管理
 * =====================================
 * 功能：
 *   - Service Worker 注册
 *   - 下载当前视口范围内的瓦片（预缓存）
 *   - 缓存统计（数量、大小）
 *   - 清除缓存
 *
 * 依赖 sw.js（项目根目录）
 */

class TileCacheManager {
  constructor(app) {
    this.app = app;
    this._ready = false;
    this._downloading = false;
    this._abortFlag = false;
    this._swReg = null;
    this._initSW();
  }

  // ==================== 初始化 ====================

  async _initSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this._swReg = await navigator.serviceWorker.register('sw.js');
      this._ready = true;
      this._updateStats();
    } catch (e) {
      console.warn('[TileCache] SW 注册失败:', e.message);
    }
  }

  /** 是否就绪（SW 已激活） */
  get ready() { return this._ready; }

  /** 是否正在下载 */
  get isDownloading() { return this._downloading; }

  // ==================== 缓存统计 ====================

  /**
   * 获取缓存统计（通过 SW 消息）
   * @returns {Promise<{count:number, size:number}>}
   */
  async getStats() {
    if (!this._swReg || !this._swReg.active) return { count: 0, size: 0 };
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ count: 0, size: 0 }), 3000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data && e.data.type === 'CACHE_STATS') {
          resolve({ count: e.data.count, size: e.data.size });
        } else {
          resolve({ count: 0, size: 0 });
        }
      };
      this._swReg.active.postMessage({ type: 'GET_CACHE_STATS' }, [channel.port2]);
    });
  }

  /** 更新 UI 中的缓存大小显示 */
  async _updateStats() {
    const el = document.getElementById('cache-size');
    if (!el) return;
    const stats = await this.getStats();
    el.textContent = stats.count > 0
      ? `${stats.count} 块 / ${_formatBytes(stats.size)}`
      : '未缓存';
  }

  /** 清除所有瓦片缓存 */
  async clearCache() {
    if (!this._swReg || !this._swReg.active) return;
    this._swReg.active.postMessage({ type: 'CLEAR_TILE_CACHE' });
    // 等 SW 处理完
    await new Promise(r => setTimeout(r, 500));
    await this._updateStats();
    Toast.show('🗑️ 瓦片缓存已清除');
  }

  // ==================== 预下载瓦片 ====================

  /**
   * 下载当前视口的瓦片
   * @param {number} [range=2] 当前缩放上下各几级（默认 ±2）
   */
  async downloadViewport(range = 2) {
    if (this._downloading) {
      Toast.show('⚠️ 正在下载中，请等待完成');
      return;
    }
    if (!this._ready) {
      Toast.show('⚠️ 离线缓存不可用（浏览器不支持 Service Worker）');
      return;
    }

    const map = this.app.mapManager.map;
    if (!map) return;

    const zoom = map.getZoom();
    if (zoom < 5) {
      Toast.show('⚠️ 当前缩放级别过低，请放大地图后再试');
      return;
    }

    const bounds = map.getBounds();
    const minZoom = Math.max(5, zoom - range);
    const maxZoom = Math.min(18, zoom + range);

    // 估算瓦片数
    const total = this._estimateTileCount(bounds, minZoom, maxZoom);
    if (total > 5000) {
      Toast.show(`⚠️ 瓦片过多（约 ${total} 块），请缩小下载范围`);
      return;
    }

    if (total === 0) {
      Toast.show('⚠️ 无瓦片需要下载');
      return;
    }

    // 确认下载
    Toast.show(`📥 正在缓存 ${total} 块瓦片（缩放 ${minZoom}-${maxZoom}）...`);

    this._downloading = true;
    this._abortFlag = false;

    const progressBar = document.getElementById('cache-progress-bar');
    const progressText = document.getElementById('cache-progress-text');
    const progressWrap = document.getElementById('cache-progress');
    if (progressWrap) progressWrap.classList.remove('hidden');

    let done = 0;
    let failed = 0;

    for (let z = minZoom; z <= maxZoom; z++) {
      if (this._abortFlag) break;
      const tiles = this._getTileList(bounds, z);
      for (const { x, y } of tiles) {
        if (this._abortFlag) break;
        try {
          await this._cacheTile(x, y, z);
          done++;
        } catch {
          failed++;
        }
        const pct = Math.min(100, Math.round((done + failed) / total * 100));
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = `${done + failed}/${total}`;
      }
    }

    this._downloading = false;
    if (progressWrap) progressWrap.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';

    if (this._abortFlag) {
      Toast.show(`⏹️ 已中断（成功 ${done} 块，失败 ${failed} 块）`);
    } else {
      Toast.show(`✅ 缓存完成（成功 ${done} 块${failed > 0 ? `，${failed} 块失败` : ''}）`);
    }

    await this._updateStats();
  }

  /** 中止下载 */
  abortDownload() {
    if (this._downloading) {
      this._abortFlag = true;
    }
  }

  // ==================== 瓦片计算 ====================

  /**
   * 经纬度 → 瓦片坐标 (Web Mercator)
   */
  _latLngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }

  /**
   * 获取某缩放层级下覆盖 bounds 的所有瓦片坐标列表
   */
  _getTileList(bounds, zoom) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const nwTile = this._latLngToTile(ne.lat, sw.lng, zoom);
    const seTile = this._latLngToTile(sw.lat, ne.lng, zoom);

    const tiles = [];
    for (let x = nwTile.x; x <= seTile.x; x++) {
      for (let y = nwTile.y; y <= seTile.y; y++) {
        // 防止越界（瓦片坐标在 0..2^zoom-1 范围内）
        const maxTile = Math.pow(2, zoom) - 1;
        if (x >= 0 && x <= maxTile && y >= 0 && y <= maxTile) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  /**
   * 估算总瓦片数
   */
  _estimateTileCount(bounds, minZoom, maxZoom) {
    let total = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
      total += this._getTileList(bounds, z).length;
    }
    return total;
  }

  /**
   * 缓存单块瓦片
   * 通过 Image 对象加载（触发 SW fetch → 自动缓存）
   */
  _cacheTile(x, y, z) {
    const subdomain = ['rt0', 'rt1', 'rt2', 'rt3'][(x + y + z) % 4];
    const url = `https://${subdomain}.map.qq.com/tile?z=${z}&x=${x}&y=${y}&type=vector&scene=0&itype=0`;
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('timeout')); }
      }, 10000);
      img.onload = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      };
      img.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('load failed')); }
      };
      img.src = url;
    });
  }
}

/**
 * 字节数 → 可读字符串
 */
function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
