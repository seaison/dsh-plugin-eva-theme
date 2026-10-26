/*!
 * dsh-plugin-eva-theme v0.51.2 —— 浏览器半边（browser half）
 * MIT License
 *
 * 明日香（暗色）／绫波丽（亮色）双角色主题，覆盖 DSH 全部语义界面。
 *
 * 三条设计原则，按重要性排序：
 *
 *   1) 令牌优先于选择器。
 *      DSH 的配色由 `ctx.theme` 组合成主题快照，再由 ui-layout 以 inline style
 *      写到 <body> 上（`body.style.setProperty(name, value)`）。inline style 压过
 *      任何样式表规则，所以「用 CSS 覆盖 --dsw-alias-*」是不会生效的。本插件因此
 *      走官方通道 `ctx.theme.overrideTokens(source, tokens)`：令牌层叠在用户当前
 *      的 light/dark 主题之上，随主题切换自动解析，卸载时精确移除。
 *
 *   2) 只用语义别名，不碰静态调色板。
 *      `--dsw-alias-*` 是组件真正消费的那一层（107 个）。覆盖 `--dsw-static-*`
 *      会连带改掉语义无关的地方，属于过度侵入。
 *
 *   3) 装饰层与令牌层分离。
 *      扫描线 / 角色背景 / 硬边 / 明朝体这些令牌表达不了的东西，放在插件自有的
 *      样式表与覆盖层里，和插件同生共死；令牌层负责颜色与状态语义。
 *
 * 命名：值一律写成 [light, dark] 两套，这样用户切到浅色主题时皮肤不会崩成
 * 「黑底 + 深色文字」的混合体。暗色为明日香，浅色为绫波丽。
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-eva-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const PACKAGE_NAME = "dsh-plugin-eva-theme";
		const STYLE_TAG_ID = PACKAGE_NAME + ":skin";
		const OVERLAY_CLASS = "eva-magi-layer";
		// Keep the original persistence namespace so renamed installs retain preferences.
		const STORAGE_NAMESPACE = "dsh-eva-magi-theme";
		const OPTIONS_STORAGE_KEY = STORAGE_NAMESPACE + ":options";
		const BOOT_FLAG = STORAGE_NAMESPACE + ":booted";
		const BOOT_LANGUAGE_KEY = STORAGE_NAMESPACE + ":boot-language";
		const LAYOUT_STORAGE_KEY = STORAGE_NAMESPACE + ":layout";
		const CLOCK_PANEL_WIDTH = 392;
		const CLOCK_SCALE_UNIT = 0.4;
		/** 宿主半边提供的只读余额路由（见 lib/index.js）。 */
		const BALANCE_ROUTE = "/dsh-eva-magi/balance.json";
		/** 翻到余额面后自动翻回的时长。 */
		const AUTO_FLIP_BACK_MS = 8000;
		// DSH 适配集中在这里：优先语义属性，内部元素只匹配局部作用域内的可读后缀。
		const HOST_HOOKS = Object.freeze({
			header: "[data-conversation-header]",
			turnProcess: "[data-turn-process]",
			composer: "[data-composer-card]",
			region: "[data-conversation-region]",
			rightFullscreen: '[data-sidebar-right-open][data-sidebar-right-panel="fullscreen"]',
			sidebar: '[data-slot="sidebar"] [class*="_root"]:has(> nav[class*="_panelList"])',
			newSession: '[data-slot="sidebar"] button[class*="_newSession"]',
			placeholder: '[data-composer-card] [class*="_placeholder"]',
			add: '[data-composer-card] [class*="_add"]',
			send: '[data-composer-card] [class*="_primary"]',
		});

		/**
		 * 设置面板的重绘钩子，由 mountChrome 装上。
		 * 存在的理由：setOption 定义在 apply 里，而面板构建在 mountChrome 里 ——
		 * 用这个工厂级变量把两边接起来，让 Console 改值也能同步到面板控件上。
		 */
		let refreshPanelRef = null;

		/** 标签块的重绘钩子（峰谷状态/倒计时）。同上：把 mountChrome 与 setOption 接起来。 */
		let refreshTagsRef = null;
		let refreshLayoutRef = null;
		let resetLayoutRef = null;
		let replayBootRef = null;
		let cancelBootRef = null;
		let previewAttentionRef = null;
		let refreshAttentionRef = null;
		/** 客户端 sessions 服务（子作用域注入）。TPS 波形靠它读 sessionStats 投影。 */
		let sessionsRef = null;


		// ============================================================
		// 1. 调色板：设计令牌表
		// ------------------------------------------------------------
		// 键名 → `--dsw-alias-<键名>`；值 → [浅色, 深色]。
		//
		// 暗色：明日香，参考角色图的战斗服红／黑，领口绿与发色橙金点缀。
		// 浅色：绫波丽，瓷白／冰蓝／少量红色标记。
		// 所有 107 个官方别名均保留；成功、警告、错误与差异仍有独立语义。
		// ============================================================
		const PALETTE = {
			// —— 画布与表面：分三层，越靠前越亮，靠发丝线而不是阴影分隔 ——
			"bg-base": ["#eff6fa", "#0d0f13"],
			"bg-layer-1": ["#f7fbfd", "#14171c"],
			"bg-layer-2": ["#ffffff", "#1c2028"],
			"bg-layer-3": ["#e4eef5", "#272c35"],
			"bg-overlay": ["#ffffff", "#20252d"],
			"bg-module-platform": ["#eaf2f7", "#181c23"],
			"bg-multi-select": ["#23799d1f", "#ff354d1a"],
			"bg-skeleton": ["#0000000a", "#ffffff0f"],
			"bg-document-preview": ["#f7fbfd", "#14171c"],
			"label-document-preview": ["#476173", "#dacbc0"],
			"bg-document-selection": ["#23799d52", "#ff354d59"],

			// 遮罩保持黑/白中性，保持阅读层级
			"bg-mask-1": ["#0000003d", "#0000005c"],
			"bg-mask-2": ["#0000001f", "#00000033"],
			"bg-mask-3": ["#0000007a", "#0000008a"],
			"bg-mask-drop": ["#ffffffb3", "#181c23cc"],
			"bg-mask-photo": ["#000000e0", "#000000e6"],

			// —— 边框：角色主色发丝线，四级递进 ——
			"border-l1": ["#28698a17", "#f33a5124"],
			"border-l2": ["#28698a29", "#f33a513d"],
			"border-l3": ["#28698a40", "#f33a5157"],
			"border-l4": ["#28698a59", "#f33a517a"],
			"border-l2-darkmode-thin": ["#28698a29", "#f33a511f"],
			"border-inverted": ["#0000", "#0000"],
			"border-inverted2": ["#0000", "#0000"],

			// —— 文本：角色文本阶梯。明朝/哥特都靠这四级拉开层级 ——
			"label-primary": ["#203849", "#fff1e7"],
			"label-secondary": ["#476173", "#c6b7ac"],
			"label-tertiary": ["#526c7c", "#b3a294"],
			"label-caption": ["#718998", "#8e8178"],
			"label-primary-dimmed": ["#314d60", "#dacbc0"],
			// 官方定义是 blue-900 / neutral-bluish-50；这里收成暖中性，只为保留
			// 「它和 label-primary 有细微差别」这一层语义，不再往蓝偏。
			"label-primary-bluish": ["#263f52", "#fff5ef"],
			"label-dimmed": ["#b6cad7", "#63646a"],
			"label-primary-inverted": ["#ffffff", "#101116"],
			"label-primary-foreground": ["#ffffff", "#101116"],
			"label-shimmer": ["#2f7190", "#ff9ca8"],
			"label-deep-diving": ["#176b91", "#ff354d"],
			"label-deep-diving-shimmer": ["#2f7190", "#ff9ca8"],

			// —— 品牌色＝主色：亮色蓝底白字／暗色珊瑚底深字 ——
			"brand-primary": ["#176b91", "#ff354d"],
			// 官方这一对是 浅色 #0f1115 / 深色 #f9fafb（浅色侧更暗）——它在官方 bundle 里
			// 找不到消费方，所以这里只做一件事：保持与官方同向的极性，别把任何潜在用途弄反。
			"brand-primary-invert": ["#1a0c10", "#fff1e7"],
			"brand-primary-new-colorprimary-new-color": ["#176b91", "#ff354d"],
			"brand-text": ["#28698a", "#ff5967"],

			// —— 按钮 ——
			"button-primary-fill": ["#176b91", "#ff354d"],
			"button-primary-hover": ["#115777", "#ff5967"],
			"button-primary-dimmed": ["#176b9133", "#ff354d47"],
			"button-contrast-fill": ["#314d60", "#fff1e7"],
			"button-elevated-fill": ["#ffffff", "#30363f"],
			"button-floating-fill": ["#ffffff", "#1b2027"],
			"button-floating-hover": ["#eaf2f7", "#30363f"],
			"button-ghost-active-fill": ["#23799d1f", "#ff354d1f"],
			"button-ghost-active-border": ["#23799d59", "#ff354d59"],
			"button-ghost-active-hover": ["#23799d2e", "#ff354d2e"],
			"button-info-fill": ["#2672631f", "#8dc3581f"],
			"button-info-hover": ["#26726333", "#8dc35833"],
			"button-tool-bar-fill": ["#f7fbfd", "#1b2027"],
			"button-tool-bar-fill-invisible": ["#0000", "#0000"],
			"button-tool-bar-hover": ["#23799d1f", "#ff354d1f"],

			// —— 交互反馈：跟随角色主色 ——
			"interactive-bg-hover": ["#23799d14", "#ff354d14"],
			"interactive-bg-hover-accent": ["#23799d24", "#ff354d24"],
			"interactive-bg-hover-danger": ["#ad3d571f", "#ff849424"],
			"interactive-bg-hover-solid": ["#00000014", "#ffffff1a"],
			"interactive-bg-active": ["#23799d24", "#ff354d24"],

			// —— 状态语义：这套皮肤里业务色跟随角色，焦点环也吃它 ——
			"state-business-primary": ["#176b91", "#ff354d"],
			"state-business-tertiary": ["#176b9159", "#ff354d66"],
			"state-success-primary": ["#267263", "#8dc358"],
			"state-success-secondary": ["#267263cc", "#8dc358cc"],
			"state-success-tertiary": ["#26726359", "#8dc35866"],
			"state-warn-primary": ["#926008", "#e5a24f"],
			"state-warn-secondary": ["#926008cc", "#e5a24fcc"],
			"state-warn-tertiary": ["#92600859", "#e5a24f66"],
			"state-warn-label": ["#805408", "#e5a24f"],
			"state-error-primary": ["#ad3d57", "#ff8494"],
			"state-error-secondary": ["#ad3d57cc", "#ff8494cc"],
			"state-idle-primary": ["#9eb6c5", "#686b73"],
			"link": ["#28698a", "#ff8290"],

			// —— 滚动条：角色色细条，像仪表刻度 ——
			"scrollbar-bg-l1": ["#28698a2e", "#f33a512e"],
			"scrollbar-bg-l2": ["#28698a24", "#f33a5124"],
			"scrollbar-hover-l1": ["#28698a59", "#f33a515c"],
			"scrollbar-hover-l2": ["#28698a47", "#f33a5147"],

			// —— 浮层 ——
			// 注意 tooltip-bg：官方设计里它「两种色板都是深底」，而 DSH 并没有
			// tooltip-label 令牌——气泡里的文字颜色不由皮肤决定。这里的覆盖只保证
			// 不改变它在浅/深两套里的极性（依然是深底），免得把官方组件的文字弄没。
			"menu-icon": ["#314d60", "#dacbc0"],
			"menu-group-header-fill": ["#f7fbfdf0", "#14171cf0"],
			"tooltip-bg": ["#203b4cf2", "#272c35f2"],
			"tooltip-key-bg": ["#3d596a", "#37404b"],
			"toast-bg": ["#203b4cf7", "#272c35f7"],
			"toast-label": ["#eff6fa", "#fff1e7"],

			// —— 开关 / 设置卡片 ——
			"switch-thumb": ["#ffffff", "#ffe1bb"],
			"settings-card-fill": ["#f7fbfd", "#14171c"],
			"settings-card-stroke": ["#28698a29", "#f33a5133"],

			// —— Markdown / 代码 ——
			"markdown-code-block": ["#eaf2f7", "#10141a"],
			"markdown-code-block-banner": ["#e4eef5", "#1c2028"],
			"markdown-inline-code": ["#23799d1a", "#ff354d1f"],
			"markdown-citation": ["#23799d24", "#ff354d24"],
			"markdown-tag": ["#2672631f", "#8dc3581f"],
			"markdown-placeholder": ["#839aa9", "#8e8178"],
			"markdown-code-segment-selected": ["#23799d33", "#ff354d33"],
			"markdown-code-segment-unselected": ["#0000000f", "#ffffff14"],
			"code-diff-added": ["#2672631f", "#8dc3581f"],
			"code-diff-deleted": ["#ad3d571f", "#ff84941f"],

			// —— 文件差异（对齐 code-diff 的语义） ——
			"file-diff-added-bg": ["#26726314", "#8dc35814"],
			"file-diff-added-gutter": ["#26726324", "#8dc35824"],
			"file-diff-added-marker": ["#267263", "#8dc358"],
			"file-diff-deleted-bg": ["#ad3d5714", "#ff849414"],
			"file-diff-deleted-gutter": ["#ad3d5724", "#ff849424"],
			"file-diff-deleted-marker": ["#ad3d57", "#ff8494"],

			// —— 引导页 ——
			"onboarding-accent": ["#176b91", "#ff354d"],
			"onboarding-card-fill": ["#f7fbfd", "#14171c"],
			"onboarding-checkbox-border": ["#28698a59", "#f33a5159"],
			"onboarding-secondary-fill": ["#eaf2f7", "#272c35"],

			// —— 回合触发器 ——
			"turn-trigger-bg": ["#23799d12", "#ff354d12"],
			"turn-trigger-bg-hover": ["#23799d1f", "#ff354d1f"],
		};

		// 启动角色与正文共用色板，避免字体和头像出现另一套红／蓝。
		const BOOT_THEMES = Object.freeze(Object.fromEntries([["asuka", 1], ["rei", 0]].map(([id, mode]) => [id, Object.freeze(Object.fromEntries(Object.entries({
			accent: "brand-primary", ink: "label-primary", dim: "label-secondary", surface: "bg-base", panel: "bg-layer-1", line: "border-l4", signal: "state-warn-primary", ok: "state-success-primary",
		}).map(([role, token]) => [role, PALETTE[token][mode]])))])));
		const bootThemeCSS = (id, prefix) => Object.entries(BOOT_THEMES[id]).map(([role, value]) => "--" + prefix + "-" + role + ":" + value + ";").join("");

		// BEGIN GENERATED ASSET INDEX
		// Generated by tools/build-assets.mjs: small SVG markup and versioned same-origin URLs.
		const BRAND_ASSETS = Object.freeze({
			boot: "/dsh-eva-magi/assets/animations/nerv-boot.gif?v=32d689fa2a8b",
			logo: "/dsh-eva-magi/assets/svg/nerv-logo.svg?v=c517c9bc95b3",
			emergency: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1000 1000\" preserveAspectRatio=\"xMidYMid slice\" fill=\"none\">\n  <title>NERV EMERGENCY</title>\n  <defs>\n    <path id=\"eva-alert-hex\" d=\"M-120 0-60-104H60L120 0 60 104H-60Z\"/>\n    <g id=\"eva-alert-tile\">\n      <use href=\"#eva-alert-hex\" fill=\"#ef060c\" stroke=\"#df0308\" stroke-width=\"5\"/>\n      <path d=\"M0-66-22-30H22ZM-22 29H22L0 65Z\" fill=\"#030101\"/>\n      <text x=\"0\" y=\"9\" fill=\"#030101\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"26\" font-weight=\"800\" text-anchor=\"middle\" textLength=\"195\" lengthAdjust=\"spacingAndGlyphs\">EMERGENCY</text>\n    </g>\n    <pattern id=\"eva-alert-scan\" width=\"4\" height=\"4\" patternUnits=\"userSpaceOnUse\">\n      <path d=\"M0 .5H4\" stroke=\"#000\" stroke-opacity=\".24\"/>\n      <path d=\"M.5 0V4\" stroke=\"#260000\" stroke-opacity=\".08\"/>\n    </pattern>\n    <filter id=\"eva-alert-grain\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\">\n      <feTurbulence type=\"fractalNoise\" baseFrequency=\".72\" numOctaves=\"3\" seed=\"19\"/>\n      <feColorMatrix type=\"saturate\" values=\"0\"/>\n    </filter>\n  </defs>\n  <path fill=\"#000\" d=\"M0 0H1000V1000H0Z\"/>\n  <g class=\"eva-alert-honeycomb\" stroke-linejoin=\"miter\">\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.16s\"><use href=\"#eva-alert-tile\" transform=\"translate(363 173)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.74s\" opacity=\".78\"><use href=\"#eva-alert-tile\" transform=\"translate(565 67)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.42s\"><use href=\"#eva-alert-tile\" transform=\"translate(565 280)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.95s\"><use href=\"#eva-alert-tile\" transform=\"translate(767 174)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.32s\" opacity=\".28\"><use href=\"#eva-alert-tile\" transform=\"translate(767 -38)\"/></g>\n    <use href=\"#eva-alert-hex\" transform=\"translate(969 67)\" stroke=\"#df0308\" stroke-width=\"7\"/>\n    <use href=\"#eva-alert-hex\" transform=\"translate(-49 793)\" stroke=\"#df0308\" stroke-width=\"7\"/>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.64s\"><use href=\"#eva-alert-tile\" transform=\"translate(132 899)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.11s\" opacity=\".65\"><use href=\"#eva-alert-tile\" transform=\"translate(334 793)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.83s\"><use href=\"#eva-alert-tile\" transform=\"translate(334 1005)\"/></g>\n    <g class=\"eva-alert-cell\" style=\"--alert-lag:-.36s\" opacity=\".24\"><use href=\"#eva-alert-tile\" transform=\"translate(-70 1005)\"/></g>\n    <use href=\"#eva-alert-hex\" transform=\"translate(536 899)\" stroke=\"#df0308\" stroke-width=\"7\"/>\n    <use href=\"#eva-alert-hex\" transform=\"translate(1128 899)\" stroke=\"#df0308\" stroke-width=\"7\"/>\n  </g>\n  <g class=\"eva-alert-wordmark\" fill=\"#ed050b\">\n    <text x=\"-25\" y=\"558\" font-family=\"Baskerville,'Times New Roman',serif\" font-size=\"218\" textLength=\"578\" lengthAdjust=\"spacingAndGlyphs\">NERV</text>\n    <path d=\"M570 416H939V484H549ZM546 496H1016V565H524Z\"/>\n    <g fill=\"#070000\" font-family=\"'Times New Roman',Baskerville,serif\">\n      <text x=\"572\" y=\"466\" font-size=\"37\" textLength=\"344\" lengthAdjust=\"spacingAndGlyphs\">God's In His Heaven</text>\n      <text x=\"547\" y=\"544\" font-size=\"35\" textLength=\"432\" lengthAdjust=\"spacingAndGlyphs\">All's Right With The World</text>\n    </g>\n    <text data-emergency-clock=\"\" x=\"459\" y=\"653\" text-anchor=\"middle\" font-family=\"'Times New Roman',Baskerville,serif\" font-size=\"96\" textLength=\"420\" lengthAdjust=\"spacingAndGlyphs\">09:58:57</text>\n  </g>\n  <path fill=\"url(#eva-alert-scan)\" d=\"M0 0H1000V1000H0Z\"/>\n  <path fill=\"#fff\" filter=\"url(#eva-alert-grain)\" opacity=\".045\" d=\"M0 0H1000V1000H0Z\"/>\n</svg>\n",
			entryPlug: "<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"eva-entry-plug\" viewBox=\"0 0 400 800\" fill=\"none\" aria-hidden=\"true\">\n  <defs>\n    <linearGradient id=\"eva-plug-shell\" x1=\"129\" y1=\"0\" x2=\"271\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">\n      <stop stop-color=\"#9aa8a8\"/><stop offset=\".16\" stop-color=\"#dce3df\"/><stop offset=\".43\" stop-color=\"#fffff3\"/><stop offset=\".7\" stop-color=\"#f5f4e7\"/><stop offset=\"1\" stop-color=\"#aab6b3\"/>\n    </linearGradient>\n    <linearGradient id=\"eva-plug-cap\" x1=\"129\" y1=\"0\" x2=\"271\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">\n      <stop stop-color=\"#82542d\"/><stop offset=\".25\" stop-color=\"#d19b59\"/><stop offset=\".57\" stop-color=\"#f5cd87\"/><stop offset=\"1\" stop-color=\"#a2703e\"/>\n    </linearGradient>\n    <linearGradient id=\"eva-plug-gold\" x1=\"129\" y1=\"0\" x2=\"271\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">\n      <stop stop-color=\"#85621f\"/><stop offset=\".4\" stop-color=\"#e4bd4f\"/><stop offset=\".7\" stop-color=\"#f8d96e\"/><stop offset=\"1\" stop-color=\"#a78630\"/>\n    </linearGradient>\n    <clipPath id=\"eva-plug-outline\"><rect x=\"129\" y=\"54\" width=\"142\" height=\"692\" rx=\"71\"/></clipPath>\n  </defs>\n  <!-- 背部导轨与定位线独立于白色密封筒，装载时仍保留完整轮廓。 -->\n  <g stroke=\"var(--boot-line)\" stroke-width=\"1\">\n    <path d=\"M105 115v578m190-578v578M96 115h18m-18 578h18m172-578h18m-18 578h18\"/>\n    <path d=\"M105 202h22m146 0h22M105 588h22m146 0h22\" stroke-dasharray=\"3 4\"/>\n  </g>\n  <g clip-path=\"url(#eva-plug-outline)\" stroke=\"#677778\" stroke-width=\"1.4\" stroke-linejoin=\"round\">\n    <rect x=\"129\" y=\"54\" width=\"142\" height=\"692\" rx=\"71\" fill=\"url(#eva-plug-shell)\"/>\n    <path d=\"M129 54h142v107c-40 9-102 9-142 0z\" fill=\"url(#eva-plug-cap)\"/>\n    <path d=\"M129 158q71 13 142 0v14q-71 13-142 0z\" fill=\"#333e42\"/>\n    <path class=\"eva-plug-band\" d=\"M129 172q71 13 142 0v29q-71 13-142 0z\" fill=\"var(--boot-accent)\" stroke=\"#36444a\"/>\n    <path d=\"M129 202q71 13 142 0M129 257q71 12 142 0M129 571q71 12 142 0M143 212v349m112-349v349\" opacity=\".6\"/>\n    <g class=\"eva-plug-roll eva-plug-roll-front\">\n    <path d=\"M148 217h20v27h-20zM232 217h20v27h-20zM154 226h8m76 0h8\" stroke=\"#879492\"/>\n    <!-- 橙色鼻锥的检修盖、锁孔与通气槽。 -->\n    <path d=\"M167 76q33-13 66 0l4 33q-37 9-74 0z\" fill=\"#f2c47d\"/>\n    <path d=\"M174 84h52m-48 9h44M151 126v19m98-19v19\" stroke=\"#896a44\"/>\n    <g fill=\"#535d57\" stroke=\"#b98c53\">\n      <circle cx=\"154\" cy=\"111\" r=\"3\"/><circle cx=\"246\" cy=\"111\" r=\"3\"/>\n      <circle cx=\"155\" cy=\"151\" r=\"2.5\"/><circle cx=\"245\" cy=\"151\" r=\"2.5\"/>\n    </g>\n    <path d=\"M180 132q20-10 40 0l-4 9h-32z\" fill=\"#333e42\" stroke=\"#a37b46\"/>\n    <!-- 长筒侧面机体喷字与面板接缝。 -->\n    <g transform=\"rotate(90 200 338)\" fill=\"#344247\" stroke=\"none\" text-anchor=\"middle\">\n      <text x=\"200\" y=\"336\" class=\"eva-plug-stencil\">EVA-<tspan data-boot-unit>02</tspan></text>\n      <text x=\"200\" y=\"353\" class=\"eva-plug-micro\">NERV · DIRECT ENTRY SYSTEM</text>\n    </g>\n    <path d=\"M157 281h-8v110h8m86-110h8v110h-8\" stroke=\"#93a09c\"/>\n    <path d=\"M166 406h68v9h-68z\" fill=\"#e6e8dc\"/>\n    <path d=\"M176 410h48\" stroke=\"var(--boot-accent)\"/>\n    <!-- L.C.L. 观察舱；驾驶员轮廓由同一坐标系的透明蒙版覆盖。 -->\n    <path d=\"M162 433l-10 13v83l10 14h76l10-14v-83l-10-13z\" fill=\"#b3bfba\" stroke=\"#536467\" stroke-width=\"2\"/>\n    <path d=\"M168 443h64l7 9v71l-7 10h-64l-7-10v-71z\" fill=\"#182b30\"/>\n    <path d=\"M166 450h12m44 0h12m-68 73h12m44 0h12\" stroke=\"var(--boot-accent)\" stroke-width=\"2\"/>\n    <path d=\"M173 462h54m-54 13h54m-54 13h54m-54 13h54m-54 13h54\" stroke=\"#709c94\" opacity=\".17\"/>\n    <g fill=\"#657571\" stroke=\"#dce2d5\"><circle cx=\"160\" cy=\"440\" r=\"2\"/><circle cx=\"240\" cy=\"440\" r=\"2\"/><circle cx=\"160\" cy=\"535\" r=\"2\"/><circle cx=\"240\" cy=\"535\" r=\"2\"/></g>\n    <path d=\"M185 552h30m-25 6h20\" stroke=\"#73817b\"/>\n    </g>\n    <g class=\"eva-plug-roll eva-plug-roll-back\" stroke=\"#84918b\">\n      <path d=\"M177 228h46v330h-46zM188 236v310m24-310v310\" fill=\"#e8e9dd\"/>\n      <path d=\"M181 276h38m-38 9h38m-38 9h38m-38 155h38m-38 9h38m-38 9h38\"/>\n      <g transform=\"rotate(90 200 357)\" fill=\"#465450\" stroke=\"none\" text-anchor=\"middle\">\n        <text x=\"200\" y=\"358\" class=\"eva-plug-micro\">NERV / SERVICE ACCESS · L.C.L.</text>\n      </g>\n      <path d=\"M181 506h38v28h-38z\" fill=\"#d5ad4c\"/><path d=\"m188 528 12-17 12 17z\" fill=\"#344247\"/>\n      <path d=\"M188 85h24v55h-24z\" fill=\"#bd894e\"/><path d=\"M193 96h14m-14 8h14m-14 8h14m-14 8h14\"/>\n    </g>\n    <!-- 与参考模型相同的金色宽环、石墨色护套和橙色三角整流片。 -->\n    <g class=\"eva-plug-collar\">\n      <path d=\"M129 583q71 12 142 0v55q-71 12-142 0z\" fill=\"url(#eva-plug-gold)\" stroke=\"#494f41\" stroke-width=\"2\"/>\n      <path d=\"M129 582q71 12 142 0m-142 59q71 12 142 0\" stroke=\"#29383d\" stroke-width=\"6\"/>\n      <path d=\"M129 646q71 12 142 0v53q-71 12-142 0z\" fill=\"#4a595d\" stroke=\"#304247\"/>\n      <path class=\"eva-plug-roll eva-plug-roll-front\" d=\"M145 654l15 37h-17zM178 657l14 39h-22zM211 658l12 38h-22zM245 654l10 36h-22z\" fill=\"#ee9b41\" stroke=\"#263c42\" stroke-width=\"2\"/>\n      <path d=\"M129 702q71 12 142 0\" stroke=\"#7a8780\"/>\n    </g>\n    <path d=\"M168 718q32 9 64 0m-53 10q21 5 42 0\" stroke=\"#97a19a\"/>\n    <path d=\"M145 90v61m0 63v347m0 148v9\" stroke=\"#fffbe5\" stroke-width=\"3\" opacity=\".5\"/>\n  </g>\n  <rect x=\"129\" y=\"54\" width=\"142\" height=\"692\" rx=\"71\" stroke=\"#889694\" stroke-width=\"1.8\"/>\n  <g class=\"eva-plug-callouts\" fill=\"none\" stroke=\"var(--boot-line)\" stroke-width=\"1\">\n    <path d=\"M269 228h35v-15h28M130 486H83v18H65M270 610h36v18h24\"/>\n    <g fill=\"var(--boot-dim)\" stroke=\"none\" class=\"eva-plug-micro\"><text x=\"299\" y=\"205\">A10</text><text x=\"41\" y=\"518\">L.C.L.</text><text x=\"290\" y=\"642\">LOCK</text></g>\n    <circle cx=\"269\" cy=\"228\" r=\"2\" fill=\"var(--boot-accent)\"/><circle cx=\"130\" cy=\"486\" r=\"2\" fill=\"var(--boot-accent)\"/>\n  </g>\n</svg>\n",
			asukaPortrait: "/dsh-eva-magi/assets/images/asuka-portrait-lineart.png?v=5487f9519bc1",
			asukaHead: "/dsh-eva-magi/assets/images/asuka-avatar-closed-eyes.png?v=cda9acf24d32",
			asukaVoice: "/dsh-eva-magi/assets/audio/asuka-voice-boot.mp3?v=8215dd8831b5",
			asukaVoiceDuration: 6.713469,
			asukaPickVoice: "/dsh-eva-magi/assets/audio/asuka-voice-select.mp3?v=39b91f1dd1c4",
			asukaApproval: "/dsh-eva-magi/assets/audio/asuka-voice-approval.mp3?v=d968f4878857",
			asukaComplete: "/dsh-eva-magi/assets/audio/asuka-voice-complete.mp3?v=f88316c1519c",
			reiPortrait: "/dsh-eva-magi/assets/images/rei-portrait-lineart.png?v=1d22c5a34557",
			reiHead: "/dsh-eva-magi/assets/images/rei-avatar-closed-eyes.png?v=cfbf109cf82b",
			reiVoice: "/dsh-eva-magi/assets/audio/rei-voice-boot.mp3?v=4a4aad865e71",
			reiVoiceDuration: 6.556735,
			reiPickVoice: "/dsh-eva-magi/assets/audio/rei-voice-select.mp3?v=ffe2e9857b36",
			reiApproval: "/dsh-eva-magi/assets/audio/rei-voice-approval.mp3?v=6e7870f6bb1d",
			reiComplete: "/dsh-eva-magi/assets/audio/rei-voice-complete.mp3?v=8762550e287c",
			bootBgm: "/dsh-eva-magi/assets/audio/nerv-boot-music.mp3?v=bd145dc69e76",
			contourWorker: "/dsh-eva-magi/assets/workers/boot-contours.js?v=f49bfc8ad0a6",
			asukaWelcome: "/dsh-eva-magi/assets/audio/asuka-voice-welcome.mp3?v=643309fadbc2",
			reiWelcome: "/dsh-eva-magi/assets/audio/rei-voice-welcome.mp3?v=eaa5ce90e76b",
			typing: "/dsh-eva-magi/assets/audio/nerv-ui-typing.mp3?v=2d940e2128c8",
			width: 256, height: 256, frames: 48, durationMs: 3840, cycleDurationMs: 1920, playbackRate: 2,
		});
		// END GENERATED ASSET INDEX

		// ============================================================
		// 2. 皮肤样式表（令牌表达不了的东西）
		// ------------------------------------------------------------
		// 全部规则都挂在 html[data-eva-*] 上：选项关掉即失效，插件卸载即整表移除。
		// 圆角令牌不在主题快照里（快照只含 107 个 --dsw-alias-*），所以它可以用
		// 普通 CSS 覆盖；但默认圆角是 panel 28px，压到 0 是本皮肤最激进的一刀，
		// 因此单独做成可关的开关。
		// ============================================================
		const SKIN_CSS = `
/* ============================================================================
   0. 令牌表达不了的部分：形状、数字、明朝体
   ============================================================================ */

/* 角色色桥：宿主别名覆盖全部 UI；装饰也从同一套颜色取值。
   变量挂在 body，保证 portal 菜单、开机序列和覆盖层均能继承。 */
html[data-eva-magi] body{
  --eva-accent:var(--dsw-alias-brand-primary);
  --eva-ink:var(--dsw-alias-label-primary);
  --eva-dim:var(--dsw-alias-label-tertiary);
  --eva-hair:var(--dsw-alias-border-l2);--eva-line:var(--dsw-alias-border-l3);
  --eva-on-accent:var(--dsw-alias-label-primary-foreground);
  --eva-secondary:#a7425d;--eva-mark:#a7425d;
  --eva-surface:var(--dsw-alias-bg-layer-1);
  --eva-control:color-mix(in srgb,var(--eva-surface) 96%,transparent);
  --eva-control-hover:color-mix(in srgb,var(--eva-accent) 9%,var(--eva-surface));
  --eva-control-active:color-mix(in srgb,var(--eva-accent) 15%,var(--eva-surface));
  --eva-shadow:rgba(29,66,88,.14);
  --eva-ghost:color-mix(in srgb,var(--eva-accent) 9%,var(--eva-surface));
  --eva-panel:color-mix(in srgb,var(--eva-surface) 96%,transparent);
  --eva-pilot-font:"Songti SC","STSong","Noto Serif CJK SC",serif;
  background-color:var(--dsw-alias-bg-base);color:var(--eva-ink);
  accent-color:var(--eva-accent);
}
html[data-eva-magi] body[data-ds-dark-theme]{
  --eva-secondary:#e5a24f;--eva-mark:#8dc358;--eva-shadow:rgba(3,5,9,.48);
}

/* 用户提供的 NERV 叶徽：静态矢量装饰，跟随角色配色，不进入辅助技术阅读流。 */
.eva-nerv-logo{display:block;flex:0 0 auto;width:20px;height:23px;background:var(--eva-accent);
  -webkit-mask:url("${BRAND_ASSETS.logo}") center/contain no-repeat;
  mask:url("${BRAND_ASSETS.logo}") center/contain no-repeat}
body:not([data-ds-dark-theme]) .eva-nerv-logo{background:var(--eva-secondary)}
.eva-cp-top .eva-nerv-logo{width:15px;height:17px}
.eva-mp-crest{position:absolute;left:50%;top:50%;width:28px;height:32px;transform:translate(-50%,-50%)}

/* 深度求索与活动过程沿用宿主动画，只将正文、鲸尾及扫光同步到当前角色。 */
html[data-eva-magi] body [data-chat-running],
html[data-eva-magi] body [data-process-activity]:has([data-shimmer]),
html[data-eva-magi] body [data-turn-process]:has([data-shimmer]){
  color:var(--eva-accent);
  --dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer);
}

/* 硬边：EVA 的世界里没有圆角 */
html[data-eva-edges="hard"]{
  --dsw-radius-xs:0px;--dsw-radius-sm:0px;--dsw-radius-md:0px;
  --dsw-radius-lg:0px;--dsw-radius-xl:0px;--dsw-radius-panel:0px;
}
/* HUD 数字：等宽对齐，读数不会随内容跳动 */
html[data-eva-nums="on"] body{font-variant-numeric:tabular-nums}
/* 选区用主色 */
html[data-eva-magi] ::selection{
  background:var(--dsw-alias-bg-document-selection);
  color:var(--dsw-alias-label-primary);
}
/* 标题走明朝体：拉丁仍吃系统无衬线，只有汉字落到明朝。
   靠 font-family 的逐字符回退实现，且只作用于 h1~h3 —— 明朝体横画很细，
   小字号在暗底会糊（这是 nerv-hud 实测到的教训）。 */
html[data-eva-mincho="on"] :is(h1,h2,h3):not(:where(.eva-boot-title)){
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,
    "Hiragino Mincho ProN","Hiragino Mincho Pro",YuMincho,"Yu Mincho","Songti SC",serif;
  letter-spacing:.01em;
}
html[data-eva-mincho="on"] :is(h1,h2,h3,strong){-webkit-text-stroke:.2px currentColor}

/* ============================================================================
   1. 覆盖层：CRT 质感 + 结构性装饰
   所有装饰都在 .eva-magi-layer 里，pointer-events:none，只影响像素。
   颜色一律用主题令牌，所以浅/深两套自动跟随。
   ============================================================================ */
.${OVERLAY_CLASS}{
  position:fixed;inset:0;pointer-events:none;z-index:2147483000;
}
.${OVERLAY_CLASS}>*{position:absolute;display:block}
.${OVERLAY_CLASS} [hidden]{display:none!important}
/* 宿主模态弹窗拥有完整交互层；皮肤组件及立绘不覆盖其遮罩和按钮。 */
body:has([role="dialog"][aria-modal="true"]:not(.eva-boot):not([hidden]):not([aria-hidden="true"])) .${OVERLAY_CLASS}{visibility:hidden}
.${OVERLAY_CLASS}[data-paused] *, .${OVERLAY_CLASS}[data-paused] *::before, .${OVERLAY_CLASS}[data-paused] *::after{animation-play-state:paused!important}
.eva-corner-stack[data-fit="minimal"] .eva-tps,
.eva-corner-stack[data-fit="minimal"] .eva-tags,
.eva-corner-stack[data-fit="minimal"] .eva-pilot-status,
.eva-corner-stack[data-fit="minimal"] .eva-pilot-en,
.eva-corner-stack[data-fit="minimal"] .eva-hud-vlabel{display:none}
.eva-corner-stack[data-fit="minimal"] .eva-hud-body{padding:7px 10px}
.eva-corner-stack[data-fit="minimal"] .eva-pilot-name{font-size:12px;margin:0}
.eva-corner-stack[data-fit="minimal"] .eva-hud::after{display:none}
html[data-eva-hud="off"] .eva-corner-stack{display:none}

html[data-eva-scan="off"] .eva-magi-scan,
html[data-eva-beam="off"] .eva-magi-beam,
html[data-eva-chrome="off"] .eva-frame,
html[data-eva-chrome="off"] .eva-edge,
html[data-eva-chrome="off"] .eva-hazard,
html[data-eva-chrome="off"] .eva-tags,
html[data-eva-hud="off"] .eva-hud{display:none}

/* 扫描线：3px 周期、1px 暗线。深色下是 CRT 余晖，浅色下减半免得脏 */
.eva-magi-scan{
  inset:0;
  background:repeating-linear-gradient(to bottom,rgba(0,0,0,0) 0 2px,rgba(0,0,0,.30) 2px 3px);
  opacity:var(--eva-scan-strength,.5);mix-blend-mode:multiply;
}
body:not([data-ds-dark-theme]) .eva-magi-scan{opacity:calc(var(--eva-scan-strength,.5) * .45)}

/* 走行的刷新带：老 CRT 的场同步条，9 秒扫一遍 */
.eva-magi-beam{
  inset:0 0 auto 0;height:150px;
  background:linear-gradient(to bottom,rgba(0,0,0,0),rgba(255,255,255,.035),rgba(0,0,0,0));
  animation:eva-beam 9s linear infinite;
}
@keyframes eva-beam{0%{transform:translateY(-160px)}100%{transform:translateY(100vh)}}

/* ---- 框架：内嵌发丝线 + 四角 L 标 ---- */
.eva-frame{position:absolute;inset:5px;border:1px solid var(--eva-hair)}
.eva-corner{position:absolute;width:17px;height:17px;border:2px solid var(--eva-accent);opacity:.7}
.eva-corner.tl{left:5px;top:5px;border-right:0;border-bottom:0}
.eva-corner.tr{right:5px;top:5px;border-left:0;border-bottom:0}
.eva-corner.bl{left:5px;bottom:5px;border-right:0;border-top:0}
.eva-corner.br{right:5px;bottom:5px;border-left:0;border-top:0}

/* ---- 左右刻度尺：每 8px 短刻度、每 40px 长刻度 ---- */
.eva-edge{position:absolute;top:70px;bottom:74px;left:7px;width:8px;opacity:.5;
  background:
    repeating-linear-gradient(to bottom,var(--eva-line) 0 1px,rgba(0,0,0,0) 1px 8px) left/3px 100% no-repeat,
    repeating-linear-gradient(to bottom,var(--eva-accent) 0 1px,rgba(0,0,0,0) 1px 40px) left/8px 100% no-repeat;}
.eva-edge.r{left:auto;right:7px;background-position:right,right}

/* ---- 底部危险条纹 ---- */
.eva-hazard{
  inset:auto 0 0 0;height:5px;opacity:.4;
  background:repeating-linear-gradient(45deg,
    var(--eva-secondary) 0 5px,rgba(0,0,0,0) 5px 10px);
}

/* ---- 右下角：计费标签／当前角色／TPS。保持用户倍率，允许覆盖输入框。 ---- */
.eva-corner-stack{
  position:absolute;left:0;top:0;z-index:3;
  width:${CLOCK_PANEL_WIDTH * CLOCK_SCALE_UNIT}px;min-width:0;
  display:flex;flex-direction:column;align-items:stretch;gap:6px;
  transform:scale(var(--eva-hud-scale,1));transform-origin:0 0;
}
.eva-corner-stack[data-fit="minimal"]{width:auto}
.eva-corner-stack[data-fit="hidden"]{display:none}
.eva-tags{
  /* 用网格把两个面叠在同一个格子里：容器尺寸取较宽的一面，
     所以翻转前后宽度不跳（避让逻辑也就不必跟着重算）。
     3D 翻转 + backface-visibility 让两面不会同时露出来。 */
  display:grid;transform-style:preserve-3d;
  transition:transform .5s cubic-bezier(.2,.75,.2,1);
  pointer-events:auto;cursor:pointer;
}
.eva-tags[data-face="back"]{transform:rotateX(180deg)}
.eva-tags:focus-visible{outline:2px solid var(--eva-accent);outline-offset:2px}
.eva-tags-face{
  grid-area:1/1;display:flex;flex-direction:column;align-items:stretch;gap:5px;
  backface-visibility:hidden;
}
/* 背面只有一个余额标签：整块高度由正面（两个标签）决定，
   所以把它垂直居中，不然会贴在顶部、下面空一块。 */
.eva-tags-back{transform:rotateX(180deg);justify-content:center}
/* 余额是"钱"，要一眼看到。但**不能动位置和尺寸** ——
   所以只改绘制类属性：底色、字色、字重、内描边（box-shadow 不占布局）、辉光。
   字号、内外边距、行高全部保持原样，两个标签的位置和大小分毫不变。 */
/* 用 .eva-tag.eva-tag--balance 提高权重：这条规则在基础 .eva-tag 之前，
   同权重会被后者（background/color）盖掉 —— 实测底色仍是橙的，就是踩了这个。
   写死权重就不怕以后规则顺序变动。 */
.eva-tag.eva-tag--balance{
  background:var(--eva-surface);color:var(--eva-accent);
  box-shadow:inset 0 0 0 1px var(--eva-accent),
    0 0 14px color-mix(in srgb,var(--eva-accent) 30%,transparent);
}
/* 背面只有一条余额，让它**占满正面两条标签的总高度**（44px 布局），
   并把数字放大 —— 视觉上就是"一条顶两条"。
   数字在上、名称在下，较长的余额也能容纳于组件的固定宽度。 */
.eva-tags-back .eva-tag--balance{
  flex:1 1 auto;flex-direction:column;justify-content:center;gap:3px;
}
.eva-tag.eva-tag--balance b{
  font:700 22px/1 ui-monospace,Menlo,monospace;letter-spacing:.01em;
  font-variant-numeric:tabular-nums;
  text-shadow:0 0 12px color-mix(in srgb,var(--eva-accent) 80%,transparent);
}
.eva-tag--balance small{opacity:.9;letter-spacing:.14em}
/* 反白标签块：nerv-hud 里那种橙底黑字 */
.eva-tag{
  /* space-between：宽度被拉齐之后，主文案贴左、副文案贴右，
     和下方仪表的网格对齐方式一致，不至于是"左边挤一堆、右边空一片"。 */
  display:flex;align-items:center;justify-content:space-between;gap:6px;
  font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  letter-spacing:.2em;text-transform:uppercase;
  padding:4px 8px;background:var(--eva-accent);color:var(--eva-on-accent);
  box-shadow:0 0 12px color-mix(in srgb,var(--eva-accent) 45%,transparent);
}
.eva-tag small{font:400 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;opacity:.72}
.eva-tag.ghost{background:transparent;color:var(--eva-accent);box-shadow:none;
  border:1px solid var(--eva-line)}

/* ---- 中央教条区：只标识当前已载入的角色，也是显示设置入口。 ---- */
.eva-hud{
  position:relative;display:flex;align-items:stretch;min-width:0;
  border:1px solid var(--eva-line);background:var(--eva-panel);
  box-shadow:0 8px 24px var(--eva-shadow),inset 3px 0 0 var(--eva-accent);
  font:9.5px/1.4 ui-monospace,Menlo,monospace;color:var(--eva-dim);
  pointer-events:auto;cursor:pointer;
}
/* 拖动柄：仪表竖标 / 时钟标题 / 播放器标题。拖动只改定位，不进入布局流。 */
.eva-hud-vlabel,.eva-clockpanel,.eva-mp-head{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
.eva-resize{position:absolute;width:16px;height:16px;pointer-events:auto;touch-action:none;z-index:6;color:inherit}
.eva-resize[data-corner="tl"]{left:0;top:0;cursor:nwse-resize}
.eva-resize[data-corner="tr"]{right:0;top:0;cursor:nesw-resize}
.eva-resize[data-corner="bl"]{left:0;bottom:0;cursor:nesw-resize}
.eva-resize[data-corner="br"]{right:0;bottom:0;cursor:nwse-resize}
.eva-corner-stack[data-dragging="1"],.eva-clockpanel[data-dragging="1"],.eva-mp[data-dragging="1"],
.eva-corner-stack[data-dragging="1"] *,.eva-clockpanel[data-dragging="1"] *,.eva-mp[data-dragging="1"] *{cursor:grabbing}
.eva-hud-vlabel{
  writing-mode:vertical-rl;text-orientation:upright;
  display:flex;align-items:center;justify-content:center;padding:7px 4px;
  border-right:1px solid var(--eva-hair);color:var(--eva-accent);
  font:10px/1.3 "Hiragino Mincho ProN","Songti SC",serif;letter-spacing:.16em;
}
.eva-hud-body{display:flex;flex:1;min-width:0;flex-direction:column;justify-content:center;padding:10px 9px}
.eva-pilot-status{display:flex;align-items:center;gap:5px;font-size:7px;letter-spacing:.16em;color:var(--eva-dim)}
.eva-pilot-status i{display:block;width:4px;height:4px;background:var(--eva-mark)}
.eva-pilot-name{display:block;margin:5px 0 3px;color:var(--eva-accent);
  font:700 21px/1.15 "Hiragino Mincho ProN","Songti SC",serif;letter-spacing:.16em;white-space:nowrap}
.eva-pilot-en{font-size:7px;letter-spacing:.14em;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* 启动标题和角色名共用中文字体，避免简体字与日文汉字回退到不同字库后错位。 */
html[data-eva-magi] :is(.eva-pilot-name,.eva-pilot-info>b,.eva-boot-loading h2,.eva-boot-title){
  font-family:var(--eva-pilot-font);text-align:start;
}
.eva-hud::after{content:"";position:absolute;right:5px;top:5px;width:14px;height:4px;
  background:var(--eva-secondary);clip-path:polygon(0 0,40% 0,55% 100%,15% 100%,0 0,60% 0,85% 0,100% 100%,75% 100%)}
body:not([data-ds-dark-theme]) .eva-hud::after{width:5px;height:5px;border-radius:50%;clip-path:none}
.eva-hud:hover{border-color:var(--eva-accent)}
.eva-hud:focus-visible{outline:2px solid var(--eva-accent);outline-offset:2px}
@keyframes eva-blink{0%,58%{opacity:1}59%,100%{opacity:.1}}

/* ---- 设置面板 ---- */
.eva-panel{
  box-sizing:border-box;position:absolute;z-index:10;
  width:360px;max-height:640px;overflow:auto;overscroll-behavior:contain;pointer-events:auto;
  border:1px solid var(--eva-accent);background:var(--eva-surface);
  box-shadow:0 12px 36px var(--eva-shadow),inset 3px 0 0 var(--eva-accent);
  font:12px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.02em;color:var(--eva-dim);
}
.eva-panel[hidden]{display:none}
.eva-panel-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:8px 12px;
  background:var(--eva-accent);color:var(--eva-on-accent);font-weight:700;letter-spacing:.12em}
.eva-panel-head small{margin-left:auto;font:400 8px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;opacity:.75}
.eva-panel-close{flex:0 0 28px;height:28px;padding:0;border:1px solid currentColor;background:transparent;
  color:inherit;cursor:pointer;font:20px/1 sans-serif}
.eva-panel-body{padding:4px 12px 12px}
.eva-panel-section+.eva-panel-section{margin-top:12px;padding-top:8px;border-top:1px solid var(--eva-hair)}
.eva-group{margin:8px 0;color:var(--eva-accent);font-weight:700;font-size:11px;letter-spacing:.12em}
.eva-advanced>summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none}
.eva-advanced>summary::-webkit-details-marker{display:none}
.eva-advanced>summary::after{content:"展开 ＋";font-size:10px;font-weight:400}
.eva-advanced[open]>summary::after{content:"收起 −"}
.eva-row{display:flex;align-items:center;gap:8px;padding:7px 0}
.eva-row-label{flex:1;min-width:0}
.eva-row-label b{display:block;font-weight:400;font-size:12px;color:var(--eva-ink)}
.eva-row-label i{display:block;font-style:normal;font-size:10px;color:var(--eva-dim)}
.eva-row[data-dim="1"]{opacity:.45}
.eva-sw{flex:0 0 auto;min-width:48px;min-height:28px;padding:5px 7px;cursor:pointer;border-radius:0;
  border:1px solid var(--eva-line);background:transparent;color:var(--eva-dim);font:700 10px/1 ui-monospace,Menlo,monospace}
.eva-sw:hover{border-color:var(--eva-accent);color:var(--eva-accent)}
.eva-sw[aria-checked="true"]{background:var(--eva-accent);color:var(--eva-on-accent);border-color:var(--eva-accent)}
.eva-sw[aria-checked="true"]:hover{color:var(--eva-on-accent);border-color:var(--eva-accent)}
.eva-sw[aria-checked="false"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.eva-sw[aria-checked="false"]:hover{border-color:var(--dsw-alias-state-error-primary)}
.eva-panel :is(button,input,summary):focus-visible{outline:2px solid var(--eva-accent);outline-offset:2px}
.eva-range-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px 8px}
.eva-val{font-size:12px;text-align:right;color:var(--eva-accent);font-variant-numeric:tabular-nums}
.eva-range-controls{grid-column:1/-1;display:grid;grid-template-columns:28px minmax(0,1fr) 28px;align-items:center;gap:8px}
.eva-range-button,.eva-range-reset{min-height:28px;border:1px solid var(--eva-line);background:transparent;
  color:var(--eva-accent);cursor:pointer;font:12px/1 ui-monospace,Menlo,monospace}
.eva-range-reset{padding:0 6px;font-size:10px}
.eva-range-button:disabled,.eva-range-reset:disabled{opacity:.35;cursor:default}
.eva-row input[type=range]{-webkit-appearance:none;appearance:none;box-sizing:border-box;min-width:0;width:100%;height:28px;margin:0;background:transparent;cursor:pointer}
.eva-row input[type=range]::-webkit-slider-runnable-track{height:3px;background:var(--eva-line)}
.eva-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:20px;margin-top:-8px;background:var(--eva-accent);border-radius:0}
.eva-panel-foot{position:sticky;bottom:0;display:flex;gap:8px;padding:9px 12px;background:var(--eva-surface);border-top:1px solid var(--eva-hair);z-index:2}
.eva-btn{flex:1;min-height:30px;padding:5px;cursor:pointer;border-radius:0;border:1px solid var(--eva-line);
  background:transparent;color:var(--eva-accent);font:700 10px/1 ui-monospace,Menlo,monospace}
.eva-btn:disabled{opacity:.4;cursor:default}
.eva-btn:hover:not(:disabled){background:var(--eva-accent);color:var(--eva-on-accent);border-color:var(--eva-accent)}
.eva-sound-previews .eva-btn[aria-pressed="true"]{background:var(--eva-accent);color:var(--eva-on-accent)}
.eva-sound-previews{display:flex;gap:8px;padding:0 0 8px}
.eva-panel-note{margin:8px 0 0;font-size:10px;color:var(--eva-dim)}

/* ---- 两个标签块：峰谷状态 + 倒计时 ----
   高峰为红字，空闲／周末／假日为绿字；中性底色保证两种主题都可读。 */
.eva-tags{--eva-rate-color:var(--dsw-alias-state-success-primary)}
.eva-tags[data-state="peak"]{--eva-rate-color:var(--dsw-alias-state-error-primary)}
.eva-tags .eva-tag--state{background:var(--eva-surface);color:var(--eva-rate-color);
  box-shadow:inset 3px 0 0 var(--eva-rate-color),0 0 12px color-mix(in srgb,var(--eva-rate-color) 16%,transparent)}
.eva-tags .eva-tag--state small,.eva-tags .eva-tag--remain small{opacity:1}
.eva-tags .eva-tag--remain{color:var(--eva-rate-color);border-color:color-mix(in srgb,var(--eva-rate-color) 45%,var(--eva-surface))}
.eva-tag--remain b{font:400 11px/1 ui-monospace,Menlo,monospace;
  letter-spacing:.06em;font-variant-numeric:tabular-nums}
.eva-tag--state b{white-space:nowrap}
/* 推算态：用样式而不是加字来标注（加字会撑宽整栈）。 */
.eva-tag--state[data-inferred="1"] small{
  text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;
  opacity:.55}
.eva-tags[data-imminent="1"] .eva-tag--state{animation:eva-blink 1.15s steps(1) infinite}

/* ============================================================================
   TPS / 解码速度波形（中央教条区正下方）
   ----------------------------------------------------------------------------
   作为仪表栈的最后一个组件，与中央教条区同宽，统一由父级缩放。
   受"仪表"开关控制：html[data-eva-hud="off"] 时一起隐藏。
   ============================================================================ */
.eva-tps{
  position:relative;right:auto;top:auto;flex:0 0 auto;min-width:0;contain:inline-size;
  width:100%;
  /* 高度写死 + overflow:hidden：波形波动时读数位数会变（— / 258 / 1234），
     不能让它把面板撑大或撑出第二行。1+21+37+18+1 = 78 */
  height:78px;overflow:hidden;
  /* border-box：否则 1px 边框会让它比下方仪表盘宽 2px，左边缘差 3px */
  box-sizing:border-box;
  transform:none;

  border:1px solid var(--eva-hair);
  background:var(--eva-panel);
  box-shadow:0 0 22px var(--eva-shadow), inset 0 0 18px color-mix(in srgb,var(--eva-accent) 5%,transparent);
  font:9px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.06em;
  color:var(--dsw-alias-label-tertiary);
  pointer-events:none;
}
html[data-eva-hud="off"] .eva-tps{display:none}
.eva-tps-head{
  display:flex;align-items:center;gap:4px;padding:4px 6px;
  line-height:13px;white-space:nowrap;overflow:hidden;
  border-bottom:1px solid var(--eva-hair);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-weight:700;font-size:9px;letter-spacing:.22em;color:var(--eva-accent);
}
.eva-tps-head i{width:5px;height:5px;background:var(--eva-accent);display:block}
.eva-tps-head small{margin-left:auto;font:400 8px/1 ui-monospace,Menlo,monospace;
  letter-spacing:.1em;color:var(--eva-dim)}
.eva-tps-now{margin-left:4px;
  /* 固定槽位：数字位数变化时布局不动（否则"TPS / DECODE"会被挤来挤去） */
  display:inline-block;min-width:3.4em;text-align:right;
  font:700 13px/1 ui-monospace,Menlo,monospace;letter-spacing:0;
  font-variant-numeric:tabular-nums;
  color:var(--eva-accent);text-shadow:0 0 8px color-mix(in srgb,var(--eva-accent) 70%,transparent)}
.eva-tps-scope{display:block;width:100%;height:34px;margin:3px 0 0;
  background:
    repeating-linear-gradient(90deg,var(--eva-hair) 0 1px,transparent 1px 20px),
    repeating-linear-gradient(0deg,var(--eva-hair) 0 1px,transparent 1px 11px);
}
.eva-tps-base{stroke:var(--eva-hair);stroke-width:1}
.eva-tps-line{fill:none;stroke:var(--eva-accent);stroke-width:1.6;
  stroke-linejoin:round;stroke-linecap:round;
  filter:drop-shadow(0 0 3px color-mix(in srgb,var(--eva-accent) 65%,transparent))}
.eva-tps-foot{display:flex;justify-content:space-between;padding:3px 6px 4px;
  border-top:1px solid var(--eva-hair);font-size:8px;letter-spacing:.1em;
  line-height:11px;white-space:nowrap;overflow:hidden}
.eva-tps-foot b{color:var(--eva-accent);font-weight:700;
  display:inline-block;min-width:2.6em;text-align:right;font-variant-numeric:tabular-nums}

/* 权限与模型选择器共用角色色、警戒条纹与全部交互状态；保持宿主尺寸。 */
html[data-eva-magi] body [data-slot="conversation.input.permission"] button,
html[data-eva-magi] body [data-slot="conversation.input.model"] button{
  background-color:var(--eva-control);
  background-image:repeating-linear-gradient(45deg,var(--eva-secondary) 0 3px,transparent 3px 6px);
  background-size:5px 100%;background-position:left center;background-repeat:no-repeat;
  color:var(--eva-accent);font-weight:700;letter-spacing:.06em;
  box-shadow:inset 0 0 0 1px var(--eva-accent);
  text-shadow:0 0 8px color-mix(in srgb,var(--eva-accent) 45%,transparent);
  transition:background-color .18s ease,box-shadow .18s ease;
}
html[data-eva-magi] body [data-slot="conversation.input.permission"] button:hover:not(:disabled),
html[data-eva-magi] body [data-slot="conversation.input.model"] button:hover:not(:disabled),
html[data-eva-magi] body [data-slot="conversation.input.permission"] button[aria-expanded="true"]:not(:disabled),
html[data-eva-magi] body [data-slot="conversation.input.model"] button[aria-expanded="true"]:not(:disabled){
  background-color:var(--eva-control-hover);
  box-shadow:inset 0 0 0 1px var(--eva-accent),0 0 12px color-mix(in srgb,var(--eva-accent) 32%,transparent);
}
html[data-eva-magi] body [data-slot="conversation.input.permission"] button:active:not(:disabled),
html[data-eva-magi] body [data-slot="conversation.input.model"] button:active:not(:disabled){
  background-color:var(--eva-control-active);
}
html[data-eva-magi] body [data-slot="conversation.input.permission"] button:focus-visible,
html[data-eva-magi] body [data-slot="conversation.input.model"] button:focus-visible{
  outline:1px solid var(--eva-accent);outline-offset:2px;
}
/* 图标和标签继承同一角色前景色。 */
html[data-eva-magi] body [data-slot="conversation.input.permission"] button > span,
html[data-eva-magi] body [data-slot="conversation.input.model"] button > span,
html[data-eva-magi] body [data-slot="conversation.input.permission"] button svg,
html[data-eva-magi] body [data-slot="conversation.input.model"] button svg{
  color:inherit;
}
html[data-eva-magi] body [data-slot="conversation.input.model"] button > span:first-of-type{
  text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;letter-spacing:.07em;
}
/* 推理等级只保留文字，不再绘制独立徽章。 */
html[data-eva-magi] body [data-slot="conversation.input.model"] button > span + span{
  font-family:ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:.06em;
  text-shadow:none;
}

/* ============================================================================
   2. 应用元素的装饰
   只用「不会改变布局、不会与应用自身冲突」的属性：box-shadow / outline /
   border-color / letter-spacing。刻意不用 ::before/:after（可能覆盖应用自己的
   伪元素）与 background-image（可能覆盖应用自己的底纹）。
   挂钩优先用 data-* 语义属性；少数内部节点通过 HOST_HOOKS 匹配可读后缀。
   ============================================================================ */

/* 会话列表：选中项左侧一条橙色标志条 —— 仪表盘式的选中态 */
html[data-eva-magi] [role="treeitem"][aria-selected="true"],
html[data-eva-magi] [role="treeitem"][data-selected="true"]{
  box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary);
}
/* 顶栏：用 inset 阴影画分隔线，不占布局（改 border 宽度会挤动内容） */
html[data-eva-magi] [data-conversation-header]{
  box-shadow:inset 0 -1px 0 var(--dsw-alias-border-l2);
}
/* 主区域：一层极淡的橙色环境光，把中心区从纯黑里拉出来 */
html[data-eva-magi] [data-conversation-region]:not([data-conversation-region="composer"]){
  box-shadow:inset 0 0 140px color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent);
}
/* 输入卡片：外圈发丝线 + 内层橙色浸润 */
/* 侧栏：稳定 slot 与局部可读后缀，同步两套角色配色。 */
/* 侧栏右缘与屏幕底缘共用角色辅助色的警戒带，不增加布局边框。 */
html[data-eva-magi] body ${HOST_HOOKS.sidebar}{
  background-color:var(--eva-control);
  background-image:repeating-linear-gradient(45deg,
    color-mix(in srgb, var(--eva-secondary) 40%, transparent) 0 5px,
    rgba(0,0,0,0) 5px 10px);
  background-size:5px 100%;
  background-position:right center;
  background-repeat:no-repeat;
}
/* 会话列表底部的宿主淡出层使用另一套侧栏底色，会在插件市场上方形成色块。 */
html[data-eva-magi] body [data-slot="sidebar"] [class*="_regionArea"] [class*="_fade"]{
  background:none;
}
/* 品牌标识使用角色主色。 */
html[data-eva-magi] body [data-slot="sidebar.brand.mark"],
html[data-eva-magi] body [data-slot="sidebar.brand.name"]{
  color:var(--eva-accent);
}
html[data-eva-magi] body [data-slot="sidebar.brand.name"]{
  text-transform:uppercase;
  letter-spacing:.1em;
  font-family:ui-monospace,Menlo,monospace;
}
/* 新会话保留按钮最外框；只匹配按钮，内部 Label / Content 容器不描框。 */
html[data-eva-magi] body ${HOST_HOOKS.newSession}{
  background-color:var(--eva-control);
  color:var(--eva-accent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--eva-accent) 60%,transparent);
}
html[data-eva-magi] body ${HOST_HOOKS.newSession}:hover{
  background-color:color-mix(in srgb,var(--eva-accent) 14%,transparent);
}
html[data-eva-magi] body ${HOST_HOOKS.newSession}:focus-visible{
  outline:1px solid var(--eva-accent);outline-offset:2px;
}
/* 分组标题：插件（面板标题）/ 工作区（区段标题）
   ----------------------------------------------------------------------------
   这两个标签**没有 data-slot 可用**，原因值得记下来：
   「data-slot="sidebar.panellist"」 这类 slot **只是 portal 锚点、不是容器** ——
   插件标题的真实祖先链是 nav.WYye1W_panelList → div${HOST_HOOKS.sidebar}，
   **根本不在那个 slot 底下**，所以早先 「[data-slot="sidebar.panellist"] > * > button」
   那种写法永远匹配不到（实测确认过）。

   它们的类名是 CSS-module 的 「Hash_name」 形式，所以改用**可读后缀**匹配：
   「[class*="_panelTitle"]」 / 「[class*="_sectionLabel"]」 —— 哈希前缀变了也不受影响，
   比写死 「.tPVXea_sectionLabel」 稳健得多。作用域锚在 「[data-slot="sidebar"]」，
   它确实是侧栏一切的祖先（已实测链路）。

   注：**「未分组」不是分组标题**，它是 workspace 行（「_projectText」，与普通工作区行
   共用同一组件），无法单独选中 —— 保持行标题原色以保证可读。 */
html[data-eva-magi] body [data-slot="sidebar"] [class*="_panelTitle"],
html[data-eva-magi] body [data-slot="sidebar"] [class*="_sectionLabel"]{
  color:var(--eva-accent);
  font-weight:700;
  letter-spacing:.1em;
}
/* 面板行（插件那一行，含左侧图标）：角色主色，图标走 currentColor 一起变 */
html[data-eva-magi] body [data-slot="sidebar"] [class*="_panelRow"],
html[data-eva-magi] body [data-slot="sidebar"] [class*="_sectionHeader"]{
  color:var(--eva-accent);
}

/* 底部「设置」与侧栏图标按钮：角色主色（稳定钩子） */
html[data-eva-magi] body [data-slot="sidebar.settings"],
html[data-eva-magi] body [data-slot="sidebar.footer.action"],
html[data-eva-magi] body [data-slot="sidebar.panellist"] > * > button{
  color:var(--eva-accent);
}
/* 会话前导标记弱化，标题保持正文可读性。 */
html[data-eva-magi] body [data-slot="sidebar.session.row.leading"]{
  color:var(--eva-dim);
}
html[data-eva-magi] body [data-slot="sidebar.session.row.leading"] *{
  color:inherit;
}
/* 侧栏动作保持硬边。 */
html[data-eva-magi] body [data-slot="sidebar.workspaces.session.row.action"] *{
  border-radius:0;
}

/* ============================================================================
   音声管制：NERV 外部音源终端。
   角色面板、警戒条纹、机械双环；动画仅表示播放状态，不模拟真实频谱。
   曲名、来源和进度均由系统媒体接口提供。停播、后台及减少动态效果时冻结。
   ============================================================================ */
.eva-mp{
  --mp-accent:var(--eva-accent);--mp-ink:var(--eva-ink);--mp-dim:var(--eva-dim);--mp-line:var(--eva-line);--mp-active:var(--eva-mark);
  position:absolute;left:0;top:0;width:${CLOCK_PANEL_WIDTH}px;box-sizing:border-box;
  padding:10px 12px 12px;border:1px solid var(--mp-accent);background:var(--eva-surface);
  color:var(--mp-ink);font-family:ui-monospace,Menlo,monospace;
  box-shadow:0 8px 28px var(--eva-shadow),inset 0 0 24px color-mix(in srgb,var(--eva-accent) 3%,transparent);
  pointer-events:auto;transform:scale(var(--eva-mp-scale,1));transform-origin:0 0;z-index:1;
}
.eva-mp::before{
  content:"";position:absolute;left:-1px;top:-1px;width:4px;height:32px;background:var(--mp-accent);
}
.eva-mp::after{
  content:"";position:absolute;right:4px;bottom:4px;width:10px;height:10px;
  border-right:2px solid var(--mp-accent);border-bottom:2px solid var(--mp-accent);pointer-events:none;
}
.eva-mp-loading{position:absolute;inset:42px 12px 58px;z-index:2;display:none;pointer-events:none;
  background:var(--eva-surface);color:var(--mp-accent);place-content:center;gap:7px;text-align:center;
  border-block:1px solid var(--mp-line);font:700 17px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.2em}
.eva-mp-loading small{font-size:8px;font-weight:400;letter-spacing:.25em}
.eva-mp-loading i{display:block;width:168px;height:4px;background:repeating-linear-gradient(90deg,var(--mp-accent) 0 12px,transparent 12px 15px);transform-origin:left;
  animation:mp-connect-bar .6s steps(9,end) both}
.eva-mp[data-entering="1"] .eva-mp-loading{display:grid;animation:mp-connect .65s linear both}
.eva-mp[data-command] .eva-mp-hazard{animation:mp-command .6s linear infinite;background-size:12px 100%}
@keyframes mp-connect{0%,65%{opacity:1}100%{opacity:0}}
@keyframes mp-connect-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes mp-command{to{background-position:12px 0}}
html[data-eva-music="off"] .eva-mp{display:none}
.eva-mp-head{display:flex;align-items:center;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--mp-line)}
.eva-mp-head b{font-size:16px;line-height:1.1;letter-spacing:.18em;color:var(--mp-accent)}
.eva-mp-head small{font-size:8px;letter-spacing:.18em;color:var(--mp-dim)}
.eva-mp-hazard{margin-left:auto;width:45px;height:11px;background:repeating-linear-gradient(130deg,var(--eva-secondary) 0 4px,var(--eva-surface) 4px 8px)}
.eva-mp-source{display:flex;align-items:center;gap:8px;margin-top:7px;min-width:0;
  color:var(--mp-dim);font-size:8px;letter-spacing:.1em}
.eva-mp-source>small{flex:0 0 auto;font-size:8px;color:var(--mp-accent)}
.eva-mp-src{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:215px;font-size:10px;letter-spacing:0}
.eva-mp-name{min-width:0;margin-top:7px}
.eva-mp-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:16px;line-height:1.4;font-weight:700;letter-spacing:.015em;color:var(--mp-ink)}
.eva-mp-artist{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  min-height:15px;color:var(--mp-dim);font-size:10px;line-height:1.5}
.eva-mp-deck{display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;align-items:center;
  margin:8px 0;padding:7px 0;border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line)}
.eva-mp-rings{position:relative;width:84px;height:84px;overflow:hidden;
  background:linear-gradient(transparent 49%,color-mix(in srgb,var(--eva-accent) 15%,transparent) 49% 50%,transparent 50%),linear-gradient(90deg,transparent 49%,color-mix(in srgb,var(--eva-accent) 15%,transparent) 49% 50%,transparent 50%)}
.eva-mp-ring{position:absolute;inset:0;display:block;width:84px;height:84px;color:var(--mp-accent);
  animation:mp-spin 18s steps(120) infinite;animation-play-state:paused;transform-origin:50% 50%}
.eva-mp-ring--solid{color:var(--mp-active);animation-duration:11s;animation-direction:reverse}
.eva-mp[data-playing="1"] .eva-mp-ring{animation-play-state:running}
.eva-mp-core{position:absolute;inset:0;width:84px;height:84px;color:var(--mp-accent)}
.eva-mp-core text{fill:var(--mp-ink);font:7px ui-monospace,Menlo,monospace;letter-spacing:1px}
@keyframes mp-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.eva-mp-signal{min-width:0;position:relative;overflow:hidden}
.eva-mp-status{display:flex;align-items:center;justify-content:space-between;gap:6px;
  color:var(--mp-accent);font-size:12px;font-weight:700;letter-spacing:.08em}
.eva-mp-status small{font-size:8px;letter-spacing:.14em}
.eva-mp[data-playing="1"] .eva-mp-status{color:var(--mp-active)}
.eva-mp-eq{display:flex;gap:4px;align-items:flex-end;height:31px;margin:8px 0 5px;
  background:repeating-linear-gradient(0deg,color-mix(in srgb,var(--eva-accent) 8%,transparent) 0 1px,transparent 1px 8px)}
.eva-mp-eq i{display:block;flex:1;height:100%;transform:scaleY(.18);transform-origin:50% 100%;
  background:repeating-linear-gradient(0deg,var(--mp-accent) 0 3px,transparent 3px 5px);
  animation:mp-eq 1.4s steps(5,end) infinite alternate;animation-play-state:paused}
.eva-mp-eq i:nth-child(3n){animation-duration:1.1s;animation-delay:-.6s}
.eva-mp-eq i:nth-child(3n+1){animation-duration:1.7s;animation-delay:-1.1s}
.eva-mp-eq i:nth-child(even){animation-direction:alternate-reverse}
.eva-mp[data-playing="1"] .eva-mp-eq i{animation-play-state:running}
.eva-mp-signal>small{display:block;color:var(--mp-dim);font-size:7px;letter-spacing:.1em}
@keyframes mp-eq{0%{transform:scaleY(.18)}35%{transform:scaleY(.65)}70%{transform:scaleY(.4)}100%{transform:scaleY(1)}}
.eva-mp-times{display:flex;align-items:baseline;justify-content:space-between;font-variant-numeric:tabular-nums}
.eva-mp-times>span{display:flex;align-items:baseline;gap:6px}
.eva-mp-times small{font-size:7px;letter-spacing:.08em;color:var(--mp-dim)}
.eva-mp-times b{font-size:15px;font-weight:500;line-height:1.2}
.eva-mp-cur{color:var(--mp-accent)}
.eva-mp-tot{color:var(--mp-dim)}
.eva-mp-bar{position:relative;height:6px;margin:5px 0 10px;background:color-mix(in srgb,var(--eva-accent) 11%,transparent);overflow:hidden}
.eva-mp-bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 11px,var(--eva-surface) 11px 13px);pointer-events:none}
.eva-mp-bar i{display:block;height:100%;width:0;background:var(--mp-accent);transition:width .35s linear}
.eva-mp-btns{display:grid;grid-template-columns:1fr 1.45fr 1fr;gap:5px}
.eva-mp-btn{min-width:0;height:36px;padding:0 4px;cursor:pointer;background:color-mix(in srgb,var(--eva-accent) 3%,transparent);
  border:1px solid var(--mp-line);color:var(--mp-accent);font:700 9px ui-monospace,Menlo,monospace;letter-spacing:.05em;
  display:flex;align-items:center;justify-content:center;gap:6px;transition:background-color .15s,color .15s}
.eva-mp-btn svg{width:15px;height:15px;flex:0 0 auto;fill:currentColor}
.eva-mp-btn[data-act="play"]{border-color:var(--mp-accent);background:var(--mp-accent);color:var(--eva-on-accent)}
.eva-mp-btn:disabled{opacity:.45;cursor:default}
.eva-mp-btn:not(:disabled):hover{background:color-mix(in srgb,var(--eva-accent) 15%,transparent);border-color:var(--mp-accent);color:var(--mp-ink)}
.eva-mp-btn[data-act="play"]:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover);color:var(--eva-on-accent)}
.eva-mp-btn:not(:disabled):active{transform:translateY(1px)}
.eva-mp-btn:focus-visible{outline:2px solid var(--mp-active);outline-offset:2px}
.eva-mp-ico-pause{display:none}
.eva-mp[data-playing="1"] .eva-mp-ico-pause{display:block}
.eva-mp[data-playing="1"] .eva-mp-ico-play{display:none}

/* ============================================================================
   時刻管制：与音声管制共用当前角色的面板与硬边规格。
   七段显示直接读取系统时间，秒刻度每秒推进，不表示网络校时状态。
   日期、本地 UTC 偏移、UTC 时刻独立排版；底部仅显示实际解码状态。
   ============================================================================ */
.eva-clockpanel{
  --cp-accent:var(--eva-accent);--cp-ink:var(--eva-accent);--cp-dim:var(--eva-dim);--cp-line:var(--eva-line);--cp-active:var(--eva-mark);
  position:absolute;left:0;top:0;width:${CLOCK_PANEL_WIDTH}px;box-sizing:border-box;padding:10px 12px 12px;
  background:var(--eva-surface);border:1px solid var(--cp-accent);color:var(--cp-ink);
  box-shadow:0 8px 28px var(--eva-shadow),inset 0 0 24px color-mix(in srgb,var(--eva-accent) 3%,transparent);
  font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;z-index:0;
  pointer-events:auto;cursor:grab;
  transform:scale(var(--eva-clock-scale,1));transform-origin:0 0;
}
.eva-clockpanel::before{content:"";position:absolute;left:-1px;top:-1px;width:4px;height:32px;background:var(--cp-accent)}
.eva-clockpanel::after{content:"";position:absolute;right:4px;bottom:4px;width:10px;height:10px;
  border-right:2px solid var(--cp-accent);border-bottom:2px solid var(--cp-accent)}
html[data-eva-clock="off"] .eva-clockpanel{display:none}
.eva-cp-top{display:flex;align-items:center;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--cp-line)}
.eva-cp-top b{font-size:16px;line-height:1.1;letter-spacing:.18em;color:var(--cp-accent)}
.eva-cp-top small{font-size:8px;letter-spacing:.16em;color:var(--cp-dim)}
.eva-cp-top i{margin-left:auto;width:45px;height:11px;background:repeating-linear-gradient(130deg,var(--eva-secondary) 0 4px,var(--eva-surface) 4px 8px)}
.eva-cp-mode{display:flex;align-items:center;justify-content:space-between;margin-top:8px;
  color:var(--cp-dim);font-size:8px;line-height:1;letter-spacing:.12em}
.eva-cp-mode>span:last-child{color:var(--cp-active)}
.eva-cp-main{padding:10px 0 9px;border-bottom:1px solid var(--cp-line)}
.eva-cp-digits{display:flex;align-items:flex-end;justify-content:center;gap:8px}
.eva-cp-pair>small{display:block;margin-bottom:5px;text-align:center;color:var(--cp-dim);font-size:7px;letter-spacing:.16em;line-height:1}
.eva-cp-number{display:flex;align-items:flex-end;gap:5px}
.eva-cp-dg{display:block;height:58px;width:34px}
.eva-cp-dg use{stroke:var(--eva-surface);stroke-width:.35;stroke-linejoin:round}
.eva-cp-ghost{fill:var(--eva-ghost)}
.eva-cp-lit{fill:var(--cp-ink)}
.eva-cp-pair--seconds .eva-cp-dg{height:44px;width:26px}
.eva-cp-pair--seconds .eva-cp-lit{fill:var(--cp-accent)}
.eva-cp-cl{display:block;width:8px;height:58px;fill:var(--cp-accent)}
.eva-cp-cl--seconds{height:44px;opacity:.75}
.eva-cp-side{display:grid;grid-template-columns:1.22fr 1fr 1fr;gap:7px;margin-top:9px}
.eva-cp-block{min-width:0;padding:1px 0 2px 7px;border-left:1px solid var(--cp-line);overflow:hidden}
.eva-cp-block small{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:5px;
  color:var(--cp-dim);font-size:7px;line-height:1;letter-spacing:.05em;white-space:nowrap}
.eva-cp-weekday{font:inherit;color:var(--cp-accent)}
.eva-cp-block>b{display:block;font-size:12px;font-weight:500;line-height:1.2;color:var(--cp-ink);white-space:nowrap}
.eva-cp-block .eva-cp-tz{font-size:11px}
.eva-cp-block .eva-cp-utc{color:var(--cp-active)}
.eva-cp-second-head{display:flex;justify-content:space-between;align-items:center;margin-top:10px;
  color:var(--cp-dim);font-size:7px;line-height:1;letter-spacing:.08em}
.eva-cp-second-head b{color:var(--cp-accent);font-weight:400}
.eva-cp-second-track{position:relative;height:4px;margin-top:5px;overflow:hidden;background:color-mix(in srgb,var(--eva-accent) 11%,transparent)}
.eva-cp-second-track i{display:block;width:0;height:100%;background:var(--cp-accent)}
.eva-cp-second-track::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(100% / 60 - 2px),var(--eva-surface) calc(100% / 60 - 2px) calc(100% / 60))}
.eva-cp-decode{display:flex;align-items:center;gap:9px;margin-top:9px;padding-top:7px;border-top:1px solid var(--cp-line)}
.eva-cp-decode>small{font-size:7px;line-height:1.5;letter-spacing:.08em;color:var(--cp-dim);flex:0 0 auto}
.eva-cp-lamps{display:flex;gap:3px;flex:1;min-width:0}
.eva-cp-lamps span{flex:1;text-align:center;font-size:7px;line-height:1;font-weight:500;letter-spacing:.05em;
  padding:4px 0;border:1px solid var(--eva-hair);color:var(--eva-dim)}
.eva-cp-lamps span[data-on="1"]{background:color-mix(in srgb,var(--eva-accent) 10%,transparent);border-color:var(--cp-accent);color:var(--cp-accent)}
.eva-cp-lamps span:nth-child(1)[data-on="1"]{border-color:var(--eva-dim);background:color-mix(in srgb,var(--eva-dim) 8%,transparent);color:var(--cp-dim)}
.eva-cp-lamps span:nth-child(3)[data-on="1"]{border-color:var(--cp-active);background:color-mix(in srgb,var(--eva-mark) 8%,transparent);color:var(--cp-active)}

/* 输入框与 portal 菜单：全模式角色配色，只修改绘制属性，保持宿主尺寸。 */
/* 输入区外层横跨整个会话宽度；清除宿主铺底渐变与区域阴影，避免卡片两侧出现色块。 */
html[data-eva-magi] body [data-composer-seat],
html[data-eva-magi] body [data-conversation-region="composer"]{
  background:none;box-shadow:none;
}
html[data-eva-magi] body [data-composer-card]{
  background-color:var(--eva-control);
  /* 右缘红黑危险条纹：卡片右端到发送按钮之间还有约 17px 空档，画条带进去。
     带宽 5px —— 与权限块、侧栏两条统一（原来这里是 6px，是唯一不一致的一条）。 */
  background-image:repeating-linear-gradient(45deg,var(--eva-secondary) 0 3px,rgba(0,0,0,0) 3px 6px);
  background-size:5px 100%;
  background-position:right center;
  background-repeat:no-repeat;
  box-shadow:inset 0 0 0 1px var(--eva-accent),
    inset 0 0 34px color-mix(in srgb,var(--eva-accent) 5%,transparent);
  transition:box-shadow .18s ease;
}
html[data-eva-magi] body [data-composer-card]:focus-within{
  box-shadow:inset 0 0 0 1px var(--eva-accent),
    inset 0 0 34px color-mix(in srgb,var(--eva-accent) 9%,transparent),
    0 0 22px color-mix(in srgb,var(--eva-accent) 20%,transparent);
}
/* 正文使用阅读色，光标使用角色主色。 */
html[data-eva-magi] body [data-composer-input]{
  color:var(--eva-ink);
  caret-color:var(--eva-accent);
  text-shadow:none;
}
/* 占位符使用可读的次级色。 */
html[data-eva-magi] body ${HOST_HOOKS.placeholder},
html[data-eva-magi] body ${HOST_HOOKS.placeholder} *{
  color:var(--eva-dim);
}
/* 附件按钮共用角色面板。 */
html[data-eva-magi] body ${HOST_HOOKS.add}{
  background-color:var(--eva-control);
  color:var(--eva-accent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--eva-accent) 70%,transparent);
}
/* 发送按钮的反白文字随主题极性切换。 */
html[data-eva-magi] body ${HOST_HOOKS.send}{
  background-color:var(--eva-accent);
  color:var(--eva-on-accent);
  box-shadow:inset 0 0 0 1px var(--eva-accent), 0 0 14px color-mix(in srgb,var(--eva-accent) 30%,transparent);
}
html[data-eva-magi] body ${HOST_HOOKS.send}:hover{background-color:var(--dsw-alias-button-primary-hover)}

/* ---- 弹出菜单（模型 / 推理等级 / 权限 …）----
   钩子是 role="menu" + data-menu-material（语义 + 官方属性；正文里的菜单共用，
   对一套皮肤来说正好统一）。菜单里的「标签 / 值」读数行照参考图 CODE : 258 的排法：
   标签使用角色主色、数值使用次级阅读色。 */
/* ⚠️ 选择器里带上 [data-menu-material] 是**必须的**：
   本项目更靠后还有一条 :is([role=dialog],[role=menu],[role=listbox]) 的弹层描边规则，
   它与 [role=menu] 那条**特异性完全相同**（都是 0,2,1），靠源码顺序它会赢 ——
   实测菜单描边被染成橙色 rgb(255,106,0)。加上这个官方属性后特异性升到 0,3,1，
   与源码顺序无关地稳定生效。
   （注意：本段 CSS 是 JS 模板字符串，注释里不能出现反引号，否则会提前截断字符串。） */
html[data-eva-magi] body [role="menu"][data-menu-material]{
  background-color:var(--eva-control);
  box-shadow:inset 0 0 0 1px var(--eva-accent),
    0 10px 30px var(--eva-shadow),
    0 0 18px color-mix(in srgb,var(--eva-accent) 16%,transparent);
  color:var(--eva-accent);
}
html[data-eva-magi] body [role="menu"][data-menu-material] [class*="_cellLabel"]{
  color:var(--eva-accent);font-weight:700;letter-spacing:.08em;
}
html[data-eva-magi] body [role="menu"][data-menu-material] [class*="_cellValue"]{
  color:var(--eva-dim);
  font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em;
}
html[data-eva-magi] body [role="menu"][data-menu-material] [role="menuitem"]:hover,
html[data-eva-magi] body [role="menu"][data-menu-material] [role="option"]:hover,
html[data-eva-magi] body [role="menu"][data-menu-material] button:hover{
  background-color:color-mix(in srgb,var(--eva-accent) 14%,transparent);color:var(--eva-accent);
}
/* 右侧栏 / 停靠面板：刻意不加描边。
   踩过的坑：早先这里给 [data-sidebar-right-panel] 加了 inset 1px 环，那个面板却是
   全高透明层（x 从屏幕正中到右缘、y 全高），于是它的左边在屏幕正中画出一条竖线、
   上边在顶端画出一条横线，拼成一个毫无意义的 L 形——用户的评价就是「多余的」。
   教训：装饰只能画在真的会绘制出来的表面上。 */
/* 按钮：加字距，悬停时内描一圈橙 —— 不设背景，避免盖掉应用的状态色 */
html[data-eva-magi] button{letter-spacing:.08em}
html[data-eva-magi] button:hover{
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4);
}
/* 键帽：老终端的实体键 */
html[data-eva-magi] kbd{
  padding:1px 5px;border:1px solid var(--dsw-alias-border-l3);
  background:var(--dsw-alias-bg-layer-3);
  box-shadow:0 1px 0 var(--dsw-alias-border-l2);
}
/* 滚动条：细橙条，像仪表刻度 */
html[data-eva-magi] ::-webkit-scrollbar{width:10px;height:10px}
html[data-eva-magi] ::-webkit-scrollbar-track{background:transparent}
html[data-eva-magi] ::-webkit-scrollbar-thumb{
  background:var(--dsw-alias-scrollbar-bg-l1);border:0;
  border-left:1px solid var(--dsw-alias-border-l2);
}
html[data-eva-magi] ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1)}
html[data-eva-magi] ::-webkit-scrollbar-corner{background:transparent}
/* 分隔线变危险条纹 */
html[data-eva-magi] hr{
  border:0;height:5px;opacity:.4;
  background:repeating-linear-gradient(45deg,
    var(--eva-secondary) 0 5px,rgba(0,0,0,0) 5px 10px);
}
/* DSH 的「已完成，用时」是任务过程按钮，底部是 border，不是 hr。
   使用稳定属性挂钩；警戒带画在现有底部留白内，不改高度或折叠行为。 */
html[data-eva-magi] ${HOST_HOOKS.turnProcess}{
  border-bottom-color:transparent;
  background-image:repeating-linear-gradient(45deg,
    color-mix(in srgb,var(--eva-secondary) 40%,transparent) 0 5px,transparent 5px 10px);
  background-position:left bottom;background-size:100% 5px;background-repeat:no-repeat;
}
/* 代码块左侧主色竖线 */
html[data-eva-magi] pre{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
/* 浮层：橙色外环 + 冷光 */
html[data-eva-magi] :is([role="dialog"],[role="menu"],[role="listbox"]){
  box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),
    0 0 30px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);
}
/* 焦点环统一走主色（focus.css 的兜底色是 state-business-primary，这里显式固定） */
html[data-eva-magi] :focus-visible{--dsw-focus-ring-color:var(--dsw-alias-brand-primary)}

/* ============================================================================
   2b. 追加的结构元素：雷达环 / 角编号 / 色散 / 扫描高光
   ============================================================================ */

/* 角色底纹：明日香的双斜切／绫波丽的细环，中心留给会话内容。 */
.eva-emg{position:absolute;inset:0;z-index:0;opacity:var(--eva-wallpaper-strength,.5);pointer-events:none;overflow:hidden}
html[data-eva-wallpaper="off"] .eva-emg{display:none}
.eva-character-art{position:absolute;right:-100px;top:18%;width:min(52vw,680px);aspect-ratio:1;color:var(--eva-accent);opacity:.17}
.eva-character-art svg{display:block;width:100%;height:100%;overflow:visible}
.eva-character-art text{font:700 210px/1 ui-monospace,Menlo,monospace;letter-spacing:-18px;fill:currentColor;stroke:none}
.eva-character-art .eva-art-label{font:500 10px/1 ui-monospace,Menlo,monospace;letter-spacing:2.2px}
.eva-character-art .eva-art-micro{font:400 7px/1 ui-monospace,Menlo,monospace;letter-spacing:1.3px;opacity:.8}
.eva-character-art .eva-art-fine{stroke-width:1;opacity:.7}
.eva-character-art .eva-art-panel{fill:currentColor;fill-opacity:.06;stroke:none}
.eva-character-art .eva-art-detail{color:var(--eva-mark)}
.eva-character-art--asuka .eva-art-detail{color:var(--eva-secondary)}
.eva-character-art--rei{display:none}
body:not([data-ds-dark-theme]) .eva-character-art--asuka{display:none}
body:not([data-ds-dark-theme]) .eva-character-art--rei{display:block;opacity:.19}
/* 左侧半身线稿：外层轻羽化，内层使用透明 PNG 轮廓作为角色色蒙版。
   与现有背景共用开关和强度；不产生点击区域，不修改宿主正文排版。 */
.eva-character-portrait{position:absolute;left:var(--eva-portrait-left,24px);top:var(--eva-portrait-top,100px);
  width:var(--eva-portrait-width,280px);height:var(--eva-portrait-height,420px);
  color:var(--eva-accent);opacity:.52;pointer-events:none;overflow:hidden;
  mask-image:linear-gradient(90deg,transparent,#000 8%,#000 74%,transparent)}
.eva-character-portrait::before{content:"";position:absolute;inset:0;background:currentColor;
  -webkit-mask:url("${BRAND_ASSETS.asukaPortrait}") center top/contain no-repeat;
  mask:url("${BRAND_ASSETS.asukaPortrait}") center top/contain no-repeat;
  /* 对齐腰部轮廓，消除原图下方透明留白：明日香 50/1536，绫波丽 14/1536。 */
  transform:translateY(3.2552083333%)}
body:not([data-ds-dark-theme]) .eva-character-portrait{opacity:.48}
body:not([data-ds-dark-theme]) .eva-character-portrait::before{
  -webkit-mask-image:url("${BRAND_ASSETS.reiPortrait}");mask-image:url("${BRAND_ASSETS.reiPortrait}");
  transform:translateY(.9114583333%)}
@media(max-width:640px){.eva-character-portrait{opacity:.3}
  body:not([data-ds-dark-theme]) .eva-character-portrait{opacity:.26}}
.eva-character-caption{position:absolute;left:24px;top:43%;writing-mode:vertical-rl;
  color:var(--eva-accent);opacity:.22;font:10px/1 ui-monospace,Menlo,monospace;letter-spacing:.38em}
body[data-ds-dark-theme] .eva-character-caption{color:var(--eva-secondary)}
@media (prefers-reduced-motion:reduce){
  .${OVERLAY_CLASS} *, .${OVERLAY_CLASS} *::before, .${OVERLAY_CLASS} *::after, .eva-boot, .eva-boot *{animation:none!important;transition:none!important}
}
/* 四角编号：EVA 屏幕上到处是这种规格码（设施编号 / 机体番号 / 模式码）。
   刻意压在 top:52px 而不是顶角 —— 顶栏两端分别是应用自己的徽标与侧栏折叠按钮，
   第一版把编号放顶角时正好压在徽标上。 */
.eva-id{
  position:absolute;font:9px/1 ui-monospace,Menlo,monospace;
  letter-spacing:.2em;color:var(--eva-accent);opacity:.55;padding:4px 6px;
}
.eva-id.tl{left:6px;top:52px}
.eva-id.tr{right:6px;top:52px}

/* CRT 色散：红/青两条线相对偏移 1px，模仿显像管的三枪不重合。
   只作用在内嵌框架上，所以不会让正文发虚。 */
.eva-frame::before,.eva-frame::after{
  content:"";position:absolute;inset:-3px;border:1px solid;opacity:.3;
}
.eva-frame::before{border-color:var(--eva-secondary);transform:translate(-1px,-1px)}
.eva-frame::after{border-color:var(--eva-mark);transform:translate(1px,1px)}

/* 刻度尺上的扫描高光：像游标量规在滑 */
.eva-edge{overflow:hidden}
.eva-edge::after{
  content:"";position:absolute;left:0;right:0;height:70px;opacity:.28;
  background:linear-gradient(to bottom,rgba(0,0,0,0),var(--eva-accent),rgba(0,0,0,0));
  animation:eva-ruler 6.5s linear infinite;
}
.eva-edge.r::after{animation-duration:7.8s;animation-delay:-2.5s}
@keyframes eva-ruler{0%{top:-70px}100%{top:100%}}

/* GIF → NERV 警报 → 黑底打字引导 → 全屏驾驶员认证舱 → 音声同步 → 聊天交接。 */
.eva-boot{${bootThemeCSS("asuka", "boot")}--sync-progress:0;
  position:fixed;inset:0;z-index:2147483100;pointer-events:auto;
  display:grid;place-items:center;overflow:hidden;background:#000101;color:var(--boot-ink);
  font-family:ui-monospace,Menlo,monospace;isolation:isolate}
.eva-boot[data-pilot="rei"]{${bootThemeCSS("rei", "boot")}}
/* The macOS host subtracts body-level overlays from window drag regions.
   Keep the boot background draggable, with the whole card-to-plug path interactive. */
html[data-platform="darwin"] .eva-boot{-webkit-app-region:drag}
html[data-platform="darwin"] .eva-boot :where(.eva-boot-grid,.eva-entry-bay,a,button,input,select,textarea,summary,
  [contenteditable="true"],[tabindex],[role="button"],[role="link"],[role="tab"],[role="option"],
  [role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="combobox"],[role="textbox"],
  [role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="listbox"],
  [role="dialog"],[role="alertdialog"],[role="tooltip"]){-webkit-app-region:no-drag}
.eva-boot *, .eva-boot *::before, .eva-boot *::after{box-sizing:border-box}
.eva-boot:is([data-phase="select"],[data-phase="loading"]){transition:background-color .65s cubic-bezier(.2,.7,.2,1),color .65s ease}
.eva-boot:is([data-phase="select"],[data-phase="loading"]) :is(.eva-boot-console,.eva-boot-title,.eva-boot-kicker,.eva-boot-kicker small,.eva-boot-hint,.eva-boot-header,.eva-boot-security,.eva-boot-security b,.eva-boot-exit,.eva-boot-resume,.eva-boot-sound,.eva-nerv-logo,.eva-entry-bay,.eva-entry-label,.eva-entry-label b,.eva-entry-spec,.eva-entry-spec b,.eva-entry-lock,.eva-entry-target,.eva-entry-machine,.eva-entry-window,.eva-entry-plug *,.eva-boot-footer,.eva-boot-status,.eva-boot-loading,.eva-boot-loading h2,.eva-boot-loading p,.eva-boot-code,.eva-sync-portrait,.eva-sync-orbit,.eva-sync-systems,.eva-sync-systems b,.eva-boot-meter,.eva-boot-meter i,.eva-boot-progress-label,.eva-boot-progress-label time,.eva-sync-caption,.eva-boot-magi,.eva-boot-magi span,.eva-boot-magi i){transition:color .65s ease,background-color .65s ease,border-color .65s ease,fill .65s ease,stroke .65s ease,box-shadow .65s ease}
.eva-boot-theme-sweep{position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(105deg,transparent 35%,color-mix(in srgb,var(--boot-accent) 7%,transparent) 49%,color-mix(in srgb,var(--boot-accent) 22%,transparent) 50%,transparent 51%);animation:eva-theme-sweep .7s cubic-bezier(.2,.6,.2,1) both}
@keyframes eva-theme-sweep{from{transform:translateX(-100%);opacity:0}15%,65%{opacity:1}to{transform:translateX(100%);opacity:0}}
.eva-boot[data-phase="loading"] .eva-boot-loading{animation:eva-sync-reveal .5s ease-out both}
@keyframes eva-sync-reveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.eva-boot [hidden]{display:none!important}
.eva-boot-gif{display:block;width:min(512px,calc(100vw - 24px),calc(100dvh - 24px));
  height:auto;aspect-ratio:1;object-fit:contain;image-rendering:auto}
.eva-boot:not([data-phase="gif"]){display:block;background:var(--boot-surface)}
.eva-boot[data-phase="emergency"]{background:#000}
.eva-emergency{position:absolute;inset:0;overflow:hidden;background:#000;pointer-events:none}
.eva-emergency>svg{display:block;width:100%;height:100%;animation:eva-alert-sequence 3s ease-in-out both}
.eva-emergency .eva-alert-cell{animation:eva-alert-cell 1.25s ease-in-out infinite;animation-delay:var(--alert-lag,0s)}
@keyframes eva-alert-sequence{0%{opacity:0}10%{opacity:.96}28%{opacity:.42}45%{opacity:.98}62%{opacity:.3}78%{opacity:.96}91%{opacity:.68}100%{opacity:0}}
@keyframes eva-alert-cell{0%,100%{opacity:1}50%{opacity:.24}}
.eva-emergency-next{position:absolute;right:24px;top:24px;border:1px solid #86191c;border-radius:0;padding:9px 12px;background:#080101;color:#ec6a6d;cursor:pointer;font:10px/1.5 ui-monospace,Menlo,monospace}
.eva-boot-backdrop{position:absolute;inset:0;overflow:hidden;pointer-events:none;
  background:radial-gradient(ellipse at 20% 35%,#d56c1810,transparent 65%),radial-gradient(ellipse at 90% 100%,#ef7d2112,transparent 55%)}
.eva-boot-contours{position:absolute;inset:0;width:100%;height:100%;color:#f49344;opacity:.65}
.eva-boot-watermark{position:absolute;right:-.035em;bottom:-.13em;color:#f49344;opacity:.035;font:800 clamp(260px,48vw,900px)/1 ui-monospace,Menlo,monospace;letter-spacing:-.1em}
.eva-boot-rail{position:absolute;top:30%;bottom:12%;width:10px;opacity:.5;background:repeating-linear-gradient(0deg,#f49344 0 1px,transparent 1px 24px)}
.eva-boot-rail.left{left:10px}.eva-boot-rail.right{right:10px}
.eva-boot-console{position:relative;z-index:1;width:100%;height:100%;height:100dvh;margin:0;
  padding:clamp(16px,3dvh,38px) clamp(24px,3.5vw,72px) clamp(12px,2dvh,24px);
  display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:clamp(14px,2.5dvh,30px);min-height:0}
.eva-boot-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-top:2px solid var(--boot-accent);padding-top:16px}
.eva-boot-heading{min-width:0}.eva-boot-brand{display:flex;gap:12px;align-items:center;margin-bottom:10px}
.eva-boot-brand .eva-nerv-logo{width:24px;height:28px}
html[data-eva-magi] .eva-boot .eva-nerv-logo{background:var(--boot-accent)}
.eva-boot-kicker{margin:0;color:var(--boot-accent);font:10px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.22em}
.eva-boot-kicker small{display:block;color:var(--boot-dim);font-size:8px;letter-spacing:.16em}
.eva-boot-title{margin:0;font:500 clamp(26px,3.2vw,54px)/1.3 var(--eva-pilot-font);letter-spacing:.13em;color:var(--boot-ink);font-synthesis:none;-webkit-text-stroke:0}
html[data-eva-magi] .eva-boot-title{-webkit-text-stroke:0}
.eva-boot-hint{margin:10px 0 0;color:var(--boot-dim);font:11px/1.6 ui-monospace,Menlo,monospace}
.eva-boot-header-side{display:flex;flex-direction:column;gap:10px;align-items:flex-end;text-align:right;flex-shrink:0}
.eva-boot-actions{display:flex;align-items:center;gap:10px}
.eva-boot-languages{display:flex;gap:2px;padding:3px;border:1px solid #774820;background:#100d09cc}
.eva-boot-languages button{border:1px solid transparent;border-radius:0;padding:5px 7px;background:transparent;color:#b8a692;cursor:pointer;font:10px/1.4 ui-monospace,Menlo,monospace;white-space:nowrap}
.eva-boot-languages button[aria-pressed="true"]{color:#ffbe82;background:#f493441a;border-color:#a45d2b}
.eva-boot-languages button:hover{color:#ffe2c6}
.eva-boot-security{color:var(--boot-dim);font:9px/1.7 ui-monospace,Menlo,monospace;letter-spacing:.13em}
.eva-boot-security b{display:block;color:var(--boot-accent);font-weight:400}
.eva-boot-exit,.eva-boot-resume{flex:0 0 auto;border:1px solid var(--boot-line);border-radius:0;padding:10px 13px;background:var(--boot-surface);color:var(--boot-ink);cursor:pointer;font:11px/1.4 ui-monospace,Menlo,monospace}
.eva-boot button:focus-visible{outline:2px solid var(--boot-accent);outline-offset:4px}
.eva-boot-exit:hover,.eva-boot-resume:hover{border-color:var(--boot-accent);color:var(--boot-accent)}
.eva-boot-sound{display:grid;place-items:center;flex:0 0 auto;width:34px;height:34px;padding:7px;border:1px solid var(--boot-line);border-radius:0;background:var(--boot-surface);color:var(--boot-accent);cursor:pointer}
.eva-boot-sound svg{width:18px;height:18px}.eva-boot-sound[aria-pressed="true"] .eva-sound-slash{display:none}
.eva-boot:is([data-phase="gif"],[data-phase="emergency"]) .eva-boot-sound{position:absolute;right:24px;bottom:24px;color:#d1d9dc;border-color:#37464b;background:#000101}
.eva-boot[data-phase="emergency"] .eva-boot-sound{color:#ec6a6d;border-color:#86191c;background:#080101}
.eva-boot[data-phase="intro"]{background:#000101}
.eva-boot[data-phase="intro"] .eva-boot-sound{position:absolute;right:24px;bottom:24px;color:#d1d9dc;border-color:#37464b;background:#000101;z-index:6}
.eva-boot-intro{position:absolute;inset:0;z-index:5;display:grid;place-items:center;overflow:hidden;background:#000101;color:#e5e9e7;clip-path:inset(0);isolation:isolate}
.eva-intro-copy{position:relative;z-index:1;max-width:calc(100% - 40px);text-align:center;animation:eva-intro-copy-in .45s ease-out both}
.eva-intro-kicker{margin:0 0 24px;color:#81908f;font:10px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.28em}
.eva-intro-title{position:relative;width:max-content;max-width:100%;margin:0 auto;color:#e5e9e7;font:500 clamp(26px,4vw,62px)/1.5 var(--eva-pilot-font);letter-spacing:.12em;white-space:pre;font-synthesis:none;-webkit-text-stroke:0}
html[data-eva-magi] .eva-intro-title{font-family:var(--eva-pilot-font);letter-spacing:.12em;-webkit-text-stroke:0}
.eva-boot[lang="en"] .eva-intro-title{letter-spacing:.025em;font-size:clamp(24px,3.8vw,58px)}
.eva-intro-measure{visibility:hidden}.eva-intro-typed{position:absolute;left:0;top:0}
.eva-intro-typed::after{content:"";display:inline-block;width:2px;height:.85em;margin-left:.12em;background:#cbd9d8;vertical-align:-.03em;animation:eva-intro-caret .72s steps(1,end) infinite}
.eva-intro-rule{display:block;width:90px;height:1px;margin:30px auto 0;background:linear-gradient(90deg,${BOOT_THEMES.asuka.accent} 0 48%,transparent 48% 52%,${BOOT_THEMES.rei.accent} 52%);transform-origin:center;animation:eva-intro-rule-in .7s ease-out both}
.eva-intro-pilot{position:absolute;top:50%;width:clamp(80px,12vw,160px);transform:translateY(-50%);text-align:center;color:var(--intro-pilot);pointer-events:none;animation:eva-intro-pilot-in 1s ease-out both}
.eva-intro-pilot[data-pilot="asuka"]{--intro-pilot:${BOOT_THEMES.asuka.accent};--intro-head:url("${BRAND_ASSETS.asukaHead}");left:7vw}
.eva-intro-pilot[data-pilot="rei"]{--intro-pilot:${BOOT_THEMES.rei.accent};--intro-head:url("${BRAND_ASSETS.reiHead}");right:7vw}
.eva-intro-face{display:block;width:100%;aspect-ratio:1/1.2;background:currentColor;mask:var(--intro-head) center/contain no-repeat;opacity:.3}
.eva-intro-pilot b{display:block;margin-top:12px;font:400 23px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.1em;opacity:.8}
.eva-intro-pilot small{display:block;margin-top:8px;color:#81908f;font:8px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.13em}
.eva-intro-next{position:absolute;right:24px;top:24px;padding:9px 12px;border:1px solid #37464b;border-radius:0;background:#000101;color:#aabbbd;cursor:pointer;font:10px/1.5 ui-monospace,Menlo,monospace}
.eva-intro-next:hover{color:#e5e9e7;border-color:#81908f}
.eva-boot-intro[data-leaving]{animation:eva-intro-dissolve .82s ease-out both;pointer-events:none}
.eva-boot-intro[data-leaving] .eva-intro-copy{visibility:hidden;animation:none}
.eva-intro-flight{position:fixed;z-index:7;margin:0;pointer-events:none;white-space:pre;transform-origin:0 0;font-synthesis:none;-webkit-text-stroke:0}
.eva-boot[data-arriving] .eva-boot-title{visibility:hidden}
@keyframes eva-intro-copy-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes eva-intro-pilot-in{from{opacity:0}to{opacity:1}}
@keyframes eva-intro-rule-in{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes eva-intro-caret{0%,100%{opacity:1}50%{opacity:0}}
@keyframes eva-intro-dissolve{from{opacity:1}to{opacity:0}}
@media(max-width:600px){.eva-intro-pilot{top:calc(50% - 140px);width:72px}.eva-intro-pilot[data-pilot="asuka"]{left:calc(50% - 108px)}.eva-intro-pilot[data-pilot="rei"]{right:calc(50% - 108px)}.eva-intro-pilot b{font-size:18px;margin-top:6px}.eva-intro-pilot small{font-size:7px}.eva-intro-kicker{font-size:8px;letter-spacing:.15em;margin-bottom:18px}.eva-intro-rule{margin-top:22px}}
@media(max-height:440px){.eva-intro-pilot{top:50%;width:70px}.eva-intro-pilot[data-pilot="asuka"]{left:5vw}.eva-intro-pilot[data-pilot="rei"]{right:5vw}.eva-intro-pilot small{display:none}.eva-intro-title{font-size:28px}.eva-intro-kicker{margin-bottom:12px}.eva-intro-rule{margin-top:16px}}
.eva-boot-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:clamp(18px,3vw,56px);align-items:stretch;min-height:0}
.eva-entry-bay{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0;container-type:size;border:1px solid var(--boot-line);background:var(--boot-panel);overflow:hidden}
.eva-entry-bay::before{content:"";position:absolute;left:50%;top:50%;width:80%;aspect-ratio:1;border:1px solid var(--boot-line);border-radius:50%;outline:1px solid color-mix(in srgb,var(--boot-line) 70%,transparent);outline-offset:24px;transform:translate(-50%,-50%)}
.eva-entry-bay::after{content:"";position:absolute;inset:72px 16px 46px;pointer-events:none;border-inline:1px solid var(--boot-line);background:repeating-linear-gradient(0deg,var(--boot-line) 0 1px,transparent 1px 28px) left/8px 100% no-repeat,repeating-linear-gradient(0deg,var(--boot-line) 0 1px,transparent 1px 28px) right/8px 100% no-repeat}
.eva-entry-bay[data-over="1"]{border-color:var(--boot-accent);box-shadow:inset 0 0 90px color-mix(in srgb,var(--boot-accent) 13%,transparent)}
.eva-entry-label{position:absolute;z-index:1;top:18px;left:18px;color:var(--boot-dim);font:9px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.2em}
.eva-entry-label b{display:block;color:var(--boot-accent);font-size:12px;letter-spacing:.12em}
.eva-entry-spec{position:absolute;right:18px;top:20px;text-align:right;color:var(--boot-dim);font:8px/1.7 ui-monospace,Menlo,monospace;letter-spacing:.08em}
.eva-entry-spec b{display:block;color:var(--boot-accent);font-weight:400}
.eva-entry-machine{--plug-clearance:105px;--plug-width:144cqw;position:relative;flex:none;height:min(calc(100cqh - var(--plug-clearance)),var(--plug-width));aspect-ratio:1/2;color:var(--boot-dim)}
.eva-entry-assembly{position:absolute;inset:0;transform:rotate(14deg)}
.eva-entry-plug{display:block;width:100%;height:100%;color:inherit;overflow:visible}
.eva-entry-plug .eva-plug-micro{font:7px ui-monospace,Menlo,monospace;letter-spacing:1px;stroke:none}
.eva-entry-plug .eva-plug-stencil{font:500 33px ui-monospace,Menlo,monospace;letter-spacing:-1px;stroke:none}
/* Surface markings roll around the long axis; shell, lighting and 14° assembly tilt stay fixed. */
.eva-plug-roll{transform-box:view-box;transform-origin:200px 400px}
.eva-plug-roll-back{opacity:0}
.eva-boot[data-paused] .eva-plug-roll{animation-play-state:paused!important}
.eva-boot[data-phase="select"] .eva-plug-roll{animation:eva-plug-roll 10s linear infinite}
.eva-boot[data-phase="select"] .eva-plug-roll-back{animation-delay:-5s}
@keyframes eva-plug-roll{
 0%,100%{transform:translateX(0) scaleX(1);opacity:1}
 12.5%{transform:translateX(45px) scaleX(.707);opacity:1}
 24.9%{transform:translateX(64px) scaleX(.006);opacity:0}
 25%,74.9%{transform:translateX(64px) scaleX(0);opacity:0}
 75%{transform:translateX(-64px) scaleX(0);opacity:0}
 87.5%{transform:translateX(-45px) scaleX(.707);opacity:1}
}
@media(prefers-reduced-motion:reduce){.eva-boot[data-phase="select"] .eva-plug-roll{animation:none}}
.eva-entry-window{position:absolute;left:41.5%;right:41.5%;top:55.5%;height:11%;opacity:0;
  background:var(--boot-accent);mask:var(--boot-head) center/contain no-repeat;pointer-events:none;filter:drop-shadow(0 0 3px var(--boot-accent))}
.eva-entry-target{position:absolute;left:12px;right:12px;bottom:16px;margin:0;text-align:center;color:var(--boot-accent);font:10px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.12em}
.eva-entry-target::before{content:"";display:block;width:58px;height:3px;margin:0 auto 8px;background:repeating-linear-gradient(135deg,var(--boot-signal) 0 4px,transparent 4px 8px)}
.eva-entry-lock{position:absolute;right:22px;top:42%;writing-mode:vertical-rl;color:var(--boot-dim);font:8px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em}
.eva-pilot-list{display:grid;grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:clamp(12px,2.3dvh,26px);min-width:0;min-height:0}
.eva-pilot-card{${bootThemeCSS("asuka", "card")}position:relative;display:grid;grid-template-columns:54% 1fr;align-items:center;text-align:left;min-width:0;min-height:0;
  padding:24px 24px 18px 8px;background:var(--card-surface);border:1px solid var(--card-line);border-left:3px solid var(--card-accent);border-radius:0;color:var(--card-ink);cursor:grab;touch-action:none;user-select:none;overflow:hidden}
.eva-pilot-card[data-pilot="rei"]{${bootThemeCSS("rei", "card")}}
.eva-pilot-card:hover,.eva-pilot-card:focus-visible{background:var(--card-panel);border-color:var(--card-accent)}
.eva-pilot-card:focus-visible{outline-color:var(--card-accent)}
.eva-pilot-card:active{cursor:grabbing}
.eva-pilot-card::before{content:attr(data-unit);position:absolute;right:-.04em;bottom:-.2em;color:var(--card-accent);font:800 clamp(100px,15vw,260px)/1 ui-monospace,Menlo,monospace;letter-spacing:-.1em;opacity:.055;pointer-events:none}
.eva-pilot-card-top{position:absolute;top:10px;left:16px;right:16px;display:flex;justify-content:space-between;color:var(--card-accent);font:8px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.13em}
.eva-pilot-card-top i{font-style:normal;color:var(--card-dim)}
.eva-pilot-face{display:block;width:100%;height:100%;min-height:0;background:var(--card-accent);mask:var(--pilot-head) center/contain no-repeat;pointer-events:none}
.eva-pilot-card[data-pilot="asuka"]{--pilot-head:url("${BRAND_ASSETS.asukaHead}")}
.eva-pilot-card[data-pilot="rei"]{--pilot-head:url("${BRAND_ASSETS.reiHead}")}
.eva-pilot-info{display:block;position:relative;min-width:0}
.eva-pilot-number{display:block;color:var(--card-accent);font:700 clamp(34px,5vw,84px)/1 ui-monospace,Menlo,monospace;letter-spacing:-.06em}
.eva-pilot-info b{display:block;margin-top:12px;color:var(--card-accent);font:500 clamp(18px,2.4vw,36px)/1.3 serif;letter-spacing:.1em}
.eva-pilot-info small{display:block;margin-top:6px;color:var(--card-accent);font:9px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.08em}
.eva-pilot-info em{display:block;margin-top:14px;color:var(--card-accent);font:normal 9px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.1em}
.eva-pilot-card::after{content:"";position:absolute;right:8px;bottom:8px;width:14px;height:14px;border-right:1px solid var(--card-accent);border-bottom:1px solid var(--card-accent)}
.eva-pilot-ghost{position:fixed;left:0;top:0;z-index:4;pointer-events:none;opacity:.85;transform-origin:center;box-shadow:0 12px 60px #0009;will-change:transform}
.eva-boot-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid var(--boot-line);padding-top:12px;min-width:0}
.eva-boot-status{margin:0;display:flex;gap:12px;align-items:center;color:var(--boot-dim);min-height:20px;font:10px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.1em}
.eva-boot-status::before{content:"";width:6px;height:6px;flex:none;background:var(--boot-accent)}
.eva-boot-magi{display:flex;align-items:center;gap:8px;color:var(--boot-dim);font:8px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.08em}
.eva-boot-magi span{border:1px solid var(--boot-line);padding:6px 10px}.eva-boot-magi i{display:inline-block;width:4px;height:4px;margin-right:6px;background:var(--boot-ok)}
.eva-boot-loading{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:0;min-width:0;overflow:hidden;border:1px solid var(--boot-line);padding:clamp(20px,3vw,56px);gap:clamp(14px,3dvh,34px);background:var(--boot-panel)}
.eva-sync-portrait{position:absolute;inset:0 0 0 20%;background:var(--boot-accent);mask:var(--boot-head) right center/contain no-repeat;opacity:.1;pointer-events:none}
.eva-boot-loading>*:not(.eva-sync-portrait){position:relative}
.eva-boot-loading h2{margin:6px 0 0;color:var(--boot-accent);font:500 clamp(28px,4.5vw,72px)/1.3 serif;letter-spacing:.13em}
.eva-boot-loading .eva-boot-code{color:var(--boot-dim);font:10px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.15em}
.eva-boot-loading p{margin:12px 0 0;color:var(--boot-dim);font:11px/1.9 ui-monospace,Menlo,monospace}
.eva-sync-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(90px,32%);align-items:center;gap:14px}
.eva-sync-orbit{position:relative;aspect-ratio:1;color:var(--boot-accent)}
.eva-sync-orbit svg{display:block;width:100%;height:100%}
.eva-sync-ring-meter{stroke-dasharray:440;stroke-dashoffset:calc(440 * (1 - var(--sync-progress)));transform:rotate(-90deg);transform-origin:90px 90px}
.eva-sync-readout{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.eva-sync-value{font:400 clamp(22px,3vw,48px)/1 ui-monospace,Menlo,monospace;letter-spacing:-.06em}
.eva-sync-readout small{margin-top:9px;font:8px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em}
.eva-sync-systems{display:flex;justify-content:space-between;gap:8px;padding-block:12px;border-block:1px solid var(--boot-line);color:var(--boot-dim);font:8px/1.8 ui-monospace,Menlo,monospace;letter-spacing:.08em}
.eva-sync-systems b{display:block;color:var(--boot-accent);font-weight:400}
.eva-boot-meter{height:16px;overflow:hidden;border:1px solid var(--boot-line);padding:3px}
.eva-boot-meter i{display:block;width:100%;height:100%;background:repeating-linear-gradient(90deg,var(--boot-accent) 0 7px,transparent 7px 10px);transform:scaleX(0);transform-origin:left}
.eva-boot-progress-label{margin-top:10px;display:flex;justify-content:space-between;gap:10px;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--boot-accent)}
.eva-boot-progress-label time{color:var(--boot-dim)}
.eva-sync-caption{margin-top:10px;color:var(--boot-dim);font:8px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.1em}
.eva-boot[data-phase="loading"] .eva-entry-window{opacity:.9;animation:eva-pilot-insert .7s cubic-bezier(.2,.8,.2,1) both}
.eva-boot[data-phase="loading"] .eva-entry-machine{color:var(--boot-accent)}
.eva-boot[data-phase="loading"] .eva-plug-collar{animation:eva-collar-lock .7s ease-out both;transform-origin:200px 640px}
@keyframes eva-pilot-insert{from{transform:translateY(-60px);opacity:0}to{transform:translateY(0);opacity:.9}}
@keyframes eva-collar-lock{from{transform:scaleX(1.12)}to{transform:scaleX(1)}}
/* 双侧舱门打开，真实聊天界面留在原位；最后以细边框交接输入焦点。 */
.eva-boot[data-phase="handoff"]{background:transparent}
.eva-boot[data-phase="handoff"] .eva-boot-backdrop{visibility:hidden}
.eva-boot[data-phase="handoff"] .eva-boot-console{z-index:3;pointer-events:none;animation:eva-console-release .28s ease-out both}
@keyframes eva-console-release{to{opacity:0;transform:translateY(-8px);visibility:hidden}}
.eva-boot-gate{position:absolute;top:0;bottom:0;width:50.2%;z-index:2;pointer-events:none;overflow:hidden;background:var(--boot-surface);color:var(--boot-accent)}
.eva-boot-gate::before{content:"";position:absolute;inset:20px;border:1px solid var(--boot-line);background:repeating-linear-gradient(135deg,transparent 0 18px,color-mix(in srgb,var(--boot-accent) 3%,transparent) 18px 19px)}
.eva-boot-gate::after{content:"";position:absolute;top:0;bottom:0;width:3px;background:repeating-linear-gradient(0deg,var(--boot-accent) 0 12px,transparent 12px 20px);opacity:.7}
.eva-boot-gate.left{left:0;border-right:1px solid var(--boot-accent);animation:eva-gate-left 1.6s cubic-bezier(.65,0,.2,1) both}
.eva-boot-gate.right{right:0;border-left:1px solid var(--boot-accent);animation:eva-gate-right 1.6s cubic-bezier(.65,0,.2,1) both}
.eva-boot-gate.left::after{right:10px}.eva-boot-gate.right::after{left:10px}
.eva-boot-gate span{position:absolute;top:50%;font:9px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;writing-mode:vertical-rl}
.eva-boot-gate.left span{right:32px}.eva-boot-gate.right span{left:32px}
@keyframes eva-gate-left{0%,18%{transform:translateX(0)}90%,100%{transform:translateX(-102%)}}
@keyframes eva-gate-right{0%,18%{transform:translateX(0)}90%,100%{transform:translateX(102%)}}
.eva-boot-clearance{position:absolute;z-index:4;left:50%;top:50%;transform:translate(-50%,-50%);padding:14px 24px;background:var(--boot-surface);border-block:1px solid var(--boot-accent);color:var(--boot-accent);text-align:center;white-space:nowrap;pointer-events:none;animation:eva-clearance 1.6s ease-out both}
.eva-boot-clearance b{display:block;font:400 clamp(16px,2vw,30px)/1.4 var(--eva-pilot-font);letter-spacing:.22em}
.eva-boot-clearance small{font:8px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.16em}
@keyframes eva-clearance{0%{opacity:0}16%,32%{opacity:1}55%,100%{opacity:0}}
.eva-boot-composer-frame{position:fixed;z-index:1;border:1px solid var(--boot-accent);box-shadow:0 0 16px color-mix(in srgb,var(--boot-accent) 22%,transparent);pointer-events:none;animation:eva-composer-arrival 1.6s ease-out both}
@keyframes eva-composer-arrival{0%,58%{opacity:0}78%{opacity:.8}100%{opacity:0}}
@media(max-width:900px){.eva-boot-security{display:none}.eva-boot-console{padding-inline:24px}.eva-entry-spec{display:none}.eva-boot-magi span{padding:5px}.eva-sync-main{grid-template-columns:minmax(0,1fr) 90px}.eva-boot-loading{padding:20px}.eva-boot-loading h2{font-size:34px}}
@media(max-width:640px){
 .eva-boot-console{padding:14px 14px 10px;gap:12px}.eva-boot-header{gap:8px;padding-top:10px}.eva-boot-title{font-size:24px;letter-spacing:.08em}
 .eva-boot-brand{gap:8px;margin-bottom:8px}.eva-boot-brand .eva-nerv-logo{width:18px;height:21px}.eva-boot-kicker{font-size:7px;letter-spacing:.08em}.eva-boot-kicker small{font-size:6px}
 .eva-boot-hint{font-size:9px;max-width:230px;margin-top:8px}.eva-boot-exit{padding:7px;font-size:9px}.eva-boot-header-side{gap:8px}.eva-boot-languages button{font-size:9px;padding:4px 5px}.eva-boot-actions{gap:6px}.eva-boot[lang="en"] .eva-boot-title{font-size:22px;letter-spacing:0}
 .eva-boot-grid{grid-template-columns:minmax(0,.83fr) minmax(0,1.17fr);gap:10px}.eva-entry-machine{--plug-clearance:85px;--plug-width:240cqw}
 .eva-entry-label{top:10px;left:8px;font-size:6px;letter-spacing:.08em}.eva-entry-label b{font-size:8px}.eva-entry-target{font-size:7px;letter-spacing:0;bottom:12px;left:6px;right:6px}.eva-entry-lock{display:none}.eva-entry-bay::after{inset:55px 5px 40px}
 .eva-pilot-list{gap:10px}.eva-pilot-card{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto;padding:22px 10px 10px}.eva-pilot-face{min-height:0}.eva-pilot-info{padding-left:3px}
 .eva-pilot-card-top{left:9px;right:9px;font-size:6px}.eva-pilot-card-top i{display:none}.eva-pilot-number{position:absolute;right:0;top:-28px;font-size:30px;opacity:.7}.eva-pilot-info b{font-size:17px;margin-top:3px}.eva-pilot-info small{font-size:7px}.eva-pilot-info em{font-size:7px;margin-top:5px}
 .eva-boot-loading{gap:18px;padding:16px 12px}.eva-sync-main{grid-template-columns:1fr;gap:18px}.eva-sync-orbit{width:94px;justify-self:center;grid-row:1}.eva-boot-loading h2{font-size:25px}.eva-boot-loading p{font-size:9px}.eva-boot-code{font-size:8px!important;letter-spacing:.06em!important}.eva-sync-systems{gap:5px;font-size:6px}.eva-sync-value{font-size:24px}.eva-sync-readout small{font-size:6px}.eva-boot-progress-label{font-size:9px;gap:4px}.eva-sync-caption{font-size:6px;letter-spacing:0}
 .eva-boot-footer{padding-top:8px;gap:8px}.eva-boot-status{font-size:8px;gap:7px;letter-spacing:0}.eva-boot-magi{gap:3px;font-size:5px}.eva-boot-magi span{padding:4px 3px}.eva-boot-magi i{display:none}
}
@media(max-height:560px){
 .eva-boot-console{padding-top:12px;padding-bottom:8px;gap:10px}.eva-boot-header{padding-top:9px}.eva-boot-brand{margin-bottom:5px}.eva-boot-brand .eva-nerv-logo{width:16px;height:18px}.eva-boot-kicker small{display:none}.eva-boot-title{font-size:26px}.eva-boot-hint{margin-top:5px;font-size:9px}.eva-boot-footer{padding-top:7px}.eva-boot-status{font-size:8px}.eva-boot-magi span{padding:4px 7px}
 .eva-entry-machine{--plug-clearance:55px}.eva-entry-label{top:8px;font-size:7px}.eva-entry-label b{font-size:9px}.eva-entry-target{font-size:8px;bottom:7px}.eva-entry-spec,.eva-entry-lock{display:none}.eva-entry-bay::after{inset:44px 8px 30px}
 .eva-entry-target::before{display:none}
 .eva-pilot-card{grid-template-columns:48% 1fr;grid-template-rows:1fr;padding:18px 12px 8px 4px}.eva-pilot-info b{font-size:18px;margin-top:4px}.eva-pilot-info small{font-size:7px}.eva-pilot-info em{font-size:7px;margin-top:6px}.eva-pilot-number{font-size:28px;position:static;opacity:1}.eva-pilot-card-top{font-size:6px;top:5px}
 .eva-boot-loading{padding:14px 20px;gap:12px}.eva-sync-main{grid-template-columns:minmax(0,1fr) 80px;gap:12px}.eva-sync-orbit{width:auto;grid-row:auto}.eva-boot-loading h2{font-size:28px}.eva-boot-loading p{margin-top:5px;font-size:9px}.eva-sync-systems{display:none}.eva-boot-loading .eva-boot-code{font-size:8px}.eva-boot-meter{height:12px}.eva-boot-progress-label{font-size:10px;margin-top:5px}.eva-sync-caption{margin-top:5px;font-size:7px}.eva-sync-value{font-size:22px}
}
@media(max-height:380px){
 .eva-boot-console{gap:8px}.eva-boot-title{font-size:22px}.eva-boot-brand{margin-bottom:4px}.eva-boot-hint{font-size:8px}.eva-boot-magi{font-size:6px}
 .eva-pilot-number{display:none}.eva-pilot-card{padding:17px 10px 6px 4px}.eva-pilot-info b{font-size:17px;margin-top:0}.eva-pilot-info small{margin-top:3px}.eva-pilot-info em{margin-top:4px}
 .eva-boot-loading{padding:8px 14px;gap:6px}.eva-sync-main{grid-template-columns:minmax(0,1fr) 60px}.eva-sync-orbit{width:60px}.eva-boot-loading h2{font-size:26px}.eva-boot-loading p{display:none}.eva-boot-resume{padding:6px;font-size:9px}.eva-sync-caption{font-size:6px}
}

`;

		const PILOTS = Object.freeze({
			asuka: Object.freeze({ name: "明日香", en: "ASUKA LANGLEY", code: "02", mode: "DARK" }),
			rei: Object.freeze({ name: "绫波丽", en: "REI AYANAMI", code: "00", mode: "LIGHT" }),
		});
		// 启动界面语言独立于宿主 UI；语音继续使用用户提供的两段原始 MP3。
		const BOOT_COPY = Object.freeze({
			"zh-CN": {
				select: "选择你的驾驶员", skipIntro: "进入选择", hint: "将头像拖入左侧插入栓，或点击头像装载", exit: "跳过并进入", language: "启动界面语言",
				asuka: "明日香", rei: "绫波丽", dark: "暗色", light: "亮色", card: "选择{pilot}，载入{mode}主题",
				bay: "插入栓，驾驶员头像放置区", drop: "拖入驾驶员 · DROP PILOT HERE", inserted: "驾驶员已装载 · 接続開始", pilots: "驾驶员选择",
				syncTitle: "驾驶员同步中", syncHint: "启动语音播放结束后进入会话", syncArea: "驾驶员同步", voiceHint: "启动语音与同步进度", progress: "驾驶员启动语音进度",
				waiting: "等待驾驶员 · AWAITING PILOT", responding: "驾驶员应答 · {pilot}", sync: "音声同步 · {pilot}", buffering: "语音缓冲中…", paused: "启动语音已暂停，返回后点击继续。",
				error: "语音暂时无法播放，可重试或跳过进入。", themeError: "主题切换暂时不可用，请重试或跳过。", resume: "继续启动语音", retry: "重试启动语音",
				complete: "同步完成", handoff: "同步完成，正在进入聊天", alert: "NERV 警报启动画面", skipAlert: "跳过警报",
				bgm: "启动背景音乐", bgmOn: "背景音乐播放中 · 点击静音", bgmOff: "点击播放启动背景音乐",
			},
			ja: {
				select: "パイロットを選択", skipIntro: "選択画面へ", hint: "ポートレートを左のエントリープラグへドラッグ、またはクリック", exit: "スキップして入る", language: "起動画面の言語",
				asuka: "アスカ", rei: "綾波レイ", dark: "ダーク", light: "ライト", card: "{pilot}を選択、{mode}テーマを読み込む",
				bay: "エントリープラグ、パイロットのドロップ先", drop: "パイロットを挿入 · DROP PILOT HERE", inserted: "パイロット搭乗 · 接続開始", pilots: "パイロット選択",
				syncTitle: "パイロット同期中", syncHint: "起動ボイス終了後にチャットへ移行します", syncArea: "パイロット同期", voiceHint: "起動ボイスと同期状況", progress: "起動ボイスの再生状況",
				waiting: "パイロット待機中 · AWAITING PILOT", responding: "パイロット応答 · {pilot}", sync: "音声同期 · {pilot}", buffering: "音声を読み込み中…", paused: "起動ボイスを一時停止しました。再開ボタンを押してください。",
				error: "音声を再生できません。再試行するかスキップしてください。", themeError: "テーマを切り替えられません。再試行してください。", resume: "起動ボイスを再開", retry: "起動ボイスを再試行",
				complete: "同期完了", handoff: "同期完了、チャットへ移行中", alert: "NERV 警報起動画面", skipAlert: "警報をスキップ",
				bgm: "起動 BGM", bgmOn: "BGM 再生中 · クリックでミュート", bgmOff: "クリックして BGM を再生",
			},
			en: {
				select: "Select your pilot", skipIntro: "Continue", hint: "Drag a portrait into the entry plug, or click to select", exit: "Skip and enter", language: "Startup language",
				asuka: "Asuka", rei: "Rei", dark: "Dark", light: "Light", card: "Select {pilot}, load the {mode} theme",
				bay: "Entry plug, pilot drop zone", drop: "DROP PILOT HERE", inserted: "PILOT LOADED · CONNECTING", pilots: "Pilot selection",
				syncTitle: "Synchronizing pilot", syncHint: "Enter chat when the startup voice finishes", syncArea: "Pilot synchronization", voiceHint: "Startup voice and synchronization", progress: "Startup voice progress",
				waiting: "AWAITING PILOT", responding: "PILOT RESPONSE · {pilot}", sync: "VOICE SYNC · {pilot}", buffering: "Buffering voice…", paused: "Startup voice paused. Select resume to continue.",
				error: "Voice playback unavailable. Retry or skip to enter.", themeError: "Theme change unavailable. Please retry or skip.", resume: "Resume voice", retry: "Retry voice",
				complete: "Sync complete", handoff: "Sync complete, entering chat", alert: "NERV emergency startup", skipAlert: "Skip alert",
				bgm: "Startup music", bgmOn: "Music playing · Click to mute", bgmOff: "Click to play startup music",
			},
		});
		/** Shared deterministic geometry: the worker and fallback draw identical contours. */
		function createContourRenderer() {
			const columns = 81, rows = 51, heights = new Float32Array(columns * rows);
			const pairs = [[], [0, 3], [0, 1], [1, 3], [1, 2], null, [0, 2], [2, 3], [2, 3], [0, 2], null, [1, 2], [1, 3], [0, 1], [0, 3], []];
			return (time) => {
				const result = [];
				// 同一连续高度场取不同高度截线；移动山峰、谷地及细部波纹，轮廓不会互相穿越。
				const phase = time * .18, peaks = [[.18 + .035 * Math.sin(phase), .17 + .04 * Math.cos(phase * .7), .03, .055, 1.2], [.89 + .03 * Math.cos(phase * .8), .84 + .06 * Math.sin(phase * .65), .045, .09, 1.3], [-.1, .9, .06, .07, .65], [.54, .53, .06, .05, -.45]];
				for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
					const u = x / (columns - 1), v = y / (rows - 1);
					let h = .11 * Math.sin(9 * u + 3 * v + phase) + .075 * Math.cos(12 * v - 4 * u - phase * .8) + .035 * Math.sin(18 * u - 11 * v + phase * .6);
					for (const [px, py, sx, sy, gain] of peaks) h += gain * Math.exp(-((u - px) ** 2 / sx + (v - py) ** 2 / sy));
					heights[y * columns + x] = h;
				}
				for (let levelIndex = 0; levelIndex < 24; levelIndex++) {
					const level = -.26 + levelIndex * .065, nodes = new Map();
					for (let y = 0; y < rows - 1; y++) for (let x = 0; x < columns - 1; x++) {
						const i = y * columns + x, a = heights[i], b = heights[i + 1], c = heights[i + columns + 1], d = heights[i + columns];
						const mask = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
						let edges = pairs[mask];
						if (edges === null) { const centerHigh = (a + b + c + d) / 4 > level; edges = (mask === 5) === centerHigh ? [0, 1, 2, 3] : [0, 3, 1, 2]; }
						if (!edges.length) continue;
						const edge = (id) => {
							const horizontal = id % 2 === 0, xx = x + (id === 1 ? 1 : 0), yy = y + (id === 2 ? 1 : 0);
							const key = horizontal ? yy * (columns - 1) + xx : rows * (columns - 1) + yy * columns + xx;
							if (!nodes.has(key)) {
								const from = id === 0 || id === 3 ? a : id === 1 ? b : d, to = id === 0 ? b : id === 3 ? d : c, t = (level - from) / (to - from);
								nodes.set(key, { x: (xx + (horizontal ? t : 0)) * 20, y: (yy + (horizontal ? 0 : t)) * 20, links: [] });
							}
							return nodes.get(key);
						};
						for (let e = 0; e < edges.length; e += 2) { const from = edge(edges[e]), to = edge(edges[e + 1]); from.links.push(to); to.links.push(from); }
					}
					const visited = new Set(), curves = [], point = p => p.x.toFixed(1) + " " + p.y.toFixed(1), middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
					const trace = (start) => {
						if (visited.has(start)) return;
						const chain = []; let node = start;
						while (node && !visited.has(node)) { visited.add(node); chain.push(node); node = node.links.find(next => !visited.has(next)); }
						if (chain.length < 2) return;
						const last = chain.at(-1), closed = chain.length > 2 && last.links.includes(start);
						let path = "M" + point(closed ? middle(last, start) : start);
						for (let n = closed ? 0 : 1; n < chain.length - (closed ? 0 : 1); n++) path += "Q" + point(chain[n]) + " " + point(middle(chain[n], chain[(n + 1) % chain.length]));
						curves.push(path + (closed ? "Z" : "L" + point(last)));
					};
					for (const node of nodes.values()) if (node.links.length === 1) trace(node);
					for (const node of nodes.values()) trace(node);
					result.push(curves.join(""));
				}
				return result;
			};
		}

		/** Same 20fps curves, computed off the UI thread with one in-flight frame. */
		function mountBootContours(root, media) {
			const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
			svg.classList.add("eva-boot-contours"); svg.setAttribute("viewBox", "0 0 1600 1000"); svg.setAttribute("preserveAspectRatio", "xMidYMid slice"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
			const paths = Array.from({ length: 24 }, (_, index) => {
				const path = document.createElementNS(ns, "path"); path.setAttribute("stroke-width", index % 4 === 0 ? "1.25" : ".7"); path.setAttribute("opacity", index % 4 === 0 ? ".72" : ".38"); svg.appendChild(path); return path;
			});
			const render = createContourRenderer(), paint = curves => curves.forEach((curve, index) => paths[index].setAttribute("d", curve));
			let frame = null, last = null, painted = 0, time = 0, disposed = false, worker = null, busy = false;
			paint(render(0)); root.prepend(svg); svg.dataset.renderer = "main";
			if (!media.matches && typeof Worker === "function") {
				try {

					worker = new Worker(BRAND_ASSETS.contourWorker); svg.dataset.renderer = "worker";
					worker.onmessage = ({data}) => { busy = false; if (!disposed && !document.hidden && !media.matches) paint(data); };
					worker.onerror = event => { event.preventDefault(); worker?.terminate(); worker = null; busy = false; svg.dataset.renderer = "main"; };
				} catch {worker?.terminate(); worker = null; svg.dataset.renderer = "main";}
			}
			const tick = (now) => {
				frame = null; if (disposed || document.hidden || media.matches) return;
				if (last !== null) time += Math.min(100, now - last) / 1000; last = now;
				if (now - painted >= 50 && !busy) {
					painted = now;
					if (worker) {busy = true; worker.postMessage(time);} else paint(render(time));
				}
				frame = requestAnimationFrame(tick);
			};
			const refresh = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; last = null; if (!disposed && !document.hidden && !media.matches) frame = requestAnimationFrame(tick); };
			refresh(); document.addEventListener("visibilitychange", refresh); media.addEventListener("change", refresh);
			return () => { disposed = true; if (frame !== null) cancelAnimationFrame(frame); worker?.terminate(); document.removeEventListener("visibilitychange", refresh); media.removeEventListener("change", refresh); };
		}

		const currentPilot = () => document.body.hasAttribute("data-ds-dark-theme") ? PILOTS.asuka : PILOTS.rei;
		function paintPilot(root) {
			const pilot = currentPilot();
			for (const node of root.querySelectorAll("[data-eva-pilot-name]")) node.textContent = pilot.name;
			for (const node of root.querySelectorAll("[data-eva-pilot-en]")) node.textContent = pilot.en;
			for (const node of root.querySelectorAll("[data-eva-pilot-id]")) node.textContent = "EVA / " + pilot.code;
		}

		// ============================================================
		// 3. 选项
		// ------------------------------------------------------------
		// 自绘显示设定面板与 Console 钩子共用选项，通过 localStorage 持久化：
		//   __EVA_MAGI_THEME__.set("scanlines", false)
		// ============================================================
		// 新标尺的 1.5 对应旧标尺的 0.6；保留当前视觉尺寸并腾出向下调节空间。
		const SIZE_MIN = 0.6, SIZE_MAX = 5, SIZE_STEP = 0.05;
		const clockRenderScale = (value) => Number((value * CLOCK_SCALE_UNIT).toFixed(9));
		const DEFAULT_OPTIONS = Object.freeze({
			// 仪表自身的缩放倍率（面板滑杆 / Cmd+滚轮可调）
			hudScale: 1.5,
			// 结构性装饰（v0.2 新增）——「EVA 元素太少」的直接回应
			chrome: true, // 内嵌框架 + 四角 L 标 + 危险条纹 + 左右刻度尺 + 反白标签块
			hud: true, // 右下角角色载入标识与 TPS
			beam: false, // 走行的场同步带（白线扫屏；实测后被要求关掉，改为默认关）
			boot: true, // 开机序列（每个会话只放一次）
			attentionSound: true, // 人工审核与任务正常完成时播放当前角色的语音
			// 质感层
			// 扫描线默认关闭（用户实测后要求先去掉）。想开回来：
			//   __EVA_MAGI_THEME__.set("scanlines", true)
			scanlines: false,
			scanlineStrength: 0.5,
			// 背景：随明暗模式切换的角色几何底纹。兼容旧 wallpaper 强度设置。
			// 更早的 rings 已不再使用；旧枚举值会被校验器忽略，回落到布尔默认值。
			wallpaper: true,
			wallpaperStrength: 0.5,
			clock: true, // 正文区右上角那块「内部/外部」七段大时钟
			// 大时钟自身的缩放倍率（四角拖动可调；独立于 hudScale）
			clockScale: 1.5,
			// 音乐播放器自身的缩放倍率（四角拖动可调；独立于时钟）
			mpScale: 1.5,
			music: true, // 检测到系统正在播放后才显示；暂停时保留控制
			// 形状与排版
			hardEdges: true,
			tabularNumbers: true,
			minchoHeadings: true,
		});

		// ============================================================
		// 设置面板的规格
		// ------------------------------------------------------------
		// 仪表可点开面板，面板里是同一批开关。刻意**不把 hud 自己**列进来：
		// 面板是仪表的一部分，关掉仪表等于把自己关在门外（只能回 Console 开）。
		// ============================================================
		const PANEL_SPEC = [
			{ group: "组件", items: [
				{ key: "clock", label: "显示时钟" },
				{ key: "music", label: "音乐播放器", hint: "播放时显示，支持暂停与切歌" },
			] },
			{ group: "角色背景", items: [
				{ key: "wallpaper", label: "显示角色背景", hint: "随明暗主题自动切换" },
				{ key: "wallpaperStrength", label: "背景强度", type: "range", min: 0, max: 1, step: 0.05 },
			] },
			{ group: "声音提醒", items: [
				{ key: "attentionSound", label: "角色提示音", hint: "操作待审核／任务完成时播放" },
			] },
			{ group: "装饰与排版", collapsible: true, items: [
				{ key: "chrome", label: "框架与刻度" },
				{ key: "boot", label: "开机动画", hint: "每次浏览器会话首次加载" },
				{ key: "beam", label: "场同步带", hint: "滚动白线" },
				{ key: "scanlines", label: "CRT 扫描线" },
				{ key: "scanlineStrength", label: "扫描线浓度", type: "range" },
				{ key: "hardEdges", label: "硬边", hint: "圆角归零" },
				{ key: "tabularNumbers", label: "等宽数字" },
				{ key: "minchoHeadings", label: "标题明朝体", hint: "h1–h3" },
			] },
		];

		// 选项 → <html> 上的标记。boot 不在表里：它是一次性 DOM，不走 CSS 开关。
		const OPTION_ATTRS = {
			chrome: "data-eva-chrome",
			hud: "data-eva-hud",
			beam: "data-eva-beam",
			scanlines: "data-eva-scan",
			clock: "data-eva-clock",
			music: "data-eva-music",
			wallpaper: "data-eva-wallpaper",
			hardEdges: "data-eva-edges",
			tabularNumbers: "data-eva-nums",
			minchoHeadings: "data-eva-mincho",
		};

		const NUMBER_OPTIONS = Object.freeze({
			hudScale: [SIZE_MIN, SIZE_MAX], clockScale: [SIZE_MIN, SIZE_MAX], mpScale: [SIZE_MIN, SIZE_MAX], scanlineStrength: [0, 1], wallpaperStrength: [0, 1],
		});
		function normalizeOption(key, value) {
			if (!Object.hasOwn(DEFAULT_OPTIONS, key)) throw new Error("[dsh-plugin-eva-theme] 未知选项 " + key);
			if (Object.hasOwn(NUMBER_OPTIONS, key)) {
				if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("选项必须是有限数字：" + key);
				const [min, max] = NUMBER_OPTIONS[key];
				return Math.min(max, Math.max(min, value));
			}
			if (typeof value !== "boolean") throw new TypeError("选项必须是布尔值：" + key);
			return value;
		}

		/** 读回用户上次的选择；localStorage 不可用时静默退回默认值。 */
		function loadOptions() {
			const merged = Object.assign({}, DEFAULT_OPTIONS);
			try {
				const raw = globalThis.localStorage?.getItem(OPTIONS_STORAGE_KEY);
				if (raw) {
					const saved = JSON.parse(raw);
					for (const key of Object.keys(DEFAULT_OPTIONS)) {
						if (!saved || !Object.hasOwn(saved, key)) continue;
						try {
							let value = saved[key];
							if (key === "clockScale") {
								const unit = Object.hasOwn(saved, "clockScaleUnit") ? saved.clockScaleUnit : 1;
								if (typeof unit !== "number" || !Number.isFinite(unit) || unit <= 0) continue;
								if (typeof value === "number") value = Number((value * unit / CLOCK_SCALE_UNIT).toFixed(9));
							}
							merged[key] = normalizeOption(key, value);
						} catch { /* 旧类型或损坏的值回到默认 */ }
					}
					if (saved && (saved.clockScaleUnit !== CLOCK_SCALE_UNIT || Object.keys(saved).some(key => key !== "clockScaleUnit" && !Object.hasOwn(DEFAULT_OPTIONS, key)))) saveOptions(merged);
				}
			} catch (error) {
				/* 无痕模式 / 存储被禁用：皮肤照常工作，只是不记忆 */
			}
			return merged;
		}

		function saveOptions(options) {
			try {
				globalThis.localStorage?.setItem(OPTIONS_STORAGE_KEY, JSON.stringify({ ...options, clockScaleUnit: CLOCK_SCALE_UNIT }));
			} catch (error) {
				/* 同上 */
			}
		}

		/** 把选项写进 <html> 的 data-* / 自定义属性，CSS 只认这些标记。 */
		function paintOptions(options) {
			const root = document.documentElement;
			root.setAttribute("data-eva-magi", "");
			// 清理已移除功能的旧标记，旧设置不会重新启用它们。
			for (const attr of ["data-eva-grid", "data-eva-top", "data-eva-vig", "data-eva-motion"]) root.removeAttribute(attr);
			for (const [key, attr] of Object.entries(OPTION_ATTRS)) {
				const on = Boolean(options[key]);
				// edges 是三态（hard/soft），其余都是 on/off
				root.setAttribute(attr, attr === "data-eva-edges" ? (on ? "hard" : "soft") : on ? "on" : "off");
			}
			root.style.setProperty("--eva-scan-strength", String(options.scanlineStrength));
			// 仪表缩放走自定义属性（不是开关，所以不在 OPTION_ATTRS 里）
			root.style.setProperty("--eva-hud-scale", String(options.hudScale));
			// 大时钟尺寸同理走自定义属性（不是开关）
			root.style.setProperty("--eva-clock-scale", String(clockRenderScale(options.clockScale)));
			root.style.setProperty("--eva-mp-scale", String(clockRenderScale(options.mpScale)));
			root.style.setProperty("--eva-wallpaper-strength", String(options.wallpaperStrength));
		}

		/**
		 * 在 <body> 存在时立刻执行，否则等 DOMContentLoaded。
		 * 客户端插件正常应在 body 脚本之后物化，但这条保护让「过早物化」这一种
		 * 失败模式变成不可能——皮肤宁可不挂，也不能把宿主页面搞崩。
		 */
		function whenBodyReady(run) {
			if (document.body) return run();
			let dispose = null;
			let cancelled = false;
			const onReady = () => {
				if (!cancelled) dispose = run();
			};
			document.addEventListener("DOMContentLoaded", onReady, { once: true });
			return () => {
				cancelled = true;
				document.removeEventListener("DOMContentLoaded", onReady);
				if (typeof dispose === "function") dispose();
			};
		}

		/** Fullscreen body children become no-drag in the macOS desktop host. */
		function themeOverlayHost() {
			return document.getElementById("root") || document.body;
		}

		// ============================================================
		// 峰谷计价：把当前处于高峰还是空闲算出来，并给出下一切换时刻
		// ------------------------------------------------------------
		// 规则与 DSH 生态里已有的实现（dsh-whale-widget）同源，其依据是
		// DeepSeek 官方计费文档 + 国务院节假日安排：
		//
		//   高峰 = 北京时间 周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00
		//   空闲 = 其余全部，含 周末（2026-08-23 起）、调休上班的周末、
		//          以及中国法定节假日全天（2026-09-19 起）
		//
		// 全部在本地按时钟推算：不联网、不读账号、不碰任何用户数据。
		// 唯一的风险是规则会变 —— 所以节假日清单只覆盖到 HOLIDAY_COVERED_YEAR，
		// 超出范围时状态照旧推算，但会标注 certainty=inferred，界面上显示「推定」。
		// ============================================================
		const PEAK_HOURS = [
			[9, 12],
			[14, 18],
		];
		// 北京时间 2026-08-23 00:00 起：周末全天按空闲计
		const WEEKEND_VALLEY_FROM = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000);
		// 北京时间 2026-09-19 00:00 起：法定节假日全天按空闲计
		const HOLIDAY_VALLEY_FROM = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000);
		// 只列「放假」的日期：调休上班日全部落在周末，按周末规则本就是空闲。
		// 来源：《国务院办公厅关于 2026 年部分节假日安排的通知》。
		// ⚠️ 每年 11 月国务院发布次年安排后需要补下一年；未覆盖的年份会被标为「推定」。
		const HOLIDAY_COVERED_YEAR = 2026;
		const HOLIDAY_VALLEY = new Set([
			"2026-01-01", "2026-01-02", "2026-01-03",
			"2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
			"2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
			"2026-04-04", "2026-04-05", "2026-04-06",
			"2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
			"2026-06-19", "2026-06-20", "2026-06-21",
			"2026-09-25", "2026-09-26", "2026-09-27",
			"2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
			"2026-10-05", "2026-10-06", "2026-10-07",
		]);

		/**
		 * 某个时刻的计费状态。
		 * @param sec - epoch 秒。
		 * @returns {peak, reason, inferred}。reason ∈ peak|offhours|weekend|holiday。
		 */
		function pricingStateAt(sec) {
			// 平移 +8h 后用 UTC 读，得到的就是北京时间的日历日与小时
			const bj = new Date(sec * 1000 + 8 * 3600 * 1000);
			const dow = bj.getUTCDay();
			const inferred = bj.getUTCFullYear() > HOLIDAY_COVERED_YEAR;
			const day = bj.toISOString().slice(0, 10);
			// 先判法定节假日再判周末：两者可能同时成立（如国庆里的周六）。
			// 此时报「休日」才和信息一致 —— 否则标签写着「週末」，
			// 倒计时却是整个假期的长度（4 天），自相矛盾。
			if (sec >= HOLIDAY_VALLEY_FROM && HOLIDAY_VALLEY.has(day)) {
				return { peak: false, reason: "holiday", inferred: false };
			}
			if (sec >= WEEKEND_VALLEY_FROM && (dow === 0 || dow === 6)) {
				return { peak: false, reason: "weekend", inferred: false };
			}
			const hour = bj.getUTCHours();
			for (const [start, end] of PEAK_HOURS) {
				if (hour >= start && hour < end) return { peak: true, reason: "peak", inferred };
			}
			return { peak: false, reason: "offhours", inferred: bj.getUTCFullYear() > HOLIDAY_COVERED_YEAR };
		}

		/**
		 * 下一个峰谷切换时刻（epoch 秒），与 pricingStateAt 完全同源。
		 * 只需扫北京时间的 0/9/12/14/18 点边界；最长假期 9 天，扫 12 天留足余量。
		 */
		function nextPricingChangeAt(sec) {
			if (!Number.isFinite(sec)) return null;
			const current = pricingStateAt(sec).peak;
			const day0 = Math.floor((sec + 8 * 3600) / 86400) * 86400;
			for (let d = 0; d <= 12; d += 1) {
				for (const edge of [0, 9, 12, 14, 18]) {
					const candidate = day0 + d * 86400 + edge * 3600 - 8 * 3600;
					if (candidate <= sec) continue;
					if (pricingStateAt(candidate).peak !== current) return candidate;
				}
			}
			return null;
		}

		/** 剩余时长 → 显示文本。跨天时用「N日 HH:MM:SS」，否则 HH:MM:SS。 */
		function formatRemaining(seconds) {
			const total = Math.max(0, Math.floor(seconds));
			const days = Math.floor(total / 86400);
			const rest = total % 86400;
			const hh = String(Math.floor(rest / 3600)).padStart(2, "0");
			const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, "0");
			const ss = String(rest % 60).padStart(2, "0");
			return days > 0 ? days + "日" + hh + ":" + mm + ":" + ss : hh + ":" + mm + ":" + ss;
		}

		/**
		 * 造设置面板。
		 *
		 * 与 Console 钩子共用同一个 setOption —— 两条路改的是同一份状态，
		 * 所以面板开着时从 Console 改值，面板也会跟着刷新。
		 *
		 * @param options - 当前选项（会被就地修改）。
		 * @param setOption - 单项写入 + 持久化 + 重绘。
		 * @param resetAll - 恢复全部默认值。
		 */
		function buildPanel(options, setOption, resetAll, resetLayout) {
			const panel = document.createElement("div");
			panel.className = "eva-panel"; panel.hidden = true;
			// 非模态设置区不加入宿主 dialog 栈；远程控制按 dialog 数量保护嵌套关闭。
			panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "EVA 角色主题显示设定");
			const head = document.createElement("div"); head.className = "eva-panel-head";
			head.innerHTML = '<span>表示設定</span><small>DISPLAY CONFIG</small><button type="button" class="eva-panel-close" aria-label="关闭显示设定" title="关闭（Esc）">×</button>';
			panel.appendChild(head);
			const body = document.createElement("div"); body.className = "eva-panel-body";
			const controls = [];
			for (const section of PANEL_SPEC) {
				const groupBody = document.createElement(section.collapsible ? "details" : "section");
				groupBody.className = "eva-panel-section" + (section.collapsible ? " eva-advanced" : "");
				const group = document.createElement(section.collapsible ? "summary" : "div");
				group.className = "eva-group"; group.textContent = section.group;
				groupBody.appendChild(group); body.appendChild(groupBody);
				for (const item of section.items) {
					const row = document.createElement("div"); row.className = "eva-row"; row.dataset.key = item.key;
					const label = document.createElement("span"); label.className = "eva-row-label";
					const name = document.createElement("b"); name.textContent = item.label; label.appendChild(name);
					if (item.hint) { const hint = document.createElement("i"); hint.textContent = item.hint; label.appendChild(hint); }
					row.appendChild(label);
					if (item.type === "range") {
						row.classList.add("eva-range-row");
						const min = item.min ?? 0, max = item.max ?? 1, step = item.step ?? 0.05;
						const input = document.createElement("input"); input.type = "range";
						input.min = String(min); input.max = String(max); input.step = String(step);
						input.setAttribute("aria-label", item.label);
						input.addEventListener("input", () => setOption(item.key, Number(input.value)));
						const val = document.createElement("output"); val.className = "eva-val";
						const reset = document.createElement("button"); reset.type = "button"; reset.className = "eva-range-reset";
						reset.textContent = "默认"; reset.setAttribute("aria-label", item.label + "恢复默认");
						reset.addEventListener("click", () => setOption(item.key, DEFAULT_OPTIONS[item.key]));
						const strip = document.createElement("div"); strip.className = "eva-range-controls";
						const minus = document.createElement("button"), plus = document.createElement("button");
						for (const [button, direction, text] of [[minus, -1, "−"], [plus, 1, "＋"]]) {
							button.type = "button"; button.className = "eva-range-button"; button.textContent = text;
							button.setAttribute("aria-label", (direction < 0 ? "减小" : "增大") + item.label);
							button.addEventListener("click", () => setOption(item.key, Number((options[item.key] + direction * step).toFixed(3))));
						}
						input.addEventListener("keydown", (event) => {
							const direction = {ArrowLeft:-1, ArrowDown:-1, ArrowRight:1, ArrowUp:1}[event.key];
							if (!direction) return;
							event.preventDefault(); setOption(item.key, Number((options[item.key] + direction * step).toFixed(3)));
						});
						row.append(val, reset); strip.append(minus, input, plus); row.appendChild(strip);
						controls.push({key:item.key,kind:"range",input,val,row,minus,plus,reset,min,max});
					} else {
						const sw = document.createElement("button"); sw.type = "button"; sw.className = "eva-sw";
						sw.dataset.key = item.key; sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", item.label);
						sw.addEventListener("click", () => setOption(item.key, !options[item.key])); row.appendChild(sw);
						controls.push({key:item.key,kind:"switch",sw});
					}
					groupBody.appendChild(row);
					if (item.key === "attentionSound") {
						const previews = document.createElement("div"); previews.className = "eva-sound-previews";
						for (const [kind, label] of [["approval", "试听审核提醒"], ["complete", "试听完成提醒"]]) {
							const button = document.createElement("button"); button.type = "button"; button.className = "eva-btn";
							button.textContent = label; button.dataset.attentionPreview = kind;
							button.setAttribute("aria-pressed", "false"); button.title = "播放当前主题的" + (kind === "approval" ? "审核" : "完成") + "语音";
							button.addEventListener("click", () => previewAttentionRef?.(kind)); previews.appendChild(button);
						}
						groupBody.appendChild(previews);
					}
				}
			}
			const note = document.createElement("p"); note.className = "eva-panel-note";
			note.textContent = "调整立即生效并自动保存 · 拖动仪表、时钟或播放器可移动 · Esc 关闭"; body.appendChild(note); panel.appendChild(body);
			const foot = document.createElement("div"); foot.className = "eva-panel-foot";
			const resetBtn = document.createElement("button"); resetBtn.type = "button"; resetBtn.className = "eva-btn";
			resetBtn.textContent = "重置全部"; resetBtn.addEventListener("click", resetAll); foot.appendChild(resetBtn);
			const resetPosBtn = document.createElement("button"); resetPosBtn.type = "button"; resetPosBtn.className = "eva-btn eva-reset-layout";
			resetPosBtn.textContent = "重置位置"; resetPosBtn.title = "仪表、时钟和播放器回到默认位置";
			resetPosBtn.addEventListener("click", resetLayout); foot.appendChild(resetPosBtn);
			const replayBtn = document.createElement("button"); replayBtn.type = "button"; replayBtn.className = "eva-btn eva-replay-boot";
				replayBtn.textContent = "重新选择驾驶员"; replayBtn.addEventListener("click", () => replayBootRef?.()); foot.appendChild(replayBtn); panel.appendChild(foot);
			const refresh = () => {
				for (const button of panel.querySelectorAll("[data-attention-preview]")) button.disabled = !options.attentionSound;
				replayBtn.title = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "直接选择驾驶员（减少动态效果）" : "重播 NERV 并选择驾驶员";
				for (const c of controls) {
					if (c.kind === "switch") {
						const on = Boolean(options[c.key]); c.sw.setAttribute("aria-checked", String(on)); c.sw.textContent = on ? "承認" : "否定";
					} else {
						const value = options[c.key], size = c.key === "clockScale" || c.key === "hudScale";
						c.input.value = String(value);
						const text = size ? Number(value).toFixed(3).replace(/\.?0+$/, "") + "×" : Math.round(value * 100) + "%";
						c.val.textContent = text; c.input.setAttribute("aria-valuetext", text);
						const disabled = c.key === "scanlineStrength" && !options.scanlines || c.key === "wallpaperStrength" && !options.wallpaper;
						c.input.disabled = disabled; c.row.dataset.dim = disabled ? "1" : "0";
						c.minus.disabled = disabled || value <= c.min; c.plus.disabled = disabled || value >= c.max;
						c.reset.disabled = disabled || value === DEFAULT_OPTIONS[c.key];
					}
				}
			};
			refresh(); return {panel,refresh};
		}

		/**
		 * 造装饰层：CRT 质感 + 结构框架 + 仪表簇 + 反白标签。
		 *
		 * 全部挂在同一个 pointer-events:none 的固定层里，所以永远不挡操作、也不进
		 * 应用的布局流。角色标识来自实际明暗模式，时钟与解码读数来自真实状态，
		 * 不做假遥测 —— 装饰就要有装饰的自觉。
		 *
		 * 返回移除函数（连同定时器、监听器一起回收）。
		 */
		function mountChrome(ctx, options, setOption, resetAll) {
			const layer = document.createElement("div");
			layer.className = OVERLAY_CLASS;
			layer.setAttribute("aria-label", "EVA 双角色主题组件");
			layer.innerHTML = [
				'<div class="eva-emg" aria-hidden="true">',
				'<div class="eva-character-portrait"></div>',
				'<div class="eva-character-art eva-character-art--asuka"><svg viewBox="0 0 600 600" fill="none" stroke="currentColor">',
				'<path class="eva-art-panel" d="M80 60h235l200 200v235H280L80 295Z"/><path d="M80 60h235l200 200v235H280L80 295Z" stroke-width="2"/>',
				'<path d="M90 20h250l215 215M45 115v200l225 225h260" stroke-width="12"/><path class="eva-art-fine" d="M102 82h204l187 187v204H289L102 286ZM68 155v149l215 215h155M132 100h150l190 190v154"/>',
				'<path class="eva-art-detail" d="M354 110l70 70m-36-88 70 70" stroke-width="18"/><path class="eva-art-detail" d="M90 323l24 24m-24-6 24 24m-24-6 24 24" stroke-width="5"/>',
				'<text class="eva-art-label" x="112" y="126">EVANGELION / UNIT-02</text><text class="eva-art-micro" x="112" y="146">PRODUCTION MODEL // NERV</text>',
				'<path class="eva-art-fine" d="M112 164h92m10 0h35m39 13v-22h22M130 236v-28h28M435 390v28h-28"/><circle cx="116" cy="186" r="3"/><circle cx="130" cy="186" r="3"/><circle cx="144" cy="186" r="3"/>',
				'<text x="150" y="390">02</text><path d="M140 454h310" stroke-width="2"/><path class="eva-art-fine" d="M140 444h310M140 461v12m10-12v7m10-7v7m10-7v12m10-12v7m10-7v7m10-7v12M350 461h100"/>',
				'<text class="eva-art-label" x="278" y="492">SECOND CHILD</text><text class="eva-art-micro" x="294" y="508">ASUKA LANGLEY // 02</text><path class="eva-art-detail" d="M459 420h12v12h-12zM480 441h12v12h-12z" fill="currentColor" stroke="none"/>',
				'</svg></div>',
				'<div class="eva-character-art eva-character-art--rei"><svg viewBox="0 0 600 600" fill="none" stroke="currentColor">',
				'<circle cx="300" cy="300" r="242" stroke-width="1"/><circle cx="300" cy="300" r="255" stroke-width="5" stroke-dasharray="1 25.7"/><circle cx="300" cy="300" r="230" stroke-dasharray="90 18 2 18"/>',
				'<circle cx="300" cy="300" r="215" stroke-width="3" stroke-dasharray="200 22 2 22"/><circle class="eva-art-fine" cx="300" cy="300" r="198" stroke-dasharray="2 7"/>',
				'<path d="M300 26v68m0 412v68M26 300h68m412 0h68" stroke-width="2"/><path d="M300 112l188 188-188 188-188-188Z"/><path class="eva-art-fine" d="M300 128l172 172-172 172-172-172ZM146 146h28v-18m280 18h-28v-18M146 454h28v18m280-18h-28v18"/>',
				'<g class="eva-art-detail"><circle cx="300" cy="72" r="9" fill="currentColor" stroke="none"/><circle cx="300" cy="72" r="15"/><circle cx="300" cy="528" r="5" fill="currentColor"/><path d="M63 294h12v12H63zM525 294h12v12h-12z" stroke-width="2"/></g>',
				'<text class="eva-art-label" x="175" y="180">EVANGELION / UNIT-00</text><text class="eva-art-micro" x="190" y="196">PROTOTYPE // NERV</text><text x="156" y="368">00</text>',
				'<path class="eva-art-fine" d="M196 398h208m-208 8h52m104 0h52"/><text class="eva-art-label" x="218" y="430">FIRST CHILD</text><text class="eva-art-micro" x="199" y="446">REI AYANAMI // 00</text>',
				'</svg></div>',
				'<span class="eva-character-caption" data-eva-pilot-en></span></div>',
				'<i class="eva-magi-beam"></i>',
				'<i class="eva-magi-scan"></i>',
				'<div class="eva-frame">',
				'<span class="eva-corner tl"></span><span class="eva-corner tr"></span>',
				'<span class="eva-corner bl"></span><span class="eva-corner br"></span>',
				'<span class="eva-id tl" data-eva-pilot-id></span>',
				'<span class="eva-id tr" data-eva-pilot-en></span>',
				// TPS / 解码速度波形：挂载后移动到中央教条区下方，与仪表一起适配。
				'<div class="eva-tps" data-eva-tps>',
				'<div class="eva-tps-head"><i></i><b>波形</b><small>TPS</small><span class="eva-tps-now">—</span></div>',
				'<svg class="eva-tps-scope" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">',
				'<line class="eva-tps-base" x1="0" y1="55" x2="200" y2="55"></line>',
				'<polyline class="eva-tps-line" points=""></polyline>',
				"</svg>",
				'<div class="eva-tps-foot"><span>PEAK <b class="eva-tps-peak">—</b></span><span>AVG <b class="eva-tps-avg">—</b></span></div>',
				"</div>",
				"</div>",
				'<i class="eva-edge"></i><i class="eva-edge r"></i>',
				'<i class="eva-hazard"></i>',
				'<svg width="0" height="0" aria-hidden="true"><defs>',
				'<g id="eva-d0"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/><path d="M0.00 19.10 L2.10 17.00 L4.20 19.10 L4.20 27.70 L2.10 29.80 L0.00 27.70 Z"/><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/></g><g id="eva-d1"><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/></g><g id="eva-d2"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/><path d="M0.00 19.10 L2.10 17.00 L4.20 19.10 L4.20 27.70 L2.10 29.80 L0.00 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/></g><g id="eva-d3"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/></g><g id="eva-d4"><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/></g><g id="eva-d5"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/></g><g id="eva-d6"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/><path d="M0.00 19.10 L2.10 17.00 L4.20 19.10 L4.20 27.70 L2.10 29.80 L0.00 27.70 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/></g><g id="eva-d7"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/></g><g id="eva-d8"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/><path d="M0.00 19.10 L2.10 17.00 L4.20 19.10 L4.20 27.70 L2.10 29.80 L0.00 27.70 Z"/><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/></g><g id="eva-d9"><path d="M2.10 0.00 L17.90 0.00 L20.00 2.10 L17.90 4.20 L2.10 4.20 L0.00 2.10 Z"/><path d="M15.80 6.30 L17.90 4.20 L20.00 6.30 L20.00 14.90 L17.90 17.00 L15.80 14.90 Z"/><path d="M15.80 19.10 L17.90 17.00 L20.00 19.10 L20.00 27.70 L17.90 29.80 L15.80 27.70 Z"/><path d="M2.10 29.80 L17.90 29.80 L20.00 31.90 L17.90 34.00 L2.10 34.00 L0.00 31.90 Z"/><path d="M0.00 6.30 L2.10 4.20 L4.20 6.30 L4.20 14.90 L2.10 17.00 L0.00 14.90 Z"/><path d="M2.10 14.90 L17.90 14.90 L20.00 17.00 L17.90 19.10 L2.10 19.10 L0.00 17.00 Z"/></g>',
				'</defs></svg>',
				'<div class="eva-clockpanel" aria-hidden="true">',
				'<div class="eva-cp-top"><b>時刻管制</b><small>SYSTEM CLOCK</small><span class="eva-nerv-logo" aria-hidden="true"></span><i></i></div>',
				'<div class="eva-cp-mode"><span>現在時刻 / LOCAL TIME</span><span>24H FORMAT</span></div>',
				'<div class="eva-cp-main"><div class="eva-cp-digits">',
				'<div class="eva-cp-pair"><small>HOUR</small><div class="eva-cp-number"><svg class="eva-cp-dg" data-i="0" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg><svg class="eva-cp-dg" data-i="1" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg></div></div>',
				'<svg class="eva-cp-cl" viewBox="0 0 8 34"><rect x="2" y="10" width="3" height="3"/><rect x="2" y="22" width="3" height="3"/></svg>',
				'<div class="eva-cp-pair"><small>MINUTE</small><div class="eva-cp-number"><svg class="eva-cp-dg" data-i="2" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg><svg class="eva-cp-dg" data-i="3" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg></div></div>',
				'<svg class="eva-cp-cl eva-cp-cl--seconds" viewBox="0 0 8 34"><rect x="2" y="10" width="3" height="3"/><rect x="2" y="22" width="3" height="3"/></svg>',
				'<div class="eva-cp-pair eva-cp-pair--seconds"><small>SECOND</small><div class="eva-cp-number"><svg class="eva-cp-dg" data-i="4" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg><svg class="eva-cp-dg" data-i="5" viewBox="0 0 20 34"><use class="eva-cp-ghost" href="#eva-d8"/><use class="eva-cp-lit" href="#eva-d0"/></svg></div></div>',
				'</div></div>',
				'<div class="eva-cp-side">',
				'<div class="eva-cp-block"><small>日付 / DATE <em class="eva-cp-weekday">---</em></small><b class="eva-cp-date">----</b></div>',
				'<div class="eva-cp-block"><small>地方時 / ZONE</small><b class="eva-cp-tz">UTC+00:00</b></div>',
				'<div class="eva-cp-block"><small>協定時 / UTC</small><b class="eva-cp-utc">--:--:--</b></div>',
				'</div>',
				'<div class="eva-cp-second-head"><span>秒刻 / SECOND INDEX</span><b class="eva-cp-second-value">00 / 59</b></div>',
				'<div class="eva-cp-second-track"><i></i></div>',
				'<div class="eva-cp-decode"><small>解码状態<br>DECODE</small><div class="eva-cp-lamps"><span>IDLE</span><span>LOW</span><span>NORM</span><span>HIGH</span></div></div>',
				'</div>',
				// —— 音声管制：曲目信息、播放状态、真实进度和三个系统控制按钮。——
				'<div class="eva-mp" role="region" aria-label="系统音乐控制" hidden>',
				'<div class="eva-mp-head"><b>音声管制</b><small>AUDIO CONTROL</small><i class="eva-mp-hazard" aria-hidden="true"></i></div>',
				'<div class="eva-mp-source"><small>外部音源 / SOURCE</small><span class="eva-mp-src"></span></div>',
				'<div class="eva-mp-name"><span class="eva-mp-title" aria-live="polite">等待系统播放</span><span class="eva-mp-artist"></span></div>',
				'<div class="eva-mp-deck" aria-hidden="true"><div class="eva-mp-rings">',
				'<svg class="eva-mp-ring eva-mp-ring--open" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="53 8 7 8"/><path d="M50 2v7M98 50h-7M50 98v-7M2 50h7" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
				'<svg class="eva-mp-ring eva-mp-ring--solid" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="19 6 3 6"/><path d="M20 33l5 3M80 33l-5 3M50 84v-6" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
				'<svg class="eva-mp-core" viewBox="0 0 100 100"><path d="M50 25 72 37v26L50 75 28 63V37Z" fill="var(--eva-ghost)" stroke="currentColor"/><text x="50" y="76" text-anchor="middle">AUDIO</text></svg><span class="eva-nerv-logo eva-mp-crest"></span>',
				'</div><div class="eva-mp-signal"><div class="eva-mp-status"><span class="eva-mp-state">一時停止</span><small class="eva-mp-state-en">HOLD</small></div>',
				'<div class="eva-mp-eq"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>',
				'<small>PLAYBACK STATE / 再生状態</small></div></div>',
				'<div class="eva-mp-times"><span><small>経過</small><b class="eva-mp-cur">00:00</b></span><span><small>全長</small><b class="eva-mp-tot">00:00</b></span></div>',
				'<div class="eva-mp-bar" role="progressbar" aria-label="曲目进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>',
				'<div class="eva-mp-btns">',
				'<button type="button" class="eva-mp-btn" data-act="prev" aria-label="上一首"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h2v14H5zM19 5v14L8 12z"/></svg><span>PREV</span></button>',
				'<button type="button" class="eva-mp-btn" data-act="play" aria-label="播放 / 暂停"><svg aria-hidden="true" viewBox="0 0 24 24" class="eva-mp-ico-pause"><rect x="7" y="6" width="3.5" height="12"/><rect x="13.5" y="6" width="3.5" height="12"/></svg><svg aria-hidden="true" viewBox="0 0 24 24" class="eva-mp-ico-play"><path d="M8 5v14l11-7z"/></svg><span class="eva-mp-playlabel">PLAY</span></button>',
				'<button type="button" class="eva-mp-btn" data-act="next" aria-label="下一首"><span>NEXT</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M17 5h2v14h-2zM5 5v14l11-7z"/></svg></button>',
				'</div><div class="eva-mp-loading" aria-hidden="true"><b>音源接続</b><small>SOURCE LINK</small><i></i></div></div>',
				'<div class="eva-corner-stack">',
				'<div class="eva-tags" data-face="front" role="button" tabindex="0" title="点击查看余额">',
				'<div class="eva-tags-face eva-tags-front">',
				'<span class="eva-tag eva-tag--state" data-state="valley"><b>空闲料金</b><small>VALLEY</small></span>',
				'<span class="eva-tag ghost eva-tag--remain"><b>--:--:--</b><small>残余</small></span>',
				"</div>",
				'<div class="eva-tags-face eva-tags-back">',
				'<span class="eva-tag eva-tag--balance"><b>—</b><small>残高</small></span>',
				"</div>",
				"</div>",
				'<div class="eva-hud">',
				'<div class="eva-hud-vlabel">中央教条区</div>',
				'<div class="eva-hud-body">',
				'<span class="eva-pilot-status"><i></i>当前载入 / LOADED</span>',
				'<strong class="eva-pilot-name" data-eva-pilot-name></strong>',
				'<small class="eva-pilot-en" data-eva-pilot-en></small>',
				"</div></div>",
				"</div>",
			].join("");

			for (const node of layer.children) {
				if (!node.matches(".eva-corner-stack,.eva-mp")) node.setAttribute("aria-hidden", "true");
			}
			let disposed = false;
			const requests = new Set();
			const fetchLocal = async (url, init = {}, controller = new AbortController()) => {
				requests.add(controller);
				const timer = setTimeout(() => controller.abort(), 12000);
				try {
					const response = await fetch(url, { ...init, signal: controller.signal });
					const data = await response.json().catch(() => null);
					return { response, data };
				} finally { clearTimeout(timer); requests.delete(controller); }
			};

			// —— 七段大时钟 ——
			const clockEl = layer.querySelector(".eva-clockpanel");
			const clockDigits = clockEl ? [...clockEl.querySelectorAll(".eva-cp-dg")] : [];
			const clockDate = clockEl ? clockEl.querySelector(".eva-cp-date") : null;
			const clockTz = clockEl ? clockEl.querySelector(".eva-cp-tz") : null;
			const clockUtc = clockEl ? clockEl.querySelector(".eva-cp-utc") : null;
			const clockWeekday = clockEl?.querySelector(".eva-cp-weekday");
			const clockSecondValue = clockEl?.querySelector(".eva-cp-second-value");
			const clockSecondFill = clockEl?.querySelector(".eva-cp-second-track i");
			const clockLamps = clockEl ? [...clockEl.querySelectorAll(".eva-cp-lamps span")] : [];


			const pad2 = (value) => (value < 10 ? "0" + value : String(value));

			/** 每秒刷一次：六位数字靠切换 <use href> 指向 defs 里预定义的字形。 */
			const updateClock = () => {
				if (!clockEl) return;
				const now = new Date();
				const text = pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
				for (let i = 0; i < clockDigits.length && i < text.length; i += 1) {
					const use = clockDigits[i].querySelector(".eva-cp-lit");
					if (use && use.getAttribute("href") !== "#eva-d" + text[i]) use.setAttribute("href", "#eva-d" + text[i]);
				}
				if (clockDate) {
					clockDate.textContent =
						now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
				}
				if (clockTz) {
					const offset = -now.getTimezoneOffset(), absolute = Math.abs(offset);
					clockTz.textContent = "UTC" + (offset >= 0 ? "+" : "-") + pad2(Math.floor(absolute / 60)) + ":" + pad2(absolute % 60);
				}
				if (clockUtc) {
					clockUtc.textContent = pad2(now.getUTCHours()) + ":" + pad2(now.getUTCMinutes()) + ":" + pad2(now.getUTCSeconds());
				}
				if (clockWeekday) clockWeekday.textContent = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getDay()];
				if (clockSecondValue) clockSecondValue.textContent = pad2(now.getSeconds()) + " / 59";
				if (clockSecondFill) clockSecondFill.style.width = (now.getSeconds() + 1) / 60 * 100 + "%";
			};

			/** 灯排跟着**真实解码速度**走，不做假遥测：0 → IDLE，<40 → LOW，<160 → NORM，其余 HIGH。 */
			const setLamps = (instant) => {
				if (!clockLamps.length) return;
				const level = instant <= 0 ? 0 : instant < 40 ? 1 : instant < 160 ? 2 : 3;
				for (let i = 0; i < clockLamps.length; i += 1) {
					if (i === level) clockLamps[i].setAttribute("data-on", "1");
					else clockLamps[i].removeAttribute("data-on");
				}
			};

			// —— 音乐播放器 ——
			const mpEl = layer.querySelector(".eva-mp");

			const mpTitle = layer.querySelector(".eva-mp-title");
			const mpArtist = layer.querySelector(".eva-mp-artist");
			const mpState = layer.querySelector(".eva-mp-state");
			const mpStateEn = layer.querySelector(".eva-mp-state-en");
			const mpPlayLabel = layer.querySelector(".eva-mp-playlabel");
			const mpCur = layer.querySelector(".eva-mp-cur");
			const mpTot = layer.querySelector(".eva-mp-tot");
			const mpBar = layer.querySelector(".eva-mp-bar");
			const mpFill = mpBar ? mpBar.querySelector("i") : null;
			const mpButtons = [...layer.querySelectorAll(".eva-mp-btn")];

			const mpFmt = (sec) => {
				const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
				return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
			};

			// 系统媒体控制：没有活动来源时不提供文件选择或独立音频播放。
			for (const btn of mpButtons) {
				btn.addEventListener("click", () => {
					if (npInfo) npSend(btn.dataset.act === "play" ? "playpause" : btn.dataset.act === "prev" ? "previous" : "next");
				});
			}
			const NP_URL = "/dsh-eva-magi/nowplaying.json";
			const NP_CTL = "/dsh-eva-magi/nowplaying";
			const mpSrc = layer.querySelector(".eva-mp-src");
			let npInfo = null;
			let npBusy = false;
			let npSeenSource = null;
			let npControlling = false;
			let npConfirmed = null, npExpected = null, npEpoch = 0, npRefresh = false, npEnterTimer = null, npReadController = null;
			const npCommands = [];
			let mediaSuspended = false;
			const mediaSource = (info) => info?.bundleId || info?.app || null;
			const renderExternal = (info) => {
				const entering = !npInfo || mediaSource(npInfo) !== mediaSource(info);
				npInfo = info;
				if (entering && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
					clearTimeout(npEnterTimer);
					mpEl.dataset.entering = "1";
					npEnterTimer = setTimeout(() => { mpEl.removeAttribute("data-entering"); npEnterTimer = null; }, 650);
				}
				if (info.playing) npSeenSource = mediaSource(info);
				if (mpSrc) { mpSrc.textContent = info.app || ""; mpSrc.title = info.app || ""; }
				const title = info.title || "(未知曲目)";
				if (mpTitle && mpTitle.textContent !== title) { mpTitle.textContent = title; mpTitle.title = title; }
				if (mpArtist) { mpArtist.textContent = info.artist || info.album || "未知演出者"; mpArtist.title = [info.artist, info.album].filter(Boolean).join(" / "); }
				if (mpState) mpState.textContent = info.playing ? "再生中" : "一時停止";
				if (mpStateEn) mpStateEn.textContent = info.playing ? "PLAYING" : "HOLD";
				if (mpPlayLabel) mpPlayLabel.textContent = info.playing ? "PAUSE" : "PLAY";
				if (mpCur) mpCur.textContent = mpFmt(info.position);
				if (mpTot) mpTot.textContent = mpFmt(info.duration);
				const progress = info.duration > 0 ? Math.max(0, Math.min(100, (Number(info.position) || 0) / info.duration * 100)) : 0;
				if (mpFill) mpFill.style.width = progress + "%";
				if (mpBar) {
					mpBar.setAttribute("aria-valuenow", String(Math.round(progress)));
					mpBar.setAttribute("aria-valuetext", mpFmt(info.position) + " / " + mpFmt(info.duration));
				}
				mpEl.toggleAttribute("data-playing", info.playing === true);
				if (info.playing) mpEl.setAttribute("data-playing", "1");
				const play = mpEl.querySelector('[data-act="play"]');
				play.setAttribute("aria-label", info.playing ? "暂停" : "继续播放");
				scheduleLayout();
			};
			const clearNowPlaying = () => {
				const changed = npInfo !== null;
				npInfo = null; npConfirmed = null; npExpected = null; npSeenSource = null;
				clearTimeout(npEnterTimer); npEnterTimer = null; mpEl.removeAttribute("data-entering");
				mpEl.hidden = true; mpEl.removeAttribute("data-playing");
				if (changed) scheduleLayout();
			};

			let npTimer = null;
			let npSupported = true;
			const scheduleNp = () => {
				clearTimeout(npTimer); npTimer = null;
				if (!disposed && !document.hidden && options.music && !mediaSuspended && npSupported && !npControlling) {
					npTimer = setTimeout(npPoll, npExpected && npExpected.until > Date.now() ? 250 : npInfo?.app ? 2000 : 3000);
				}
			};
			const npPoll = async (force = false) => {
				clearTimeout(npTimer); npTimer = null;
				npRefresh ||= force || Boolean(npExpected);
				if (disposed || document.hidden || npBusy || npControlling || !mpEl || mediaSuspended || !options.music || !npSupported) return;
				npBusy = true;
				const reader = new AbortController(); npReadController = reader;
				const epoch = npEpoch, refresh = npRefresh; npRefresh = false;
				try {
					const { response, data: info } = await fetchLocal(NP_URL + (refresh ? "?refresh=1" : ""), { credentials: "same-origin" }, reader);
					if (disposed || !options.music || epoch !== npEpoch) return;
					if (!response.ok) throw new Error("http");
					npSupported = info?.supported !== false;
					if (info?.ok && info.app && (info.playing === true || info.state === "paused" && npSeenSource === mediaSource(info))) {
						// 系统可能在接受动作后短暂返回旧状态；最多等 1.5s，避免图标先切换又闪回。
						if (npExpected && npExpected.source === mediaSource(info) && npExpected.until > Date.now() && info.playing !== npExpected.playing) {
							renderExternal({ ...info, playing: npExpected.playing, state: npExpected.playing ? "playing" : "paused" });
						} else { npExpected = null; npConfirmed = info; renderExternal(info); }
					}
					else clearNowPlaying();
				} catch {
					if (!disposed && epoch === npEpoch) clearNowPlaying();
				} finally {
					npBusy = false;
					if (npReadController === reader) npReadController = null;
					if (npRefresh && !npControlling && !disposed && !document.hidden && options.music && !mediaSuspended && npSupported) npPoll(true);
					else scheduleNp();
				}
			};

			/** 连续点击按顺序发送；先响应界面，再以系统结果校准，不锁住按钮等待查询。 */
			const drainNpCommands = async () => {
				npControlling = true;
				try {
					while (npCommands.length && !disposed) {
						const command = npCommands[0];
						const { response, data } = await fetchLocal(NP_CTL, {
							method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
							body: JSON.stringify({ action: command.action, app: command.app, bundleId: command.bundleId }),
						});
						if (disposed) return;
						if (!response.ok || !data?.ok) throw new Error(data?.code === "SOURCE_CHANGED" ? "播放来源已切换" : "控制失败");
						if (command.action === "playpause" && npConfirmed) npConfirmed = { ...npConfirmed, playing: command.playing, state: command.playing ? "playing" : "paused" };
						npCommands.shift();
					}
				} catch (error) {
					npCommands.length = 0;
					npExpected = null;
					if (!disposed) {
						if (npConfirmed) renderExternal(npConfirmed);
						if (mpSrc) mpSrc.textContent = error.message === "播放来源已切换" ? error.message : "控制失败";
					}
				} finally {
					npControlling = false;
					if (npExpected) npExpected.until = Date.now() + 1500;
					if (!disposed) { mpEl.removeAttribute("data-command"); npPoll(true); }
				}
			};
			const npSend = (action) => {
				if (!npInfo || disposed || npCommands.length >= 8) return;
				npEpoch++; npReadController?.abort(); clearTimeout(npTimer); npTimer = null;
				const playing = action === "playpause" ? !npInfo.playing : npInfo.playing;
				npCommands.push({ action, app: npInfo.app, bundleId: npInfo.bundleId, playing });
				mpEl.dataset.command = action;
				// 点击时不再被载入遮罩覆盖；暂停立即冻结机械环并切换图标。
				clearTimeout(npEnterTimer); npEnterTimer = null; mpEl.removeAttribute("data-entering");
				if (action === "playpause") {
					npExpected = { source: mediaSource(npInfo), playing, until: Infinity };
					renderExternal({ ...npInfo, playing, state: playing ? "playing" : "paused" });
				}
				else { mpState.textContent = "切替中"; mpStateEn.textContent = action === "next" ? "NEXT" : "PREV"; }
				if (!npControlling) drainNpCommands();
			};

			const tpsPanelEl = layer.querySelector(".eva-tps");
			if (tpsPanelEl) { tpsPanelEl.setAttribute("aria-hidden", "true"); layer.querySelector(".eva-corner-stack").appendChild(tpsPanelEl); }
			themeOverlayHost().appendChild(layer);

			// 角色标识只显示当前载入者；模式切换时原位更新，不重建组件或重置用户设置。
			const readState = () => {
				paintPilot(layer);
				const hud = layer.querySelector(".eva-hud");
				hud.setAttribute("aria-label", "当前载入：" + currentPilot().name + "；打开显示设定");
			};

			// —— 两个标签块：峰谷状态 + 下一切换倒计时 ——
			const tagsWrap = layer.querySelector(".eva-tags");
			const stateTag = layer.querySelector(".eva-tag--state");
			const remainTag = layer.querySelector(".eva-tag--remain");
			const stateText = stateTag.querySelector("b");
			const stateSub = stateTag.querySelector("small");
			const remainText = remainTag.querySelector("b");
			const remainSub = remainTag.querySelector("small");

			/** 状态 → [主文案, 副文案] */
			const STATE_LABELS = {
				peak: ["高峰料金", "PEAK RATE"],
				weekend: ["週末料金", "WEEKEND"],
				holiday: ["休日料金", "HOLIDAY"],
				offhours: ["空闲料金", "VALLEY"],
			};

			/** 把当前峰谷状态与倒计时画进两个标签块。 */
			const renderTags = () => {
				const nowSec = Math.floor(Date.now() / 1000);
				const state = pricingStateAt(nowSec);
				const key = state.peak ? "peak" : state.reason;
				const label = STATE_LABELS[key] || STATE_LABELS.offhours;
				tagsWrap.dataset.state = key;
				stateText.textContent = label[0];
				// 节假日清单未覆盖时，以虚线下划线和提示标注推算状态。
				stateSub.textContent = label[1];
				stateTag.dataset.inferred = state.inferred ? "1" : "0";
				stateTag.title = state.inferred ? "节假日清单未覆盖该年份，此状态为推算" : "";

				const next = nextPricingChangeAt(nowSec);
				if (next === null) {
					remainText.textContent = "—";
					remainSub.textContent = "残余";
					tagsWrap.dataset.imminent = "0";
					return;
				}
				const remain = next - nowSec;
				remainText.textContent = formatRemaining(remain);
				// 「切换」比「至切换」再短一档：默认放大到 1.5 之后，
			// 这几个像素就是标签块保得住还是被自动收掉的差别。
			remainSub.textContent = "切换";
				// 30 分钟内就要切换 → 闪一下（EVA 的「まもなく」）
				tagsWrap.dataset.imminent = remain <= 1800 ? "1" : "0";
			};

			// —— 点击标签块翻面看余额 ——
			// 余额由**宿主半边**去取：客户端按设计读不到 API Key。
			// 流程是 标签翻面 → fetch 本机只读路由 → 宿主用凭据问 DeepSeek 官方接口。
			// 所以这里不碰密钥、不直连外网，只请求自己的宿主。
			const balanceTag = layer.querySelector(".eva-tag--balance");
			let balanceState = "idle"; // idle | loading | ready | failed | unsupported

			/** 只做展示：把状态画到背面的两个标签上。 */
			const paintBalance = (main, sub) => {
				balanceTag.querySelector("b").textContent = main;
				balanceTag.querySelector("small").textContent = sub;
			};

			/** 失败原因 → 副文案。让人看得出是"没配密钥"还是"网络不通"。 */
			const FAILURE_LABEL = {
				NO_KEY: "未配置密钥",
				NO_BALANCE: "响应异常",
				FORBIDDEN: "本机校验未过",
				METHOD: "方法不允许",
				ERROR: "网络失败",
				TIMEOUT: "请求超时",
			};

			const formatAmount = (data) => {
				const symbol = data.currency === "USD" ? "$" : "¥";
				const amount = Number(data.balance);
				return symbol + (Number.isFinite(amount) ? amount.toFixed(2) : String(data.balance ?? "—"));
			};

			/**
			 * 翻到背面时取一次余额，两行都画上。
			 *
			 * 只有余额一个数据源：宿主拿 DSH 凭据去问 DeepSeek 官方接口。
			 * （原来的「今日已用」本地记账已按用户要求整体删除。）
			 */
			let balanceRequest = 0;
			const loadBackFace = async () => {
				const request = ++balanceRequest;
				balanceState = "loading";
				paintBalance("取得中", "RESOLVING");
				try {
					const { response, data } = await fetchLocal(BALANCE_ROUTE, { credentials: "same-origin" });
					if (disposed || request !== balanceRequest) return;
					if (response.status === 404) {
						balanceState = "unsupported"; paintBalance("未対応", "NO HOST ROUTE"); return;
					}
					if (!response.ok || data?.ok !== true || typeof data.balance !== "number" || !Number.isFinite(data.balance)) {
						balanceState = "failed";
						const code = data?.code || "ERROR";
						paintBalance("取得不可", FAILURE_LABEL[code] || (/^HTTP_/.test(code) ? "HTTP " + code.slice(5) : "BALANCE N/A"));
					} else { balanceState = "ready"; paintBalance(formatAmount(data), "残高"); }
				} catch (error) {
					if (disposed || request !== balanceRequest) return;
					balanceState = "failed";
					paintBalance("取得不可", error?.name === "AbortError" ? "请求超时" : "网络失败");
				}
			};

			// 仪表与时钟共用基准宽度；标签翻面或倒计时变化不再影响组件宽度。
			const stack = layer.querySelector(".eva-corner-stack");

			// ============================================================
			// 自由布局：仪表 / 时钟 / 播放器各自记住相对默认锚点的偏移。
			// 位置存 localStorage：left/top 为视觉左上角绝对坐标（null = 跟随默认锚点）。
			// 拖动进入“手动”模式；四角缩放只改 scale，左上角保持不动。
			// ============================================================
			const LAYOUT_KEYS = ["hud", "clock", "mp"];
			const layoutState = { hud: { left: null, top: null }, clock: { left: null, top: null }, mp: { left: null, top: null } };
			try {
				const saved = JSON.parse(globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY) || "null");
				for (const key of LAYOUT_KEYS) {
					const value = saved?.[key];
					if (!value || typeof value !== "object") continue;
					const left = Number(value.left), top = Number(value.top);
					if (Number.isFinite(left)) layoutState[key].left = Math.max(-100000, Math.min(100000, left));
					if (Number.isFinite(top)) layoutState[key].top = Math.max(-100000, Math.min(100000, top));
				}
			} catch { /* 存储不可用时位置只在本次会话生效 */ }
			const saveLayout = () => {
				try { globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutState)); } catch { /* 同上 */ }
			};
			const clampValue = (value, min, max) => min > max ? min : Math.min(max, Math.max(min, value));
			const layoutAnchors = { hud: { left: 0, top: 0 }, clock: { left: 0, top: 0 }, mp: { left: 0, top: 0 } };
			let layoutBounds = null;
			let activeDrag = null;
			const dragCleanups = [];
			// 四角缩放手柄：作为模块的子元素，固定在四角，随模块一起缩放。
			const resizeGrips = {};
			for (const [key, el, scaleKey] of [["hud", stack, "hudScale"], ["clock", clockEl, "clockScale"], ["mp", mpEl, "mpScale"]]) {
				const grips = [];
				if (el) {
					for (const corner of ["tl", "tr", "bl", "br"]) {
						const grip = document.createElement("span");
						grip.className = "eva-resize";
						grip.dataset.corner = corner;
						grip.dataset.widget = key;
						grip.setAttribute("aria-hidden", "true");
						grip.title = "拖动缩放";
						el.appendChild(grip);
						grips.push(grip);
					}
				}
				resizeGrips[key] = { el, grips, scaleKey };
			}

			// ============================================================
			// TPS / 解码速度波形（中央教条区下方）
			// ------------------------------------------------------------
			// 数据源是 DSH 自己的 sessionStats 投影 —— 界面上那个「257 tok/s」就是它算的：
			//   tps = decodeTokens / (decodeMs / 1000)
			// 但那是**会话累计均值**，画出来几乎是条直线。所以这里取投影的原始分量，
			// 按采样间隔求增量，得到该区间内的**瞬时**解码速度 —— 那才是有波动的曲线。
			// ============================================================
			const tpsLine = layer.querySelector(".eva-tps-line");
			const tpsNow = layer.querySelector(".eva-tps-now");
			const tpsPeak = layer.querySelector(".eva-tps-peak");
			const tpsAvg = layer.querySelector(".eva-tps-avg");
			const TPS_SAMPLES = 44;
			const tpsBuffer = new Array(TPS_SAMPLES).fill(0);
			let tpsPrev = null;
			let tpsSessionId = null;

			/** 当前会话 id：会话区域上的 data-conversation-session（形如 session-<uuid>）。 */
			const domSessionId = () => {
				try {
					const host = document.querySelector("[data-conversation-session]");
					return host ? host.getAttribute("data-conversation-session") : null;
				} catch (error) {
					return null;
				}
			};

			/** 读当前会话的 sessionStats 投影；拿不到就返回 null（波形照画，只是没数据）。 */
			const readStats = () => {
				try {
					if (!sessionsRef || typeof sessionsRef.binding !== "function") return null;
					const raw = domSessionId();
					if (!raw) return null;
					const bare = raw.replace(/^session-/, "");
					const binding =
						sessionsRef.binding(raw) || sessionsRef.binding(bare) || sessionsRef.binding("session-" + bare);
					const projections = binding && binding.session && binding.session.projections;
					const face = projections && typeof projections.faceOf === "function"
						? projections.faceOf("sessionStats")
						: null;
					return face && typeof face.getSnapshot === "function" ? face.getSnapshot() : null;
				} catch (error) {
					return null;
				}
			};

			const drawTps = (instant) => {
				if (!tpsLine) return;
				const peak = Math.max(...tpsBuffer);
				const avg = tpsBuffer.reduce((sum, value) => sum + value, 0) / tpsBuffer.length;
				// 纵轴自适应，但保底 60：空闲时不把噪声放大成满屏波形
				const top = Math.max(60, peak * 1.15);
				let points = "";
				for (let i = 0; i < TPS_SAMPLES; i += 1) {
					const x = (i / (TPS_SAMPLES - 1)) * 200;
					const y = 55 - Math.min(1, tpsBuffer[i] / top) * 52;
					points += (i > 0 ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
				}
				tpsLine.setAttribute("points", points);
				tpsNow.textContent = instant > 0 ? String(Math.round(instant)) : "—";
				// 同一份真实解码速度喂给大时钟的灯排（不做假遥测）
				setLamps(instant);
				tpsPeak.textContent = peak > 0 ? String(Math.round(peak)) : "—";
				tpsAvg.textContent = avg > 0 ? String(Math.round(avg)) : "—";
			};

			const sampleTps = () => {
				if (disposed || document.hidden || (!options.hud && !options.clock)) return;
				const sessionId = domSessionId();
				if (sessionId !== tpsSessionId) { tpsPrev = null; tpsBuffer.fill(0); tpsSessionId = sessionId; }
				let instant = 0;
				const stats = readStats();
				const tokens = stats ? Number(stats.decodeTokens) : NaN;
				const ms = stats ? Number(stats.decodeMs) : NaN;
				if (Number.isFinite(tokens) && Number.isFinite(ms)) {
					if (tpsPrev) {
						const deltaTokens = tokens - tpsPrev.tokens;
						const deltaMs = ms - tpsPrev.ms;
						// 增量 / 增量：这一段区间内的真实解码速度
						if (deltaTokens > 0 && deltaMs > 0) instant = deltaTokens / (deltaMs / 1000);
					}
					tpsPrev = { tokens, ms };
				}
				tpsBuffer.push(instant);
				tpsBuffer.shift();
				drawTps(instant);
				// 把原始分量写进 title：出问题时能一眼看出是"读不到投影"还是"确实没在生成"
				const panel = layer.querySelector(".eva-tps");
				if (panel) {
					panel.title = Number.isFinite(tokens) && Number.isFinite(ms)
						? "decodeTokens=" + tokens + " decodeMs=" + Math.round(ms) + " 瞬时=" + instant.toFixed(1) + " tok/s"
						: "读不到 sessionStats 投影（sessions 服务未就绪或没有当前会话）";
				}
			};
			let tpsTimer = null;
			drawTps(0);

			const tagsEl = layer.querySelector(".eva-tags");
			/** 自动翻回的定时器。 */
			let flipBackTimer = null;
			/**
			 * 翻面。
			 *
			 * 翻到背面展示余额，**8 秒后自动翻回** —— 用的是同一个 CSS transition，
			 * 所以来回动画完全一致。中途再点一下也会即时翻回（并取消待执行的定时器）。
			 */
			const flipTags = (force) => {
				const toBack = typeof force === "boolean" ? force : tagsEl.dataset.face !== "back";
				tagsEl.dataset.face = toBack ? "back" : "front";
				tagsEl.setAttribute("aria-label", toBack ? "返回计费状态" : "查看账户余额");
				layer.querySelector(".eva-tags-front").setAttribute("aria-hidden", String(toBack));
				layer.querySelector(".eva-tags-back").setAttribute("aria-hidden", String(!toBack));
				if (flipBackTimer !== null) {
					clearTimeout(flipBackTimer);
					flipBackTimer = null;
				}
				if (!toBack) return;
				loadBackFace();
				flipBackTimer = setTimeout(() => {
					flipBackTimer = null;
					flipTags(false);
				}, AUTO_FLIP_BACK_MS);
			};
			tagsEl.addEventListener("click", flipTags);
			tagsEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					flipTags();
				}
			});

			// 设置入口保留在仪表上；布局按实测盒子与可见视口计算，不使用固定基宽。
			paintOptions(options);
			const hudEl = layer.querySelector(".eva-hud");
			const { panel, refresh: refreshPanel } = buildPanel(options, setOption, resetAll, () => resetLayoutRef?.());
			layer.appendChild(panel);
			panel.id = PACKAGE_NAME + ":panel";
			refreshPanelRef = refreshPanel;
			refreshTagsRef = renderTags;
			hudEl.setAttribute("role", "button");
			hudEl.setAttribute("tabindex", "0");
			hudEl.setAttribute("aria-label", "EVA 角色主题显示设定");
			hudEl.setAttribute("aria-controls", panel.id);
			hudEl.setAttribute("aria-expanded", "false");
			hudEl.title = "点击打开显示设定";
			layer.querySelector(".eva-tags-back").setAttribute("aria-hidden", "true");
			tagsEl.setAttribute("aria-label", "查看账户余额");

			// 布局使用 CSS 视口坐标；组件保留用户设定倍率，跟随页面原生缩放。
			const viewport = () => {
				const vv = window.visualViewport;
				const left = vv?.offsetLeft || 0, top = vv?.offsetTop || 0;
				const width = vv?.width || window.innerWidth, height = vv?.height || window.innerHeight;
				return { left, top, width, height, right: left + width, bottom: top + height };
			};
			const css = (el, key, value) => { if (el.style[key] !== value) el.style[key] = value; };
			const variable = (key, value) => {
				if (layer.style.getPropertyValue(key) !== value) layer.style.setProperty(key, value);
			};
			let layoutFrame = null;
			let resizeObserver = null;
			let observed = [];
			const bindSizeObservers = (elements) => {
				if (!resizeObserver || elements.length === observed.length && elements.every((el, i) => el === observed[i])) return;
				resizeObserver.disconnect();
				observed = elements;
				for (const element of observed) resizeObserver.observe(element);
			};

			const placePanel = (bounds, gap, head) => {
				if (panel.hidden) return;
				const top = Math.min(bounds.bottom - gap - 1, Math.max(bounds.top + gap, (head?.bottom || bounds.top) + 12));
				const room = Math.max(1, bounds.bottom - top - gap);
				const narrow = bounds.width < 760;
				panel.dataset.dock = narrow ? "bottom" : "left";
				css(panel, "width", Math.max(1, Math.min(360, bounds.width - gap * 2)) + "px");
				css(panel, "left", bounds.left + gap + "px");
				css(panel, "top", narrow ? "auto" : top + "px");
				css(panel, "bottom", narrow ? window.innerHeight - bounds.bottom + gap + "px" : "auto");
				css(panel, "maxHeight", Math.min(640, room, narrow ? bounds.height * .7 : room) + "px");
			};

			const portrait = layer.querySelector(".eva-character-portrait");
			/** 把偏移应用到三个组件；超出会话区域时夹回，避免拖出界面。 */
			function applyPositions() {
				if (!layoutBounds) return;
				const bounds = layoutBounds, margin = 4;
				const place = (element, key, scale) => {
					if (!element || element.hidden || element.offsetWidth === 0) return;
					const width = element.offsetWidth * scale, height = element.offsetHeight * scale;
					const anchor = layoutAnchors[key], state = layoutState[key];
					let left = state.left === null ? anchor.left : state.left;
					let top = state.top === null ? anchor.top : state.top;
					// 仅手动模式（拖动/缩放过）才夹回会话区域；默认锚点保持右下/右上贴边，超尺寸时允许溢出。
					if (state.left !== null || state.top !== null) {
						left = clampValue(left, bounds.left + margin, bounds.right - margin - width);
						top = clampValue(top, bounds.top + margin, bounds.bottom - margin - height);
						state.left = left; state.top = top;
					}
					css(element, "left", left + "px");
					css(element, "top", top + "px");
				};
				place(stack, "hud", options.hudScale);
				place(clockEl, "clock", clockRenderScale(options.clockScale));
				place(mpEl, "mp", clockRenderScale(options.mpScale));
			}

			const layout = () => {
				if (disposed || document.hidden) return;
				const screenBounds = viewport();
				const bounds = { ...screenBounds };
				const header = document.querySelector(HOST_HOOKS.header);
				const composer = document.querySelector(HOST_HOOKS.composer);
				const region = document.querySelector(HOST_HOOKS.region);
				const regionBox = region?.getBoundingClientRect();
				if (regionBox?.width > 0 && regionBox.right > bounds.left && regionBox.left < bounds.right) {
					bounds.left = Math.max(bounds.left, regionBox.left);
					bounds.right = Math.min(bounds.right, regionBox.right);
					bounds.width = bounds.right - bounds.left;
				}
				const gap = bounds.width < 640 ? 8 : 18;
				bindSizeObservers([document.documentElement, document.body, header, composer, region].filter(Boolean));
				const head = header?.getBoundingClientRect();
				const rawCard = composer?.getBoundingClientRect();
				const card = rawCard?.width > 0 && rawCard.height > 0 ? rawCard : null;
				// DSH 的右栏全屏模式盖住会话区域；只保留小型设置入口，避免遮挡文件/终端控件。
				if (document.querySelector(HOST_HOOKS.rightFullscreen)) {
					clockEl.hidden = true; mpEl.hidden = true; portrait.hidden = true; mediaSuspended = true;
					if (tpsPanelEl) tpsPanelEl.hidden = true;
					stack.dataset.fit = "minimal";
					const scale = options.hudScale;
					variable("--eva-hud-scale", String(scale));
					const hudWidth = stack.offsetWidth * scale, hudHeight = stack.offsetHeight * scale;
					layoutAnchors.hud = { left: screenBounds.right - gap - hudWidth, top: screenBounds.bottom - gap - hudHeight };
					layoutBounds = screenBounds;
					applyPositions();
					placePanel(screenBounds, gap, null);
					return;
				}

				mediaSuspended = false;
				if (tpsPanelEl) tpsPanelEl.hidden = false;
				// 左侧立绘以会话半宽为目标；腰部贴输入框，空间不足时等比收小以保留头部。
				const portraitMinTop = Math.max(bounds.top + gap, (head?.bottom || bounds.top + 64) + 10);
				const portraitBottom = Math.min(bounds.bottom, card ? card.top : bounds.bottom - gap);
				const portraitRoom = Math.max(0, portraitBottom - portraitMinTop);
				portrait.hidden = portraitRoom === 0;
				const portraitWidth = Math.min(bounds.width * .5, portraitRoom * 2 / 3);
				const portraitHeight = portraitWidth * 1.5;
				const portraitTop = portraitBottom - portraitHeight;
				variable("--eva-portrait-left", bounds.left + gap + (bounds.width > 900 ? 12 : 0) + portraitWidth / 6 + "px");
				variable("--eva-portrait-top", portraitTop + "px");
				variable("--eva-portrait-width", portraitWidth + "px");
				variable("--eva-portrait-height", portraitHeight + "px");
				// 保留设定倍率：页面原生缩放直接作用于组件，不因输入栏或剩余空间反向缩小。
				stack.dataset.fit = "full";
				variable("--eva-hud-scale", String(options.hudScale));
				const hudWidth = stack.offsetWidth * options.hudScale, hudHeight = stack.offsetHeight * options.hudScale;
				layoutAnchors.hud = { left: bounds.right - gap - hudWidth, top: bounds.bottom - gap - hudHeight };

				// 右上时钟使用原 TPS 锚点，播放器只在检测到系统播放后出现在时钟下方。
				const top = Math.max(bounds.top + gap, (head?.bottom || bounds.top + 64) + 10);
				clockEl.hidden = !options.clock;
				mpEl.hidden = !options.music || !npInfo;
				mpEl.dataset.compact = "false";
				const clockHeight = clockEl.hidden ? 0 : clockEl.offsetHeight;
				const clockScale = clockRenderScale(options.clockScale);
				variable("--eva-clock-scale", String(clockScale));
				const left = bounds.right - gap - CLOCK_PANEL_WIDTH * clockScale;
				layoutAnchors.clock = { left, top };
				// 播放器右对齐时钟/仪表右边缘：宽度用自身 mpScale，位置仍随缩放后的时钟下移。
				layoutAnchors.mp = { left: bounds.right - gap - CLOCK_PANEL_WIDTH * clockRenderScale(options.mpScale), top: top + clockHeight * clockScale + (clockHeight ? 10 : 0) };
				layoutBounds = bounds;
				applyPositions();
				placePanel(bounds, gap, head);
			};
			const scheduleLayout = () => {
				if (disposed || document.hidden || layoutFrame !== null) return;
				layoutFrame = requestAnimationFrame(() => { layoutFrame = null; layout(); syncWork(); });
			};
			if (typeof ResizeObserver === "function") resizeObserver = new ResizeObserver(scheduleLayout);
			const layoutObserver = new MutationObserver((records) => {
				const hooks = HOST_HOOKS.header + "," + HOST_HOOKS.composer + "," + HOST_HOOKS.region + ",[data-sidebar-right-panel]";
				if (records.some((record) => {
					if (layer.contains(record.target)) return false;
					if (record.type === "attributes") return record.target.matches("[data-sidebar-right-panel]") || observed.some((el) => record.target === el || record.target.contains(el));
					return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && (node.matches(hooks) || node.querySelector(hooks)));
				})) scheduleLayout();
			});
			layoutObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-sidebar-right-open", "data-sidebar-right-panel"] });
			layoutObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
			const themeObserver = new MutationObserver(readState);
			themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });

			const togglePanel = (open, restoreFocus = true) => {
				const willOpen = typeof open === "boolean" ? open : panel.hidden;
				const hadFocus = panel.contains(document.activeElement);
				panel.hidden = !willOpen;
				hudEl.setAttribute("aria-expanded", String(willOpen));
				if (willOpen) {
					refreshPanel(); layout();
					panel.querySelector("input[type=range],.eva-sw")?.focus({ preventScroll: true });
				} else if (restoreFocus && hadFocus) hudEl.focus({ preventScroll: true });
			};
			panel.querySelector(".eva-panel-close").addEventListener("click", () => togglePanel(false));
			panel.querySelector(".eva-replay-boot").addEventListener("click", () => togglePanel(false, false));
			let hudDragConsumed = false;
			hudEl.addEventListener("click", () => {
				if (hudDragConsumed) { hudDragConsumed = false; return; }
				togglePanel();
			});
			hudEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") { event.preventDefault(); togglePanel(); }
			});
			const onHudWheel = (event) => {
				if (!event.ctrlKey && !event.metaKey) return;
				event.preventDefault();
				const next = Math.round((options.hudScale + (event.deltaY < 0 ? SIZE_STEP : -SIZE_STEP)) * 100) / 100;
				setOption("hudScale", next);
			};
			hudEl.addEventListener("wheel", onHudWheel, { passive: false });
			const onDocPointerDown = (event) => {
				if (!panel.hidden && !panel.contains(event.target) && !hudEl.contains(event.target)) togglePanel(false, false);
			};
			const onDocKeyDown = (event) => { if (event.key === "Escape" && !panel.hidden) togglePanel(false); };
			document.addEventListener("pointerdown", onDocPointerDown, true);
			document.addEventListener("keydown", onDocKeyDown);

			let secondsTimer = null;
			const updateReadings = () => {
				if (disposed || document.hidden) return;
				if (options.hud) renderTags();
				if (options.clock) updateClock();
			};
			const syncWork = () => {
				const active = !document.hidden;
				layer.toggleAttribute("data-paused", !active);
				if (active && (options.hud && stack.dataset.fit !== "minimal" || options.clock && !clockEl.hidden)) {
					if (secondsTimer === null) secondsTimer = setInterval(updateReadings, 1000);
					if (tpsTimer === null) tpsTimer = setInterval(sampleTps, 400);
				} else {
					clearInterval(secondsTimer); secondsTimer = null;
					clearInterval(tpsTimer); tpsTimer = null; tpsPrev = null;
				}
				if (active && options.music && !mediaSuspended && npSupported) {
					if (npTimer === null && !npBusy && !npControlling) npPoll();
				} else { clearTimeout(npTimer); npTimer = null; }
			};
			const onVisibility = () => { syncWork(); if (!document.hidden) { updateReadings(); scheduleLayout(); } };
			refreshLayoutRef = () => { layout(); updateReadings(); syncWork(); };

			// 拖动移动：仪表竖标 / 时钟标题 / 播放器标题。
			const attachDrag = (key, element, handle, label) => {
				if (!element || !handle) return;
				handle.title = label;
				let down = null;
				const onMove = (event) => {
					if (!down || event.pointerId !== down.id) return;
					const dx = event.clientX - down.x, dy = event.clientY - down.y;
					if (!down.moved && Math.hypot(dx, dy) < 3) return;
					down.moved = true;
					event.preventDefault();
					try { handle.setPointerCapture(event.pointerId); } catch { /* 同上 */ }
					layoutState[key].left = down.left + dx;
					layoutState[key].top = down.top + dy;
					applyPositions();
				};
				const onEnd = (event) => {
					if (!down || event.pointerId !== down.id) return;
					const current = down; down = null; activeDrag = null;
					try { handle.releasePointerCapture(event.pointerId); } catch { /* 同上 */ }
					element.removeAttribute("data-dragging");
					window.removeEventListener("pointermove", onMove, { passive: false });
					window.removeEventListener("pointerup", onEnd);
					window.removeEventListener("pointercancel", onEnd);
					if (current.moved) {
						saveLayout();
						if (key === "hud") hudDragConsumed = true;
						if (key === "mp") mpDragConsumed = true;
					}
				};
				const onDown = (event) => {
					if (event.button !== 0 || activeDrag) return;
					if (!element.offsetWidth || element.hidden) return;
					const state = layoutState[key];
					const left = state.left === null ? (Number.parseFloat(element.style.left) || layoutAnchors[key].left) : state.left;
					const top = state.top === null ? (Number.parseFloat(element.style.top) || layoutAnchors[key].top) : state.top;
					state.left = left; state.top = top; // 一旦拖动即进入手动模式
					down = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top, moved: false };
					activeDrag = down;
					element.dataset.dragging = "1";
					window.addEventListener("pointermove", onMove, { passive: false });
					window.addEventListener("pointerup", onEnd);
					window.addEventListener("pointercancel", onEnd);
				};
				handle.addEventListener("pointerdown", onDown);
				if (key === "mp") {
					// 整块面板可拖：拖动后吞掉这次 click，避免误触发播放/切歌按钮。
					const onPanelClick = (event) => {
						if (!mpDragConsumed) return;
						mpDragConsumed = false;
						event.preventDefault();
						event.stopPropagation();
					};
					element.addEventListener("click", onPanelClick, true);
					dragCleanups.push(() => element.removeEventListener("click", onPanelClick, true));
				}
				dragCleanups.push(() => {
					handle.removeEventListener("pointerdown", onDown);
					element.removeAttribute("data-dragging");
					if (down) {
						window.removeEventListener("pointermove", onMove, { passive: false });
						window.removeEventListener("pointerup", onEnd);
						window.removeEventListener("pointercancel", onEnd);
						down = null; activeDrag = null;
					}
				});
			};
			let mpDragConsumed = false;
			attachDrag("hud", stack, hudEl, "拖动移动仪表 · 单击打开设置");
			attachDrag("clock", clockEl, clockEl, "拖动移动时钟");
			attachDrag("mp", mpEl, mpEl, "拖动移动音乐播放器");
			const attachResize = (grip) => {
				const key = grip.dataset.widget, corner = grip.dataset.corner;
				const element = resizeGrips[key]?.el;
				const scaleKey = resizeGrips[key]?.scaleKey || "clockScale";
				if (!element) return;
				let down = null;
				const onMove = (event) => {
					if (!down || event.pointerId !== down.id) return;
					const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
					if (!down.moved && moved < 3) return;
					down.moved = true;
					event.preventDefault();
					const startDist = Math.hypot(down.x - down.ax, down.y - down.ay);
					const currentDist = Math.hypot(event.clientX - down.ax, event.clientY - down.ay);
					const scale = startDist > 0 ? down.scale * (currentDist / startDist) : down.scale;
					const next = clampValue(scale, SIZE_MIN, SIZE_MAX);
					const ratio = next / down.scale;
					const cssScale = scaleKey === "hudScale" ? down.scale : clockRenderScale(down.scale);
					const width = element.offsetWidth * cssScale, height = element.offsetHeight * cssScale;
					const dx = (corner === "tl" || corner === "bl") ? width * (1 - ratio) : 0;
					const dy = (corner === "tl" || corner === "tr") ? height * (1 - ratio) : 0;
					options[scaleKey] = Math.round(next * 100) / 100;
					const state = layoutState[key];
					state.left = down.left + dx;
					state.top = down.top + dy;
					paintOptions(options);
					applyPositions();
				};
				const onEnd = (event) => {
					if (!down || event.pointerId !== down.id) return;
					const current = down; down = null; activeDrag = null;
					try { grip.releasePointerCapture(event.pointerId); } catch { /* 同上 */ }
					window.removeEventListener("pointermove", onMove, { passive: false });
					window.removeEventListener("pointerup", onEnd);
					window.removeEventListener("pointercancel", onEnd);
					if (current.moved) { saveOptions(options); saveLayout(); }
				};
				const onDown = (event) => {
					if (event.button !== 0 || activeDrag) return;
					if (!element.offsetWidth || element.hidden) return;
					const rect = element.getBoundingClientRect();
					const state = layoutState[key];
					state.left = rect.left; state.top = rect.top; // 进入手动模式
					const ax = (corner === "tl" || corner === "bl") ? rect.right : rect.left;
					const ay = (corner === "tl" || corner === "tr") ? rect.bottom : rect.top;
					try { grip.setPointerCapture(event.pointerId); } catch { /* 同上 */ }
					down = { id: event.pointerId, x: event.clientX, y: event.clientY, ax, ay, scale: options[scaleKey], left: rect.left, top: rect.top, moved: false };
					activeDrag = down;
					window.addEventListener("pointermove", onMove, { passive: false });
					window.addEventListener("pointerup", onEnd);
					window.addEventListener("pointercancel", onEnd);
				};
				grip.addEventListener("pointerdown", onDown);
				dragCleanups.push(() => {
					grip.removeEventListener("pointerdown", onDown);
					if (down) {
						window.removeEventListener("pointermove", onMove, { passive: false });
						window.removeEventListener("pointerup", onEnd);
						window.removeEventListener("pointercancel", onEnd);
						down = null; activeDrag = null;
					}
				});
			};
			for (const key of LAYOUT_KEYS) for (const grip of resizeGrips[key].grips) attachResize(grip);
			resetLayoutRef = () => {
				for (const key of LAYOUT_KEYS) { layoutState[key].left = null; layoutState[key].top = null; }
				try { globalThis.localStorage?.removeItem(LAYOUT_STORAGE_KEY); } catch { /* 同上 */ }
				layout();
			};
			window.addEventListener("resize", scheduleLayout);
			window.visualViewport?.addEventListener("resize", scheduleLayout);
			window.visualViewport?.addEventListener("scroll", scheduleLayout);
			document.addEventListener("transitionend", scheduleLayout, true);
			document.addEventListener("visibilitychange", onVisibility);
			updateClock(); readState(); renderTags();
			layout(); syncWork();
			// 老内核没有 ResizeObserver 时保留低频布局兜底。
			const fallbackTimer = resizeObserver ? null : setInterval(scheduleLayout, 2000);

			return () => {
				disposed = true;
				for (const request of requests) request.abort();
				requests.clear();
				clearInterval(secondsTimer); clearInterval(tpsTimer); clearInterval(fallbackTimer);
				clearTimeout(npTimer); clearTimeout(npEnterTimer); clearTimeout(flipBackTimer); npCommands.length = 0;
				if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
				window.removeEventListener("resize", scheduleLayout);
				window.visualViewport?.removeEventListener("resize", scheduleLayout);
				window.visualViewport?.removeEventListener("scroll", scheduleLayout);
				document.removeEventListener("transitionend", scheduleLayout, true);
				document.removeEventListener("visibilitychange", onVisibility);
				document.removeEventListener("pointerdown", onDocPointerDown, true);
				document.removeEventListener("keydown", onDocKeyDown);
				resizeObserver?.disconnect(); layoutObserver.disconnect(); themeObserver.disconnect();
				for (const cleanup of dragCleanups) cleanup();
				dragCleanups.length = 0;
				resetLayoutRef = null;
				refreshTagsRef = null; refreshPanelRef = null; refreshLayoutRef = null;
				layer.remove();
				const root = document.documentElement;
				root.removeAttribute("data-eva-magi");
				for (const attr of Object.values(OPTION_ATTRS)) root.removeAttribute(attr);
				for (const key of ["--eva-tps-width", "--eva-scan-strength", "--eva-hud-scale", "--eva-hud-scale-inv", "--eva-clock-scale", "--eva-mp-scale", "--eva-wallpaper-strength"]) root.style.removeProperty(key);
			};
		}

		/** 只订阅宿主状态，不回答审核、不创建会话，也不把历史回放当作任务完成。 */
		function mountAttentionSounds(ctx, options) {
			const sessions = ctx.sessions, status = ctx.uiSession?.sessionStatus;
			if (typeof sessions?.list?.subscribe !== "function" || typeof status?.subscribe !== "function") return () => {};
			let disposed = false, audio = null, active = null, generation = 0, deadline = null, blocked = false, previewId = 0;
			let queue = [];
			const bindings = new Map(), seenApprovals = new Set();
			const fresh = (item) => options.attentionSound && Date.now() - item.at < 60000 && item.valid();
			const paintPlayback = () => {
				for (const button of document.querySelectorAll("[data-attention-preview]")) {
					const label = button.dataset.attentionPreview === "approval" ? "审核" : "完成";
					const playing = Boolean(active?.preview && active.started && active.kind === button.dataset.attentionPreview && !blocked);
					button.setAttribute("aria-pressed", String(playing)); button.textContent = playing ? "停止" + label + "试听" : "试听" + label + "提醒";
					button.title = playing ? PILOTS[audio.dataset.pilot].name + " · " + label + "提醒播放中" : "播放当前主题的" + label + "语音";
				}
			};
			const release = () => {
				generation++; clearTimeout(deadline); deadline = null; active = null; blocked = false;
				if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
				paintPlayback();
			};
			const finish = () => { release(); pump(); };
			const attempt = () => {
				const current = active, serial = ++generation;
				blocked = false;
				const failed = (error) => {
					if (disposed || serial !== generation || active !== current) return;
					if (error?.name === "NotAllowedError") { blocked = true; paintPlayback(); }
					else finish();
				};
				try { Promise.resolve(audio.play()).then(() => {
					if (!disposed && serial === generation && active === current) { active.started = true; paintPlayback(); }
				}, failed); } catch (error) { failed(error); }
			};
			const pump = () => {
				if (disposed || active || !options.attentionSound || document.querySelector(".eva-boot,.eva-welcome-voice")) return;
				queue = queue.filter(fresh);
				const item = queue.shift(); if (!item) return;
				if (!audio) {
					audio = document.createElement("audio"); audio.className = "eva-attention-audio"; audio.hidden = true;
					audio.setAttribute("aria-hidden", "true"); audio.preload = "auto"; audio.volume = .85;
					audio.addEventListener("ended", finish); audio.addEventListener("error", finish); document.body.appendChild(audio);
				}
				const pilot = document.body.hasAttribute("data-ds-dark-theme") ? "asuka" : "rei";
				active = item; audio.dataset.kind = item.kind; audio.dataset.pilot = pilot;
				audio.src = BRAND_ASSETS[pilot + (item.kind === "approval" ? "Approval" : "Complete")]; audio.load();
				deadline = setTimeout(finish, 15000); attempt();
			};
			const enqueue = (kind, valid, preview = false) => {
				if (disposed || !options.attentionSound) return false;
				if (preview) {
					queue = queue.filter(item => !item.preview);
					if (active?.preview) release();
				}
				const item = { kind, valid, preview, at: Date.now() };
				// 人工审核优先于排队的完成提醒；一个音源串行播放，避免多会话叠音。
				if (kind === "approval") queue.unshift(item); else queue.push(item);
				if (queue.length > 8) queue.pop(); pump(); return true;
			};
			const isPending = (id, key) => {
				const pending = status.getSnapshot().get(id)?.pendingInteraction;
				return pending?.kind === "approval" && pending.key === key && pending.answerable;
			};
			const scanApprovals = () => {
				for (const [id, value] of status.getSnapshot()) {
					const pending = value.pendingInteraction;
					if (pending?.kind !== "approval" || !pending.answerable) continue;
					const key = id + ":" + pending.key;
					if (seenApprovals.has(key)) continue;
					seenApprovals.add(key);
					if (seenApprovals.size > 1024) seenApprovals.delete(seenApprovals.values().next().value);
					enqueue("approval", () => isPending(id, pending.key));
				}
				queue = queue.filter(fresh);
				if (active && !fresh(active)) release(); pump();
			};
			const scanSessions = () => {
				const list = sessions.list.getSnapshot(), present = new Set();
				for (const id of Object.keys(list.byId)) {
					if (list.byId[id].origin === "subagent") continue;
					const binding = sessions.binding(id), source = binding?.eventSource;
					if (typeof source?.subscribe !== "function" || binding.session?.getSnapshot().subagent) continue;
					present.add(id);
					if (bindings.get(id)?.binding === binding) continue;
					bindings.get(id)?.stop();
					const record = { binding, watermark: -1, version: 0, stop: null };
					const seed = (snapshot) => {
						record.version++; record.watermark = -1;
						for (const { event } of snapshot.entries) if (Number.isInteger(event.seq)) record.watermark = Math.max(record.watermark, event.seq);
					};
					seed(source.getSnapshot());
					record.stop = source.subscribe(() => {
						const snapshot = source.getSnapshot(), change = snapshot.change;
						if (change.kind === "replace") { seed(snapshot); return; }
						if (change.kind !== "append") return;
						for (const { event } of change.entries) {
							if (!Number.isInteger(event.seq) || event.seq <= record.watermark) continue;
							const { seq, type, data } = event; record.watermark = seq;
							if (type !== "turn/end" || data.reason.kind !== "completed") continue;
							const version = record.version;
							enqueue("complete", () => bindings.get(id) === record && record.version === version);
						}
					});
					bindings.set(id, record);
				}
				for (const [id, record] of bindings) if (!present.has(id)) { record.stop(); bindings.delete(id); }
			};
			const preview = (kind) => {
				if (!["approval", "complete"].includes(kind)) return false;
				if (active?.preview && active.kind === kind && !blocked) { previewId++; release(); pump(); return true; }
				const id = ++previewId; return enqueue(kind, () => id === previewId, true);
			};
			const refresh = () => {
				if (!options.attentionSound) { queue = []; release(); } else pump();
			};
			const onGesture = () => {
				if (!blocked || !active) return;
				if (!fresh(active)) finish(); else attempt();
			};
			let observedBootHost = null;
			const observeBootHost = () => {
				const host = themeOverlayHost();
				if (host === observedBootHost) return;
				bootObserver.disconnect();
				bootObserver.observe(document.body, { childList: true });
				if (host !== document.body) bootObserver.observe(host, { childList: true });
				observedBootHost = host;
			};
			const bootObserver = new MutationObserver(() => {
				observeBootHost();
				if (document.querySelector(".eva-boot,.eva-welcome-voice")) {
					if (active) { const item = active; release(); queue.unshift(item); }
				} else pump();
			});
			observeBootHost();
			document.addEventListener("pointerdown", onGesture, true); document.addEventListener("keydown", onGesture, true);
			const stopStatus = status.subscribe(scanApprovals), stopList = sessions.list.subscribe(scanSessions);
			previewAttentionRef = preview; refreshAttentionRef = refresh;
			scanSessions(); scanApprovals();
			return () => {
				disposed = true; queue = []; release(); bootObserver.disconnect(); stopStatus(); stopList();
				for (const record of bindings.values()) record.stop(); bindings.clear(); seenApprovals.clear();
				document.removeEventListener("pointerdown", onGesture, true); document.removeEventListener("keydown", onGesture, true);
				if (audio) { audio.removeEventListener("ended", finish); audio.removeEventListener("error", finish); audio.remove(); }
				if (previewAttentionRef === preview) previewAttentionRef = null;
				if (refreshAttentionRef === refresh) refreshAttentionRef = null;
			};
		}

		/** 启动状态机：主题只走宿主 setTheme；进度只跟随真实音频时钟。 */
		function mountBoot(ctx) {
			const el = document.createElement("div");
			el.className = "eva-boot"; el.dataset.phase = "gif"; el.setAttribute("aria-hidden", "true");
			el.innerHTML = '<img class="eva-boot-gif" alt="" width="256" height="256" decoding="async">';
			const img = el.firstElementChild, media = window.matchMedia("(prefers-reduced-motion: reduce)");
			const bgm = document.createElement("audio"), soundButton = document.createElement("button");
			bgm.className = "eva-boot-bgm"; bgm.preload = "auto"; bgm.loop = true; bgm.volume = 0;
			bgm.src = BRAND_ASSETS.bootBgm;
			soundButton.type = "button"; soundButton.className = "eva-boot-sound"; soundButton.setAttribute("aria-label", "启动背景音乐");
			soundButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="eva-sound-slash" d="m3 3 18 18"/></svg>';
			const previousFocus = document.activeElement, listeners = [], inertNodes = new Map();
			// Warm both themes while the GIF/alarm is playing; drop never starts a large portrait decode.
			const warmImages = ["asukaHead", "reiHead", "asukaPortrait", "reiPortrait"].map(key => {
				const image = new Image(); image.src = BRAND_ASSETS[key]; image.decode?.().catch(() => {}); return image;
			});
			let disposed = false, gifTimer = null, deadline = null, enterTimer = null, progressFrame = null, focusFrame = null, bgmFrame = null, emergencyTimer = null, emergencyClockTimer = null;
			let emergency = null, emergencyNext = null, stopContours = null;
			let intro = null, introTimer = null, typeTimer = null, revealTimer = null, introFlight = null, flightAnimation = null, selectionAnimation = null;
			let bgmWanted = true, bgmStarting = false;
			let typingAudio = null, welcomeAudio = null, welcomeTimer = null, welcomeCleanup = null;
			let audio = null, consoleEl = null, status = null, bay = null, resume = null, progress = null, fill = null, percent = null, time = null;
			let selected = null, drag = null, suppressClick = false, syncValue = null, syncOrbit = null;
			let pickAudio = null, pickPilot = null, pointerPilot = null, pickActive = false, waitingForPick = false, pickTimer = null, pickCleanup = null, pickGeneration = 0;
			let themeSweep = null, themeTimer = null;
			let language = "zh-CN", statusKey = "waiting", resumeKey = "resume";
			try { const saved = localStorage.getItem(BOOT_LANGUAGE_KEY); if (Object.hasOwn(BOOT_COPY, saved)) language = saved; } catch { /* 存储受限时仍可即时切换。 */ }
			const text = (key) => BOOT_COPY[language][key].replace("{pilot}", BOOT_COPY[language][selected || pickPilot || "asuka"]);
			const listen = (target, type, handler, options) => {
				target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options));
			};
			const paintSound = () => {
				const playing = bgmWanted && !bgm.paused;
				soundButton.setAttribute("aria-pressed", String(playing));
				soundButton.setAttribute("aria-label", text("bgm")); soundButton.title = text(playing ? "bgmOn" : "bgmOff");
			};
			const fadeBgm = (target, duration = 260) => {
				if (bgmFrame !== null) cancelAnimationFrame(bgmFrame); bgmFrame = null;
				if (disposed) return;
				if (bgm.paused) { bgm.volume = target; return; }
				const from = bgm.volume, start = performance.now();
				const step = (now) => {
					bgmFrame = null; if (disposed || document.hidden) return;
					const ratio = Math.max(0, Math.min(1, (now - start) / duration)); bgm.volume = Math.max(0, Math.min(1, from + (target - from) * ratio));
					if (ratio < 1) bgmFrame = requestAnimationFrame(step);
				};
				bgmFrame = requestAnimationFrame(step);
			};
			const playBgm = () => {
				if (disposed || !bgmWanted || bgmStarting || !bgm.paused || document.hidden || el.dataset.phase === "handoff") return;
				bgmStarting = true;
				try { Promise.resolve(bgm.play()).then(() => { bgmStarting = false; if (!disposed) paintSound(); }, () => { bgmStarting = false; if (!disposed) paintSound(); }); }
				catch { bgmStarting = false; paintSound(); }
			};
			listen(bgm, "playing", () => { if (!disposed) { paintSound(); fadeBgm(el.dataset.phase === "loading" || pickActive ? .075 : .28, 450); } });
			listen(bgm, "pause", paintSound);
			listen(bgm, "error", () => { if (!disposed) { bgm.pause(); paintSound(); } });
			listen(soundButton, "click", () => {
				if (!bgm.paused) { bgmWanted = false; bgm.pause(); if (bgmFrame !== null) cancelAnimationFrame(bgmFrame); bgmFrame = null; }
				else { bgmWanted = true; playBgm(); }
				paintSound();
			});
			listen(el, "pointerdown", (event) => { if (!soundButton.contains(event.target)) playBgm(); }, true);
			listen(el, "keydown", (event) => { if (event.key !== "Escape" && !soundButton.contains(event.target)) playBgm(); });
			paintSound();
			const releaseBackground = () => { for (const [node, inert] of inertNodes) node.inert = inert; inertNodes.clear(); };
			const holdBackground = () => {
				// Isolate siblings along the ancestor chain, never an ancestor of this dialog.
				for (let node = el; node && node !== document.body; node = node.parentElement) {
					for (const sibling of node.parentElement?.children || []) {
						if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
						inertNodes.set(sibling, sibling.inert); sibling.inert = true;
					}
				}
			};
			const clearEmergency = () => {
				clearTimeout(emergencyTimer); clearInterval(emergencyClockTimer); emergencyTimer = emergencyClockTimer = null;
				emergency?.remove(); emergencyNext?.remove(); emergency = emergencyNext = null;
			};
			const stopTyping = () => {
				if (!typingAudio) return;
				typingAudio.pause(); typingAudio.removeAttribute("src"); typingAudio.load(); typingAudio.remove(); typingAudio = null;
			};
			const stopWelcome = () => {
				clearTimeout(welcomeTimer); welcomeTimer = null; welcomeCleanup?.(); welcomeCleanup = null;
				if (!welcomeAudio) return;
				welcomeAudio.pause(); welcomeAudio.removeAttribute("src"); welcomeAudio.load(); welcomeAudio.remove(); welcomeAudio = null;
			};
			const playWelcome = () => {
				if (!selected || document.hidden) return;
				welcomeAudio = document.createElement("audio"); welcomeAudio.className = "eva-welcome-voice"; welcomeAudio.hidden = true;
				welcomeAudio.preload = "auto"; welcomeAudio.src = BRAND_ASSETS[selected + "Welcome"];
				const onHidden = () => { if (document.hidden) stopWelcome(); };
				welcomeAudio.addEventListener("ended", stopWelcome); welcomeAudio.addEventListener("error", stopWelcome);
				document.addEventListener("visibilitychange", onHidden);
				welcomeCleanup = () => { document.removeEventListener("visibilitychange", onHidden); welcomeAudio?.removeEventListener("ended", stopWelcome); welcomeAudio?.removeEventListener("error", stopWelcome); };
				document.body.appendChild(welcomeAudio); welcomeTimer = setTimeout(stopWelcome, 10000);
				try { Promise.resolve(welcomeAudio.play()).catch(stopWelcome); } catch { stopWelcome(); }
			};
			const clearIntro = () => {
				stopTyping();
				clearTimeout(introTimer); clearTimeout(typeTimer); clearTimeout(revealTimer);
				introTimer = typeTimer = revealTimer = null; intro?.remove(); intro = null;
				flightAnimation?.cancel(); flightAnimation = null; introFlight?.remove(); introFlight = null;
				selectionAnimation?.cancel(); selectionAnimation = null;
				el.removeAttribute("data-arriving"); if (consoleEl) consoleEl.inert = false;
			};
			const clearThemeShift = () => { clearTimeout(themeTimer); themeTimer = null; themeSweep?.remove(); themeSweep = null; };
			const previewPilot = (id) => {
				for (const node of el.querySelectorAll("[data-boot-unit]")) if (node.textContent !== PILOTS[id].code) node.textContent = PILOTS[id].code;
				if (el.dataset.pilot === id) return;
				el.dataset.pilot = id; clearThemeShift();
				if (disposed || media.matches || document.hidden) return;
				themeSweep = document.createElement("div"); themeSweep.className = "eva-boot-theme-sweep"; themeSweep.setAttribute("aria-hidden", "true"); el.appendChild(themeSweep);
				themeTimer = setTimeout(clearThemeShift, 700);
			};
			const endDrag = () => {
				if (!drag) return;
				const active = drag; drag = null; active.ghost?.remove();
				try { if (active.card.hasPointerCapture(active.pointerId)) active.card.releasePointerCapture(active.pointerId); } catch {}
				if (bay) bay.removeAttribute("data-over");
			};
			const stopPick = () => {
				pickGeneration++; pickActive = false; clearTimeout(pickTimer); pickTimer = null; pickCleanup?.(); pickCleanup = null;
				if (pickAudio) { pickAudio.pause(); pickAudio.removeAttribute("src"); pickAudio.load(); }
			};
			const finishPick = () => {
				if (disposed) return;
				stopPick();
				if (waitingForPick) { waitingForPick = false; if (el.dataset.phase === "loading" && !document.hidden) playVoice(); }
				else if (el.dataset.phase === "select") { if (statusKey === "responding") setStatus("waiting"); fadeBgm(.28); }
			};
			const playPick = (id) => {
				if (disposed || el.dataset.phase !== "select" || document.hidden || !pickAudio) return;
				stopPick(); pickPilot = id; pickActive = true; pickAudio.dataset.pilot = id; setStatus("responding");
				const generation = pickGeneration, done = () => { if (generation === pickGeneration) finishPick(); };
				pickAudio.addEventListener("ended", done); pickAudio.addEventListener("error", done);
				pickCleanup = () => { pickAudio.removeEventListener("ended", done); pickAudio.removeEventListener("error", done); };
				pickTimer = setTimeout(done, 8000); pickAudio.src = BRAND_ASSETS[id + "PickVoice"]; pickAudio.load();
				playBgm(); fadeBgm(.075);
				try { Promise.resolve(pickAudio.play()).catch(done); } catch { done(); }
			};
			const prepareVoice = (id) => {
				if (audio.dataset.pilot === id) return;
				audio.dataset.pilot = id; audio.src = BRAND_ASSETS[id + "Voice"]; audio.load();
			};
			const cancelDrag = () => {
				endDrag(); pointerPilot = null;
				if (el.dataset.phase === "select") { stopPick(); setStatus("waiting"); fadeBgm(.28); previewPilot(document.body.hasAttribute("data-ds-dark-theme") ? "asuka" : "rei"); }
			};
			const dispose = (focus = false, welcome = false) => {
				stopWelcome();
				if (focusFrame !== null) { cancelAnimationFrame(focusFrame); focusFrame = null; }
				if (disposed) return;
				disposed = true; clearTimeout(gifTimer); clearTimeout(deadline); clearTimeout(enterTimer); clearEmergency(); clearIntro(); clearThemeShift(); stopContours?.();
				if (progressFrame !== null) cancelAnimationFrame(progressFrame);
				if (bgmFrame !== null) cancelAnimationFrame(bgmFrame); bgmFrame = null;
				endDrag(); waitingForPick = false; stopPick(); for (const remove of listeners) remove();
				img.removeAttribute("src");
				for (const image of warmImages) image.removeAttribute("src"); warmImages.length = 0;
				if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
				bgm.pause(); bgm.removeAttribute("src"); bgm.load();
				releaseBackground(); el.remove();
				if (welcome) playWelcome();
				if (focus && !document.hidden) {
					const restoreFocus = () => {
						if (document.hidden || document.querySelector(".eva-boot")) return;
						const input = document.querySelector('[data-composer-input]:not([contenteditable="false"]):not([aria-disabled="true"])');
						if (input && !input.closest("[inert]")) input.focus({ preventScroll: true });
						else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
					};
					restoreFocus();
					// 宿主编辑器需要一帧反映 inert 解除；下一帧补齐交接且可被重播／卸载取消。
					const active = document.activeElement;
					if (!active?.matches("[data-composer-input]")) focusFrame = requestAnimationFrame(() => {
						focusFrame = null; if (document.activeElement === active) restoreFocus();
					});
				}
			};
			const setStatus = (key) => { statusKey = key; if (status) status.textContent = text(key); };
			const paintLanguage = () => {
				el.lang = language;
				if (el.dataset.phase !== "gif") el.setAttribute("aria-label", text({ emergency: "alert", intro: "select", select: "select", loading: "syncArea", handoff: "handoff" }[el.dataset.phase]));
				for (const node of el.querySelectorAll("[data-boot-text]")) node.textContent = text(node.dataset.bootText);
				for (const node of el.querySelectorAll("[data-boot-aria]")) node.setAttribute("aria-label", text(node.dataset.bootAria));
				for (const button of el.querySelectorAll("[data-boot-language]")) button.setAttribute("aria-pressed", String(button.dataset.bootLanguage === language));
				if (emergencyNext) emergencyNext.textContent = text("skipAlert");
				if (consoleEl) {
					el.querySelector(".eva-boot-title").textContent = text(selected ? "syncTitle" : "select");
					el.querySelector(".eva-boot-hint").textContent = text(selected ? "syncHint" : "hint");
					for (const card of el.querySelectorAll(".eva-pilot-card")) {
						const id = card.dataset.pilot, mode = text(id === "asuka" ? "dark" : "light");
						card.setAttribute("aria-label", BOOT_COPY[language].card.replace("{pilot}", text(id)).replace("{mode}", mode));
						card.querySelector(".eva-pilot-info b").textContent = text(id); card.querySelector(".eva-pilot-info em").textContent = mode + " / UNIT " + PILOTS[id].code;
					}
					el.querySelector(".eva-entry-target").textContent = text(selected ? "inserted" : "drop");
					if (selected) el.querySelector(".eva-boot-loading h2").textContent = text(selected);
					resume.textContent = text(resumeKey); setStatus(statusKey);
				}
				paintSound();
			};
			const fmt = (seconds) => { const n = Math.floor(Math.max(0, seconds || 0)); return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0"); };
			const drawProgress = (ended = false) => {
				if (!audio || disposed) return;
				// Desktop's dsh-app proxy strips Content-Length: duration may stay
				// Infinity until late in playback. Fall back to the same file's sample count.
				const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : BRAND_ASSETS[(selected || audio.dataset.pilot) + "VoiceDuration"] || 0;
				const value = ended ? 100 : duration ? Math.min(100, Math.max(0, audio.currentTime / duration * 100)) : 0;
				fill.style.transform = "scaleX(" + value / 100 + ")";
				if (syncOrbit) syncOrbit.style.setProperty("--sync-progress", String(value / 100));
				const rounded = String(Math.floor(value));
				if (progress.getAttribute("aria-valuenow") !== rounded) { progress.setAttribute("aria-valuenow", rounded); percent.textContent = rounded.padStart(2, "0") + "%"; if (syncValue) syncValue.textContent = percent.textContent; }
				const clockText = fmt(audio.currentTime) + " / " + (duration ? fmt(duration) : "--:--");
				if (time.textContent !== clockText) time.textContent = clockText;
				if (progress.getAttribute("aria-valuetext") !== clockText) progress.setAttribute("aria-valuetext", clockText);
			};
			const tick = () => {
				progressFrame = null; if (disposed || !audio || audio.paused || document.hidden) return;
				drawProgress(); progressFrame = requestAnimationFrame(tick);
			};
			const showAudioError = () => {
				if (disposed || el.dataset.phase !== "loading") return;
				clearTimeout(deadline); audio.pause(); resume.hidden = false; resumeKey = "retry"; resume.textContent = text(resumeKey);
				setStatus("error");
			};
			const playVoice = () => {
				if (disposed || !audio) return;
				waitingForPick = false; stopPick();
				playBgm(); fadeBgm(.075);
				resume.hidden = true; clearTimeout(deadline); deadline = setTimeout(showAudioError, 12000);
				try { const playing = audio.play(); playing?.catch(() => { if (!disposed) showAudioError(); }); } catch { showAudioError(); }
			};
			const handoff = () => {
				if (disposed || el.dataset.phase !== "loading") return;
				drawProgress(true); clearTimeout(deadline); if (progressFrame !== null) cancelAnimationFrame(progressFrame); progressFrame = null;
				if (media.matches) { dispose(true, true); return; }
				// 全程保留模态隔离，等舱门完全开启后再把输入焦点交回宿主。
				el.dataset.phase = "handoff"; el.setAttribute("aria-label", text("handoff")); stopContours?.();
				fadeBgm(0, 1500);
				el.tabIndex = -1; el.focus({ preventScroll: true });
				const gates = document.createElement("div"); gates.setAttribute("aria-hidden", "true");
				gates.innerHTML = '<div class="eva-boot-gate left"><span>NERV / ENTRY SYSTEM · INTERLOCK RELEASED</span></div><div class="eva-boot-gate right"><span>A.T. FIELD · COMMUNICATION CHANNEL OPEN</span></div><div class="eva-boot-clearance"><b>' + text("complete") + '</b><small>SYNCHRONIZATION COMPLETE / EVA ' + PILOTS[selected].code + '</small></div>';
				el.appendChild(gates);
				const frame = document.createElement("div"); frame.className = "eva-boot-composer-frame"; frame.setAttribute("aria-hidden", "true");
				const locateComposer = () => {
					const target = document.querySelector("[data-composer-card]");
					if (!target) { frame.hidden = true; return; }
					const rect = target.getBoundingClientRect(); frame.hidden = rect.width === 0 || rect.height === 0;
					Object.assign(frame.style, { left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
				};
				el.appendChild(frame); locateComposer(); listen(window, "resize", locateComposer);
				enterTimer = setTimeout(() => dispose(true, true), 1600);
			};
			const choose = (id, picked = false) => {
				if (disposed || el.dataset.phase !== "select" || !Object.hasOwn(PILOTS, id)) return;
				try {
					if (typeof ctx.theme.setTheme !== "function") throw new Error("theme unavailable");
					ctx.theme.setTheme(id === "asuka" ? "dark" : "light");
				} catch { setStatus("themeError"); return; }
				if (!picked) playPick(id);
				const rollFrames = [...el.querySelectorAll(".eva-plug-roll")].map(node => ({node, transform:getComputedStyle(node).transform, opacity:getComputedStyle(node).opacity}));
				selected = id; previewPilot(id); el.style.setProperty("--boot-head", 'url("' + BRAND_ASSETS[id + "Head"] + '")');
				el.dataset.phase = "loading"; endDrag();
				if (!media.matches && !document.hidden) for (const {node, transform, opacity} of rollFrames) node.animate([{transform, opacity}, {transform:"translateX(0px) scaleX(1)", opacity:node.classList.contains("eva-plug-roll-back") ? 0 : 1}], {duration:400,easing:"ease-out"});
				el.querySelector(".eva-pilot-list").hidden = true; el.querySelector(".eva-boot-loading").hidden = false;
				el.querySelector(".eva-boot-code").textContent = "EVA / " + PILOTS[id].code + " · " + PILOTS[id].en;
				el.querySelector(".eva-entry-label b").textContent = "ENTRY PLUG / " + PILOTS[id].code;
				el.querySelector(".eva-entry-lock").textContent = "INTERLOCK / ENGAGED";
				setStatus(pickActive ? "responding" : "sync"); paintLanguage();
				prepareVoice(id);
				if (pickActive) { waitingForPick = true; resume.hidden = true; } else playVoice();
				el.querySelector(".eva-boot-exit").focus({ preventScroll: true });
			};
			const emergencyScreen = () => {
				if (disposed || el.dataset.phase !== "gif") return;
				if (media.matches || document.hidden) { selectScreen(); return; }
				clearTimeout(gifTimer); clearTimeout(deadline); img.removeAttribute("src"); img.hidden = true;
				el.dataset.phase = "emergency"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "NERV 警报启动画面"); holdBackground();
				emergency = document.createElement("section"); emergency.className = "eva-emergency"; emergency.setAttribute("aria-hidden", "true"); emergency.innerHTML = BRAND_ASSETS.emergency;
				emergencyNext = document.createElement("button"); emergencyNext.type = "button"; emergencyNext.className = "eva-emergency-next"; emergencyNext.textContent = "跳过警报";
				el.insertBefore(emergency, soundButton); el.appendChild(emergencyNext); bgm.hidden = true; el.appendChild(bgm);
				const updateClock = () => { if (emergency) emergency.querySelector("[data-emergency-clock]").textContent = new Date().toTimeString().slice(0, 8); };
				const fitEmergency = () => { emergency?.querySelector("svg").setAttribute("preserveAspectRatio", window.innerWidth < window.innerHeight ? "xMidYMid meet" : "xMidYMid slice"); };
				updateClock(); fitEmergency(); emergencyClockTimer = setInterval(updateClock, 1000);
				listen(window, "resize", fitEmergency); listen(emergencyNext, "click", introScreen);
				paintLanguage();
				emergencyNext.focus({ preventScroll: true }); emergencyTimer = setTimeout(introScreen, 3000);
			};
			const introScreen = () => {
				if (disposed || !["gif", "emergency"].includes(el.dataset.phase)) return;
				if (media.matches || document.hidden) { selectScreen(); return; }
				clearTimeout(gifTimer); clearTimeout(deadline); clearEmergency(); img.removeAttribute("src"); img.hidden = true;
				el.dataset.phase = "intro"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); holdBackground();
				intro = document.createElement("section"); intro.className = "eva-boot-intro";
				intro.innerHTML = '<div class="eva-intro-pilot" data-pilot="asuka" aria-hidden="true"><span class="eva-intro-face"></span><b>02</b><small>ASUKA LANGLEY</small></div><div class="eva-intro-copy"><p class="eva-intro-kicker" aria-hidden="true">NERV / PILOT AUTHENTICATION</p><h1 class="eva-intro-title"><span class="eva-intro-measure" aria-hidden="true"></span><span class="eva-intro-typed" aria-hidden="true"></span></h1><i class="eva-intro-rule" aria-hidden="true"></i></div><div class="eva-intro-pilot" data-pilot="rei" aria-hidden="true"><span class="eva-intro-face"></span><b>00</b><small>REI AYANAMI</small></div><button type="button" class="eva-intro-next"></button>';
				const title = intro.querySelector("h1"), typed = intro.querySelector(".eva-intro-typed"), next = intro.querySelector("button");
				const fullTitle = text("select"), characters = Array.from(fullTitle); let count = 0;
				title.setAttribute("aria-label", fullTitle); intro.querySelector(".eva-intro-measure").textContent = fullTitle; next.textContent = text("skipIntro");
				const typeNext = () => {
					typeTimer = null; if (disposed || el.dataset.phase !== "intro") return;
					typed.textContent = characters.slice(0, ++count).join("");
					if (count === 1) { try { Promise.resolve(typingAudio?.play()).catch(() => {}); } catch { /* A blocked effect never holds up the title. */ } }
					if (count < characters.length) typeTimer = setTimeout(typeNext, 1050 / characters.length);
				};
				typingAudio = document.createElement("audio"); typingAudio.className = "eva-intro-typing"; typingAudio.hidden = true; typingAudio.preload = "auto"; typingAudio.volume = .8; typingAudio.src = BRAND_ASSETS.typing;
				listen(typingAudio, "ended", stopTyping); listen(typingAudio, "error", stopTyping); el.appendChild(typingAudio);
				el.insertBefore(intro, soundButton); paintLanguage(); listen(next, "click", () => selectScreen()); next.focus({ preventScroll: true });
				typeTimer = setTimeout(typeNext, 220); introTimer = setTimeout(() => selectScreen(true), 2250);
			};
			const selectScreen = (animate = false) => {
				if (disposed || !["gif", "emergency", "intro"].includes(el.dataset.phase)) return;
				const introLayer = animate === true && !media.matches && !document.hidden ? intro : null;
				if (!introLayer) clearIntro();
				else { stopTyping(); clearTimeout(typeTimer); clearTimeout(introTimer); typeTimer = introTimer = null; }
				clearTimeout(gifTimer); clearTimeout(deadline); clearEmergency(); img.removeAttribute("src"); img.hidden = true;
				el.dataset.phase = "select"; el.removeAttribute("aria-hidden"); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "选择你的驾驶员");
				holdBackground();
				el.dataset.pilot = document.body.hasAttribute("data-ds-dark-theme") ? "asuka" : "rei";
				const backdrop = document.createElement("div"); backdrop.className = "eva-boot-backdrop"; backdrop.setAttribute("aria-hidden", "true");
				backdrop.innerHTML = '<span class="eva-boot-watermark" data-boot-unit>EV</span><i class="eva-boot-rail left"></i><i class="eva-boot-rail right"></i>';
				stopContours = mountBootContours(backdrop, media);
				el.appendChild(backdrop);
				consoleEl = document.createElement("section"); consoleEl.className = "eva-boot-console";
				consoleEl.innerHTML = [
					'<header class="eva-boot-header"><div class="eva-boot-heading"><div class="eva-boot-brand"><span class="eva-nerv-logo" aria-hidden="true"></span><p class="eva-boot-kicker">NERV / PILOT AUTHENTICATION<small>SPECIAL AGENCY · CENTRAL DOGMA</small></p></div><h1 class="eva-boot-title">选择你的驾驶员</h1><p class="eva-boot-hint">将头像拖入左侧插入栓，或点击头像装载</p></div><div class="eva-boot-header-side"><div class="eva-boot-security" aria-hidden="true">TOKYO-III<b>NEURAL INTERFACE · LEVEL 07</b></div><div class="eva-boot-languages" role="group" data-boot-aria="language"><button type="button" data-boot-language="zh-CN" lang="zh-CN">中文</button><button type="button" data-boot-language="ja" lang="ja">日本語</button><button type="button" data-boot-language="en" lang="en">English</button></div><div class="eva-boot-actions"><button type="button" class="eva-boot-exit" data-boot-text="exit">跳过并进入</button></div></div></header>',
					'<div class="eva-boot-grid"><div class="eva-entry-bay" role="group" data-boot-aria="bay"><div class="eva-entry-label">NERV / ENTRY SYSTEM<b>ENTRY PLUG / STANDBY</b></div><div class="eva-entry-spec" aria-hidden="true">EVANGELION<b>DIRECT ENTRY SYSTEM</b>L.C.L. / SEALED</div><span class="eva-entry-lock" aria-hidden="true">INTERLOCK / STANDBY</span><div class="eva-entry-machine"><div class="eva-entry-assembly">',
					BRAND_ASSETS.entryPlug,
					'<div class="eva-entry-window" aria-hidden="true"></div></div></div><p class="eva-entry-target">拖入驾驶员 · DROP PILOT HERE</p></div><div class="eva-pilot-list" role="group" data-boot-aria="pilots">',
					...Object.entries(PILOTS).map(([id, pilot]) => '<button type="button" class="eva-pilot-card" data-pilot="' + id + '" data-unit="' + pilot.code + '" aria-label="选择' + pilot.name + '，载入' + (id === "asuka" ? "暗色" : "亮色") + '主题"><span class="eva-pilot-card-top" aria-hidden="true">PILOT / ' + (id === "asuka" ? "SECOND CHILD" : "FIRST CHILD") + '<i>NEURAL ID · ' + pilot.code + '</i></span><span class="eva-pilot-face" aria-hidden="true"></span><span class="eva-pilot-info"><span class="eva-pilot-number">' + pilot.code + '</span><b>' + pilot.name + '</b><small>' + pilot.en + '</small><em>' + (id === "asuka" ? "暗色 / UNIT 02" : "亮色 / UNIT 00") + '</em></span></button>'),
					'</div><section class="eva-boot-loading" hidden data-boot-aria="syncArea"><div class="eva-sync-portrait" aria-hidden="true"></div><div class="eva-sync-main"><div><span class="eva-boot-code"></span><h2></h2><p>VOICE LINK<br><span data-boot-text="voiceHint">启动语音与同步进度</span></p></div><div class="eva-sync-orbit" aria-hidden="true"><svg viewBox="0 0 180 180" fill="none" stroke="currentColor"><circle cx="90" cy="90" r="86" opacity=".35" stroke-dasharray="1 7"/><circle cx="90" cy="90" r="70" opacity=".14" stroke-width="3"/><circle class="eva-sync-ring-meter" cx="90" cy="90" r="70" stroke-width="3"/><path d="M90 0v9m90 81h-9M90 180v-9M0 90h9"/></svg><div class="eva-sync-readout"><span class="eva-sync-value">00%</span><small>VOICE SYNC</small></div></div></div><div class="eva-sync-systems" aria-hidden="true"><span>A10 INTERFACE<b>CONNECTED</b></span><span>L.C.L. CHAMBER<b>SEALED</b></span><span>MAGI SYSTEM<b>STANDBY</b></span></div><div><div class="eva-boot-meter" role="progressbar" data-boot-aria="progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><div class="eva-boot-progress-label"><span>00%</span><time>00:00 / --:--</time></div><div class="eva-sync-caption">AUDIO SYNCHRONIZATION</div></div><button type="button" class="eva-boot-resume" hidden>继续启动语音</button></section></div><footer class="eva-boot-footer"><p class="eva-boot-status" role="status">等待驾驶员 · AWAITING PILOT</p><div class="eva-boot-magi" aria-hidden="true"><span><i></i>MELCHIOR·1</span><span><i></i>BALTHASAR·2</span><span><i></i>CASPER·3</span></div></footer>',
				].join("");
				el.appendChild(consoleEl);
				previewPilot(el.dataset.pilot);
				el.querySelector(".eva-boot-actions").insertBefore(soundButton, el.querySelector(".eva-boot-exit"));
				status = el.querySelector(".eva-boot-status"); bay = el.querySelector(".eva-entry-bay"); resume = el.querySelector(".eva-boot-resume");
				progress = el.querySelector(".eva-boot-meter"); fill = progress.firstElementChild; percent = el.querySelector(".eva-boot-progress-label span"); time = el.querySelector(".eva-boot-progress-label time");
				syncValue = el.querySelector(".eva-sync-value"); syncOrbit = el.querySelector(".eva-sync-orbit");
				audio = document.createElement("audio"); audio.preload = "auto"; audio.hidden = true; el.appendChild(audio);
				audio.className = "eva-boot-voice"; bgm.hidden = true; el.appendChild(bgm);
				pickAudio = document.createElement("audio"); pickAudio.className = "eva-boot-pick-voice"; pickAudio.preload = "auto"; pickAudio.hidden = true; el.appendChild(pickAudio);
				for (const event of ["loadedmetadata", "durationchange", "timeupdate"]) listen(audio, event, () => drawProgress());
				listen(audio, "ended", handoff); listen(audio, "error", showAudioError);
				listen(audio, "playing", () => { if (disposed) return; clearTimeout(deadline); resume.hidden = true; setStatus("sync"); if (progressFrame === null) tick(); });
				listen(audio, "pause", () => { if (disposed || audio.ended || el.dataset.phase !== "loading") return; resume.hidden = false; resumeKey = "resume"; resume.textContent = text(resumeKey); fadeBgm(.28); });
				listen(audio, "waiting", () => { if (!disposed) { clearTimeout(deadline); deadline = setTimeout(showAudioError, 12000); setStatus("buffering"); } });
				listen(resume, "click", playVoice); listen(el.querySelector(".eva-boot-exit"), "click", () => dispose(true));
				// 拖动中 Chromium 可能把 capture 交回页面；在 document 接续移动与放手。
				listen(document, "pointermove", (event) => {
					if (!drag || drag.pointerId !== event.pointerId) return;
					if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
					const rect = bay.getBoundingClientRect();
					if (!drag.ghost) { const cardRect = drag.card.getBoundingClientRect(); drag.width = cardRect.width; drag.height = cardRect.height; drag.ghost = drag.card.cloneNode(true); drag.ghost.classList.add("eva-pilot-ghost"); drag.ghost.inert = true; drag.ghost.setAttribute("aria-hidden", "true"); drag.ghost.style.width = drag.width + "px"; drag.ghost.style.height = drag.height + "px"; el.appendChild(drag.ghost); }
					drag.ghost.style.transform = "translate(" + (event.clientX - drag.width / 2) + "px," + (event.clientY - drag.height / 2) + "px) scale(.6)";
					const over = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
					bay.dataset.over = over ? "1" : "0"; previewPilot(drag.card.dataset.pilot);
				}, true);
				listen(document, "pointerup", (event) => {
					if (!drag || drag.pointerId !== event.pointerId) return;
					const moved = Boolean(drag.ghost), id = drag.card.dataset.pilot, rect = bay.getBoundingClientRect();
					const over = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
					endDrag(); suppressClick = moved; if (moved) pointerPilot = null; if (moved && over) choose(id, true);
				}, true);
				listen(document, "pointercancel", (event) => { if (drag?.pointerId === event.pointerId) cancelDrag(); }, true);
				listen(window, "blur", cancelDrag);
				for (const card of el.querySelectorAll(".eva-pilot-card")) {
					listen(card, "click", (event) => { if (suppressClick) { suppressClick = false; pointerPilot = null; event.preventDefault(); return; } const picked = event.detail > 0 && pointerPilot === card.dataset.pilot; pointerPilot = null; choose(card.dataset.pilot, picked); });
					listen(card, "pointerdown", (event) => {
						if (event.button !== 0 || el.dataset.phase !== "select") return;
						event.preventDefault(); card.focus({ preventScroll: true });
						suppressClick = false; endDrag(); drag = { card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
					pointerPilot = card.dataset.pilot; previewPilot(pointerPilot); prepareVoice(pointerPilot); playPick(pointerPilot);
						try { card.setPointerCapture(event.pointerId); } catch { /* 不支持 capture 时由 document 接续。 */ }
					});
					listen(card, "lostpointercapture", (event) => { if (drag?.pointerId === event.pointerId && event.buttons === 0) cancelDrag(); });
				}
				for (const button of el.querySelectorAll("[data-boot-language]")) listen(button, "click", () => {
					language = button.dataset.bootLanguage; paintLanguage();
					try { localStorage.setItem(BOOT_LANGUAGE_KEY, language); } catch { /* 当前界面仍然生效。 */ }
				});
				paintLanguage();
				if (introLayer) {
					const fromTitle = introLayer.querySelector(".eva-intro-title"), toTitle = el.querySelector(".eva-boot-title");
					const from = fromTitle.getBoundingClientRect(), to = toTitle.getBoundingClientRect(), style = getComputedStyle(fromTitle);
					introFlight = document.createElement("div"); introFlight.className = "eva-intro-flight"; introFlight.textContent = text("select"); introFlight.setAttribute("aria-hidden", "true");
					Object.assign(introFlight.style, {left: from.left + "px", top: from.top + "px", fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, color: style.color});
					el.appendChild(introFlight);
					flightAnimation = introFlight.animate([{transform:"translate(0,0) scale(1,1)", color:style.color}, {transform:"translate(" + (to.left - from.left) + "px," + (to.top - from.top) + "px) scale(" + to.width / from.width + "," + to.height / from.height + ")", color:getComputedStyle(toTitle).color}], {duration:820,easing:"cubic-bezier(.22,.7,.2,1)",fill:"both"});
					// A one-shot fade cannot restart when data-arriving is removed.
					selectionAnimation = consoleEl.animate([{opacity:0}, {opacity:1}], {duration:820,easing:"ease-out"});
					el.setAttribute("data-arriving", ""); introLayer.setAttribute("data-leaving", ""); introLayer.inert = consoleEl.inert = true;
					el.tabIndex = -1; el.focus({ preventScroll: true });
					revealTimer = setTimeout(() => {
						clearIntro(); if (!disposed && !document.hidden && el.dataset.phase === "select") el.querySelector(".eva-pilot-card")?.focus({ preventScroll: true });
					}, 820);
				} else if (!document.hidden) {
					if (!media.matches) selectionAnimation = consoleEl.animate([{opacity:0}, {opacity:1}], {duration:380,easing:"ease-out"});
					el.querySelector(".eva-pilot-card").focus({ preventScroll: true });
				}
			};
			listen(document, "keydown", (event) => {
				if (disposed) return;
				if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (drag) cancelDrag(); else dispose(true); return; }
				if (event.key === "Tab" && el.dataset.phase !== "gif") {
					if (el.dataset.phase === "handoff" || el.hasAttribute("data-arriving")) { event.preventDefault(); return; }
					const buttons = [...el.querySelectorAll("button:not(:disabled)")].filter(node => !node.closest("[hidden]"));
					const index = buttons.indexOf(document.activeElement), next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
					event.preventDefault(); buttons[next]?.focus({ preventScroll: true });
				}
			}, true);
			listen(window, "resize", () => {
				if (!el.hasAttribute("data-arriving")) return;
				clearIntro(); if (!document.hidden) el.querySelector(".eva-pilot-card")?.focus({ preventScroll: true });
			});
			listen(document, "visibilitychange", () => {
				if (disposed) return;
				el.toggleAttribute("data-paused", document.hidden);
				if (document.hidden) { bgm.pause(); if (bgmFrame !== null) cancelAnimationFrame(bgmFrame); bgmFrame = null; cancelDrag(); clearThemeShift(); clearIntro(); waitingForPick = false; stopPick(); if (["gif", "emergency", "intro"].includes(el.dataset.phase)) selectScreen(); else if (el.dataset.phase === "loading") { audio.pause(); resume.hidden = false; resumeKey = "resume"; resume.textContent = text(resumeKey); setStatus("paused"); } else if (el.dataset.phase === "handoff") dispose(); }
				else if (el.dataset.phase === "select") el.querySelector(".eva-pilot-card")?.focus({ preventScroll: true });
			});
			listen(media, "change", () => { if (media.matches) { clearThemeShift(); clearIntro(); if (["gif", "emergency", "intro"].includes(el.dataset.phase)) selectScreen(); else if (el.dataset.phase === "handoff") dispose(true, true); } });
			listen(img, "load", () => { if (disposed || el.dataset.phase !== "gif") return; clearTimeout(deadline); el.setAttribute("data-ready", ""); gifTimer = setTimeout(emergencyScreen, BRAND_ASSETS.durationMs); }, { once: true });
			listen(img, "error", emergencyScreen, { once: true });
			themeOverlayHost().appendChild(el);
			el.appendChild(soundButton); el.removeAttribute("aria-hidden"); paintLanguage(); playBgm();
			if (media.matches) selectScreen();
			else { deadline = setTimeout(emergencyScreen, 5000); img.src = BRAND_ASSETS.boot; }
			return dispose;
		}

		/** 开机序列每个浏览器会话只放一次，别让每次刷新都等一遍。 */
		function shouldRunBoot() {
			try {
				if (sessionStorage.getItem(BOOT_FLAG)) return false;
				sessionStorage.setItem(BOOT_FLAG, "1");
				return true;
			} catch (error) {
				return true; // 无痕模式下每次都放，总比不放好
			}
		}

		/** 注入插件自有样式表。返回移除函数。 */
		function mountStyles() {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = SKIN_CSS;
			document.head.appendChild(tag);
			return () => tag.remove();
		}

		/** 令牌表 → `overrideTokens` 要的 { light, dark } 形状。 */
		function tokenLayer() {
			const layer = {};
			for (const [alias, [light, dark]] of Object.entries(PALETTE)) {
				layer["--dsw-alias-" + alias] = { light, dark };
			}
			return layer;
		}

		// ============================================================
		// 4. 插件体
		// ============================================================
		/** 服务依赖：theme 由 @deepseek-ai/dsh-client-ui-theme 提供。 */
		const inject = ["theme"];

		/**
		 * @param ctx - 浏览器侧 Cordis 上下文。
		 */
		// ============================================================
		// 启动自检
		// ------------------------------------------------------------
		// HOST_HOOKS 集中记录语义属性与可读类名后缀。只有相应宿主区域存在时，
		// 缺失的控件才算必需；空白页、非会话页面和折叠侧栏不会产生误报。
		const DIAGNOSE_DELAY_MS = 4000;

		const HOOK_CHECKS = [
			{ sel: HOST_HOOKS.turnProcess, what: "任务完成与用时栏", required: false },
			{ sel: HOST_HOOKS.composer, what: "输入框卡片", required: true, context: HOST_HOOKS.header },
			{ sel: "[data-composer-input]", what: "输入区", required: true, context: HOST_HOOKS.composer },
			{ sel: '[data-slot="conversation.input.model"]', what: "模型选择器", required: true, context: HOST_HOOKS.composer },
			{ sel: '[data-slot="conversation.input.permission"]', what: "权限选择器", required: true, context: HOST_HOOKS.composer },
			{ sel: '[data-slot="sidebar"]', what: "侧边栏插槽", required: false },
			{ sel: HOST_HOOKS.sidebar, what: "左侧边栏面板", required: true, context: '[data-slot="sidebar"]' },
			{ sel: HOST_HOOKS.newSession, what: "新会话按钮", required: true, context: '[data-slot="sidebar"]' },
			{ sel: HOST_HOOKS.add, what: "加号按钮", required: true, context: HOST_HOOKS.composer },
			{ sel: HOST_HOOKS.send, what: "发送按钮", required: true, context: HOST_HOOKS.composer },
			{ sel: HOST_HOOKS.placeholder, what: "输入框占位符", required: false },
			{ sel: '[data-slot="sidebar"] [class*="_panelTitle"]', what: "侧栏标题", required: false },
			{ sel: '[role="menu"][data-menu-material]', what: "弹出菜单", required: false },
		];

		/**
		 * 体检：返回未命中的钩子。全中时 missing 为空数组。
		 * 只读、不写入，可随时在 Console 调用。
		 */
		function diagnose(doc) {
			const root = doc || globalThis.document;
			if (!root || typeof root.querySelector !== "function") {
				return { checked: 0, missing: [], unverifiable: true };
			}
			const missing = [];
			for (const check of HOOK_CHECKS) {
				let hit = false;
				try {
					hit = Boolean(root.querySelector(check.sel));
				} catch (error) {
					hit = false; // 选择器不被支持（极老的内核）
				}
				if (!hit) missing.push({ what: check.what, sel: check.sel, required: check.required && (!check.context || Boolean(root.querySelector(check.context))) });
			}
			return { checked: HOOK_CHECKS.length, missing };
		}

		/**
		 * 延迟一拍再体检：这些节点多半是应用异步渲染出来的，挂载瞬间查必然全是缺的。
		 *
		 * 只在「**确实认出了一个钩子**、但 required 的钩子缺了」时才输出 ——
		 * 一个都没认出来说明当前根本不在应用页面里（例如测试台），此时保持安静。
		 */
		function scheduleDiagnose() {
			const timer = setTimeout(() => {
				const report = diagnose();
				const found = report.checked - report.missing.length;
				if (found === 0) return;
				const bad = report.missing.filter((m) => m.required);
				if (bad.length === 0) return;
				console.info(
					"[dsh-plugin-eva-theme] 启动自检：" +
						bad.length +
						" 处钩子未命中，对应样式会**静默失效**（多半是 DSH 升级改过结构）。" +
						"明细：__EVA_MAGI_THEME__.diagnose()",
				);
				for (const m of bad) console.info("  · " + m.what + "  →  " + m.sel);
			}, DIAGNOSE_DELAY_MS);
			return () => clearTimeout(timer);
		}

		function apply(ctx) {
			const options = loadOptions();
			let mounted = null;

			/**
			 * 唯一的写入通道：界面面板与 Console 钩子都走它。
			 * 写入 → 持久化 → 重绘 CSS 标记 → 刷新面板控件。
			 */
			const setOption = (key, value) => {
				if (!mounted) throw new Error("主题已卸载");
				options[key] = normalizeOption(key, value);
				if (key === "boot" && !options.boot) cancelBootRef?.();
				saveOptions(options);
				paintOptions(options);
				refreshAttentionRef?.();
				if (typeof refreshPanelRef === "function") refreshPanelRef();
				if (typeof refreshTagsRef === "function") refreshTagsRef();
				if (typeof refreshLayoutRef === "function") refreshLayoutRef();
				return options[key];
			};

			/** 恢复全部默认值（面板底部的「重置全部」）。 */
			const resetAll = () => {
				if (!mounted) throw new Error("主题已卸载");
				Object.assign(options, DEFAULT_OPTIONS);
				saveOptions(options);
				paintOptions(options);
				refreshAttentionRef?.();
				if (typeof refreshPanelRef === "function") refreshPanelRef();
				if (typeof refreshTagsRef === "function") refreshTagsRef();
				if (typeof refreshLayoutRef === "function") refreshLayoutRef();
				if (typeof resetLayoutRef === "function") resetLayoutRef();
				return options;
			};

			// 皮肤样式表 + 装饰层 + 令牌层，生命周期都挂在 ctx.effect 上，
			// 因此 HMR 重载和插件卸载都不会留下残留。

			// 可选依赖：客户端 sessions 服务（TPS 波形要读它的 sessionStats 投影）。
			// 同样用子作用域注入：服务缺失时皮肤照常工作，只是波形没有数据。
			if (typeof ctx.inject === "function") {
				ctx.inject(["sessions", "uiSession"], (scope) => {
					scope.effect(() => whenBodyReady(() => mountAttentionSounds(scope, options)), "eva-magi: role attention sounds");
				});
				ctx.inject(["sessions"], (scope) => {
					try {
						sessionsRef = scope.sessions || null;
					} catch (error) {
						sessionsRef = null;
					}
					scope.effect(() => () => {
						sessionsRef = null;
					}, "eva-magi: sessions ref");
				});
			}

			ctx.effect(() => scheduleDiagnose(), "eva-magi: hook self-check");
			ctx.effect(() => mountStyles(), "eva-magi: skin stylesheet");
			ctx.effect(
				() => whenBodyReady(() => mountChrome(ctx, options, setOption, resetAll)),
				"eva-magi: chrome + crt layers",
			);
			ctx.effect(() => {
				let stopped = false, stop = null;
				const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
				const cancel = () => { stop?.(); stop = null; };
				const play = () => {
					if (stopped || document.hidden) return false;
					cancel(); stop = whenBodyReady(() => mountBoot(ctx)); return true;
				};
				const refresh = () => { refreshPanelRef?.(); };
				replayBootRef = play; cancelBootRef = cancel;
				reducedMotion.addEventListener("change", refresh);
				if (options.boot && !document.hidden && shouldRunBoot()) play();
				return () => {
					stopped = true; cancel(); reducedMotion.removeEventListener("change", refresh);
					if (replayBootRef === play) replayBootRef = null;
					if (cancelBootRef === cancel) cancelBootRef = null;
				};
			}, "eva-magi: boot sequence");
			ctx.effect(
				() => {
					const dispose = ctx.theme.overrideTokens(PACKAGE_NAME, tokenLayer());
					return () => {
						dispose();
						if (globalThis.__EVA_MAGI_THEME__ === mounted) delete globalThis.__EVA_MAGI_THEME__;
						mounted = null;
					};
				},
				"eva-magi: alias token layer",
			);

			// 面板与 Console 共用当前有效选项。
			mounted = {
				version: "0.51.2",
				source: PACKAGE_NAME,
				options,
				palette: PALETTE,
				tokens: tokenLayer(),
				// Console 钩子与界面面板走同一条写入通道，不会有两套状态
				set: setOption,
				reset: resetAll,
				// 体检当前页面里的钩子命中情况（只读）
				diagnose,
			};
			globalThis.__EVA_MAGI_THEME__ = mounted;
		}

		exports.name = PACKAGE_NAME;
		exports.inject = inject;
		exports.apply = apply;
		exports.PALETTE = PALETTE;
		exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
		// 峰谷规则是纯函数，导出以便单测（测试台用已知时刻断言高峰/空闲）
		exports.pricingStateAt = pricingStateAt;
		exports.nextPricingChangeAt = nextPricingChangeAt;
		exports.createContourRenderer = createContourRenderer;
		return module.exports;
	},
});
