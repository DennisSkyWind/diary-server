#!/bin/bash
# 日记系统同步到GitHub开源仓库
# 用法: bash sync-to-github.sh "提交说明"

SRC=/home/ubuntu/.openclaw/workspace/diary-server
DST=/home/ubuntu/diary-open-source

if [ -z "$1" ]; then
  echo "用法: bash sync-to-github.sh \"提交说明\""
  exit 1
fi

echo "=== 同步日记系统到GitHub ==="

# 同步核心文件
for f in index.js index.html dashboard.html settings.html data-viewer.html config-sources.html report-viewer.html ai-service.js schema.json post-weibo.py schema_extension.sql; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$DST/$f"
    echo "✅ $f"
  fi
done

# 清除硬编码路径
echo ""
echo "🧹 清除硬编码路径..."
cd "$DST"

# 替换 /home/ubuntu 路径为环境变量（在index.js中）
python3 -c "
import re

# index.js 路径清理
with open('index.js', 'r') as f:
    content = f.read()

# DIARY_DIR 硬编码
content = content.replace(\"const DIARY_DIR = '/home/ubuntu/logseq-notes';\", \"const DIARY_DIR = process.env.DIARY_DIR || path.join(__dirname, 'data', 'diary');\")

# 其他 /home/ubuntu 路径
content = content.replace(\"/home/ubuntu/.local/bin/bdpan\", \"process.env.BDPAN_PATH || 'bdpan'\")
content = content.replace(\"/home/ubuntu/.copaw/data/\", \"path.join(COPAW_DIR, 'data/')\" )
content = content.replace(\"/home/ubuntu/.openclaw/workspace/data/\", \"path.join(OPENCLAW_DIR, 'data/')\")
content = content.replace(\"/home/ubuntu/logseq-notes\", \"process.env.DIARY_DIR || path.join(__dirname, 'data', 'diary')\")

with open('index.js', 'w') as f:
    f.write(content)

# post-weibo.py 路径清理  
with open('post-weibo.py', 'r') as f:
    content = f.read()
content = content.replace(\"/home/ubuntu/logseq-notes/.weibo-config.json\", \"os.environ.get('WEIBO_CONFIG_FILE', os.path.join(os.path.dirname(__file__), 'weibo-config.json'))\")
with open('post-weibo.py', 'w') as f:
    f.write(content)

# index.html 标题和路径清理
with open('index.html', 'r') as f:
    content = f.read()
content = content.replace('老周的日记系统', '日记系统')
content = re.sub(r\"/home/ubuntu/[^\s'\"]+\", lambda m: './data', content)
with open('index.html', 'w') as f:
    f.write(content)

# config-sources.html 路径清理
with open('config-sources.html', 'r') as f:
    content = f.read()
content = re.sub(r\"/home/ubuntu/[^\s'\"]+\", lambda m: './data', content)
with open('config-sources.html', 'w') as f:
    f.write(content)

# ai-service.js 个人信息清理
with open('ai-service.js', 'r') as f:
    content = f.read()
personal = ['米妮', 'Migo', 'Minnie', '老周', '周泓武', '熊大妈', '昆明', '高考']
for p in personal:
    content = content.replace(p, '')
with open('ai-service.js', 'w') as f:
    f.write(content)

print('✅ 路径和个人信息已清理')
"

# 检查是否有变更
if git diff --quiet && git diff --cached --quiet; then
  echo "📌 无变更，跳过提交"
  exit 0
fi

# 提交推送
git add -A
git commit -m "$1"
git push origin main

echo ""
echo "✅ 同步完成！已推送到 GitHub"
