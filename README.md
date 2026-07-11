# Circlemap — 同心圆雷达地图

基于腾讯地图的同心圆雷达工具，专为"鬼抓人"等户外活动设计。
支持单人独立使用，也支持多人实时联网对战（MQTT 5.0）。
以自己或任意点为中心，绘制多层同心圆，实时查看与圆心的距离、方位趋势、运动轨迹。

---

## 功能一览

### 地图与选点
- **点击选点** — 点击地图任意位置设为圆心
- **坐标输入** — 手动输入经纬度，支持智能粘贴解析
- **智能识别** — 自动识别 `23.1291, 113.2644` / `39.9N 116.4E` / `N 39.9 E 116.4` / `纬度:23.1291 经度:113.2644` 等多种格式
- **长按地图** — GPS 过期时设为手动位置，否则快速创建圆
- **URL 参数** — `?lat=39.9&lng=116.4&radius=1000` 直接打开指定位置

### GPS 定位
- **短按** GPS 按钮 — 单次定位，飞到当前位置
- **长按** GPS 按钮 — 切换持续追踪
- **WGS84 -> GCJ-02** 纯前端纠偏（腾讯地图官方 API + 手写 Haversine 降级）
- **精度环** — 地图上显示定位精度范围圆环
- **卡尔曼滤波** — 一维卡尔曼（位置+速度），Q/R 自适应 accuracy 抑制漂移
- **自动降级** — 连续超时 5 次自动切低精度，信号恢复后自动切回
- **位置过期提醒** — 10 分钟未更新自动提示 + 自动重定位

### 同心圆
- 对数半径滑块 — 常用小半径占据更多滑块行程，精准调节
- 预设半径按钮 — 100m/500m/1km/3km/5km/10km 一键切换
- 多层同心圆绘制（默认每 2.5km 一圈）
- **重叠染色加深** — 多个圆重叠区域颜色自然加深（离屏 Canvas 双 Pass）
- 圆列表 — 查看、选中、编辑半径、删除（均支持 5 秒撤销）
- 信息面板 — 圆心坐标、半径、面积、圈数

### 位置追踪
- **距圆心距离** — 实时显示每个圆的距离
- **三态范围判定** — 范围内 / 可能范围内 / 范围外（结合精度圈判定）
- **明确文字标签** — 圆列表每行显示 `[范围内]` / `[可能范围内]` / `[范围外]`
- **靠近/远离趋势** — 箭头指示运动方向变化
- **地图跟随模式** — 点击状态条切换，位置更新自动移动视角
- **对方标记** — 标记对方位置，可设精度范围圈

### 多人联网对战（MQTT 5.0）
- **房间系统** — 创建/加入房间，4-8 人实时对战
- **自动重连** — 页面加载后 24 小时内自动检测并重连上次房间（localStorage 持久化），5 秒内短时刷新跳过让 MQTT 重连自行恢复
- **队伍模式** — 鬼（追逐方）vs 人（逃跑方），开局自动分配
- **队伍首字标记** — 地图上玩家标记显示队伍名首字符，快速区分阵营
- **NPC 观战** — 独立旁观视角，可查看所有队伍圆心距离 + 每人范围内/外状态
- **团队健康度面板** — 实时显示全队在线状态、电量百分比、GPS 精度、最后更新时间，颜色分级一目了然
- **玩家精度圈** — 远程玩家的位置标记附带精度范围圈（主题色半透明）
- **路径预测开关** — 可选的玩家运动路径预测椭圆（10s/30s 投影），滑动开关控制
- **圆列表共享** — 各队伍同心圆在房间内同步，所有人可见
- **远程圆过期** — 10 分钟无更新自动删除
- **半径滑块松手同步** — 编辑半径松手后通过 `change` 事件立即同步到其他玩家
- **MQTT 5.0 topicAlias** — 上行 topic 开销从 ~50B 降至 ~3B，8 人 1 小时总流量 ~142KB
- **后台保活** — 锁屏/切后台后心跳降频（60s）+ MQTT keepalive 5 分钟 + 原生回调驱动发布，不断连
- **自动重连** — 连接断开后 5s 自动重连，支持 Broker 降级（MQTT 5.0 -> 3.1.1）+ 多 Broker 备用
- **共享设定同步** — 房主修改设定（半径、共享开关等）后全员同步
- **重加入恢复** — 断线重连后自动 request_state 同步完整房间状态

