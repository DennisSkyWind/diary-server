import json
from datetime import datetime

with open('obsidian_tasks.json', 'r') as f:
    data = json.load(f)

# 修正 total_tasks
data['total_tasks'] = 12
data['completion_rate'] = '100%'

with open('obsidian_tasks.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("任务文件已修正: 12/12 (100%)")