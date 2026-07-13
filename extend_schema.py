#!/usr/bin/env python3
"""扩展日记系统数据库Schema"""

import sqlite3
import os

db_path = '/home/ubuntu/.openclaw/workspace/diary-server/diary-graph.db'

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("开始扩展Schema...")

# 1. 创建 memory_versions 表
cursor.execute('''
CREATE TABLE IF NOT EXISTS memory_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    summary TEXT,
    edited_by TEXT DEFAULT 'user',
    edit_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path, version_number)
)
''')
print("✅ memory_versions 表创建成功")

# 2. 创建 templates 表
cursor.execute('''
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    content TEXT NOT NULL,
    variables TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
)
''')
print("✅ templates 表创建成功")

# 3. 创建 search_history 表
cursor.execute('''
CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    result_count INTEGER,
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_session TEXT
)
''')
print("✅ search_history 表创建成功")

# 4. 创建 tag_stats_cache 表
cursor.execute('''
CREATE TABLE IF NOT EXISTS tag_stats_cache (
    tag TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    last_used TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
''')
print("✅ tag_stats_cache 表创建成功")

# 5. 创建索引
cursor.execute('CREATE INDEX IF NOT EXISTS idx_versions_file ON memory_versions(file_path)')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_versions_number ON memory_versions(file_path, version_number DESC)')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category)')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(searched_at DESC)')
print("✅ 索引创建成功")

# 6. 插入默认模板
templates_data = [
    ('日报模板', 'daily', '## 今日任务\n- [ ] 任务1\n\n## 今日记录\n{{content}}\n\n## 明日计划\n- [ ] ', '{"variables": ["content"]}'),
    ('周报模板', 'weekly', '## 本周总结\n- 完成事项：\n- 未完成事项：\n\n## 下周计划\n{{plans}}\n\n## 反思\n{{reflection}}', '{"variables": ["plans", "reflection"]}'),
    ('研究笔记', 'research', '## 研究主题\n{{topic}}\n\n## 核心观点\n{{points}}\n\n## 参考资料\n- {{references}}', '{"variables": ["topic", "points", "references"]}'),
    ('会议记录', 'general', '## 会议主题\n{{title}}\n\n## 参会人员\n{{participants}}\n\n## 会议内容\n{{content}}\n\n## 待办事项\n- {{actions}}', '{"variables": ["title", "participants", "content", "actions"]}')
]

for name, cat, content, vars in templates_data:
    cursor.execute('INSERT OR IGNORE INTO templates (name, category, content, variables) VALUES (?, ?, ?, ?)',
                   (name, cat, content, vars))

print("✅ 默认模板插入成功")

conn.commit()

# 验证结果
cursor.execute('SELECT name FROM sqlite_master WHERE type="table"')
tables = [t[0] for t in cursor.fetchall()]
print("\n所有表:", tables)

cursor.execute('SELECT name, category FROM templates WHERE is_active=1')
print("默认模板:", cursor.fetchall())

conn.close()
print("\n✅ T1.1 Schema扩展完成！")