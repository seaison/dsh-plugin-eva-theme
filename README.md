<div align="center">

<img src="assets/svg/nerv-logo.svg" width="72" alt="NERV 标志" />

# DSH EVA Theme

**选择你的驾驶员，接入你的工作台。**

为 **DeepSeek Harness / DSH** 打造的 EVA 双角色主题插件。<br />明日香的红与黑，绫波丽的白与蓝；从启动认证到每一次对话，保持同一套角色配色与声音。

[![Release](https://img.shields.io/github/v/release/seaison/dsh-plugin-eva-theme?label=release&color=ff354d)](https://github.com/seaison/dsh-plugin-eva-theme/releases/latest) [![CI](https://github.com/seaison/dsh-plugin-eva-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/seaison/dsh-plugin-eva-theme/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/code-MIT-176b91)](LICENSE)

[**下载最新版本**](https://github.com/seaison/dsh-plugin-eva-theme/releases/latest) · [快速安装](#快速安装) · [启动体验](#启动体验) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/seaison/dsh-plugin-eva-theme/issues)

`dsh-plugin-eva-theme` · 当前版本 **v0.52.0**

</div>

## 双驾驶员，完整主题

切换明暗模式，即可切换驾驶员。全局界面、输入栏、菜单、设置、消息状态和主题组件一起换色，配合角色半身线稿与机体编号装饰。

| **02 · 明日香 / ASUKA LANGLEY** | **00 · 绫波丽 / REI AYANAMI** |
| :---: | :---: |
| 暗色模式 · 战斗服红、炭黑、橙金与绿色点缀 | 亮色模式 · 瓷白、冰蓝与少量红色标记 |

<p align="center"><img src="docs/screenshots/character-asuka.png" width="49%" alt="明日香暗色主题：红黑界面、角色线稿与 02 装甲纹样" /> <img src="docs/screenshots/character-rei.png" width="49%" alt="绫波丽亮色主题：白蓝界面、角色线稿与 00 环形纹样" /></p>

点击图片可查看完整预览。截图来自包含模拟会话和音乐数据的测试台；实际布局随宿主版本、窗口尺寸和字体有所差异。

- **驾驶员认证开场**：NERV GIF、警报、打字引导、插入栓装载与机械舱门，串起完整启动流程。
- **角色语音互动**：选择应答、启动语音、聊天欢迎，以及待审核／任务完成提醒，随当前驾驶员切换。
- **EVA 桌面组件**：时钟、系统音乐播放器、中央教条区、TPS 波形与计费时段信息。
- **可调的工作台**：组件尺寸、背景强度、声音提醒与排版选项即时生效，自动保存。

## 启动体验

> NERV GIF → 红色警报 →「选择你的驾驶员」逐字出现 → 驾驶员选择 → 语音同步 → 舱门开启 → 聊天欢迎

![驾驶员选择：左侧插入栓、右侧双驾驶员头像、橙色动态等高线](docs/screenshots/pilot-selection.png)

1. **系统唤醒**：两倍尺寸、两倍播放速度的 NERV GIF 开场，时长仍为 3.84 秒；接上约 3 秒的红色警报。
2. **选择驾驶员**：黑底标题伴随打字音效逐字出现，再归位到全屏选择页。橙色等高线持续起伏，插入栓保留倾角并缓慢转动表面标识。
3. **装载与同步**：将闭眼头像拖入插入栓，或直接点击／使用键盘选择。角色先回应，再播放完整启动语音；进度条与同步环跟随真实播放位置。
4. **进入工作台**：同步完成后，双侧机械舱门打开，角色背景衔接聊天界面，并播放对应欢迎语音。

启动背景音乐为鷺巣詩郎《EM20#070720》，角色说话时自动降低音量，进入聊天后停止。喇叭按钮可静音，启动过程可跳过。

启动文字支持 **中文 / 日本語 / English**，保存所选语言，角色语音保持日语。每个浏览器会话自动播放一次；点击显示设置中的「重新选择驾驶员」即可重播。系统开启「减少动态效果」时会跳过开场动画，保留静态选择与语音；切到后台会暂停相应动画和声音。

## 快速安装

**普通使用无需运行构建命令。图片、音频与生成后的客户端已包含在仓库和安装包中。**

1. 打开 [最新 Release](https://github.com/seaison/dsh-plugin-eva-theme/releases/latest)，下载 **Source code (zip)** 并解压；也可以克隆仓库。
2. 在 DeepSeek Harness / DSH 左侧打开「插件」→「添加插件」，在「包名或地址」中填写**解压后的项目目录路径**，按提示安装并启用。
3. 若宿主提示需要重载，按提示重载或重启应用；在启动页选择驾驶员即可进入对应主题。

安装时请保留完整目录，尤其是 `lib/`、`assets/`、`package.json` 和 `cordis.patch.yml`。

<details>
<summary>其他安装方式：仓库地址 / .tgz 安装包</summary>

插件管理器的「包名或地址」也可填写：

```text
https://github.com/seaison/dsh-plugin-eva-theme.git
```

Release 还提供标准 npm 格式的 `.tgz` 安装包。将其解压后，选择里面的 `package/` 目录安装。`SHA256SUMS.txt` 可用于核对下载文件的完整性。

</details>

<details>
<summary>升级旧版本与切换角色</summary>

从旧名 `dsh-eva-magi-theme` 升级时，先停用旧条目，再安装 `dsh-plugin-eva-theme`，避免同时启用两份皮肤。已有显示设置、组件尺寸和启动语言偏好会保留。

进入聊天后，点击会话顶栏的驾驶员开关可直接切换。**明日香 02 对应红黑暗色，绫波丽 00 对应白蓝亮色**。切换时头像滑动、机体纹样交替，支持页面过渡的客户端会从开关位置圆形展开新配色。仍可在「设置 → 通用设置 → 外观」选择跟随系统，启动页选择驾驶员也会保存对应明暗模式。

</details>

## 组件与个性化

点击**中央教条区的角色载入标识**，即可打开显示设定。常用尺寸和背景选项直接显示，装饰与排版选项可折叠；桌面面板停靠左侧，窄窗口使用底部抽屉。

| 组件 | 使用体验 |
| :--- | :--- |
| **时钟与仪表** | 默认倍率均为 1.5、宽约 235px；范围 0.6–5、步长 0.05，可加减、键盘调整或单项重置。 |
| **角色背景** | 半身线稿贴近输入框上沿，配合 02／00 几何纹样；可调背景强度。 |
| **系统音乐播放器** | 在 macOS 和 Windows 上检测系统音乐，支持暂停、上一首与下一首。Windows 检测到多个音源时可手动选择。 |
| **中央教条区与 TPS** | 展示当前载入的驾驶员和输出速度波形，随主题切换配色。 |
| **计费时段信息** | 低谷绿色、高峰红色；金额估算按插件规则展示，实际以服务方账单为准。 |
| **角色提示音** | 人工操作待审核或主会话任务正常完成时播放；可关闭，也可分别试听审核与完成语音。 |

组件跟随 DSH 页面缩放，可以覆盖输入栏；背景装饰不拦截输入。历史消息、错误、取消和子任务不会触发完成提示音。

## v0.52.0 更新

- **Windows 音乐播放控制**：读取系统媒体会话，支持多音源选择，并适配未注册系统媒体会话的网易云客户端。
- **会话顶栏驾驶员开关**：一键切换明日香 02 与绫波丽 00，头像与机体编号随主题滑动交替。

感谢 powang233 与 yaqishi 的贡献。[更新日志](CHANGELOG.md) · [贡献来源](NOTICE.md)

## v0.51.2 更新

本版重点改善官方客户端的启动体验：

- **进度从前半段正常推进**：修复语音已播放、进度仍停在 0%，随后跳到约 60% 的问题。
- **打字页衔接更平滑**：消除标题归位结束后重复淡入造成的瞬间闪烁。
- 保留角色应答、完整启动语音、背景音乐、舱门与欢迎语音的原有时序。

上一版 v0.51.1 已修复 macOS 启用全屏皮肤后窗口无法拖动的问题，并保留头像到插入栓的拖放操作。[修复说明](docs/macos-window-drag.md) · [全部更新记录](CHANGELOG.md)

## 兼容性与验证

| 环境 | 当前验证范围 |
| :--- | :--- |
| **官方 DeepSeek Harness 0.2.1-rc.2 · macOS** | 已实测明日香拖放、绫波丽点击装载及两位驾驶员的加载进度。 |
| **DSH Desktop 2.0.17 / 2.0.18** | 已验证插件与主题接口；核心颜色通过官方主题令牌覆盖。 |
| **Windows 10 1809+ / Windows 11** | 音乐播放器接入 Windows 系统媒体会话。已通过宿主模拟、浏览器回归及脚本检查，实际 Windows 播放器仍待实机验证。 [Microsoft API 文档](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager) |
| **Linux 客户端** | 主题与启动使用浏览器标准能力，系统音乐面板仅在有宿主媒体桥的平台上启用。 |

v0.51.2 通过 **880 项启动检查、2562 项布局检查**，另含客户端、macOS 拖动区域、提示音、资源与安装包验证。浏览器回归使用隔离测试台；真实客户端验收范围以上表为准。宿主升级后，局部装饰可能需要适配。

## 常见问题

<details>
<summary>如何重新播放启动动画，或更换驾驶员？</summary>

点击中央教条区角色标识，打开显示设定，选择「重新选择驾驶员」。日常只想换配色时，也可直接切换宿主的深色／浅色模式。

</details>

<details>
<summary>启动音乐为什么没有立即响起？</summary>

浏览器或桌面宿主可能限制自动播放。点击头像或喇叭按钮后会尝试播放；语音播放受阻时，可点击继续／重试，也可跳过进入聊天。

</details>

<details>
<summary>为什么没有显示音乐播放器？</summary>

播放器在检测到音乐播放后显示，并需要在显示设定中保持开启。Windows 需要播放器提供系统媒体会话，部分浏览器也需要启用系统媒体集成。网易云兼容路径通过窗口标题和音量峰值推断曲目与播放状态，曲目时长可能显示为「—」。系统同时存在其他媒体会话时，网易云兼容路径会停用系统媒体键操作，避免控制到另一来源。

</details>

## 开发与文档

开发要求 **Node.js 22.19+ 或 24+**，浏览器测试需要 Chrome / Chromium。项目零安装依赖。

```sh
npm run build        # 更新生成资源与文档
npm run check        # 静态一致性与文档链接检查
npm test             # 完整回归
npm run preview      # 本地模拟测试台
npm run perf:boot    # 驾驶员拖放性能采样
npm run release      # 验证、打包并生成校验值
```

<details>
<summary>项目目录</summary>

```text
assets/                 图片、音频、SVG、GIF、资源清单与工作线程
  source/               原始 GIF，仅开发使用
lib/                    主题客户端与宿主接口
tests/                  行为、资源、接口与布局回归
tools/                  构建、预览、性能采样与发布工具
docs/                   架构、色板、素材来源、截图和参考稿
```

图片和音频通过带内容摘要的同源资源地址加载；等高线计算在 Worker 中执行，不可用时使用同形状的回退。关闭或卸载插件会回收样式、资源、监听器和计时器。

</details>

[开发与贡献](CONTRIBUTING.md) · [架构说明](docs/architecture.md) · [主题令牌](docs/theme-tokens.md) · [性能记录](docs/performance.md) · [发布流程](docs/release.md)

## 素材与许可

这是一个 EVA 同人主题项目。代码采用 [MIT](LICENSE)；角色、品牌、音乐与语音素材的来源和许可说明见 [NOTICE](NOTICE.md)、[资源清单](docs/assets.md) 和 [音乐记录](docs/boot-music.md)。维护者已确认《EM20#070720》的再分发授权，公开安装包包含该音轨；代码许可不替代第三方素材的权利说明。

欢迎通过 [GitHub Issues](https://github.com/seaison/dsh-plugin-eva-theme/issues) 分享建议或反馈问题。请附上 DSH 版本、系统、主题模式、缩放比例与复现步骤；截图前隐藏账号和会话隐私。
