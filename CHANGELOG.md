# Changelog

```
* fix: 全项目36个bug修复 — GPS权限拒绝死循环/低电量GPS未停止/房间管理器泄漏/玩家名双重转义
* 7562def  refactor: 调整调试日志输出逻辑，新增实际定位间隔统计
* 9abc748  feat: 新增轨迹录制状态持久化与恢复功能
* 915b87e  refactor(storage): 重构存储模块，新增多存储引擎支持
* 6d41a39  refactor: 重构轨迹存储为IndexedDB并优化采样配置
* 499c304  feat: 将轨迹面板移至每个 tab 底部显示，轨迹 tab 只保留轨迹内容
* 8234adc  feat: 添加轨迹独立模式，新增底部常驻记录条
* 7d10412  style: 移除面板logo相关的样式和dom元素
* a851aa8  style(ui): 使用CSS变量统一管理手柄条颜色
* f28e53e  fix(storage): 修复经纬度航向值存储溢出和异常的问题
* 8dc1f1c  feat: 实现二进制轨迹存储与多项功能优化
* 6ce0970  feat: add logo to panel header and add favicon
* a0536cd  ci(android-build): 更新github actions依赖版本至最新版
* f480005  ci(android-build): 优化APK内GNSS类验证逻辑
* 4d447a5  fix: 修复多个逻辑问题并优化代码
* 721e20c  refactor(room): 重构统一开始与结束时间模块
* 2f554bd  refactor: 移除旧版鬼抓人游戏相关功能
* bbdcc23  fix: 瓦片合模线修复（每张瓦片向外扩展1px覆盖抗锯齿边缘）
* 78e703e  fix: 速度曲线坐标偏移修复（ctx.translate(mapX,chartY)卡片坐标系）
* ba30e04  fix: 瓦片高度符号修复 + 速度曲线改用Canvas2D直接绘制
* adf0fbb  fix: 瓦片网格范围改为地图区四角经纬度
* 7387124  fix: 地图区去掉圆角，瓦片完整铺满不裁四角
* e6f967a  fix: 动态 padR 增至50%余量；导出前同步 chart.js data
* 233759b  fix: 恢复地图区圆角矩形背景；动态 padR 自适应
* 5e75a26  fix: 瓦片覆盖修复——静态 pad + 恢复 roundRect clip
* ff1e02a  fix: 瓦片覆盖整个地图区；速度曲线内联 style 覆盖
* a1435b0  fix: 瓦片覆盖范围扩大；导出速度曲线固定 canvas 尺寸
* c3ab193  feat: 报告地图加载高德瓦片底图（失败降级纯色）
* cfdcb15  feat: 定位 marker 插值动画（rAF 500ms ease-out 平滑移动）
* 9a92bd6  fix: 导出速度曲线比例修复 + 峰值降采样（保峰谷）
* 8c45ae2  feat: 轨迹 50000 点上限 + 百度式速度自适应节流（间隔 1s~60s）
* 320fc58  refactor: 移除同心圆个数显示（info 面板 + 报告统计）
* f191411  fix: 移除 10km 标签避免与 25km 重叠
* bde1064  feat: 半径上限 50km 收紧至 25km（滑块/输入框/标签同步）
* e00ed7c  fix: 滑块标签与轨道对齐——按 thumb 有效范围缩进
* b6311c8  refactor: 清理旧版圆圈自定义与团队健康度相关代码
* edeffbe  feat: 半径滑块刻度标签按映射位置绝对定位（幂刻度 1m~50km）
* 8dbf952  fix: 半径滑块归一化补减 min 偏移（与反映射一致）
* 5e50f96  feat: 半径滑块改为真对数刻度（每数量级均分行程）
* f6692cf  feat: GPSManager 收敛为单 2D 滤波器实例，节流调至 1s/20s
* 1f66dc0  feat: 2D 卡尔曼 q 速度自适应（sf=clamp(speed/0.5,1,12)）
* 3a4e3d0  feat: 2D 卡尔曼 q 系数校准为 0.5（静止 0.1/移动 0.3 m/s²）
* 2fa9163  feat: 2D 卡尔曼 q 系数校准（5/acc，扫描最优）
* 92c542d  feat: 卡尔曼滤波升级为 2D 恒速模型（ENU 米坐标）
* dcd9613  refactor: 重构存储、网络协议和UI，调整GPS节流策略
* f598811  fix: 修复多项空值/重复执行问题并更新资源版本
* 65b8d88  refactor(gps): 调整GPS正常定位间隔为2秒，并补充相关文档
* 1a0fe2d  refactor: 拆分app.js为多UI模块，完成功能重构
* 50336c1  feat: 优化卡尔曼滤波器和GPS管理器，动态调整测量噪声
* b954762  feat: 添加.gitignore文件以忽略CodeGraph数据文件
* e88169a  perf: 全面性能优化 - Canvas分层/链式节流/坐标缓存/Player增量更新
* 59cc946  docs: 更新README - 新增auto-rejoin/团队健康度/体感温度/路径预测开关等
* 6ab9da6  docs: 更新AGENTS.md为项目开发指南
* 82c71d9  feat: 团队健康度面板 + 离开房间后保留队伍自动重连
* 2de654b  feat: 更新天气信息显示，增加体感温度
* 3687ded  fix: 地图玩家标记显示队伍首字 + 半径滑块松手后同步
* 42a3104  feat: 地图玩家标记显示GPS精度圈 + 多人房间路径预测开关
* 6038890  chore: MQTT keepalive 150s→120s
* a91d35d  feat: 队伍卡片紧凑化 + 位置共享队伍首字徽章 + keepalive 150s
* ed0c3ad  docs: CHANGELOG 补充 v1.3.0 版本对照
* 899797c  docs: 更新README文档 - 补充多人联网对战、MQTT 5.0、后台保活等
* 6cd9190  feat: 后台MQTT保活 - 增大keepalive + 降频心跳 + 原生回调驱动
* ca233c3  feat: 圆列表与NPC视角显示范围内/可能范围内/范围外文字标签
* 7ab554e  feat: MQTT 5.0 升级 + topicAlias 压缩 + 自动降级到 3.1.1
* faa5927  fix: 修复 code review 中全部 15 个 bug（CRITICAL/HIGH/MEDIUM/LOW）
* 12fc881  feat: 远程圆 10 分钟后自动过期删除
* 4657b39  feat: NPC 视角显示远程圆与各队员距离
* 5cebd6f  feat: 同步完整共享状态（是否开启、burst阶段、剩余时间）
* 7f7ce2a  fix: 重加入同步时 burst 设定在 onGameStateChange 之前存储
* 5ddcfa5  feat: 位置共享设定随 game_start 同步房主配置
* 9aabe2c  feat: 游戏开始时自动按队伍分配人鬼标签
* c1ec42b  fix: 多人模式地图选点改为纯选点 + 重加入房间状态同步
* d115954  style: 其他队伍团队指示器改为同心圆雷达样式
* b52d061  refactor: 移除界面全部 emoji（纯文本化 UI）
* 3004c72  Revert "feat: 多人页面支持手动指定 MQTT 服务器（测试用）"
* eeb2c73  feat: 多人页面支持手动指定 MQTT 服务器（测试用）
* 456fa9f  Revert "feat: 支持 ?broker= URL 参数覆盖 MQTT Broker（本地测试用）"
* 8d591ea  feat: 支持 ?broker= URL 参数覆盖 MQTT Broker（本地测试用）
* f46ecbb  fix: 多人/坐标选项卡下允许点击地图选点
* 3a53425  fix: 点击地图只选圆心、不再直接画圆
* d835868  fix: 修复多人坐标转换、点击选点与开局共享三处问题
* a461b1c  fix: 收窄房间消息异常日志，二进制解码独立容错
* d287ad5  fix: 修复房间 UI 的 XSS（玩家名/队伍色注入）
* ae1bb64  chore: 更新 room.js 脚本缓存戳
* 0275ca8  feat: 圆同步改为二进制编码
* dd2de8b  chore: 更新 room/app/map 脚本缓存戳
* c18c7f2  feat: 地图渲染其他玩家的圆（作者色虚线 + 昵称）
* 4b12c02  feat: 应用层接入多人圆同步
* 58e9274  feat: 多人圆同步（其他队伍可见彼此画的圆）
* 0e1463d  chore: 更新 room.js 脚本缓存戳
* bd4489e  feat: 在场消息改为二进制编码（同 pos/ping 风格）
* 1740067  chore: 更新 room.js 脚本缓存戳
* 6bdaf7e  fix: 位置共享按真实位移立即补发，消除发报延迟
* 08dbfc7  chore: 更新 map.js 脚本缓存戳
* 5124070  feat: 多人玩家标记改为同心圆点样式（像我的位置），用队伍颜色
* 04f2e46  chore: 更新 room.js 脚本缓存戳
* 6a3b311  fix: 游戏中取消发报员压制并缓存最新坐标，确保开局即共享
* 6bc4961  chore: 更新 room.js/app.js/map.js 脚本缓存戳
* 1f0438e  feat: 地图点击回调 onMapClick（多人模式点地图设共享位置用）
* 3494b58  feat: 游戏开始锁定共享，全员可见，点地图设共享位置
* 190a564  feat: 位置共享默认关闭，发报间隔降至15s并支持立即补发
* 4be792b  chore: 更新 room.js 与 app.js 脚本缓存戳
* 130b3c0  fix: 加入房间昵称生效，开始时间同步选择框并支持到点自动开局
* 5deda26  feat: 多人房间异常退出即时清理与游戏重开
* e4773b1  fix: 退出重加后首点立即发 + 加入即发 presence
* 839666f  bugfix: 修复玩家标记 SVG 因中文昵称导致 btoa 崩溃
* a0a306d  feat: 位置消息二进制编码+字段裁剪+自适应间隔以节省带宽
* c544ce4  feat: 建队表单新增 NPC 队勾选并更新缓存戳
* 5ae3deb  style: 队伍创建表单换行修复与 NPC 标签样式
* 9293048  feat: NPC 队 UI 接入与游戏可见性/统计修复
* 097c1ae  feat: NPC 队持续共享与多人同步修复
* 827dda8  refactor: 移除原生调色盘，队伍色改纯预设横向选择
* 204be10  feat: 队伍颜色选择器加预设色板(对齐主题强调色风格)
* 08d485a  style: 队伍颜色选择器改为圆形彩虹环 + 玻璃质感 swatch
* 93c608e  fix: 赛后统计×关闭按钮不工作(重复id导致监听绑在遮罩上)
* 1fdeab4  fix: MQTT 改用默认协议3.1.1 + 连接错误中文透传
* eee6128  fix: 修复 room.js 语法错误(缺失的 if 块导致 RoomManager 未定义)
* fa3c082  feat: 游戏控制UI + 赛后统计面板样式
* ce96eed  feat: 游戏角色分配(鬼/人) + 游戏状态机 + 抓人判定 + 赛后统计逻辑
* 98e467b  feat: 应用集成 + UI — 观战/倒计时/位置共享/过时标记
* a1e4a9f  feat: 位置共享/观战模式/游戏倒计时 — RoomManager 内部协议
* ec8bbe2  feat: 位置预测椭圆 — Canvas 双椭圆绘制 + 自动过时清理
* 51ef2da  refactor: 原生后台定位改为30s间隔节流，最近定位显示后台标签
* 164967d  fix: 原生后台定位回调传入 NaN（属性名不匹配）
* a8df964  fix: 原生后台定位划掉任务不重启
* 20c2731  feat: @capgo/background-geolocation 原生后台定位（方案B）
* a1210b9  Revert "feat: Android 前台服务保活后台定位（方案2）"
* a0c8c10  ci: 前台服务配置脚本集成到构建流程
* ea89145  feat: Android 前台服务保活后台定位（方案2）
* 6faa496  fix: 手机端多人房间按钮溢出 + 共享定位按钮不可取消
* b5b3160  feat: 队伍 UI + 玩家列表分组 + 缓存版本戳更新
* 3aa96d6  feat: 玩家地图标记支持 opacity 透明度
* a8d8943  feat: 队伍发报员模式 — 选举算法 + 分离检测 + 流量节省
* e9869d5  feat: 集成多人房间 — 地图玩家标记 + 应用逻辑 + 页面 UI
* b7baba9  feat: 新增多人房间模块 — RoomManager + 房间样式
* a3477a6  feat: Android 原生导出改用缓存写入 + 系统分享（方案 B）
* fd2e7d8  feat: 安装 @capacitor/filesystem 和 @capacitor/share 插件
* 244960e  fix: 导出改用 Blob + ObjectURL，Toast 提示文件名和位置
* 270e00c  fix: 导出报告下载链接未挂载到 DOM 导致静默失败
* dfc17b0  fix: GPS 状态条呼吸灯被 overflow:hidden 截断
* 840d35f  refactor: 全局字重归一为 normal，移除所有 bold/600/700 引用
* 575def9  refactor: 删除 Regular/Bold 字重，fonts.css 精简为仅 Medium
* bcf05ba  feat: 后台定位（wakeLock + 60s 轮询）+ 活动报告导出 PNG
* b45ba99  feat: 添加卡尔曼滤波实时平滑 GPS 漂移 + 激进省电策略
* 0067e7d  feat: 字体升级为本地 HarmonyOS Sans
* 23cb740  refactor: 移除离线瓦片缓存功能 - 清理界面与文档
* 1f7e744  refactor: 移除离线瓦片缓存功能 - 删除核心缓存文件
* 3a87c3b  feat: 缓存管理弹窗确认 + 视觉高级感提升
* 327b9f2  refactor: 将全屏引导改为功能旁提示浮层
* d9c9f12  feat: v1.2.0 — 离线瓦片缓存 + DMS 坐标解析 + 主题主色 + 首次上手引导
* fe9e01c  refactor: css/style.css 拆分为 10 个板块文件
* fabe551  refactor: 将 sw.js 移动到 js/ 目录下
* f5c12b2  feat: 新增 5 组主题主色切换 + 首次上手引导（8 步）
* 3d639c8  docs: AGENTS.md 同步当前项目结构 + 添加 Commit 描述中文规范
* 4315d21  CI: 复制 sw.js 到 native/web/ 目录
* 25b24fd  feat: offline tile cache + remove GPX export
* 605a166  feat: 圆心坐标度分秒(DMS)格式显示
* 1a578f7  feat: 度分秒(DMS)格式自动识别与转换十进制经纬度
* 4818ce6  chore: 移除 DPR 诊断显示，UA 覆盖方案已修复瓦片差异
* 8546173  feat: 自定义 MainActivity 覆盖 WebView UA 为桌面版以测试瓦片差异
* c06c0cd  debug: DPR 诊断从 Toast 移至 GNSS 卫星数量下方显示
* 3e53128  chore: 移除 GNSS 卫星数据已激活 Toast
* 612ac78  debug: 启动时 Toast 显示 DPR/缩放/WebView 状态，替代 DevTools 调试
* ab2a392  debug: 添加设备环境诊断日志，辅助排查手机端瓦片差异
* ac316b7  docs: 创建 AGENTS.md — Circlemap 项目指南
* 2a9ebcb  feat: 轨迹平滑算法 + 轨迹统计面板
* f5ae58f  feat: 轨迹按速度分段着色（蓝→青→黄绿→橙→红）
| * 5a7ea2e  [main] PR #14 — 精度三态+重叠染色+预设按钮+浅色主题+轨迹持久化+方位角+朝向箭头+删除撤销
|/|
* | a400c78  chore: bump version v9→v10
* | 45e5c4d  fix: 审查修复 — accent变量/撤销防双击/heading重置/漏传heading
* | 0ff3473  chore: bump version v8→v9
* | f6318dc  feat(P0): 方位角显示 + 罗盘朝向箭头 + 删除撤销
* | 28a1bf8  feat: 半径预设按钮、浅色主题Canvas颜色适配、轨迹持久化
* | 7eb59c7  feat: 多圆重叠区域染色加深（离屏Canvas分层绘制）
* | 2ad4e42  feat: 精度圈参与范围判断（三态：范围内/可能范围内/范围外）
|/
* afdd173  feat: 速度/海拔显示、主题切换、2行状态栏、绘图优化
* 4f98fea  docs: 添加 README.md — 项目说明与功能概览
* cc011f1  chore: merge dev → main (bug fixes & refactor)
*   3b1c7c0  feat: 手动定位加入最近定位列表，带 📍 手动 标记
|\
| * 0de426b  feat: 手动定位加入最近定位列表，带 📍 手动 标记
* | 59ceedd  fix: GPS状态栏不更新时间 & 双重初始化 bug
|\|
| * da1b70a  fix: 修复 app 双重初始化 bug
| * bbd906c  cleanup: 移除未使用的 _intervalId 字段
| * 20186e4  fix: 移除 _startInterval 封装，直接 setInterval
| * e26ad06  fix: _processPosition 末尾统一刷新UI
| * 02cb929  fix: 回退 _displayTime 分离
| * 6cb5b85  fix: GPS状态栏5项Bug修复
| * 41aec7b  feat: 圆圈标注全功能 (#1-#18)
|/
* ec6d605  手机端紧凑优化 + 持续追踪不移地图
* c5b40dc  优化：手机端页面紧凑布局 (#5)
* ace687f  美化：手机端布局优化
*   28f1ef5  Merge pull request #1 from hzr12/dev
|\
| * ae00b4d  修复：后台恢复不飞地图，watchPosition 失败显示错误提示
| * b951bb7  追踪改为纯 watchPosition，切后台自动停 GPS 省电
| * 29da0b5  GPS 模块精简：startWatching 支持自定义参数，清理无用常量
| * 1cac635  轮询替代 watchPosition，真正省电
| * 9007473  移动端面板折叠：点击把手收起/展开，默认收起
| * a91be7b  GPS节流 + 圆圈编辑
| * eead6af  GPS按钮：短按单次定位，长按切换持续追踪
| * 9a9423e  feat: expired position auto-relocate
| * 4023d49  feat: continuous GPS tracking, localStorage persistence, distance trend
|/
* 4e418df  状态条显示上次定位距今X分钟
* f2b800b  定位过期提醒：10分钟未更新显示⚠️
* e4132dd  同心圆间隔 1km → 2.5km
* 7d3ab22  距我距离 + 手机布局重构
* 4b03bff  const PI 改为 Math.PI，更新缓存版本戳
* fc29c14  GPS纠偏改为纯JS算法，移除不可靠的腾讯地图convertor API
* a568ff7  修复GPS纠偏无效：缺少convertor附加库
* 79b6160  GPS坐标纠偏：WGS84→GCJ-02
* ca8b2b8  修复缩放时圆圈偏移问题
* 0d34bf7  智能坐标解析、一键复制、页面改名
* fc56e91  增强自动定位：重试提示、位置标记、10秒超时
* 2f56abe  添加多圆列表UI与深色样式优化
* 3f87866  添加多圆支持与坐标对齐修复
* 58f6a99  优化手机端适配和GPS定位交互
* 4e31e89  添加HTML骨架和深色主题样式
* 7905a0a  添加地图管理和同心圆Canvas渲染
* a8af019  添加配置和GPS定位模块
```

