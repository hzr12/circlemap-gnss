/**
 * 离线瓦片缓存 Service Worker
 * ============================
 * 拦截腾讯地图瓦片请求，缓存优先策略。
 * 首次访问→从网络获取并缓存，后续离线→从缓存返回。
 * 预下载瓦片：主线程通过 postMessage 触发批量缓存。
 */

const CACHE_NAME = 'circlemap-tiles-v1';

// 腾讯地图瓦片域名（rt0~rt3）
const TILE_PATTERN = /\.map\.qq\.com\/tile/;

// 跳过等待，立即激活
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// 接管所有客户端
self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// 主线程消息：获取缓存统计
self.addEventListener('message', (e) => {
  if (e.data.type === 'GET_CACHE_STATS') {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      let totalSize = 0;
      for (const req of keys) {
        const resp = await cache.match(req);
        if (resp) totalSize += (await resp.clone().arrayBuffer()).byteLength;
      }
      e.source.postMessage({
        type: 'CACHE_STATS',
        count: keys.length,
        size: totalSize
      });
    })());
  }

  if (e.data.type === 'CLEAR_TILE_CACHE') {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      for (const req of keys) {
        if (TILE_PATTERN.test(req.url)) {
          await cache.delete(req);
        }
      }
    })());
  }
});

// 拦截瓦片请求：缓存优先
self.addEventListener('fetch', (e) => {
  if (TILE_PATTERN.test(e.request.url)) {
    e.respondWith(cacheFirst(e.request));
  }
});

/**
 * 缓存优先策略
 * 1) 检查缓存 → 命中直接返回
 * 2) 未命中 → 网络获取，成功则存入缓存
 * 3) 网络失败且无缓存 → 返回空 204
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // 克隆后存入缓存（response 流只能消费一次）
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线且无缓存 → 返回空白响应
    return new Response(null, { status: 204, statusText: 'No Cache' });
  }
}
