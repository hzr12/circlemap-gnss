/**
 * 圆圈地图 - 配置
 * ============================================
 * 所有可调参数集中管理
 */

const CONFIG = {
  // 腾讯地图 API 密钥
  MAP_KEY: 'OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77',

  // 默认地图中心（广州塔）
  DEFAULT_CENTER: { lat: 23.1291, lng: 113.2644 },

  // 默认缩放级别
  DEFAULT_ZOOM: 12,

  // 定位后缩放级别
  LOCATION_ZOOM: 15,

  // 半径范围（米）
  MIN_RADIUS: 1,
  MAX_RADIUS: 50000,
  DEFAULT_RADIUS: 5000,

  // 同心圆间隔（米）— 每 1 公里一圈
  CONCENTRIC_INTERVAL: 1000,

  // 画布最小绘制像素阈值
  MIN_DRAW_PX: 4,

  // GPS 超时时间（毫秒）
  GPS_TIMEOUT: 15000,

  // 地图缩放级别与半径适配映射
  ZOOM_MAP: [
    { maxRadius: 50, zoom: 17 },
    { maxRadius: 100, zoom: 16 },
    { maxRadius: 200, zoom: 15 },
    { maxRadius: 500, zoom: 14 },
    { maxRadius: 1000, zoom: 13 },
    { maxRadius: 2000, zoom: 12 },
    { maxRadius: 5000, zoom: 11 },
    { maxRadius: 10000, zoom: 10 },
    { maxRadius: 20000, zoom: 9 },
    { maxRadius: Infinity, zoom: 8 }
  ]
};