### GNSS 卫星数据（Android 原生端）
- 实时显示参与定位/可见卫星数
- 按星座分组：GPS / 北斗 / GLONASS / Galileo
- 平均信噪比（dB-Hz）

### 轨迹记录
- 记录移动轨迹，10m 自适应采样 + 精度联动抖动过滤
- **轨迹平滑** — 滑动窗口平均算法（窗口 5）
- **速度着色** — 轨迹线按速度分段染色（蓝 -> 青 -> 黄绿 -> 橙 -> 红）
- **速度曲线** — Chart.js 实时折线图
- GPX 1.1 文件导出（WGS84 坐标优先）
- **轨迹统计** — 总距离、总时长、平均/最高速度、起止时间
- 支持暂停/继续/清除（清除可撤销）

### 持久化
- 圆圈、半径、中心点、轨迹自动保存到 localStorage
- 主题偏好、平滑开关持久化
- 刷新页面自动恢复
- 最近 10 次定位记录

### 界面
- 深色/浅色双主题 — CSS 变量，一键切换
- 主色可选 — 青/绿/蓝/紫/橙 五种主题色
- 玻璃质感，移动优先，触屏优化
- 移动端面板折叠 — 点击把手收起/展开
- 响应横竖屏旋转
- 桌面端浮动面板（380px 宽，右下角悬浮）

### 电池与省电
- **电量监控** — 显示电量百分比 + 预估续航
- **省电模式** — 降低 GPS 精度，暂停天气更新
- **低电量锁定** — <20% 自动开启，<10% 自动停止追踪
- **充电恢复** — 充电时自动解锁省电并恢复追踪

### 天气
- 主用 Open-Meteo（免费、无 key、原生 CORS）
- 降级到 wttr.in（中文）
- 显示温度、湿度、风速、天气描述、日出日落
- **体感温度** — 显示体感温度（`apparent_temperature` + `FeelsLikeC`）

---

## 快速开始

### Web 端（零构建）

```bash
# 方式 1：直接用浏览器打开
双击 index.html

# 方式 2：用 HTTP 服务器托管
python -m http.server 8080
# 或
npx serve
```
打开 `http://localhost:8080` 即可使用。

**多人模式**需要联网（MQTT over WebSocket）。创建或加入房间即可开始对战。

### Android APK

```bash
cd native
npm install
cd gnss-plugin && npx tsc && cd ..
npx cap add android           # 首次
cp -R ../index.html ../js ../css web/
npx cap sync android
cd android && ./gradlew assembleDebug
```
CI 会自动构建并发布到 GitHub Release。

---

## 技术栈

| 模块 | 技术 |
|------|------|
| 地图引擎 | 腾讯地图 JavaScript API v2（`qq.maps.*`） |
| UI | 纯 ES6 Class，零框架 |
| 同心圆渲染 | Canvas 叠加层（离屏双 Pass） |
| 坐标纠偏 | WGS84 -> GCJ-02（官方 API + 纯 JS 降级） |
| GPS | 浏览器 Geolocation API |
| 滤波 | 一维卡尔曼滤波器（位置+速度，Q/R 自适应） |
| 多人通信 | MQTT 5.0 over WebSocket（mqtt.js） |
| Broker | EMQX 公共 Broker（主用）+ HiveMQ / Mosquitto（备用） |
| 轨迹图表 | Chart.js 4 |
| 持久化 | localStorage |
| 原生壳 | Capacitor v8 Android |
| GNSS | 自定义 Capacitor 插件（原生端） |
| 后台定位 | @capgo/background-geolocation |
| CI/CD | GitHub Actions（自动构建+签名+发布） |

