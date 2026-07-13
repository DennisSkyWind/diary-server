# 日记系统与 Obsidian 功能对比分析

## 一、Obsidian 核心功能清单

基于 Obsidian 2026 Core Plugins 评级：

### S Tier (最重要)
| 功能 | 描述 |
|------|------|
| **Canvas** | 无限画布，可视化组织笔记，支持卡片、连线、嵌入 |
| **Bases** | 数据库视图，类似 Notion 表格，属性过滤排序 |

### A Tier
| 功能 | 描述 |
|------|------|
| **Daily Notes** | 每日笔记，自动创建日期命名的笔记 |
| **Templates** | 模板系统，快速应用预设内容 |
| **Command Palette** | 快捷命令面板 (⌘P/⌃P) |
| **Sync** | 官方同步服务 |
| **Publish** | 发布到公开网站 |

### B Tier
| 功能 | 描述 |
|------|------|
| **Backlinks** | 反向链接，显示哪些笔记引用当前笔记 |
| **Graph View** | 知识图谱，可视化笔记关系网络 |
| **Quick Switcher** | 快速切换文件 (⌘O/⌃O) |
| **Outline** | 大纲视图，显示笔记标题结构 |
| **Properties View** | 属性/元数据视图 |
| **Bookmarks** | 书签系统，收藏重要笔记 |
| **Note Composer** | 笔记组合/拆分，提取内容到新笔记 |
| **File Recovery** | 文件恢复/版本历史 |
| **Search** | 全文搜索 |

### C Tier
| 功能 | 描述 |
|------|------|
| **Tags View** | 标签视图，显示所有标签 |
| **Page Preview** | 页面悬浮预览，鼠标悬停显示链接内容 |
| **Outgoing Links** | 出向链接，显示当前笔记引用的其他笔记 |
| **Word Count** | 字数统计 |

---

## 二、当前日记系统已实现功能

### ✅ 已有的功能

| Obsidian功能 | 日记系统实现 | API/页面 |
|-------------|-------------|---------|
| Daily Notes | ✅ 日历视图 | `/api/calendar/:y/:m` |
| Templates | ✅ 模板系统 | `/api/templates`, `/api/templates/apply` |
| Backlinks | ✅ 反向链接 | `/api/backlinks`, `/api/backlinks/build` |
| Graph View | ✅ 知识图谱 | `/api/graph/network`, `/api/graph/stats` |
| Search | ✅ 全文搜索 | `/api/search` |
| File Recovery | ✅ 版本历史 | `/api/versions`, `/api/versions/:id/restore` |
| Tags View | ✅ 标签建议 | `/api/tags/suggest` |
| Properties | ✅ Frontmatter管理 | `/api/frontmatter/batch-update`, `/api/frontmatter/auto-infer` |
| Statistics | ✅ 统计仪表盘 | `/api/stats`, `/api/dashboard/stats` |

### 🚀 超出 Obsidian 的功能

| 功能 | 描述 | API |
|------|------|-----|
| **AI 摘要** | 自动生成笔记摘要 | `/api/ai/summary`, `/api/ai/summary/stream` |
| **AI 搜索** | 智能语义搜索 | `/api/ai/search` |
| **AI 润色** | 文字风格润色 | `/api/ai/polish/stream` |
| **AI 分类** | 自动分类建议 | `/api/ai/organize/classify` |
| **知识缺口分析** | 发现知识盲区 | `/api/gaps`, `/api/gaps/wizard` |
| **置信度管理** | 内容可信度评估 | `/api/confidence/report` |
| **自动研究** | 缺失内容自动补充 | `/api/research-on-miss` |
| **过期页面维护** | 自动清理过期内容 | `/api/maintenance/stale` |
| **虚拟文件夹** | 智能分类组织 | `/api/virtual-folders` |

---

## 三、缺少的关键功能

### 🔴 高优先级 (S/A Tier)

