# Circlemap — 同心圆雷达地图

纯前端单页应用（SPA），基于腾讯地图 JavaScript API v2。  
用于"鬼抓人"等户外活动——以任意点为中心绘制同心圆，实时追踪距离、方位、轨迹。

---

## 项目结构速览

```
index.html          ← 唯一入口（直接打开即可运行）
css/
  theme.css         ← CSS 变量 + 主色方案 + 深浅主题
  base.css          ← Reset + 基础样式 + 按钮通用
  map.css           ← 地图容器 + Canvas + 浮动按钮
  panel.css         ← 面板结构 + 模式切换 + 坐标输入 + 半径 + 信息展示
  gps.css           ← GPS 状态条 + 信号强度 + GNSS
  circles.css       ← 圆列表 + 距离标记 + 对方位置 + 最近定位
  trail.css         ← 轨迹记录 + 速度曲线
  toast-modal.css   ← Toast + Modal
  onboarding.css    ← 首次上手引导
  responsive.css    ← 移动端 / 平板 / 桌面响应式
js/
  config.js         ← 所有可调参数 + 工具函数（calcDistance, formatDistance 等）
  app.js            ← 主控制器 App 类（UI 绑定 + 逻辑编排 + 启动入口）
  map.js            ← MapManager（腾讯地图 + Canvas 同心圆渲染）
  gps.js            ← GPSManager（浏览器 Geolocation API + GNSS 插件）
  trail.js          ← Trail（轨迹采样、平滑、距离计算）
  toast.js          ← Toast（短暂消息提示）
  storage.js        ← Storage（localStorage 读写）
native/             ← Capacitor v8 Android 原生壳 + GNSS 插件
  gnss-plugin/      ← 自定义 Capacitor 插件（原生端 GNSS 卫星数据）
  capacitor.config.json
  package.json
.github/workflows/
  android-build.yml ← CI: 构建签名 APK 并发布 GitHub Release
```

---

## 运行与调试

**Web 端** — 直接双击 `index.html` 或用任意 HTTP 服务器托管即可运行：
```
# Python
python -m http.server 8080

# Node
npx serve
```
打开 `http://localhost:8080`。  
不需要 `npm install`，没有 webpack/rollup/web-vite 构建步骤。

**调试技巧：**
- `window.app` 或 `window._app` 暴露了 App 实例，控制台可直接调用 `app.gpsManager.gnssSatellites` 等
- 所有配置参数在 `CONFIG` 全局对象中（`js/config.js`）

**Android APK 构建：**
```bash
cd native
npm install
cd gnss-plugin && npx tsc && cd ..
npx cap add android   # 首次
# 手动将 Web 资源复制到 native/web/（参考 CI 流程）
cp -R ../index.html ../js ../css web/
npx cap sync android
cd android && ./gradlew assembleDebug
```
CI 会自动完成上述流程并发布到 GitHub Release。

---

## 关键架构事实

### 无框架 / 无构建
纯 ES6 class，7 个 `*.js` 文件通过 `<script>` 标签顺序加载（依赖顺序见 `index.html` 末尾）。  
**加载顺序有依赖：** `config.js → toast.js → storage.js → trail.js → map.js → gps.js → app.js`。  
更改文件需更新 `index.html` 中脚本 `<script src="...">` 的 `?t=` 缓存版本戳（手动 bump）。

### 入口初始化
`app.js` 末尾：`App` 实例化 → `init()`。  
双重启动保护：`DOMContentLoaded` + `readyState` 检查，`_appInitialized` 防重复。

### 腾讯地图 API
- 使用 `qq.maps.*` 命名空间，v2 版本
- API key `OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77` 是 DEMO key（位于 `config.js` + `index.html` 两处）
- 额外加载 `libraries=geometry,convertor`（球面计算 + 坐标转换）
- 坐标纠偏：WGS84（浏览器）→ GCJ-02（腾讯地图），优先官方 convertor API，5 秒超时降级到手写算法

### Canvas 同心圆渲染（`map.js`）
- 使用 Canvas 叠加层（`#circle-canvas`，CSS `pointer-events: none`）而非腾讯地图原生 Overlay
- 离屏 Canvas 双 Pass 渲染：Pass 1 画填充（重叠自然加深），Pass 2 画描边+标注
- `requestAnimationFrame` + 30fps 限频（`_scheduleRedraw`）
- 事件追踪 `_syncCenter` 而非依赖 `map.getCenter()`（异步问题）
- 自带 `roundRect` polyfill 兼容 iOS <15.4

