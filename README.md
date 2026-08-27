# ModHeader

一个轻量级的 Chrome 和 Firefox 浏览器扩展（Manifest V3），用于便捷地修改 HTTP 请求和响应头，以及覆盖 URL 查询参数。支持多 Profile、URL 过滤器以及多种操作方式。

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)
![Firefox Extension](https://img.shields.io/badge/Firefox-Extension-orange)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)

## 功能特性

- **多 Profile 管理** — 创建多个独立的 Header 配置，随时切换、复制或删除
- **请求 / 响应 Header 编辑** — 分别管理 Request 和 Response Header，支持 `Set`、`Append`、`Remove` 三种操作
- **URL 查询参数覆盖** — 修改请求 URL 上的查询参数，支持 `Set`（添加或替换）、`Replace`（仅替换已存在的参数）、`Remove`（删除参数）三种操作
- **URL 过滤器** — 通过通配符或正则表达式精确控制规则生效范围，留空则对所有 URL 生效
- **逐条开关** — 全局、Profile、单条规则三个层级的启用/禁用控制
- **导出 / 导入** — 将所有 Profile 导出为 JSON 文件，或从文件导入
- **标签页全屏编辑** — 弹窗底部提供「Open in tab」按钮，可在新标签页中编辑 Profile，布局自适应
- **实时规则统计** — Header 栏显示当前生效的规则数量
- **深色主题** — 精心设计的深色 UI，保护眼睛

## 构建与安装

为了在 Chrome 和 Firefox 中均保持零警告警告，推荐通过脚本为各浏览器构建专属目录包：

```bash
node build.js
```
运行后会在项目下生成 `dist/` 文件夹：
- `dist/chrome/` — Chrome 专属版本（无 `'background.scripts'` 警告）
- `dist/firefox/` — Firefox 专属版本

### Chrome 浏览器
1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目下的 `dist/chrome` 目录

### Firefox 浏览器
1. 打开 Firefox，访问 `about:debugging#/runtime/this-firefox`
2. 点击右上角的 **Load Temporary Add-on...**（加载临时附加组件...）
3. 选择本项目下的 `dist/firefox/manifest.json` 文件

## 使用方法

### 基本操作

| 操作 | 说明 |
|------|------|
| 添加 Profile | 点击 Profile 栏右侧的 `+` 按钮 |
| 切换 Profile | 点击对应的 Profile 标签页 |
| 重命名 Profile | 鼠标悬停在 Profile 标签上，点击出现的编辑图标 |
| 删除 Profile | 点击「Delete profile」按钮 |
| 复制 Profile | 点击底部工具栏的「Clone」按钮 |

### Header 编辑

1. 选择目标 Profile
2. 在 **Request** 或 **Response** 标签页下，点击 **Add** 按钮添加 Header
3. 填写 Header 名称和值，选择操作类型：
   - **Set** — 设置（覆盖）Header 值
   - **Append** — 追加 Header 值
   - **Remove** — 移除指定 Header
4. 通过左侧开关单独控制每条 Header 的启用状态

### URL 查询参数覆盖

在 **Params** 标签页中修改请求 URL 上的查询参数：

1. 选择目标 Profile，点击 **Add Query Param** 添加参数
2. 填写参数名和值，选择操作类型：
   - **Set** - 参数存在则替换，不存在则添加
   - **Replace** - 仅当参数已存在时替换，不存在则忽略
   - **Remove** - 删除该参数的所有出现
3. 参数名和值需为 ASCII，且不能包含空格、`&` 或 `#`

### URL 过滤器

在 **URL Filters** 标签页中添加匹配规则：

- 通配符格式：`||example.com^` 或 `*://api.example.com/*`
- 正则表达式格式：`.*\.example\.com`（需点击 `.*` 按钮启用正则模式）
- 留空则对所有 URL 生效

### 导出 / 导入

- **导出**：点击底部「Export」按钮，下载 `modheader-profiles-YYYY-MM-DD.json`
- **导入**：点击底部「Import」按钮，选择之前导出的 JSON 文件

### 全屏编辑

点击底部工具栏的「**Open in tab**」按钮，在浏览器新标签页中打开编辑器。标签页模式下：
- 布局自适应窗口宽度
- 导航栏固定在顶部
- Header 列表区域自动扩展，适合大量编辑

## 技术实现

- **Chrome API**：`declarativeNetRequest`（动态规则）、`storage.local`、`action`
- **数据同步**：Popup 与 Tab 编辑器通过 `chrome.storage.onChanged` 实时双向同步
- **布局自适应**：通过 CSS `@media` 媒体查询，弹窗保持 560px 固定宽度，标签页自动适配全屏

## 项目结构

```
ModHeader/
├── manifest.json          # Chrome 扩展清单（Manifest V3）
├── background.js          # Service Worker — 规则构建与动态更新
├── popup/
│   ├── popup.html         # 弹窗 / 标签页编辑器页面
│   ├── popup.css          # 样式（含响应式媒体查询）
│   └── popup.js           # UI 逻辑、数据管理与存储
└── README.md
```

## License

MIT
