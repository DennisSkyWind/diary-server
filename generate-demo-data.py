#!/usr/bin/env python3
"""生成演示数据 - 日记系统开源版"""
import sqlite3
import os
import json
from datetime import datetime, timedelta

db_path = os.path.join(os.path.dirname(__file__), 'diary-graph.db')
if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
c = conn.cursor()

# 创建表
c.execute('''CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    type TEXT DEFAULT 'topic',
    category TEXT,
    description TEXT,
    confidence REAL DEFAULT 0.5,
    freshness_tier TEXT DEFAULT 'standard',
    last_updated TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    metadata TEXT
)''')

c.execute('''CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation TEXT DEFAULT 'related',
    weight REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES nodes(id),
    FOREIGN KEY (target_id) REFERENCES nodes(id)
)''')

c.execute('''CREATE TABLE IF NOT EXISTS backlinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_page TEXT NOT NULL,
    target_page TEXT NOT NULL,
    context TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)''')

# 插入演示节点
demo_nodes = [
    ('日记系统', 'topic', '产品', '个人日记管理系统', 0.9, 'permanent'),
    ('AI摘要', 'feature', '技术', 'AI自动生成日记摘要', 0.8, 'current'),
    ('知识图谱', 'feature', '技术', '日记内容的可视化知识图谱', 0.85, 'current'),
    ('Markdown', 'format', '技术', 'Markdown格式日记文件', 0.7, 'permanent'),
    ('每日记录', 'habit', '生活', '每天坚持写日记', 0.6, 'current'),
    ('项目开发', 'topic', '工作', '软件开发项目', 0.75, 'fast'),
    ('读书笔记', 'topic', '学习', '阅读书籍的笔记', 0.65, 'moderate'),
    ('旅行', 'topic', '生活', '旅行见闻和攻略', 0.5, 'moderate'),
]

for label, ntype, cat, desc, conf, freshness in demo_nodes:
    c.execute('INSERT INTO nodes (label, type, category, description, confidence, freshness_tier) VALUES (?,?,?,?,?,?)',
              (label, ntype, cat, desc, conf, freshness))

# 插入演示边
demo_edges = [
    (1, 2, 'provides'),   # 日记系统 -> AI摘要
    (1, 3, 'provides'),   # 日记系统 -> 知识图谱
    (1, 4, 'uses'),       # 日记系统 -> Markdown
    (5, 1, 'uses'),       # 每日记录 -> 日记系统
    (6, 5, 'motivates'),  # 项目开发 -> 每日记录
    (7, 4, 'uses'),       # 读书笔记 -> Markdown
    (8, 5, 'motivates'),  # 旅行 -> 每日记录
]

for source, target, relation in demo_edges:
    c.execute('INSERT INTO edges (source_id, target_id, relation) VALUES (?,?,?)',
              (source, target, relation))

conn.commit()
print(f"✅ 演示数据库已生成: {db_path}")
print(f"   节点: {demo_nodes.__len__()}, 边: {demo_edges.__len__()}")

# 创建演示日记目录
diary_dir = os.path.join(os.path.dirname(__file__), 'data', 'diary')
os.makedirs(diary_dir, exist_ok=True)

# 生成演示日记文件
demo_entries = [
    ('2026-01-15', '日记系统开发', '今天完成了日记系统的知识图谱功能，可以自动从日记中提取实体和关系。AI摘要功能也基本稳定了。'),
    ('2026-02-20', '周末读书', '读了《原子习惯》的几个章节，觉得微习惯的概念很有道理。每天写日记本身就是一种微习惯。'),
    ('2026-03-10', '项目里程碑', '日记系统V2发布了！新增了AI智能分类、知识图谱、数据仪表盘等功能。'),
    ('2026-04-05', '春游', '今天去了公园，樱花开了很美。用日记系统记录了今天的见闻。'),
    ('2026-05-01', '劳动节', '假期在家优化了日记系统的性能，图谱加载速度提升了3倍。'),
]

for date, title, content in demo_entries:
    year, month, day = date.split('-')
    month_dir = os.path.join(diary_dir, year, month)
    os.makedirs(month_dir, exist_ok=True)
    filepath = os.path.join(month_dir, f'{date}.md')
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(f'# {title}\n\ndate: {date}\ntags: [{title.split()[0]}]\nconfidence: 0.8\nfreshness: current\n\n{content}\n')

print(f"✅ 演示日记已生成: {diary_dir}")
print(f"   日记文件: {len(demo_entries)}")

conn.close()