### GPS 定位（`gps.js`）
- 纯浏览器 `Geolocation API`，无第三方 SDK
- 单次定位（短按按钮）vs 持续追踪 `watchPosition`（长按按钮切换）
- 节流：高频位置更新每 5 秒最多处理一次（`_gpsMinInterval = 5000`）
- 超时降级：连续 5 次超时 → 自动切低精度 `enableHighAccuracy: false`，每 2 分钟尝试恢复
- 省电模式：低电量 <20% 锁定省电，<10% 自动停止追踪
- GNSS 插件（仅 Capacitor Android）：通过自定义插件读取原始卫星数据（星座、信噪比、参与定位数）

### 轨迹模块
- Trail 类独立管理轨迹数组
- 自适应采样：最小 10m 间隔 + 精度联动抖动过滤（`TRAIL_JITTER_FACTOR = 1.5`）
- 滑动窗口平滑（窗口 5，`getSmoothedPositions`），偏好存储 `localStorage`

### 持久化

### 持久化
- `localStorage` 保存：圆圈列表、选中状态、半径、中心点、轨迹数据、主题偏好、平滑开关
- 轨迹和圆圈状态分开存储（`circlemap_data` + `circlemap_trail`）
- 脏标记模式：`_dirty` / `_trailDirty`，60 秒定时 + 操作时写入

### 删除撤销
- 清除全部 / 删除单个圆 都支持撤销（5 秒内可点"撤销"按钮）
- 清除轨迹也支持撤销
- `_showUndoToast(message, onUndo)` 通用方法

### 信号 / 天气 / 电池
- GPS 状态条显示：信号强度条（4 档）、速度、海拔、电量、最近圆距离
- 天气：主用 Open-Meteo（免费无 key），降级到 wttr.in（中文），省电模式下跳过
- 电池：`navigator.getBattery` 监控，支持消耗速率估算剩余时间

### Android 原生（Capacitor v8）
- `capacitor.config.json` 中注册了 `GnssData` 插件
- CI `android-build.yml` 会自动将 web 资源复制到 `native/web/`，`cap sync` 推入 Android 项目
- GNSS 插件注册监听顺序讲究：先 `addListener` 后 `startGnssListening()`（防竞态）
- 权限：需 `ACCESS_FINE_LOCATION`，插件同时请求 Capacitor 权限和浏览器 Geolocation 权限

---

## 版本与发布

- 版本号体现在 `index.html` 中脚本的 `?t=YYYYMMDDvN` 参数（手动递增）
- `CHANGELOG.md` 维护完整的 git 历史（人工维护，非自动生成）
- GitHub Release：`v*` tag 触发正式版，main push 触发 dev-build 预发布
- APK 签名：keystore `native/circlemap.keystore`，口令 `circlemap123`
- **Commit 描述必须使用中文**：feature/bugfix/refactor 等分类允许使用英文前缀（如 `feat:`），但详细描述必须中文



---

## 常见陷阱

1. **`?t=` 缓存版本戳**：修改 `js/*.js` 或 `css/*.css` 后必须更新 `index.html` 中对应 `<script>` / `<link>` 的版本戳（`YYYYMMDDvN`），否则浏览器缓存旧代码。
2. **脚本加载顺序**：新加 JS 文件必须按正确顺序插入 `index.html` 的 `<script>` 标签列表。
3. **坐标转换 5 秒超时**：`wgs84ToGcj02` 的 convertor API 调用有 5 秒硬超时。弱网环境超时后会降级到手写算法，不影响功能。
4. **腾讯地图 API 加载**：页面需联网加载 `map.qq.com/api/js`，内网/断网不可用。
5. **`roundRect` polyfill**：影响 Canvas 圆角矩形标注框，iOS <15.4 和 Firefox <112 需要。
6. **GPS 节流 5 秒**：高频位置更新会被丢弃，实测中连续定位的间隔最少 5 秒。
7. **后台暂停 GPS**：iOS 使用 `pagehide` / `pageshow` 事件（`visibilitychange` 在 iOS 上不可靠）。
8. **GNSS 插件**：仅在 Capacitor Android 原生端可用；浏览器 Web 端不显示卫星数据，GNSS bar 会自动隐藏（`display: none`）。
9. **最大轨迹 500 点**：`TRAIL_MAX_POINTS`，超出后丢弃最早的点。
10. **Chart.js 实例必须 `destroy()`**：`App.destroy()` 中显式销毁，否则 canvas 引用泄漏。
11. **离线瓦片缓存已移除**（`js/tile-cache.js`, `js/sw.js`）。之前的实现有 SW 作用域 + opaque response 双重问题，无法工作。如需重新实现，需同时修复 scope 注册和 opaque 缓存策略。
12. **思考和推理必须使用中文回答**