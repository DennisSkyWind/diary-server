#!/bin/bash
# diary-server 守护脚本
# 功能：监控日记系统进程，崩溃后自动重启
# 用法：nohup bash /home/ubuntu/.openclaw/workspace/diary-server/daemon.sh &

DIARY_DIR="/home/ubuntu/.openclaw/workspace/diary-server"
PORT=3333
LOG_FILE="/home/ubuntu/.copaw/logs/diary-daemon.log"
CHECK_INTERVAL=30  # 检查间隔（秒）
MAX_RESTART=5      # 最大连续重启次数
RESTART_WINDOW=300 # 重启窗口（秒）

restart_count=0
last_restart=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

check_port() {
    curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null
}

check_process() {
    pgrep -f "node index.js" -d ',' 2>/dev/null | grep -v "$$" > /dev/null
}

start_server() {
    cd "$DIARY_DIR"
    nohup /usr/bin/node index.js </dev/null >> /home/ubuntu/.copaw/logs/diary-server-stdout.log 2>> /home/ubuntu/.copaw/logs/diary-server-stderr.log &
    sleep 3
    if check_process; then
        log "✅ 日记系统启动成功 (PID: $(pgrep -f 'node index.js' | head -1))"
        return 0
    else
        log "❌ 日记系统启动失败"
        return 1
    fi
}

stop_server() {
    local pid=$(pgrep -f "node index.js" | head -1)
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null
        sleep 2
        # 强制杀
        kill -9 "$pid" 2>/dev/null
        log "🛑 日记系统已停止 (PID: $pid)"
    fi
    # 确保端口释放
    fuser -k "$PORT"/tcp 2>/dev/null
    sleep 1
}

# 主循环
log "🚀 日记系统守护进程启动"
log "   检查间隔: ${CHECK_INTERVAL}s"
log "   最大重启: ${MAX_RESTART}次/${RESTART_WINDOW}s"

while true; do
    http_code=$(check_port)
    
    if [ "$http_code" != "200" ]; then
        # 服务异常
        log "⚠️ 检测到服务异常 (HTTP: $http_code)"
        
        # 检查重启频率
        now=$(date +%s)
        if [ $((now - last_restart)) -lt $RESTART_WINDOW ]; then
            restart_count=$((restart_count + 1))
        else
            restart_count=1
        fi
        last_restart=$now
        
        if [ $restart_count -ge $MAX_RESTART ]; then
            log "🔴 连续重启${MAX_RESTART}次，暂停5分钟后重试"
            sleep 300
            restart_count=0
            continue
        fi
        
        log "🔄 尝试重启 (第${restart_count}次)..."
        stop_server
        start_server
    fi
    
    sleep $CHECK_INTERVAL
done