| 功能 | 重要性 | 实现难度 | 预计耗时 |
|------|--------|---------|---------|
| **Canvas 无限画布** | ⭐⭐⭐⭐⭐ | 高 | 8h |
| **Bases 数据库视图** | ⭐⭐⭐⭐⭐ | 高 | 6h |
| **Command Palette** | ⭐⭐⭐⭐ | 中 | 3h |
| **Quick Switcher** | ⭐⭐⭐⭐ | 低 | 2h |

### 🟡 中优先级 (B Tier)

| 功能 | 重要性 | 实现难度 | 预计耗时 |
|------|--------|---------|---------|
| **Outline 大纲视图** | ⭐⭐⭐ | 低 | 1.5h |
| **Outgoing Links** | ⭐⭐⭐ | 低 | 1h |
| **Bookmarks 书签** | ⭐⭐⭐ | 低 | 2h |
| **Page Preview** | ⭐⭐⭐ | 中 | 2h |
| **Note Composer** | ⭐⭐ | 中 | 3h |

### 🟢 低优先级 (C Tier)

| 功能 | 重要性 | 实现难度 | 颕计耗时 |
|------|--------|---------|---------|
| **Word Count** | ⭐ | 低 | 0.5h |

---

## 四、开发计划

### Phase 1: 基础交互增强 (预计 5.5h)

| ID | 任务 | 优先级 | 耗时 |
|---|------|--------|------|
| P1-1 | Quick Switcher 快速切换 (⌘K) | high | 2h |
| P1-2 | Command Palette 命令面板 | high | 3h |
| P1-3 | Word Count 字数统计 | low | 0.5h |

### Phase 2: 内容组织增强 (预计 4.5h)

| ID | 任务 | 优先级 | 耗时 |
|---|------|--------|------|
| P2-1 | Outline 大纲视图侧栏 | medium | 1.5h |
| P2-2 | Outgoing Links 出向链接视图 | medium | 1h |
| P2-3 | Bookmarks 书签系统 | medium | 2h |

### Phase 3: 可视化增强 (预计 2h)

| ID | 任务 | 优先级 | 耗时 |
|---|------|--------|------|
| P3-1 | Page Preview 悬浮预览 | medium | 2h |

### Phase 4: 核心功能 (预计 14h)

| ID | 任务 | 优先级 | 耗时 |
|---|------|--------|------|
| P4-1 | Canvas 无限画布基础 | high | 5h |
| P4-2 | Canvas 卡片/连线功能 | high | 3h |
| P4-3 | Bases 数据库视图 | high | 6h |

### Phase 5: 笔记操作增强 (预计 3h)

| ID | 任务 | 优先级 | 耗时 |
|---|------|--------|------|
| P5-1 | Note Composer 拆分笔记 | medium | 1.5h |
| P5-2 | Note Composer 合并笔记 | medium | 1.5h |

---

## 五、总览

| 指标 | 数值 |
|------|------|
| **总任务数** | 14 |
| **总耗时** | 29h |
| **高优先级** | 6 任务 |
| **中优先级** | 6 任务 |
| **低优先级** | 2 任务 |

### 推荐执行顺序

```
Phase 1 (基础交互) → Phase 2 (内容组织) → Phase 3 (可视化) → Phase 5 (笔记操作) → Phase 4 (核心功能)
```

**建议先完成 Phase 1-3**，快速提升日常使用体验。
**Phase 4 Canvas/Bases** 为大型功能，可单独迭代。

---

## 六、实现方式确认 ⚠️ 重要

### 核心原则

**所有功能都在原有日记系统（3333端口）中集成实现，不新建独立系统。**

### 技术实现方案

