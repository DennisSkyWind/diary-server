# 📓 Diary Server - 智能日记管理系统

[English](#english) | [中文](#中文)

---

<a id="中文"></a>

## 中文

一个基于 Node.js 的智能日记管理系统，集成 AI 摘要、知识图谱、多层记忆架构，让日记不仅是记录，更是你的**第二大脑**。

### ✨ 核心特性

- 📝 **Markdown 日记** — 所见即所得编辑，支持 frontmatter 元数据
- 🤖 **AI 智能** — 自动摘要、润色、分类、标签建议、关联推荐（流式输出）
- 🕸️ **知识图谱** — 自动构建日记间的关联关系，可视化知识网络
- 🔍 **多维搜索** — 全文搜索 + 标签搜索 + AI 语义搜索
- 🧠 **多层记忆** — 即时记忆(Memos) → 工作记忆(日记) → 长期记忆(memory.db)
- 🏥 **健康维护** — 过期页面检测、孤立页面发现、知识缺口分析、置信度评估
- 📊 **数据仪表盘** — 统计概览、数据源可视化
- 📁 **虚拟文件夹** — 灵活的文件组织，支持手动/AI/系统自动分类
- 🔖 **书签系统** — 快速收藏重要日记
- 📋 **模板系统** — 预设模板快速创建日记
- 📌 **微博发布** — 一键分享到微博
- ☁️ **百度网盘备份** — 自动云端备份

### 🏗️ 系统架构

```
┌──────────────────────────────────────────────────────┐
│                   Diary Server (Node.js)              │
│                      端口: 3333                       │
├──────────┬──────────┬──────────┬─────────────────────┤
│  文件管理  │  AI 智能   │  知识图谱  │  健康维护           │
│  CRUD/树  │  摘要/润色  │  节点/边   │  过期/孤立/缺口      │
├──────────┴──────────┴──────────┴─────────────────────┤
│              多层记忆系统 (multi-layer-memory)          │
├──────────┬──────────┬──────────┬─────────────────────┤
│  即时记忆  │  工作记忆  │  长期记忆  │  关联图谱           │
│  Memos   │  日记文件  │  memory.db│  diary-graph.db     │
└──────────┴──────────┴──────────┴─────────────────────┘
```

### 📊 分层记忆优化

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 进程守护 + 标签清洗 + 重要性重算 | ✅ 完成 |
| Phase 2 | 关系类型丰富化 + 引用转化 + 时间边构建 | ✅ 完成 |
| Phase 3 | Memos同步 + 长期记忆提炼 + 向量嵌入 | 🚧 进行中 |

**图谱数据：** 571 节点 / 1627 边（references 762 + tag 638 + mention 126 + time 101）

**记忆数据：** 878 条记忆 / 4 种关系类型（time/related/similar/references）/ ⭐1-5 重要性分层

### 🚀 快速开始

#### 环境要求

- Node.js >= 18
- npm
- SQLite3 (better-sqlite3)

#### 安装

```bash
git clone https://github.com/DennisSkyWind/diary-server.git
cd diary-server
npm install
```

#### 配置

复制 example 文件并填入你的配置：

```bash
# AI 配置（必填 - 需要大模型 API Key）
cp ai-config.json.example ai-config.json
# 编辑 ai-config.json，填入你的 API Key

# 数据源配置（可选）
cp data-sources.json.example data-sources.json

# 虚拟文件夹配置（可选）
cp virtual-folders.json.example virtual-folders.json

# 微博发布配置（可选）
cp weibo-config.json.example weibo-config.json
```

#### 启动

```bash
node index.js
```

访问 `http://localhost:3333` 即可使用。

#### 进程守护

```bash
# 使用 nohup
nohup node index.js > /tmp/diary.log 2>&1 &

# 或使用提供的守护脚本
chmod +x daemon.sh
./daemon.sh
```

### 📡 API 概览

系统提供 88 个 API 接口，主要分类：

| 分类 | 数量 | 说明 |
|------|------|------|
| 文件管理 | 9 | CRUD、目录树、移动、统计 |
| AI 智能 | 12 | 摘要、润色、分类、标签、关联（支持流式） |
| 知识图谱 | 5 | 构建、统计、网络、反向链接 |
| 搜索 | 2 | 全文搜索、标签建议 |
| 健康维护 | 6 | 过期页面、孤立页面、知识缺口、置信度 |
| 其他 | 54 | 书签、模板、版本、虚拟文件夹、仪表盘等 |

详细 API 文档请参考源码 `index.js`。

### 📁 项目结构

```
diary-server/
├── index.js              # 主服务（5327行，含所有API和前端路由）
├── ai-service.js         # AI 服务（811行，摘要/润色/分类/标签）
├── index.html            # 主页面（Markdown编辑器+搜索+图谱）
├── dashboard.html        # 仪表盘页面
├── data-viewer.html      # 数据源查看器
├── settings.html         # 设置页面
├── report-viewer.html    # 报告查看器
├── config-sources.html   # 数据源配置页面
├── schema.json           # Schema 定义
├── daemon.sh             # 进程守护脚本
├── docs/                 # 开发文档
├── ai-config.json.example    # AI 配置模板
├── data-sources.json.example # 数据源配置模板
├── virtual-folders.json.example # 虚拟文件夹配置模板
└── weibo-config.json.example   # 微博配置模板
```

### 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 📄 许可证

ISC License

---

<a id="english"></a>

## English

A Node.js-based intelligent diary management system with AI summarization, knowledge graph, and multi-layer memory architecture — turning your diary into a **second brain**.

### ✨ Key Features

- 📝 **Markdown Diary** — WYSIWYG editing with frontmatter metadata support
- 🤖 **AI Intelligence** — Auto summary, polish, classification, tag suggestion, association recommendation (streaming)
- 🕸️ **Knowledge Graph** — Auto-build relationships between entries, visualize knowledge network
- 🔍 **Multi-dimensional Search** — Full-text + tag + AI semantic search
- 🧠 **Multi-layer Memory** — Instant(Memos) → Working(Diary) → Long-term(memory.db)
- 🏥 **Health Maintenance** — Stale page detection, orphan discovery, knowledge gap analysis, confidence assessment
- 📊 **Dashboard** — Statistics overview, data source visualization
- 📁 **Virtual Folders** — Flexible organization with manual/AI/system auto-classification
- 🔖 **Bookmarks** — Quick-save important entries
- 📋 **Templates** — Pre-set templates for fast entry creation
- 📌 **Weibo Publishing** — One-click sharing to Weibo
- ☁️ **Baidu Cloud Backup** — Automatic cloud backup

### 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Diary Server (Node.js)              │
│                      Port: 3333                       │
├──────────┬──────────┬──────────┬─────────────────────┤
│ File Mgmt │  AI Svc   │  Graph    │  Health            │
│ CRUD/Tree │ Sum/Polish│ Node/Edge │ Stale/Orphan/Gap   │
├──────────┴──────────┴──────────┴─────────────────────┤
│           Multi-layer Memory System                    │
├──────────┬──────────┬──────────┬─────────────────────┤
│  Instant  │  Working  │ Long-term │  Association       │
│  Memos    │  Diaries  │ memory.db │ diary-graph.db     │
└──────────┴──────────┴──────────┴─────────────────────┘
```

### 📊 Memory Optimization Phases

| Phase | Content | Status |
|-------|---------|--------|
| Phase 1 | Process daemon + Tag cleanup + Importance recalculation | ✅ Done |
| Phase 2 | Relationship enrichment + Mention conversion + Time edge construction | ✅ Done |
| Phase 3 | Memos sync + Long-term memory distillation + Vector embeddings | 🚧 In Progress |

**Graph Data:** 571 nodes / 1627 edges (references 762 + tag 638 + mention 126 + time 101)

**Memory Data:** 878 memories / 4 relationship types (time/related/similar/references) / ⭐1-5 importance layers

### 🚀 Quick Start

#### Prerequisites

- Node.js >= 18
- npm
- SQLite3 (better-sqlite3)

#### Installation

```bash
git clone https://github.com/DennisSkyWind/diary-server.git
cd diary-server
npm install
```

#### Configuration

Copy example files and fill in your settings:

```bash
# AI config (required - needs LLM API Key)
cp ai-config.json.example ai-config.json
# Edit ai-config.json with your API Key

# Data sources (optional)
cp data-sources.json.example data-sources.json

# Virtual folders (optional)
cp virtual-folders.json.example virtual-folders.json

# Weibo publishing (optional)
cp weibo-config.json.example weibo-config.json
```

#### Run

```bash
node index.js
```

Visit `http://localhost:3333` to start using.

#### Process Daemon

```bash
# Using nohup
nohup node index.js > /tmp/diary.log 2>&1 &

# Or use the provided daemon script
chmod +x daemon.sh
./daemon.sh
```

### 📡 API Overview

88 API endpoints in total:

| Category | Count | Description |
|----------|-------|-------------|
| File Management | 9 | CRUD, directory tree, move, stats |
| AI Intelligence | 12 | Summary, polish, classify, tags, association (streaming) |
| Knowledge Graph | 5 | Build, stats, network, backlinks |
| Search | 2 | Full-text, tag suggestion |
| Health | 6 | Stale pages, orphans, knowledge gaps, confidence |
| Others | 54 | Bookmarks, templates, versions, virtual folders, dashboard, etc. |

See source code `index.js` for detailed API documentation.

### 📁 Project Structure

```
diary-server/
├── index.js              # Main server (5327 lines, all APIs & frontend routes)
├── ai-service.js         # AI service (811 lines, summary/polish/classify/tag)
├── index.html            # Main page (Markdown editor + search + graph)
├── dashboard.html        # Dashboard page
├── data-viewer.html      # Data source viewer
├── settings.html         # Settings page
├── report-viewer.html    # Report viewer
├── config-sources.html   # Data source config page
├── schema.json           # Schema definition
├── daemon.sh             # Process daemon script
├── docs/                 # Development docs
├── ai-config.json.example    # AI config template
├── data-sources.json.example # Data sources template
├── virtual-folders.json.example # Virtual folders template
└── weibo-config.json.example   # Weibo config template
```

### 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### 📄 License

ISC License
