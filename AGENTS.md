# Circlemap — AI 辅助开发指南

## 项目本质

纯前端同心圆雷达地图工具（鬼抓人），**零构建**，浏览器直接打开 `index.html` 即可。Android 原生壳使用 Capacitor v8。

## 关键命令

```bash
# Web 端 — 无需构建，直接双击或：
python -m http.server 8080

# Android APK 构建（完整流程）
cd native
npm install
cd gnss-plugin && npx tsc && cd ..
npx cap add android           # 仅首次
cp -R ../index.html ../js ../css web/
npx cap sync android
cd android && ./gradlew assembleDebug
```

## 架构规则

### 脚本加载顺序（不可调换）
```
config.js → toast.js → storage.js → trail.js → map.js → gps.js → [mqtt.js CDN] → room.js → app-core.js → app-gps-ui.js → app-circle-ui.js → app-room-ui.js
```
新增 JS 文件必须插入正确位置。

> **注意**：`app.js` 已拆分为 4 个文件，使用 `App.prototype` 方法追加模式。
> `app-core.js` 定义 `class App`；`app-*-ui.js` 在其 prototype 上追加 UI 方法。
> `_escapeHtml()` 定义在 `app-core.js` 中，供 `app-circle-ui.js` 和 `app-room-ui.js` 共享。
> `Toast.showUndo()` 定义在 `toast.js` 中（撤销 Toast），供 `app-core.js` 和 `app-circle-ui.js` 调用。

### 缓存版本戳
所有 CSS/JS 引用使用 `?t=YYYYMMDDvN` 格式，**手动管理**。修改文件后必须递增版本号（v1→v2→...）。

### CSS 拆分
12 个按功能拆分（`theme.css / map.css / gps.css / circles.css / trail.css / room.css` 等）。新增样式应放入对应文件或新建文件。

### CDN 外部库
- `map.qq.com/api/js?v=2.exp`（腾讯地图）
- `chart.js@4`（速度曲线）
- `mqtt@5`（多人通信）

## 核心架构

| 模块 | 类/文件 | 职责 |
|------|---------|------|
| 入口 | `index.html` | 加载全部资源 |
| 配置 | `js/config.js` | `CONFIG` 全局常量 + 工具函数 |
| 地图 | `js/map.js` | `MapManager`（腾讯地图 + Canvas 同心圆） |
| 定位 | `js/gps.js` | `GPSManager` + `KalmanFilter` |
| 多人 | `js/room.js` | `RoomManager`（MQTT 5.0） |
| 轨迹 | `js/trail.js` | 采样/平滑/GPX 导出 |
| 主控核心 | `js/app-core.js` | `App` 类定义 + 核心逻辑 |
| GPS UI | `js/app-gps-ui.js` | 状态条/速度曲线/定位列表/跟随 |
| 圆 UI | `js/app-circle-ui.js` | 圆列表/info 面板/删除撤销/编辑半径 |
| 房间 UI | `js/app-room-ui.js` | 分享/健康/队伍/玩家列表/游戏控制/计时/爆发/统计 |

## 重要约定

- **坐标纠偏**：浏览器返回 WGS84，腾讯地图用 GCJ-02，纠偏 5s 超时降级到手写 Haversine
- **GPS 节流**：连续定位最短 5s 间隔
- **位置过期**：10 分钟无更新自动提示重定位
- **轨迹上限**：`TRAIL_MAX_POINTS = 500`
- **MQTT Broker 注意**：`test.mosquitto.org` 的 wss(8081) 已被禁用，仅明文 ws 可用；https 页面下 ws 被混合内容策略拦截，仅 file:// / http:// 可用
- **Android GNSS 插件**：注册顺序必须先 `addListener` 后 `startGnssListening`
- **多人房间上限**：8 人（受公共 Broker 限制）

## CI/CD

GitHub Actions（`.github/workflows/android-build.yml`）：main 分支推送 + tag 推送自动构建签名 APK，发布到 GitHub Release。需配置 Java 21 + Node 22。

## 编码规则

### 热路径方法必须缓存 DOM 引用
```js
// 正确：懒缓存
const el = this._fooEl || (this._fooEl = document.getElementById('foo'));
// 错误：每次调用都查询
const el = document.getElementById('foo');
```
所有可能在一次用户交互或一次位置更新中反复调用的方法（`_update*`、`_show*` 等），其 `getElementById` 调用必须使用 `this._xxxEl || (this._xxxEl = ...)` 模式一次性缓存。例外：仅在 `init()` / `_setupUI()` 中执行一次的初始化代码可以不缓存。

### 隐私日志必须用 CONFIG.DEBUG 守卫
```js
// 正确
if (CONFIG.DEBUG) console.log(...);
// 禁止：不经守卫输出用户坐标、NMEA 语句、地图中心、userAgent 等隐私数据
```
`console.log` / `console.info` 中若涉及用户位置、设备信息、NMEA 报文等，必须加 `if (CONFIG.DEBUG)` 条件，默认不输出。

### 定时器必须成对管理（set → clear）
- `setInterval` / `setTimeout` 必须有对应的 `clearInterval` / `clearTimeout` 在销毁/离开时执行
- 同一类的定时器（如 burst 阶段、timer 倒计时）应在方法本地先 `clear` 后 `set`，避免重复设置
- RoomManager 中的定时器由其自身的 `leaveRoom()` / `destroy()` 清理；App 层的 UI 定时器由 `_roomCleanup()` 或 `destroy()` 清理

### 死代码必须删除（不注释掉）
- 定义后没有被调用的方法、无引用的属性赋值，必须删除而非注释
- 检查：grep 方法名/属性名确认除定义外无其他引用

### 全量渲染必须评估成本
- 列表类方法（`_updateRoomPlayerList`、`_updateCircleList`）每次 `innerHTML = html` 全量重建在 8 人/50 圆以内可接受
- 超过此规模或每帧调用的场景，应改用 `createDocumentFragment` / `insertAdjacentHTML` 增量更新
- 新加的列表渲染方法默认用增量模式

### 版本戳管理
所有 CSS/JS 引用使用 `?t=YYYYMMDDvN` 格式，**手动管理**。修改文件后必须递增版本号（v1→v2→...）。
每次修改文件时要同时更新对应的版本戳。未改的文件不要动。

## 代码风格

- 纯 ES6 Class，零框架
- 中文注释 + 中文 UI
- `localStorage` 持久化键名 `circlemap_data`
- 版本戳仅当修改对应文件时递增，不全局统一
