# 📝 Diary Server - 智能日记管理系统

一个功能丰富的个人日记管理系统，支持 AI 摘要、知识图谱、Markdown 编辑、数据仪表盘等。

## ✨ 功能特性

### 📖 日记管理
- **Markdown 编辑**：纯文本 Markdown 格式，数据永远属于你
- **目录树浏览**：按年/月/日自动归档
- **虚拟文件夹**：跨目录组织日记，支持收藏、分类
- **全文搜索**：快速检索日记内容

### 🤖 AI 智能功能
- **AI 摘要**：一键生成日记摘要
- **AI 语义搜索**：基于 LLM 的语义检索
- **AI 润色**：多种风格润色文本
- **AI 智能分类**：自动按主题归档日记
- 支持多种 LLM 提供商：OpenAI / DashScope / DeepSeek / 自定义

### 🕸️ 知识图谱
- **自动实体提取**：从日记内容中提取实体和关系
- **可视化网络图**：交互式知识图谱浏览
- **双向链接**：日记间的引用关系
- **知识缺口检测**：发现待深入的主题
- **置信度评分**：节点信息质量评估

### 📊 数据仪表盘
- **日记统计**：写作频率、活跃天数
- **数据源集成**：查看股票、日程、健康等数据
- **过期页面检测**：提醒更新陈旧内容
- **维护工具**：批量归档、清理

### 📤 分享与备份
- **微博发布**：选择日记内容发布到微博
- **百度网盘备份**：自动备份到云端

## 🚀 快速开始

### 方式一：本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/DennisSkyWind/diary-server.git
cd diary-server

# 2. 安装依赖
npm install

# 3. 生成演示数据
python3 generate-demo-data.py

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置 DIARY_DIR 和 AI_API_KEY

# 5. 启动服务
npm start
```

访问 http://localhost:3333 即可使用。

### 方式二：Docker 部署

```bash
# 构建并运行
docker build -t diary-server .
docker run -d \
  -p 3333:3333 \
  -v /path/to/your/diary:/app/data/diary \
  -e AI_API_KEY=your-api-key \
  --name diary \
  diary-server
```

### 方式三：一键启动（带演示数据）

```bash
npm run setup && npm start
```

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3333 | 服务端口 |
| `DIARY_DIR` | ./data/diary | 日记文件目录 |
| `COPAW_DIR` | ./data | 数据文件目录 |
| `AI_API_KEY` | - | AI 服务 API Key |
| `AI_PROVIDER` | openai | AI 服务提供商 |
| `PYTHON_PATH` | python3 | Python 路径 |

### AI 配置

复制 `ai-config.json.example` 为 `ai-config.json`，填入你的 API Key：

```bash
cp ai-config.json.example ai-config.json
```

支持以下 AI 提供商：
- **OpenAI**：GPT-4o-mini, GPT-4o
- **阿里云 DashScope**：Qwen-Turbo, Qwen-Plus, Qwen-Max
- **DeepSeek**：DeepSeek-Chat, DeepSeek-Coder
- **自定义**：任何 OpenAI 兼容 API

## 📁 目录结构

```
diary-server/
├── index.js              # 后端服务主文件
├── ai-service.js         # AI 服务模块
├── index.html            # 主编辑器界面
├── dashboard.html        # 数据仪表盘
├── settings.html         # 设置页面
├── schema.json           # Schema 定义
├── generate-demo-data.py # 演示数据生成
├── Dockerfile            # Docker 部署
├── .env.example          # 环境变量模板
├── ai-config.json.example # AI 配置模板
├── package.json
└── data/
    └── diary/            # 日记文件（Markdown）
        └── 2026/
            └── 01/
                └── 2026-01-15.md
```

## 🗺️ API 概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/tree` | GET | 文件目录树 |
| `/api/file` | GET | 读取文件内容 |
| `/api/save` | POST | 保存文件 |
| `/api/search` | GET | 全文搜索 |
| `/api/ai/summary` | POST | AI 摘要 |
| `/api/ai/search` | POST | AI 语义搜索 |
| `/api/graph/network` | GET | 知识图谱数据 |
| `/api/graph/stats` | GET | 图谱统计 |
| `/api/stats` | GET | 日记统计 |
| `/api/maintenance/stale` | GET | 过期页面检测 |
| `/api/bookmarks` | GET | 收藏列表 |

完整 API 文档请访问 `/api/health` 获取服务状态。

## 📄 日记格式

日记使用 Markdown 格式，支持 YAML Front Matter：

```markdown
# 周末读书

date: 2026-02-20
tags: [读书, 学习]
confidence: 0.8
freshness: current

今天读了《原子习惯》的几个章节...
```

### Front Matter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | string | 日期 |
| `tags` | array | 标签列表 |
| `confidence` | float | 信息置信度 (0-1) |
| `freshness` | string | 新鲜度等级 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📜 License

MIT License