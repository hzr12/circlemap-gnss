# Changelog

```
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
