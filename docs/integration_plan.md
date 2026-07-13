# 日记系统功能整合开发计划

## 背景

当前存在两套系统：
- **原日记系统**：Node.js (3333端口)，数据源 `/home/ubuntu/logseq-notes`，493篇文章
- **新开发系统**：Python Flask (3339端口)，通过代理跳转方式提供服务

用户要求：将新功能**直接整合到原日记系统中**，而非代理跳转。

## 目标

将新系统功能（版本历史、AI摘要、标签建议、模板、日历、仪表盘）全部用Node.js实现，统一到3333端口。

---

## Phase 1: 数据层整合

### T1.1 扩展数据库Schema
- 在 `diary-graph.db` 中添加新表：
  - `memory_versions` - 版本历史
  - `templates` - 模板存储
  - `search_history` - 搜索历史
- 预计工作量：2小时

### T1.2 数据迁移
- 保持现有数据不变
- 新功能表初始化
- 预计工作量：1小时

---

## Phase 2: API层实现

### T2.1 版本历史API
- `POST /api/memories/:id/versions` - 保存版本
- `GET /api/memories/:id/versions` - 获取版本列表
- `GET /api/memories/:id/versions/:num` - 获取特定版本
- `POST /api/memories/:id/versions/:num/restore` - 恢复版本
- 预计工作量：3小时

### T2.2 AI摘要API
- `POST /api/memories/:id/summary` - 生成摘要
- `GET /api/daily-summary/:date` - 日摘要
- 需集成AI服务（已有ai-service.js）
- 预计工作量：3小时

### T2.3 标签建议API
- `POST /api/tags/suggest` - 标签建议
- 基于关键词匹配和常用标签统计
- 预计工作量：2小时

### T2.4 模板API
- `GET /api/templates` - 模板列表
- `POST /api/templates` - 创建模板
- `POST /api/templates/:id/apply` - 应用模板
- 预计工作量：2小时

### T2.5 统计仪表盘API
- `GET /api/dashboard/stats` - 统计数据
- 活跃天数、平均条数、频率分布
- 预计工作量：2小时

### T2.6 日历API
- `GET /api/calendar/:year/:month` - 月度数据
- 每日记录数量统计
- 预计工作量：1小时

---

## Phase 3: 前端整合

### T3.1 编辑器增强
- 在现有编辑器中添加：
  - 版本历史按钮
  - 标签建议按钮
  - AI摘要按钮
- 预计工作量：4小时

### T3.2 日历视图页面
- 新增 `calendar.html`
- 日历组件集成
- 点击日期跳转到对应文章
- 预计工作量：4小时

### T3.3 仪表盘页面
- 新增 `stats.html`
- 统计图表展示
- 使用Chart.js或类似库
- 预计工作量：4小时

### T3.4 模板管理页面
- 新增 `templates.html`
- 模板列表、创建、应用
- 预计工作量：3小时

### T3.5 导航整合
- 在左侧栏添加新功能入口（非跳转）
- 预计工作量：1小时

---

## Phase 4: 清理与部署

### T4.1 移除代理跳转
- 删除3339服务依赖
- 清理代理路由代码
- 预计工作量：1小时

### T4.2 停止3339服务
- 确认所有功能已迁移
- 停止Python服务
- 预计工作量：0.5小时

### T4.3 测试验证
- 功能完整性测试
- 性能测试
- 预计工作量：2小时

---

## 总工作量估算

| Phase | 任务数 | 预计时间 |
|-------|--------|----------|
| Phase 1 | 2 | 3小时 |
| Phase 2 | 6 | 13小时 |
| Phase 3 | 5 | 16小时 |
| Phase 4 | 3 | 3.5小时 |
| **总计** | **16** | **35.5小时** |

---

## 优先级排序

1. **高优先级**：版本历史、编辑器增强（T1.1, T2.1, T3.1）
2. **中优先级**：仪表盘、日历、标签建议（T2.5, T2.6, T2.3, T3.2, T3.3）
3. **低优先级**：模板、AI摘要、清理（T2.2, T2.4, T3.4, T4.x）

---

## 技术选型

- **后端**：Node.js + better-sqlite3（现有）
- **前端**：原生HTML/CSS/JS + Chart.js（图表）
- **AI服务**：复用现有 ai-service.js

---

## 开始日期

待用户确认后开始执行。

---

*创建时间：2026-05-18*
*状态：待审批*