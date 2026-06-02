FROM node:20-slim

# 安装Python（微博发布功能需要）
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装Node依赖
COPY package*.json ./
RUN npm install

# 复制源码
COPY . .

# 生成演示数据
RUN python3 generate-demo-data.py

# 暴露端口
EXPOSE 3333

# 数据目录
VOLUME ["/app/data/diary"]

CMD ["node", "index.js"]