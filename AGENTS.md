# Circlemap — Agent Guide

> 纯 JS 同心圆地图工具（腾讯地图 API v2），专为户外活动设计。

## ⚠️ 分支规则（必须遵守）

- **`dev` 是主开发分支，永远不要删除 `dev` 分支**
- 所有新功能、bug 修复都在 `dev` 上开发
- `dev` 分支只接受web更新
- PR 合并到 `main` 时**不要**使用 `--delete-branch` 参数
- `main` 只接受从 `dev` 合并，不在 `main` 上直接提交

## 首个命令

```powershell
# 在本地启动一个静态服务器预览
cd F:\project\circlemap; python -m http.server 8000
```

## 关键架构

### 脚本加载顺序（严格依赖）
`index.html` 中 `<script>` 顺序不可乱：
```
config.js → toast.js → storage.js → trail.js → gpx.js → map.js → gps.js → app.js
```
新增 JS 文件必须插入正确位置。`config.js` 定义全局 `CONFIG` 和全局函数（`calcDistance`、`calcBearing`、`formatDistance` 等），被所有其他文件依赖。

### 版本戳
修改 JS/CSS 后必须**更新所有** `?t=` 参数（统一递增），否则浏览器缓存会加载旧代码。

### 坐标体系
- **内部存储/渲染全部 GCJ-02**（腾讯地图使用）
- GPS 返回 WGS84，通过 `mapManager.wgs84ToGcj02()` 即时纠偏
- 纠偏算法嵌入在 map.js（纯 JS，不依赖腾讯地图 convertor API）
- GPX 导出时输出 `wgsLat/wgsLng`（优先）或 `lat/lng`（GCJ-02 降级），用户需知此区别

## 模块职责

| 文件 | 职责 | 关键点 |
|------|------|--------|
| `config.js` | 全局常量 + 工具函数 | 所有 magic number 在此，全局函数也在此 |
| `app.js` | 主控制器 | 协调所有模块，绑定 UI 事件，**不要往这里加绘图逻辑** |
| `map.js` | 地图管理器 | 腾讯地图 API + Canvas 叠加层，**两阶段渲染管线** |
| `gps.js` | GPS 定位 | `getCurrentPosition()` / `watchPosition()`，iOS 切后台兜底 |
| `trail.js` | 轨迹存储 + 采样 | 最大 500 点，10m 最小采样间距，`getSmoothedPositions()` |
| `storage.js` | localStorage 持久化 | 静态类，4 个 key |
| `gpx.js` | GPX 导出 | GPX 1.1 schema，含 `gpxtpx:speed/course` 扩展 |
| `toast.js` | Toast 提示 | 简单消息提示。**带撤销按钮的 toast 在 app.js 的 `_showUndoToast()`** |

## 渲染管线（map.js）

Canvas 叠加层 `#circle-canvas` 浮在腾讯地图 div 之上：

1. `_scheduleRedraw()` — RAF 节流到 30fps
2. `_redraw()` — 两阶段：
   - **Pass 1（离屏 Canvas）**：`_drawCircleFill()` — 画所有圆的填充，重叠自动叠色加深
   - `drawImage` 合成到主 Canvas
   - **Pass 2（主 Canvas）**：`_drawCircleStrokes()` — 描边 + 圆心标记
3. `_getColors()` — 根据 `_theme` 返回 9 字段颜色对象，dark/light 各一套
4. 轨迹使用 `qq.maps.Polyline` **数组**（不是单条 Polyline），按速度分段着色

### 离屏 Canvas 要点
- `_getOffscreen(w, h)` 懒创建，尺寸变化时重建
- `devicePixelRatio` 处理 HiDPI
- 所有绘制坐标经 `_latLngToContainerPoint()` 投影到像素

## localStorage keys

| Key | 用途 | 写入时机 |
|-----|------|---------|
| `circlemap_data` | 圆数据 + 设置 | 有变更时 (`_dirty` 门控) |
| `circlemap_trail` | 轨迹点数组 | 停止录制 / 切后台 / 定期 |
| `circlemap_theme` | 主题 dark/light | 切换主题时 |
| `circlemap_trail_smooth` | 平滑开关 | 切换时 |

## 轨迹系统

- `Trail.positions[]` 每个点：`{lat, lng, wgsLat?, wgsLng?, time, accuracy?, speed?, heading?}`
- `getSmoothedPositions(windowSize=5)` — 滑动窗口平均，不修改原始数据，返回新数组
- 渲染调用链：`_getTrailPositions()` → `mapManager.setTrail()`
- 速度着色：5 档（蓝 0-0.5 / 青 0.5-1.5 / 黄绿 1.5-3 / 橙 3-5 / 红 >5 m/s）
- 连续同色段合并为一条 Polyline（500点 → 典型 20-50 段）

## 样式体系

- CSS 变量 `:root` + `[data-theme="light"]` override，约 30 个变量
- Canvas 颜色独立于 CSS，在 `map.js._getColors()` 中定义，修改颜色需**同时改两处**
- 移动端断点 480px，平板/桌面断点 768px

## GPS 行为

- `enableHighAccuracy: true`, `timeout: 10000`, `maximumAge: 0`（单次）/ 5000（持续）
- 总超时兜底 = timeout + 5000ms（防 GPS 信号弱卡死）
- 页面 `visibilitychange` + `pagehide` 兜底：后台自动停追踪，前台恢复
- 位置过期阈值 10 分钟，自动重定位最小间隔 5 分钟

## 开发注意事项

- **不要引入构建工具或框架**——纯 ES6+ 直接在浏览器运行
- `index.html` 中腾讯地图 API key 为 `OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77`（demo key，可公开）
- `mode === 'click'` 时地图点击选点，`mode === 'input'` 时隐藏点击提示
- 半径滑块使用**对数映射**（`sliderToRadius` / `radiusToSlider`），小半径占更多行程
- 圆 ID 用 `Date.now()` 起始递增（`_idCounter`），避免时间戳碰撞
- GPX 导出 URL 5 秒后 revoke
- 撤销 toast 5 秒自动关闭，点击后 `disabled=true` 防双击
