import json
from datetime import datetime

with open('obsidian_tasks.json', 'r') as f:
    data = json.load(f)

now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

# 更新 P4-1, P4-2, P4-3 为 completed
for task in data['tasks']:
    if task['id'] in ['P4-1', 'P4-2', 'P4-3']:
        task['status'] = 'completed'
        task['completed_at'] = now

# 更新统计
completed = sum(1 for t in data['tasks'] if t['status'] == 'completed')
data['completed'] = completed
data['completion_rate'] = f'{completed}/{data["total_tasks"]}'

with open('obsidian_tasks.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"任务状态已更新: {completed}/14 完成")