## 版本对照

| Tag / Ref | 版本戳 | 说明 |
|-----------|--------|------|
| `v1.5.0-dev` | v105 | 二进制轨迹存储 + IndexedDB 重构 + 轨迹录制状态持久化/恢复 + 轨迹独立模式 + 底部常驻记录条 + 存储多引擎支持 + 实际定位间隔统计 |
| `v1.4.0` | v100 | 2D 卡尔曼滤波升级（ENU 米坐标 + 速度自适应 q 系数）+ 全面性能优化（Canvas 分层/链式节流/坐标缓存）+ 半径滑块真对数刻度 + 轨迹 50000 点上限 + 百度式速度自适应节流（1s~60s）+ 定位 marker 插值动画 + 报告地图高德瓦片底图 + 瓦片覆盖/速度曲线系列修复 + 房间模块重构 |
| `v1.3.0` | v92 | 多人联网对战（MQTT 5.0 + 房间/队伍/NPC 观战 + 圆同步 + 后台保活）+ 三态范围文字标签 + 卡尔曼滤波 + 活动报告导出 |
| `v1.2.0` | v50 | 离线瓦片缓存 + DMS 坐标解析/显示 + 主题主色 5 种 + 首次上手引导 8 步 + CSS 拆分为 10 模块 |
| `ac316b7` | v12 | 轨迹平滑 + 统计面板 |
| `f5ae58f` | v11 | 轨迹按速度着色 |
| `a400c78` | v10 | 审查修复 |
| `0ff3473` | v9  | 方位角+箭头+撤销 |
| `28a1bf8` | v8  | 预设按钮+浅色主题+轨迹持久化 |
| `7eb59c7` | v7  | 多圆重叠染色 |
| `2ad4e42` | v6  | 精度三态范围判断 |
| `afdd173` | v5  | 速度/海拔/主题/2行状态栏 |
| `cc011f1` | v4  | 重构+bug修复 |
| `ec6d605` | v3  | 手机紧凑+追踪不移地图 |
| `28f1ef5` | v2  | GPS持续追踪+持久化 |
| `a8af019` | v1  | 初始版本 |