---

## 目录结构

```
├── index.html              # 唯一入口（加载全部 CSS/JS 及 CDN 库）
├── css/                    # 12 个 CSS 文件（按功能拆分）
│   ├── fonts.css           # 字体定义
│   ├── theme.css           # CSS 变量 + 主色方案 + 深色/浅色主题
│   ├── base.css            # Reset + 基础样式
│   ├── map.css             # 地图容器 + Canvas 叠加层
│   ├── panel.css           # 面板结构 + 坐标输入 + 半径控制
│   ├── gps.css             # GPS 状态条 + 信号强度 + GNSS
│   ├── circles.css         # 圆列表 + 距离标记 + 范围标签
│   ├── trail.css           # 轨迹记录 + 速度曲线
│   ├── toast-modal.css     # Toast + Modal
│   ├── onboarding.css      # 首次引导
│   ├── responsive.css      # 响应式布局
│   └── room.css            # 多人房间 UI（队伍、游戏、健康度面板）
├── js/                     # 9 个 JS 文件（严格加载顺序）
│   ├── config.js           # CONFIG 全局常量 + 工具函数
│   ├── toast.js            # Toast 消息提示
│   ├── storage.js          # localStorage 持久化
│   ├── trail.js            # 轨迹点存储、自适应采样、距离计算
│   ├── map.js              # MapManager（腾讯地图 + Canvas 同心圆渲染）
│   ├── gps.js              # GPSManager（Geolocation API + 卡尔曼滤波 + GNSS 桥接）
│   ├── mqtt.js             # mqtt.js CDN（MQTT 5.0 客户端，外部库）
│   ├── room.js             # RoomManager（MQTT 通信 + 队伍/NPC/游戏控制）
│   └── app.js              # App 主控制器（UI 绑定 + 逻辑编排 + 启动入口）
├── native/
│   ├── capacitor.config.json
│   ├── gnss-plugin/        # 自定义 Capacitor GNSS 插件（TypeScript）
│   └── package.json
├── .github/workflows/
│   └── android-build.yml   # Android APK 构建 CI
├── CHANGELOG.md
└── AGENTS.md               # AI 辅助开发指南
```

---

## 注意事项

- **联网要求**：腾讯地图 API 需要联网加载，内网/断网不可用
- **坐标纠偏**：浏览器返回 WGS84，腾讯地图使用 GCJ-02，纠偏有 5 秒超时降级到手写算法
- **GPS 节流**：连续定位间隔最少 5 秒
- **GNSS 插件**：仅在 Android 原生端可用，浏览器 Web 端自动隐藏；注册顺序必须先 `addListener` 后 `startGnssListening`
- **轨迹上限**：最多 500 个采样点（`TRAIL_MAX_POINTS`）
- **多人模式**：MQTT Broker 为公共服务器，消息不可加密，无 SLA 保障；8 人以内低频场景完全够用
- **后台保活**：锁屏后 MQTT 心跳自动降频（60s），keepalive 5 分钟，原生定位回调驱动发布；10 小时可玩
- **最大房间人数**：8 人（受 EMQX 公共 Broker 连接速率限制）
- **缓存版本戳**：所有 CSS/JS 引用使用 `?t=YYYYMMDDvN` 格式手动管理版本，修改文件后必须同步更新
- **脚本加载顺序**：`config.js -> toast.js -> storage.js -> trail.js -> map.js -> gps.js -> [mqtt.js CDN] -> room.js -> app.js`，不可调换
- **MQTT Broker**：`test.mosquitto.org` 的 wss(8081) 已被官方禁用，仅 ws 明文可用；浏览器混合内容策略会拦截 ws://，故仅 file:// 或 http:// 页面下可达

---

## License

MIT
