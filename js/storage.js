/**
 * 数据持久化
 * =============================================
 * localStorage 读写，仅处理纯数据
 */

class Storage {
  /**
   * 保存圆圈状态
   * @param {object} mapManager - 用于读取 circles/selectedCircleId
   * @param {number} circleRadius
   * @param {{lat:number,lng:number}|null} center
   */
  static saveCircles(mapManager, circleRadius, center) {
    try {
      const data = {
        circles: mapManager.getCircles().map(c => ({
          id: c.id,
          center: c.center,
          maxRadius: c.maxRadius,
          color: c.color || '',
          createdAt: c.createdAt
        })),
        selectedCircleId: mapManager.selectedCircleId,
        circleRadius: circleRadius,
        center: center
      };
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[Storage] 保存失败:', e.message);
      if (e.name === 'QuotaExceededError') {
        Toast.show(' 存储空间不足，请清理部分数据');
      }
    }
  }

  /**
   * 恢复圆圈状态
   * @returns {object|null} { circles, selectedCircleId, circleRadius, center }
   */
  static loadCircles() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Storage] 恢复失败:', e.message);
      return null;
    }
  }

  // ----- 轨迹持久化（二进制紧凑编码） -----

  static TRAIL_KEY = 'circlemap_trail';

  // 魔数 'CT1'（3B）+ 版本（1B）头部，随后每点定长 26 字节：
  //   lat/lng: float64（全精度无损往返）| time: uint32 秒 | speed: uint16 ×100
  //   heading: uint16 ×100 | accuracy: uint16（0-65535m，地下高精度不截断）
  // 75000 点 ≈ 1.95MB（Latin1 字符串），远低于 localStorage 5MB 配额
  static _TRAIL_MAGIC = 'CT1';
  static _TRAIL_VERSION = 1;
  static _TRAIL_POINT_BYTES = 26;

  /**
   * 轨迹存储适配层（预留 IndexedDB 实现，替换时仅需更换此对象）：
   *   当前实现 BinaryLocalStorage：同步编解码 + localStorage，全程同步、
   *   pagehide 兜底保存可靠，调用方无需感知异步。
   *   未来 IndexedDB 实现的契约（保持 saveTrail/loadTrail 外部签名不变）：
   *     save(trail) → Promise<void>（异步，内部自行吞错并告警）
   *     load()      → Promise<{positions:Array}|null>
   */
  static _trailStore = {
    save(trail) {
      try {
        localStorage.setItem(Storage.TRAIL_KEY, Storage._encodeTrail(trail.positions));
        return;
      } catch (e) {
        // 配额不足 → 抽稀一半重试
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          try {
            const half = trail.positions.filter((_, i) => i % 2 === 0);
            localStorage.setItem(Storage.TRAIL_KEY, Storage._encodeTrail(half));
            console.warn('[Storage] 轨迹超配额，已抽稀保存（保留', half.length, '点）');
            return;
          } catch (e2) {
            console.warn('[Storage] 轨迹抽稀保存也失败:', e2 && e2.message);
          }
        } else {
          console.warn('[Storage] 轨迹保存失败:', e && e.message);
        }
        try { Toast.show(' 轨迹保存失败：本地存储空间不足'); } catch (_) { /* 页面隐藏时无 toast */ }
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(Storage.TRAIL_KEY);
        if (!raw) return null;
        if (raw.charCodeAt(0) === 67) { // 以 'C'（魔数 'CT1'）开头 → 二进制格式
          return Storage._decodeTrail(raw);
        }
        // 旧 JSON 格式（{positions:[...]}）→ 自动迁移：重编码为二进制并回写
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.positions)) {
          const positions = data.positions.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
          try {
            localStorage.setItem(Storage.TRAIL_KEY, Storage._encodeTrail(positions));
          } catch (e) { /* 迁移失败则保留旧数据，下次再试 */ }
          return { positions };
        }
        return null;
      } catch (e) {
        console.warn('[Storage] 轨迹恢复失败:', e.message);
        return null;
      }
    }
  };

  /**
   * 保存轨迹数据（同步签名，内部走适配层）
   * @param {Trail} trail
   */
  static saveTrail(trail) {
    Storage._trailStore.save(trail);
  }

  /**
   * 恢复轨迹数据
   * @returns {{positions:Array}|null}
   */
  static loadTrail() {
    return Storage._trailStore.load();
  }

  /** 轨迹点数组 → Latin1 二进制字符串 */
  static _encodeTrail(positions) {
    const n = positions.length;
    const PB = Storage._TRAIL_POINT_BYTES;
    const bytes = new Uint8Array(4 + n * PB);
    bytes[0] = 67; bytes[1] = 84; bytes[2] = 49; // 'CT1'
    bytes[3] = Storage._TRAIL_VERSION;
    const dv = new DataView(bytes.buffer);
    let o = 4;
    for (const p of positions) {
      dv.setFloat64(o, Number(p.lat) || 0, true); o += 8;
      dv.setFloat64(o, Number(p.lng) || 0, true); o += 8;
      dv.setUint32(o, Math.max(0, Math.floor((Number(p.time) || 0) / 1000)), true); o += 4;
      dv.setUint16(o, Math.max(0, Math.min(65535, Math.round((Number(p.speed) || 0) * 100))), true); o += 2;
      dv.setUint16(o, Math.max(0, Math.min(65535, Math.round((Number(p.heading) || 0) * 100))), true); o += 2;
      dv.setUint16(o, Math.max(0, Math.min(65535, Math.round(Number(p.accuracy) || 0))), true); o += 2;
    }
    // Uint8Array → Latin1 字符串（1 字节/字符），分块拼接防栈溢出
    let str = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      str += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return str;
  }

  /** Latin1 二进制字符串 → 轨迹点数组（魔数/版本校验失败返回 null） */
  static _decodeTrail(str) {
    const len = str.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = str.charCodeAt(i);
    if (bytes.length < 4 || bytes[0] !== 67 || bytes[1] !== 84 || bytes[2] !== 49) return null;
    if (bytes[3] !== Storage._TRAIL_VERSION) {
      console.warn('[Storage] 轨迹格式版本不兼容:', bytes[3], '（当前', Storage._TRAIL_VERSION, '）');
      return null;
    }
    const PB = Storage._TRAIL_POINT_BYTES;
    const dv = new DataView(bytes.buffer);
    const count = Math.floor((len - 4) / PB);
    const positions = new Array(count);
    let o = 4;
    for (let i = 0; i < count; i++) {
      const lat = dv.getFloat64(o, true); o += 8;
      const lng = dv.getFloat64(o, true); o += 8;
      const time = dv.getUint32(o, true) * 1000; o += 4;
      const speed = dv.getUint16(o, true) / 100; o += 2;
      const heading = dv.getUint16(o, true) / 100; o += 2;
      const accuracy = dv.getUint16(o, true); o += 2;
      positions[i] = { lat, lng, time, speed, heading, accuracy };
    }
    return { positions };
  }
}