| 功能 | 实现位置 | 实现方式 |
|------|---------|---------|
| **Quick Switcher** | index.html + index.js | 添加全局弹窗组件 `<div id="quick-switcher-modal">`，绑定 `⌘K` 快捷键，调用现有 `/api/search` |
| **Command Palette** | index.html + index.js | 添加全局弹窗 `<div id="command-palette-modal">`，绑定 `⌘P` 快捷键，列出所有功能命令 |
| **Word Count** | index.html | 编辑器底部 `<span id="word-count">`，实时统计字数 |
| **Outline 大纲视图** | index.html + index.js | 添加右侧栏 `<div id="outline-panel">`，解析当前笔记的 `# ## ###` 标题结构 |
| **Outgoing Links** | index.html + index.js | 右侧栏面板，调用现有 `/api/backlinks` 反向获取出向链接 |
| **Bookmarks** | index.js + diary-graph.db | 新增 `bookmarks` 表，左侧栏添加「⭐ 书签」按钮，新增 `/api/bookmarks` API |
| **Page Preview** | index.html + index.js | 在预览区链接添加 `mouseenter` 事件，显示悬浮 `<div id="page-preview-tooltip">` |
| **Canvas 无限画布** | 新建 canvas.html (同目录) | 独立页面，但同一端口访问 `/canvas.html`，新增 `/api/canvas/*` API，数据存入 `diary-graph.db` |
| **Bases 数据库视图** | 新建 bases.html (同目录) | 独立页面，但同一端口访问 `/bases.html`，基于现有 frontmatter 属性，新增 `/api/bases/*` API |
| **Note Composer** | index.html + index.js | 编辑器工具栏添加「提取」「合并」按钮，调用现有 `/api/create-file` + `/api/save` |

### 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| **index.html** | 添加弹窗组件、右侧栏、快捷键绑定、按钮 |
| **index.js** | 添加新API端点、快捷键处理、弹窗逻辑 |
| **diary-graph.db** | 新增 `bookmarks`、`canvas_cards`、`canvas_connections` 表（按需） |
| **canvas.html** | 新建画布页面（Phase 4） |
| **bases.html** | 新建数据库视图页面（Phase 4） |

### 端口与服务

- **唯一端口**: 3333
- **唯一服务**: `/home/ubuntu/.openclaw/workspace/diary-server/index.js`
- **数据源**: `/home/ubuntu/logseq-notes`
- **数据库**: `/home/ubuntu/.openclaw/workspace/diary-server/diary-graph.db`

### 不创建的内容

- ❌ 不创建新的独立服务
- ❌ 不创建新的端口（如3334）
- ❌ 不创建新的数据库
- ❌ 不创建新的部署流程

---

## 七、现有系统架构

```
┌─────────────────────────────────────────────────────────┐
│  index.html (3333端口)                                   │
├────────────┬──────────────────────────┬─────────────────┤
│  左侧栏     │  主编辑区                  │  右侧栏(待添加)  │
│  #sidebar  │  #main                    │  #outline-panel │
│            │  ├─ #toolbar              │                 │
│  ├─目录树   │  ├─ #fm-info-bar          │  ├─大纲         │
│  ├─虚拟视图 │  ├─ #editor               │  ├─出向链接     │
│  ├─图谱按钮 │  │   ├─ #markdown-input   │  └─书签列表     │
│  ├─新功能   │  │   └─ #preview          │                 │
│  │  日历    │                           │                 │
│  │  仪表盘  │                           │                 │
│  │  模板    │                           │                 │
│  │  图谱    │                           │                 │
└────────────┴──────────────────────────┴─────────────────┘
```

**弹窗组件（全局）：**
- `#quick-switcher-modal` - 快速切换
- `#command-palette-modal` - 命令面板
- `#page-preview-tooltip` - 悬浮预览

---

## 八、开发前备份确认 ✅

**备份时间**: 2026-05-19 10:33:15

| 文件 | 备份路径 | 大小 |
|------|---------|------|
| index.html | backups/index.html.bak_20260519_103315 | 166KB |
| index.js | backups/index.js.bak_20260519_103315 | 196KB |
| diary-graph.db | backups/diary-graph.db.bak_20260519_103315 | 2.99MB |

**恢复方式**: `cp backups/index.html.bak_20260519_103315 index.html`

---

*确认时间: 2026-05-19*
*备份完成: 2026-05-19 10:33:15*
*实现方式: 集成到原有日记系统，不新建独立系统*