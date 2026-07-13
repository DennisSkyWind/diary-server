-- 日记系统功能扩展 Schema
-- 创建时间: 2026-05-18

-- =====================================================
-- 1. 版本历史表 (memory_versions)
-- =====================================================
CREATE TABLE IF NOT EXISTS memory_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,              -- 文件路径（对应graph_nodes）
    version_number INTEGER NOT NULL,      -- 版本号
    title TEXT,                           -- 标题
    content TEXT,                         -- 内容快照
    summary TEXT,                         -- 摘要
    edited_by TEXT DEFAULT 'user',        -- 编辑者
    edit_reason TEXT,                     -- 编辑原因
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path, version_number)     -- 同一文件版本号唯一
);

-- 版本历史索引
CREATE INDEX IF NOT EXISTS idx_versions_file ON memory_versions(file_path);
CREATE INDEX IF NOT EXISTS idx_versions_number ON memory_versions(file_path, version_number DESC);

-- =====================================================
-- 2. 模板表 (templates)
-- =====================================================
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                   -- 模板名称
    category TEXT DEFAULT 'general',      -- 分类：general, daily, weekly, research
    content TEXT NOT NULL,                -- 模板内容（Markdown）
    variables TEXT,                       -- 变量定义（JSON格式）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1           -- 是否启用
);

-- 模板索引
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_active ON templates(is_active);

-- =====================================================
-- 3. 搜索历史表 (search_history)
-- =====================================================
CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,                  -- 搜索关键词
    result_count INTEGER,                 -- 结果数量
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_session TEXT                     -- 用户会话标识
);

-- 搜索历史索引
CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(searched_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_query ON search_history(query);

-- =====================================================
-- 4. 标签统计缓存表 (tag_stats_cache)
-- =====================================================
CREATE TABLE IF NOT EXISTS tag_stats_cache (
    tag TEXT PRIMARY KEY,                 -- 标签名
    count INTEGER DEFAULT 0,              -- 使用次数
    last_used TIMESTAMP,                  -- 最后使用时间
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 5. 默认模板数据
-- =====================================================
INSERT INTO templates (name, category, content, variables) VALUES
('日报模板', 'daily', 
'## 今日任务
- [ ] 任务1
- [ ] 任务2

## 今日记录
{{content}}

## 明日计划
- [ ] ',
'{"variables": ["content"]}'),

('周报模板', 'weekly',
'## 本周总结
- 完成事项：
- 未完成事项：

## 下周计划
{{plans}}

## 反思
{{reflection}}',
'{"variables": ["plans", "reflection"]}'),

('研究笔记', 'research',
'## 研究主题
{{topic}}

## 核心观点
{{points}}

## 参考资料
- {{references}}',
'{"variables": ["topic", "points", "references"]}');

-- =====================================================
-- 6. 视图：文件版本统计
-- =====================================================
CREATE VIEW IF NOT EXISTS v_file_version_stats AS
SELECT 
    file_path,
    COUNT(*) as version_count,
    MAX(version_number) as latest_version,
    MIN(created_at) as first_version,
    MAX(created_at) as last_version
FROM memory_versions
GROUP BY file_path;