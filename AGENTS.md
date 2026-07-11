# Circlemap — 同心圆雷达地图

纯前端 SPA，基于腾讯地图 JavaScript API v2 + Canvas 叠加层。零构建、无框架。

## 启动

```bash
# 直接双击 index.html，或用 HTTP 服务器托管
python -m http.server 8080
# 或
npx serve
```

---

## 文件清单

**入口：** `index.html` — 加载全部 CSS/JS + 腾讯地图 API + Chart.js + MQTT.js（CDN）

**CSS（12 个文件）：**
`fonts.css` `theme.css` `base.css` `map.css` `panel.css` `gps.css` `circles.css` `trail.css` `toast-modal.css` `onboarding.css` `responsive.css` `room.css`

**JS（9 个文件，加载顺序有依赖）：**

```
config.js → toast.js → storage.js → trail.js → map.js → gps.js → [mqtt.js CDN] → room.js → app.js
```

- `config.js` — 全局 `CONFIG` + 工具函数（calcDistance、formatDistance、copyText 等）
- `toast.js` — Toast 消息提示（独立模块）
- `storage.js` — localStorage 读写（`circlemap_data` + `circlemap_trail` 键）
- `trail.js` — Trail 类（轨迹点存储、自适应采样、距离计算）
- `map.js` — MapManager（腾讯地图 + Canvas 同心圆离屏渲染）
- `gps.js` — GPSManager（浏览器 Geolocation API + 卡尔曼滤波 + GNSS 插件桥接）
- `room.js` — RoomManager（MQTT 5.0 多人房间/队伍/NPC/游戏控制，约 2100 行最大模块）
- `app.js` — App 主控制器（UI 绑定 + 逻辑编排 + 启动入口）

**Android 原生：** `native/` — Capacitor v8 + 自定义 GNSS 插件 + `@capgo/background-geolocation`

---

## 关键架构事实

### 调试
- `window.app` / `window._app` 暴露 App 实例，控制台可直接操作
- 所有配置在 `CONFIG` 全局对象（`js/config.js`）

### 腾讯地图 API
- `qq.maps.*` v2 命名空间，API key 是 DEMO 公共 key（位于 `config.js` + `index.html` 两处）
- 额外加载 `libraries=geometry,convertor`（球面计算 + 坐标转换）
- 坐标纠偏：WGS84（浏览器）→ GCJ-02（腾讯），优先官方 convertor API，5 秒超时降级到手写算法

### Canvas 同心圆
- `#circle-canvas`，CSS `pointer-events: none`，非腾讯原生 Overlay
- 离屏双 Pass：Pass 1 画填充（重叠自然加深），Pass 2 画描边+标注
- 30fps 限频（`requestAnimationFrame` + `_scheduleRedraw`）
- 事件追踪 `_syncCenter`（不依赖 `map.getCenter()`，因其异步）
- 自带 `roundRect` polyfill 兼容 iOS <15.4、Firefox <112

### GPS 定位
- 纯浏览器 Geolocation API，无第三方 SDK
- 单次定位（短按 GPS 按钮）vs 持续追踪 `watchPosition`（长按切换）
- 节流：`_gpsMinInterval = 5000`，高频位置至少间隔 5 秒
- 超时降级：连续 5 次超时 → 自动切 `enableHighAccuracy: false`，每 2 分钟尝试恢复
- 省电：<20% 锁定省电，<10% 自动停止追踪
- **卡尔曼滤波**：`gps.js` 内置一维卡尔曼（位置+速度），Q/R 自适应 accuracy 抑制漂移

### 轨迹
- 自适应采样：最小 10m 间隔 + 精度联动抖动过滤（`TRAIL_JITTER_FACTOR = 1.5`）
- 滑动窗口平滑（窗口 5），上限 500 点（`TRAIL_MAX_POINTS`）

### 持久化
- `localStorage` 脏标记模式（`_dirty` / `_trailDirty`），60 秒定时 + 操作时写入
- 圆数据 `circlemap_data`，轨迹 `circlemap_trail`，分开存储

### 删除撤销
- 清除全部 / 删除单个圆 / 清除轨迹均支持 5 秒内撤销
- 通用方法 `_showUndoToast(message, onUndo)`

### 多人房间（MQTT 5.0）
- 公共 Broker（EMQX 上海主用 `wss://broker-cn.emqx.io:8084/mqtt`，HiveMQ / Mosquitto 备用）
- 注意：`test.mosquitto.org` 的 wss(8081) 已被官方注释禁用，仅 ws 明文可连，浏览器混合内容会拦截
- 加载顺序：`mqtt.js` CDN **必须在 `room.js` 之前**（在 index.html 中位于 gps.js 之后、room.js 之前）
- `@capgo/background-geolocation` 插件用于 Android 原生后台定位（独立于 WebView 存活）

### Android 原生（Capacitor v8）
- `capacitor.config.json` 注册了 `GnssData`、`BackgroundGeolocation`、`Filesystem`、`Share` 插件
- GNSS 插件：仅原生端可用，Web 端自动 `display: none`
- GNSS 注册顺序：先 `addListener` 后 `startGnssListening()`（防竞态）
- 权限：需 `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION`
- CI 覆盖 UA：通过自定义 `MainActivity.java` 将 WebView UA 改为桌面版，影响地图瓦片

---

## 版本与发布

- 版本号体现在 `index.html` 中 `<script>` / `<link>` 的 `?t=YYYYMMDDvN` 参数（**手动递增**）
- GitHub Release：`v*` tag 触发正式版，main push 触发 dev-build 预发布
- APK 签名：keystore `native/circlemap.keystore`，口令 `circlemap123`，alias `circlemap`
- **Commit 描述必须使用中文**：允许英文前缀（`feat:`、`fix:`、`refactor:` 等），详细描述必须中文

---

## APK 构建

```bash
cd native && npm install
cd gnss-plugin && npx tsc && cd ..
npx cap add android            # 首次
cp -R ../index.html ../js ../css web/
npx cap sync android
cd android && ./gradlew assembleDebug
```

CI（`.github/workflows/android-build.yml`）自动完成 Web 资源复制 → cap sync → 插件集成 → 签名 → Release。

---

## 常见陷阱

1. **`?t=` 缓存版本戳** — 修改 `js/*.js` 或 `css/*.css` 后必须更新 `index.html` 中对应 `<script>` / `<link>` 的版本戳，否则浏览器使用旧代码
2. **脚本加载顺序** — `room.js` 位于 gps.js 之后、app.js 之前，且依赖 `mqtt.js` CDN 先加载
3. **腾讯地图 API 需联网** — 内网/断网不可用
4. **坐标转换 5 秒超时** — 弱网降级到手写算法
5. **GPS 节流 5 秒** — 连续定位间隔最少 5 秒
6. **iOS 后台 GPS** — 使用 `pagehide` / `pageshow`（`visibilitychange` 在 iOS 不可靠）
7. **GNSS 仅 Android 原生端** — Web 端自动隐藏；先 addListener 后 startGnssListening
8. **Chart.js 泄漏** — `App.destroy()` 中必须显式 `destroy()`，否则 canvas 引用泄漏
9. **MQTT 公共 Broker** — 消息不可加密，无 SLA；mosquitto 的 wss 已禁用，仅 ws 明文
10. **离线瓦片缓存已移除** — 之前 `js/tile-cache.js` + `js/sw.js` 有 SW scope + opaque response 双重问题，无法工作。如需重新实现须同时修复
