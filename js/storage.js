/**
 * 数据持久化
 * =============================================
 * 圆圈状态：localStorage 读写（小数据量）
 * 轨迹数据：IndexedDB 存储（大数据量，支持最大 25MB）
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

  // ----- IndexedDB 引擎 -----

  static _db = null;             // IndexedDB 连接实例
  static _dbInitPromise = null;  // 初始化 Promise（防止并发初始化）
  static _dbInitialized = false; // 是否已完成初始化（含数据迁移）

  /**
   * 初始化 IndexedDB 连接（懒加载，首次调用时初始化）
   * @returns {Promise<IDBDatabase>}
   */
  static _initDB() {
    if (Storage._db) return Promise.resolve(Storage._db);
    if (Storage._dbInitPromise) return Storage._dbInitPromise;

    Storage._dbInitPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CONFIG.DB_STORE_TRAIL)) {
          // 轨迹存储：keyPath 为 'id'（固定 key='current'）
          const store = db.createObjectStore(CONFIG.DB_STORE_TRAIL, { keyPath: 'id' });
          // 添加时间戳索引，便于未来查询历史
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        Storage._db = e.target.result;
        Storage._dbInitialized = true;
        // 触发数据迁移（localStorage → IndexedDB）
        Storage._migrateFromLocalStorage().catch(err => {
          console.warn('[Storage] 数据迁移失败:', err.message);
        });
        resolve(Storage._db);
      };

      request.onerror = (e) => {
        console.warn('[Storage] IndexedDB 打开失败:', e.target.error);
        Storage._dbInitPromise = null; // 允许重试
        reject(e.target.error);
      };
    });

    return Storage._dbInitPromise;
  }

  /**
   * 数据迁移：将旧 localStorage 中的轨迹数据迁移到 IndexedDB
   * 仅在首次初始化时执行一次
   */
  static _migrateFromLocalStorage() {
    return new Promise((resolve) => {
      try {
        const oldData = localStorage.getItem(Storage.TRAIL_KEY);
        if (!oldData) {
          resolve(); // 无旧数据
          return;
        }

        let positions = null;
        if (oldData.charCodeAt(0) === 67) {
          // 二进制格式
          const decoded = Storage._decodeTrail(oldData);
          if (decoded) positions = decoded.positions;
        } else {
          // JSON 格式
          const data = JSON.parse(oldData);
          if (data && Array.isArray(data.positions)) {
            positions = data.positions.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
          }
        }

        if (positions && positions.length > 0) {
          // 迁移到 IndexedDB
          const trailData = {
            id: 'current',
            positions: positions,
            updatedAt: Date.now(),
            pointCount: positions.length,
            sizeBytes: new Blob([oldData]).size
          };
          Storage._saveToIndexedDB(trailData).then(() => {
            // 迁移成功后清除 localStorage 中的旧数据
            try {
              localStorage.removeItem(Storage.TRAIL_KEY);
              console.info('[Storage] 轨迹数据已从 localStorage 迁移到 IndexedDB（', positions.length, '点）');
            } catch (_) {}
            resolve();
          }).catch(err => {
            console.warn('[Storage] 迁移保存失败:', err.message);
            resolve(); // 不阻塞主流程
          });
        } else {
          resolve();
        }
      } catch (e) {
        console.warn('[Storage] 数据迁移异常:', e.message);
        resolve();
      }
    });
  }

  /**
   * 将轨迹数据保存到 IndexedDB
   * @param {object} data - { id, positions, updatedAt, pointCount, sizeBytes }
   * @returns {Promise<void>}
   */
  static _saveToIndexedDB(data) {
    return Storage._initDB().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG.DB_STORE_TRAIL, 'readwrite');
        const store = transaction.objectStore(CONFIG.DB_STORE_TRAIL);
        store.put(data);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  /**
   * 从 IndexedDB 加载轨迹数据
   * @returns {Promise<object|null>}
   */
  static _loadFromIndexedDB() {
    return Storage._initDB().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG.DB_STORE_TRAIL, 'readonly');
        const store = transaction.objectStore(CONFIG.DB_STORE_TRAIL);
        const request = store.get('current');

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = (e) => reject(e.target.error);
      });
    });
  }

  // ----- 轨迹持久化 -----

  static TRAIL_KEY = 'circlemap_trail';

  // 魔数 'CT1'（3B）+ 版本（1B）头部，随后每点定长 26 字节：
  //   lat/lng: float64（全精度无损往返）| time: uint32 秒 | speed: uint16 ×100
  //   heading: uint16 ×100 | accuracy: uint16（0-65535m，地下高精度不截断）
  // 25MB 配额可存储约 96 万点（25MB / 26B），远超 15 万点上限
  static _TRAIL_MAGIC = 'CT1';
  static _TRAIL_VERSION = 1;
  static _TRAIL_POINT_BYTES = 26;

  /**
   * 计算轨迹数据的估算大小（字节）
   * @param {Array} positions
   * @returns {number}
   */
  static _estimateSize(positions) {
    return 4 + positions.length * Storage._TRAIL_POINT_BYTES;
  }

  /**
   * 检查是否超出存储上限
   * @param {number} sizeBytes
   * @returns {boolean}
   */
  static _isOverLimit(sizeBytes) {
    return sizeBytes > CONFIG.DB_MAX_SIZE;
  }

  /**
   * 轨迹存储适配层（IndexedDB 实现）：
   *   异步保存/加载，内部自行吞错并告警
   *   save(trail) → void（异步，fire-and-forget）
   *   load()      → Promise<{positions:Array}|null>
   */
  static _trailStore = {
    save(trail) {
      if (!trail || !trail.positions || trail.positions.length === 0) {
        return;
      }

      const positions = trail.positions;
      let workingPositions = positions;

      // 检查存储上限，必要时抽稀
      let estimatedSize = Storage._estimateSize(workingPositions);
      if (Storage._isOverLimit(estimatedSize)) {
        // 计算需要抽稀的比例
        const ratio = CONFIG.DB_MAX_SIZE / estimatedSize;
        const keepCount = Math.floor(workingPositions.length * ratio);
        // 等间隔抽稀
        const step = workingPositions.length / keepCount;
        workingPositions = workingPositions.filter((_, i) => Math.floor(i / step) < keepCount);
        estimatedSize = Storage._estimateSize(workingPositions);
        console.warn('[Storage] 轨迹超配额（', positions.length, '点），已抽稀至', workingPositions.length, '点保存');
      }

      const trailData = {
        id: 'current',
        positions: workingPositions,
        updatedAt: Date.now(),
        pointCount: workingPositions.length,
        sizeBytes: estimatedSize
      };

      // 异步保存，fire-and-forget
      Storage._saveToIndexedDB(trailData).catch(err => {
        console.warn('[Storage] 轨迹保存失败:', err.message);
        try { Toast.show(' 轨迹保存失败：本地存储空间不足'); } catch (_) { /* 页面隐藏时无 toast */ }
      });
    },

    load() {
      return Storage._loadFromIndexedDB()
        .then(data => {
          if (!data || !data.positions || data.positions.length === 0) {
            return null;
          }
          return {
            positions: data.positions,
            updatedAt: data.updatedAt,
            pointCount: data.pointCount
          };
        })
        .catch(err => {
          console.warn('[Storage] 轨迹恢复失败:', err.message);
          return null;
        });
    }
  };

  /**
   * 保存轨迹数据（兼容旧同步签名，内部走 IndexedDB 异步）
   * @param {Trail} trail
   */
  static saveTrail(trail) {
    Storage._trailStore.save(trail);
  }

  /**
   * 恢复轨迹数据（异步，返回 Promise）
   * @returns {Promise<{positions:Array}|null>}
   */
  static loadTrail() {
    return Storage._trailStore.load();
  }

  /**
   * 获取 IndexedDB 存储统计信息
   * @returns {Promise<{pointCount:number,sizeBytes:number,updatedAt:number}|null>}
   */
  static getTrailInfo() {
    return Storage._loadFromIndexedDB()
      .then(data => {
        if (!data) return null;
        return {
          pointCount: data.pointCount || (data.positions ? data.positions.length : 0),
          sizeBytes: data.sizeBytes || 0,
          updatedAt: data.updatedAt || 0
        };
      })
      .catch(() => null);
  }

  /**
   * 清除所有轨迹数据
   * @returns {Promise<void>}
   */
  static clearTrail() {
    return Storage._initDB().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG.DB_STORE_TRAIL, 'readwrite');
        const store = transaction.objectStore(CONFIG.DB_STORE_TRAIL);
        store.delete('current');

        transaction.oncomplete = () => {
          // 同时清除 localStorage 中的旧数据
          try { localStorage.removeItem(Storage.TRAIL_KEY); } catch (_) {}
          resolve();
        };
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  /** 轨迹点数组 → Latin1 二进制字符串（编码工具函数，保留供未来导出使用） */
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
      const h = (((Number(p.heading) || 0) % 360) + 360) % 360;
      dv.setUint16(o, Math.max(0, Math.min(35999, Math.round(h * 100))), true); o += 2;
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
