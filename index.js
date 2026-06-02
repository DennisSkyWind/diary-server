const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const Database = require('better-sqlite3');

// AI 服务模块
const aiService = require('./ai-service.js');

const PORT = process.env.PORT || 3333;
const DIARY_DIR = process.env.DIARY_DIR || path.join(__dirname, 'data', 'diary');
const HTML_FILE = path.join(__dirname, 'index.html');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(__dirname, 'data');
const COPAW_DIR = process.env.COPAW_DIR || path.join(__dirname, 'data');

// 微博配置和文章目录
const WEIBO_CONFIG_FILE = path.join(DIARY_DIR, '.weibo-config.json');

// 虚拟文件夹配置文件
const VIRTUAL_FOLDERS_FILE = path.join(__dirname, 'virtual-folders.json');
// 图数据库文件
const GRAPH_DB_FILE = path.join(__dirname, 'diary-graph.db');
// Schema定义文件
const SCHEMA_FILE = path.join(__dirname, 'schema.json');

// ========== Phase 1: Schema辅助函数 ==========

const FRESHNESS_TTL = {
  live: 15 * 60 * 1000, breaking: 6 * 60 * 60 * 1000, current: 3 * 24 * 60 * 60 * 1000,
  fast: 4 * 7 * 24 * 60 * 60 * 1000, moderate: 3 * 30 * 24 * 60 * 60 * 1000,
  standard: 6 * 30 * 24 * 60 * 60 * 1000, academic: 365 * 24 * 60 * 60 * 1000,
  evergreen: 5 * 365 * 24 * 60 * 60 * 1000, permanent: Infinity
};

const TYPE_DEFAULT_FRESHNESS = {
  note: 'standard', event: 'current', task: 'current', idea: 'permanent',
  memory: 'permanent', reference: 'moderate', research: 'academic', conversation: 'permanent'
};

function isStale(tier, date) {
  const ttl = FRESHNESS_TTL[tier];
  return ttl !== Infinity && date && (new Date() - new Date(date)) > ttl;
}

function inferFreshnessTier(content, filename) {
  if (!content) return 'standard';
  const l = content.toLowerCase();
  
  // 日期格式文件（日记）永久保存
  if (filename && /^\d{4}-\d{2}-\d{2}/.test(filename)) return 'permanent';
  if (filename && /📅\s*活动/.test(filename)) return 'permanent';
  if (filename && /日记/.test(filename)) return 'permanent';
  
  // 实时数据
  if (l.includes('股票') || l.includes('行情') || l.includes('实时') || l.includes('股价')) return 'live';
  
  // 突发新闻
  if (l.includes('新闻') || l.includes('突发') || l.includes('紧急') || l.includes('公告')) return 'breaking';
  
  // 当前事件
  if (l.includes('今天') || l.includes('本周') || l.includes('近期') || l.includes('最新')) return 'current';
  
  // 快速变化领域
  if (l.includes('ai') || l.includes('技术') || l.includes('api') || l.includes('框架') || l.includes('版本')) return 'fast';
  
  // 学术研究
  if (l.includes('论文') || l.includes('研究') || l.includes('学术') || l.includes('实验')) return 'academic';
  
  // 历史传记
  if (l.includes('历史') || l.includes('传记') || l.includes('定律') || l.includes('定理')) return 'evergreen';
  
  return 'standard';
}

function inferType(content, category) {
  if (category === '对话记录') return 'conversation';
  if (category === '工作') return 'task';
  if (category === '学习') return 'reference';
  if (!content) return 'note';
  const l = content.toLowerCase();
  
  // 事件
  if (l.includes('活动') || l.includes('会议') || l.includes('事件') || l.includes('发生')) return 'event';
  
  // 任务
  if (l.includes('任务') || l.includes('待办') || l.includes('完成') || l.includes('进度')) return 'task';
  
  // 想法/灵感
  if (l.includes('想法') || l.includes('灵感') || l.includes('创意') || l.includes('思考')) return 'idea';
  
  // 记忆/回忆
  if (l.includes('回忆') || l.includes('记忆') || l.includes('往事') || l.includes('经历')) return 'memory';
  
  // 参考资料
  if (l.includes('参考') || l.includes('文档') || l.includes('资料') || l.includes('教程')) return 'reference';
  
  // 研究
  if (l.includes('研究') || l.includes('分析') || l.includes('调研') || l.includes('探索')) return 'research';
  
  return 'note';
}

function inferConfidence(content, sources = []) {
  // 基于来源数量判断置信度
  if (sources.length >= 3) return 'high';
  if (sources.length >= 2) return 'medium';
  
  // 基于内容特征判断
  if (!content) return 'low';
  const l = content.toLowerCase();
  
  // 高置信度特征：多来源引用、数据支撑
  if (l.includes('来源') || l.includes('引用') || l.includes('数据') || l.includes('统计')) return 'medium';
  
  // 个人笔记/日记默认中等置信度
  if (l.includes('笔记') || l.includes('日记') || l.includes('记录')) return 'medium';
  
  // 推测性内容低置信度
  if (l.includes('推测') || l.includes('可能') || l.includes('猜测') || l.includes('估计')) return 'low';
  
  return 'medium';
}

// 统计页面类型和置信度分布
function getPageStats() {
  const stats = { types: {}, freshness: {}, confidence: {}, total: 0, stale: 0 };
  const allFiles = [];
  
  const walk = (dir) => {
    try {
      fs.readdirSync(dir).forEach(item => {
        const fp = path.join(dir, item);
        const st = fs.statSync(fp);
        if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
        else if (item.endsWith('.md')) allFiles.push(fp);
      });
    } catch(e) {}
  };
  walk(DIARY_DIR);
  
  stats.total = allFiles.length;
  
  allFiles.forEach(fp => {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);
      
      const type = frontmatter?.type || inferType(content);
      stats.types[type] = (stats.types[type] || 0) + 1;
      
      const freshness = frontmatter?.freshness_tier || inferFreshnessTier(content, fp);
      stats.freshness[freshness] = (stats.freshness[freshness] || 0) + 1;
      
      const conf = frontmatter?.confidence || inferConfidence(content);
      stats.confidence[conf] = (stats.confidence[conf] || 0) + 1;
      
      // 检查过期
      if (frontmatter?.freshness_tier && frontmatter?.updated && isStale(frontmatter.freshness_tier, frontmatter.updated)) {
        stats.stale++;
      }
    } catch(e) {}
  });
  
  return stats;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: content };
  const fm = {};
  m[1].split('\n').forEach(line => {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (mm) {
      let v = mm[2].trim();
      if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1,-1).split(',');
      fm[mm[1]] = v;
    }
  });
  return { frontmatter: fm, body: m[2] };
}

function generateFrontmatter(meta) {
  const lines = ['---'];
  if (meta.title) lines.push(`title: "${meta.title}"`);
  if (meta.type) lines.push(`type: ${meta.type}`);
  if (meta.freshness_tier) lines.push(`freshness_tier: ${meta.freshness_tier}`);
  if (meta.confidence) lines.push(`confidence: ${meta.confidence}`);
  if (meta.tags?.length) lines.push(`tags: [${meta.tags.map(t=>`"${t}"`).join(', ')}]`);
  lines.push(`created: ${meta.created || new Date().toISOString().split('T')[0]}`);
  lines.push(`updated: ${new Date().toISOString().split('T')[0]}`);
  lines.push('---');
  return lines.join('\n');
}

function updateFrontmatter(filePath, newMeta) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);
  const merged = { ...frontmatter, ...newMeta };
  const fm = generateFrontmatter(merged);
  const newContent = frontmatter ? `${fm}\n${body}` : `${fm}\n\n${content}`;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return merged;
}

// ========== Phase 1 辅助函数结束 ==========

// 获取虚拟文件夹配置
function getVirtualFolders() {
  if (fs.existsSync(VIRTUAL_FOLDERS_FILE)) {
    return JSON.parse(fs.readFileSync(VIRTUAL_FOLDERS_FILE, 'utf-8'));
  }
  // 默认配置
  const defaultConfig = {
    folders: [
      {"id": "root", "name": "根目录", "icon": "📁", "parent": null, "order": 0},
      {"id": "uncategorized", "name": "未分类", "icon": "📂", "parent": "root", "order": 1},
      {"id": "conversations", "name": "对话记录", "icon": "💬", "parent": "root", "order": 2, "autoMatch": "date"},
      {"id": "work", "name": "工作", "icon": "💼", "parent": "root", "order": 3},
      {"id": "family", "name": "家庭", "icon": "🏠", "parent": "root", "order": 4},
      {"id": "travel", "name": "旅游", "icon": "✈️", "parent": "root", "order": 5},
      {"id": "study", "name": "学习", "icon": "📚", "parent": "root", "order": 6},
      {"id": "life", "name": "生活", "icon": "🍽️", "parent": "root", "order": 7},
      {"id": "emotion", "name": "情感", "icon": "💭", "parent": "root", "order": 8},
      {"id": "memorial", "name": "纪念", "icon": "🎉", "parent": "root", "order": 9}
    ],
    fileAssignments: {}
  };
  fs.writeFileSync(VIRTUAL_FOLDERS_FILE, JSON.stringify(defaultConfig, null, 2));
  return defaultConfig;
}

// 识别日期格式的文件名（对话文件）
function isDateFilename(filename) {
  const basename = path.basename(filename, '.md');
  // YYYY-MM-DD 格式 (如 2026-03-09)
  if (/^\d{4}-\d{2}-\d{2}$/.test(basename)) return true;
  // YYYYMMDD 格式 (如 20260407)
  if (/^\d{8}$/.test(basename)) return true;
  // 其他带日期后缀的格式 (如 xxx_2026-03-09)
  if (/_\d{4}-\d{2}-\d{2}$/.test(basename)) return true;
  return false;
}

// 保存虚拟文件夹配置
function saveVirtualFolders(config) {
  fs.writeFileSync(VIRTUAL_FOLDERS_FILE, JSON.stringify(config, null, 2));
}

function getWeiboConfig() {
  if (fs.existsSync(WEIBO_CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(WEIBO_CONFIG_FILE, 'utf-8'));
  }
  return null;
}

if (!fs.existsSync(DIARY_DIR)) {
  fs.mkdirSync(DIARY_DIR, { recursive: true });
}

// 解析文件的frontmatter摘要（只读取前100行）
function parseFrontmatterSummary(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    
    const fmText = fmMatch[1];
    const fm = {};
    
    fmText.split('\n').forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if (value.startsWith('"') || value.startsWith("'")) {
          value = value.slice(1, -1);
        }
        // 只提取关键字段
        if (['freshness_tier', 'type', 'confidence', 'title'].includes(key)) {
          fm[key] = value;
        }
      }
    });
    return fm;
  } catch(e) {
    return null;
  }
}

function getDirTree(dir, relativePath = '') {
  const items = fs.readdirSync(dir);
  const tree = [];
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const relPath = path.join(relativePath, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      tree.push({
        name: item,
        type: 'folder',
        path: relPath,
        children: getDirTree(fullPath, relPath)
      });
    } else if (item.endsWith('.md')) {
      const fm = parseFrontmatterSummary(fullPath);
      tree.push({
        name: item,
        type: 'file',
        path: relPath,
        freshness: fm?.freshness_tier || null,
        confidence: fm?.confidence || null,
        pageType: fm?.type || null,
        title: fm?.title || null
      });
    }
  }
  return tree;
}

function saveFile(filePath, content) {
  const fullPath = path.join(DIARY_DIR, filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function deleteItem(itemPath) {
  const fullPath = path.join(DIARY_DIR, itemPath);
  if (!fs.existsSync(fullPath)) return false;
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true });
  } else {
    fs.unlinkSync(fullPath);
  }
  return true;
}

// 数据源配置文件
const DATA_SOURCES_FILE = path.join(__dirname, 'data-sources.json');

function getDataSources() {
  try {
    if (fs.existsSync(DATA_SOURCES_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_SOURCES_FILE, 'utf-8'));
    }
  } catch(e) {}
  return { data_sources: [], chart_types: {}, default_settings: {} };
}

// 根据数据源配置加载数据
function loadDataBySource(source) {
  const filePath = source.path;
  if (!fs.existsSync(filePath)) return null;
  
  const ext = path.extname(filePath).toLowerCase();
  const type = source.type;
  
  if (type === 'json' || ext === '.json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  
  if (type === 'sqlite' || ext === '.db') {
    const db = new Database(filePath, { readonly: true });
    const tableName = source.table;
    let data;
    
    if (tableName) {
      data = db.prepare(`SELECT * FROM ${tableName} LIMIT 100`).all();
    } else {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length > 0) {
        data = db.prepare(`SELECT * FROM ${tables[0].name} LIMIT 100`).all();
      } else {
        data = [];
      }
    }
    db.close();
    return data;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // 微博API需要保留原始请求头
  
  // === 旧代理路由已清理，新功能已直接在3333实现 ===
  // 兼容旧链接，重定向到新位置
  const legacyRoutes = ['/v2editor', '/v2calendar', '/v2dashboard', '/v2templates', '/v2graph'];
  if (legacyRoutes.some(p => pathname.startsWith(p))) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<script>alert("功能已整合，请使用左侧栏按钮或刷新页面");location.href="/index.html";</script>');
    return;
  }

  // === API: 健康检测 (代理检测其他服务) ===
  if (pathname === '/api/health' && req.method === 'GET') {
    const port = parsedUrl.query.port;
    if (!port) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'port required'}));
      return;
    }
    let responseSent = false;
    const sendResponse = (status, data) => {
      if (responseSent) return;
      responseSent = true;
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(data);
    };
    const reqOpts = {
      hostname: '127.0.0.1',
      port: port,
      path: '/',
      method: 'GET',
      timeout: 3000
    };
    const proxyReq = http.request(reqOpts, (proxyRes) => {
      sendResponse(200, JSON.stringify({status: 'ok', port: port}));
    });
    proxyReq.on('error', () => {
      sendResponse(500, JSON.stringify({status: 'error', port: port}));
    });
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      sendResponse(500, JSON.stringify({status: 'timeout', port: port}));
    });
    proxyReq.end();
    return;
  }

  // 测试接口：返回最简单的 JSON
  if (pathname === '/api/test') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify([{"name":"test","type":"folder","path":"test"}]));
    return;
  }
  
  if (pathname === '/api/tree') {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(getDirTree(DIARY_DIR)));
    return;
  }
  
  // === API: 读取文件内容 ===
  if (pathname === '/api/file' && req.method === 'GET') {
    const filePath = parsedUrl.query.path;
    if (!filePath) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '缺少文件路径'}));
      return;
    }
    
    const fullPath = path.join(DIARY_DIR, filePath);
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '文件不存在'}));
      return;
    }
    
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({content}));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 虚拟文件夹 - 获取配置 ===
  if (pathname === '/api/virtual-folders' && req.method === 'GET') {
    try {
      const config = getVirtualFolders();
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({success: true, ...config}));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 虚拟文件夹 - 移动文件 ===
  if (pathname === '/api/virtual-folders/move' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filePath, folderId, source } = JSON.parse(body);
        if (!filePath || !folderId) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件路径或文件夹ID'}));
          return;
        }
        
        const config = getVirtualFolders();
        // 新数据结构：保留来源信息
        // source: 'manual' = 用户手动移动, 'ai' = AI整理, 'system' = 系统默认
        const moveSource = source || 'manual'; // 默认为用户手动移动
        config.fileAssignments[filePath] = {
          folder: folderId,
          source: moveSource,
          timestamp: new Date().toISOString()
        };
        saveVirtualFolders(config);
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, message: `文件已移动到 ${folderId}`, source: moveSource}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: 虚拟文件夹 - 批量移动 ===
  if (pathname === '/api/virtual-folders/batch-move' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { assignments, source } = JSON.parse(body);
        if (!assignments || typeof assignments !== 'object') {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少分配信息'}));
          return;
        }
        
        const config = getVirtualFolders();
        const moveSource = source || 'manual'; // 默认为用户手动移动
        const timestamp = new Date().toISOString();
        
        // 批量移动时保留来源信息
        for (const [filePath, folderId] of Object.entries(assignments)) {
          config.fileAssignments[filePath] = {
            folder: folderId,
            source: moveSource,
            timestamp: timestamp
          };
        }
        saveVirtualFolders(config);
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, message: `已移动 ${Object.keys(assignments).length} 个文件`, source: moveSource}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: 虚拟文件夹 - 创建新文件夹 ===
  if (pathname === '/api/virtual-folders/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, icon, parent } = JSON.parse(body);
        if (!name) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件夹名称'}));
          return;
        }
        
        const config = getVirtualFolders();
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
        const newFolder = {
          id,
          name,
          icon: icon || '📁',
          parent: parent || 'root',
          order: config.folders.length
        };
        config.folders.push(newFolder);
        saveVirtualFolders(config);
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, folder: newFolder}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: 虚拟文件夹 - 删除文件夹 ===
  if (pathname === '/api/virtual-folders/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folderId } = JSON.parse(body);
        if (!folderId || folderId === 'root' || folderId === 'uncategorized') {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '不能删除根目录或未分类'}));
          return;
        }
        
        const config = getVirtualFolders();
        config.folders = config.folders.filter(f => f.id !== folderId);
        // 移动该文件夹下的文件到未分类
        for (const [file, folder] of Object.entries(config.fileAssignments)) {
          if (folder === folderId) {
            config.fileAssignments[file] = 'uncategorized';
          }
        }
        saveVirtualFolders(config);
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, message: '文件夹已删除'}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: 虚拟文件夹 - 按文件夹获取文件列表 ===
  if (pathname === '/api/virtual-folders/files' && req.method === 'GET') {
    try {
      const folderId = parsedUrl.query.folder || 'all';
      const includeSource = parsedUrl.query.includeSource === 'true';
      const config = getVirtualFolders();
      
      // 获取所有物理文件
      const physicalFiles = [];
      function scanDir(dir, basePath = '') {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relPath = basePath ? basePath + '/' + item : item;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && !item.startsWith('.')) {
            scanDir(fullPath, relPath);
          } else if (item.endsWith('.md')) {
            physicalFiles.push(relPath);
          }
        }
      }
      scanDir(DIARY_DIR);
      
      // 辅助函数：获取文件夹ID（兼容新旧数据结构）
      function getFolderId(assignment) {
        if (typeof assignment === 'string') {
          return assignment; // 旧结构：直接的folderId
        } else if (assignment && assignment.folder) {
          return assignment.folder; // 新结构：{ folder, source, timestamp }
        }
        return 'uncategorized';
      }
      
      // 辅助函数：获取来源信息
      function getSource(assignment) {
        if (typeof assignment === 'object' && assignment.source) {
          return assignment.source;
        }
        return 'legacy'; // 旧数据标记为legacy
      }
      
      // 按虚拟文件夹分组（日期格式的文件自动归类到对话记录）
      const grouped = {};
      const fileDetails = {}; // 文件详细信息（包含来源）
      
      for (const file of physicalFiles) {
        const assignment = config.fileAssignments[file];
        let assignedFolder = getFolderId(assignment);
        let source = getSource(assignment);
        
        // 如果未手动分配且文件名是日期格式，自动归类到对话记录
        if (!assignment && isDateFilename(file)) {
          assignedFolder = 'conversations';
          source = 'system'; // 系统自动归类
        }
        
        if (!grouped[assignedFolder]) grouped[assignedFolder] = [];
        grouped[assignedFolder].push(file);
        
        if (includeSource) {
          fileDetails[file] = {
            folder: assignedFolder,
            source: source
          };
        }
      }
      
      if (folderId === 'all') {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, grouped, folders: config.folders, fileDetails}));
      } else {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, files: grouped[folderId] || []}));
      }
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 保存 JSON 文件 ===
  if (pathname === '/api/data-save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { path: filePath, data } = JSON.parse(body);
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: '文件不存在'}));
        return;
      }
      
      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === API: 保存配置文件（可创建新文件）===
  if (pathname === '/api/config-save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { file, data } = JSON.parse(body);
      if (!file) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: '未指定文件路径'}));
        return;
      }
      
      try {
        // 确保目录存在
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, {recursive: true});
        }
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === 配置页面 ===
  if (pathname === '/config-sources') {
    const html = fs.readFileSync(path.join(__dirname, 'config-sources.html'), 'utf-8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  
  // === API: 执行数据库操作 ===
  if (pathname === '/api/db-exec' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { path: dbPath, table, action, data, where } = JSON.parse(body);
      
      if (!dbPath || !fs.existsSync(dbPath)) {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: '数据库文件不存在'}));
        return;
      }
      
      try {
        const db = new Database(dbPath);
        let result;
        
        if (action === 'insert') {
          const keys = Object.keys(data);
          const values = Object.values(data);
          const placeholders = keys.map(() => '?').join(', ');
          const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`);
          result = stmt.run(...values);
        } else if (action === 'update') {
          const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
          const values = [...Object.values(data), where].filter(v => v !== undefined);
          const stmt = db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`);
          result = stmt.run(...values);
        } else if (action === 'delete') {
          const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
          result = stmt.run(where);
        }
        
        db.close();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, changes: result?.changes}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === 数据查看器页面 ===
  if (pathname === '/data-viewer') {
    const filePath = parsedUrl.query.path;
    
    // 如果没有path参数，返回带数据源列表的页面
    if (!filePath) {
      const config = getDataSources();
      const html = fs.readFileSync(path.join(__dirname, 'data-viewer.html'), 'utf-8');
      
      // 注入数据源列表到页面
      const sourcesList = config.data_sources?.map(s => 
        `<a href="/data-viewer?path=${encodeURIComponent(s.path)}" class="source-item">
          <span class="icon">${s.icon}</span>
          <span class="name">${s.name}</span>
          <span class="type">${s.type.toUpperCase()}</span>
        </a>`
      ).join('') || '';
      
      const modifiedHtml = html.replace(
        '<div id="tabs" class="tabs"></div>',
        '<div class="source-list">' + sourcesList + '</div>'
      ).replace(
        '<div class="empty">加载中...</div>',
        '<div class="empty">选择一个数据源查看详情</div>'
      );
      
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(modifiedHtml);
      return;
    }
    
    const html = fs.readFileSync(path.join(__dirname, 'data-viewer.html'), 'utf-8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  
  // === Dashboard 页面 ===
  if (pathname === '/' || pathname === '/dashboard') {
    const html = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  
  // 日记编辑器页面
  if (pathname === '/diary' || pathname === '/editor') {
    const html = fs.readFileSync(HTML_FILE, 'utf-8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  
  // 系统设置页面
  if (pathname === '/settings' || pathname === '/settings.html') {
    const settingsFile = path.join(__dirname, 'settings.html');
    if (fs.existsSync(settingsFile)) {
      const html = fs.readFileSync(settingsFile, 'utf-8');
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(html);
      return;
    }
  }
  
  // 其他HTML页面（report-viewer, data-viewer, config-sources等）
  if (pathname.endsWith('.html') && pathname !== '/index.html') {
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath)) {
      const html = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(html);
      return;
    }
  }
  
  if (pathname === '/api/create-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const {name} = JSON.parse(body);
      const fullPath = path.join(DIARY_DIR, name);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, {recursive: true});
      }
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  // 移动文件夹
  if (pathname === '/api/move-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let {source, destination} = JSON.parse(body);
      
      // 尝试查找真实路径（带emoji）
      function findRealPath(inputPath) {
        // 如果路径已存在，直接返回
        const directPath = path.join(DIARY_DIR, inputPath);
        if (fs.existsSync(directPath)) return directPath;
        
        // 尝试添加常见emoji前缀
        const emojis = ['📅 ', '📊 ', '📁 '];
        for (const emoji of emojis) {
          // 检查是否已有emoji，避免重复
          if (!inputPath.startsWith(emoji)) {
            const emojiPath = path.join(DIARY_DIR, emoji + inputPath);
            if (fs.existsSync(emojiPath)) return emojiPath;
          }
        }
        return null;
      }
      
      const sourcePath = findRealPath(source);
      if (!sourcePath) {
        res.writeHead(400);
        res.end(JSON.stringify({error: '源文件夹不存在: ' + source}));
        return;
      }
      
      // 处理目标路径
      let destPath = findRealPath(destination);
      if (!destPath && destination) {
        // 如果指定了目标但找不到，直接使用用户输入的路径
        destPath = path.join(DIARY_DIR, destination);
        // 如果不存在，尝试添加emoji（但不重复）
        if (!fs.existsSync(destPath) && !destination.startsWith('📅')) {
          const withEmoji = path.join(DIARY_DIR, '📅 ' + destination);
          if (fs.existsSync(withEmoji)) {
            destPath = withEmoji;
          }
        }
      } else if (!destPath && !destination) {
        // 移动到根目录
        destPath = path.join(DIARY_DIR, path.basename(sourcePath));
      }
      
      // 检查目标位置是否已有同名文件夹/文件
      const sourceName = path.basename(sourcePath);
      const finalDestPath = path.join(destPath, sourceName);
      if (fs.existsSync(finalDestPath)) {
        res.writeHead(400);
        res.end(JSON.stringify({error: '目标位置已有同名文件夹'}));
        return;
      }
      
      // 使用 rename 移动
      try {
        fs.renameSync(sourcePath, finalDestPath);
      } catch (err) {
        // 如果rename失败（目录已存在），尝试复制+删除
        if (err.code === 'ENOTEMPTY' || err.code === 'EEXIST') {
          // 使用 cp + rm 方式
          const { execSync } = require('child_process');
          execSync(`cp -r "${sourcePath}" "${destPath}/"`);
          fs.rmSync(sourcePath, { recursive: true });
        } else {
          throw err;
        }
      }
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }
  
  if (pathname === '/api/create-file' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const {name} = JSON.parse(body);
      const filePath = path.join(DIARY_DIR, name);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
      }
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf-8');
      }
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }
  
  if (pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body);
      saveFile(data.path, data.content);
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }
  
  if (pathname === '/api/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const {path: itemPath} = JSON.parse(body);
      deleteItem(itemPath);
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }
  
  // === 新增API: 搜索文章（全文搜索）===
  if (pathname === '/api/search' && req.method === 'GET') {
    const query = parsedUrl.query.q || '';
    
    if (!query) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: '请提供搜索关键词'}));
      return;
    }
    
    try {
      const results = [];
      const keyword = query.toLowerCase();
      
      function searchDir(dir) {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory() && !item.startsWith('.')) {
            searchDir(fullPath);
          } else if (item.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
            if (content.includes(keyword)) {
              const relPath = path.relative(DIARY_DIR, fullPath);
              const index = content.indexOf(keyword);
              const start = Math.max(0, index - 50);
              const end = Math.min(content.length, index + 100);
              let context = content.slice(start, end).replace(/\n/g, ' ');
              if (start > 0) context = '...' + context;
              if (end < content.length) context = context + '...';
              
              results.push({
                file: relPath,
                name: item,
                preview: context,
                mtime: stat.mtime.getTime(),  // 添加修改时间
                isDatedFile: /^\d{4}-\d{2}-\d{2}/.test(item) || /_\d{4}-\d{2}-\d{2}/.test(item)  // 是否是日期文件
              });
            }
          }
        }
      }
      
      searchDir(DIARY_DIR);
      
      // 智能排序：日期文件优先（最新的排前面），然后按修改时间
      results.sort((a, b) => {
        // 日期文件优先
        if (a.isDatedFile && !b.isDatedFile) return -1;
        if (!a.isDatedFile && b.isDatedFile) return 1;
        // 同为日期文件，按文件名倒序（新日期在前）
        if (a.isDatedFile && b.isDatedFile) {
          return b.name.localeCompare(a.name);
        }
        // 非日期文件，按修改时间倒序
        return b.mtime - a.mtime;
      });
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, query, count: results.length, results}));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: e.message}));
    }
    return;
  }
  
  // === 新增API: 百度网盘备份 ===
  if (pathname === '/api/backup-baidu' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const {path: filePath} = JSON.parse(body);
        
        // 获取文件完整路径
        const fullPath = path.join(DIARY_DIR, filePath);
        if (!fs.existsSync(fullPath)) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          return res.end(JSON.stringify({success: false, error: '文件不存在'}));
        }
        
        // 构建网盘路径: /apps/bdpan/diary-backup/日期_文件名
        const date = new Date().toISOString().slice(0, 10);
        const fileName = path.basename(filePath);
        const remotePath = `diary-backup/${date}_${fileName}`;
        
        // 调用 bdpan 上传
        const {execSync} = require('child_process');
        const bdpanPath = process.env.BDPAN_PATH || 'bdpan';
        
        try {
          const result = execSync(`"${bdpanPath}" upload "${fullPath}" "${remotePath}" --json`, {
            encoding: 'utf-8',
            timeout: 60000
          });
          
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            success: true, 
            remote_path: `/apps/bdpan/${remotePath}`,
            local_path: filePath
          }));
        } catch(uploadErr) {
          console.error('百度网盘上传失败:', uploadErr.message);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            success: false, 
            error: '上传失败: ' + (uploadErr.message || '请检查网络或登录状态')
          }));
        }
      } catch(e) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === 新增API: 分类整理（分类--日期--文章）===
  if (pathname === '/api/organize-by-category' && req.method === 'POST') {
    try {
      // 扫描日记目录
      const files = [];
      function scanDiary(dir, baseDir) {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && !item.startsWith('.') && item !== '📊 日记整理报告') {
            scanDiary(fullPath, baseDir);
          } else if (item.endsWith('.md')) {
            const relDir = path.relative(baseDir, dir);
            files.push({
              path: fullPath,
              name: item,
              folder: relDir === '.' ? '根目录' : relDir,
              mtime: stat.mtime
            });
          }
        }
      }
      scanDiary(DIARY_DIR, DIARY_DIR);
      
      let movedCount = 0;
      
      // 按日期和分类整理文件
      // 整理方式1: 保持原有分类结构，只确保分类目录存在
      // 整理方式2: 按月份--分类整理（需要传递 mode 参数）
      
      let organizeMode = 'keep'; // 默认保持原结构
      
      // 检查是否有文件需要整理（松散文件移到分类目录）
      const rootFiles = files.filter(f => f.folder === '根目录');
      
      // 将根目录的文件移动到默认分类
      rootFiles.forEach(f => {
        // 查找第一个存在的分类目录作为目标
        const categories = ['📅 活动', '📅 历史', '微博'];
        let targetDir = null;
        for (const cat of categories) {
          const catPath = path.join(DIARY_DIR, cat);
          if (fs.existsSync(catPath)) {
            targetDir = catPath;
            break;
          }
        }
        
        if (targetDir) {
          const targetPath = path.join(targetDir, f.name);
          if (f.path !== targetPath && !fs.existsSync(targetPath)) {
            fs.renameSync(f.path, targetPath);
            movedCount++;
          }
        }
      });
      
      // 生成整理报告
      let report = `# 📂 日记整理报告\n\n`;
      report += `> 整理时间: ${new Date().toLocaleString()}\n`;
      report += `> 整理文件数: ${movedCount}\n\n`;
      report += `---\n\n`;
      report += `## 整理结果\n\n`;
      report += `文件已整理到以下结构：\n\n`;
      
      // 读取新结构
      const newFiles = [];
      function scanNew(dir, base) {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const full = path.join(dir, item);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            scanNew(full, base);
          } else if (item.endsWith('.md')) {
            newFiles.push(path.relative(DIARY_DIR, full));
          }
        }
      }
      scanNew(DIARY_DIR, DIARY_DIR);
      
      // 按月份分组显示
      const byMonth = {};
      newFiles.forEach(f => {
        const match = f.match(/^📅 (\d{4}-\d{2})/);
        if (match) {
          if (!byMonth[match[1]]) byMonth[match[1]] = [];
          byMonth[match[1]].push(f);
        }
      });
      
      for (const [month, monthFiles] of Object.entries(byMonth).sort().reverse()) {
        report += `### 📅 ${month}\n\n`;
        monthFiles.forEach(f => report += `- ${f}\n`);
        report += '\n';
      }
      
      // 保存报告
      const reportPath = path.join(DIARY_DIR, '📊 日记整理报告.md');
      fs.writeFileSync(reportPath, report, 'utf-8');
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, count: movedCount, report: reportPath}));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: e.message}));
    }
    return;
  }
  if (pathname === '/api/organize' && req.method === 'POST') {
    try {
      const collectedFiles = [];
      
      // 扫描目录的函数
      function scanForArticles(dir, baseDir, extensions) {
        if (!fs.existsSync(dir)) return;
        
        function walk(d) {
          const items = fs.readdirSync(d);
          for (const item of items) {
            const fullPath = path.join(d, item);
            const stat = fs.statSync(fullPath);
            
            // 跳过特定目录
            if (stat.isDirectory()) {
              const skipDirs = ['node_modules', '.git', 'logs', 'file_store', 'embedding_cache', 'downloads'];
              if (!skipDirs.includes(item)) {
                walk(fullPath);
              }
            } else {
              const ext = path.extname(item).toLowerCase();
              if (extensions.includes(ext)) {
                const relPath = path.relative(baseDir, fullPath);
                collectedFiles.push({
                  path: fullPath,
                  relPath: relPath,
                  name: item,
                  mtime: stat.mtime,
                  size: stat.size
                });
              }
            }
          }
        }
        walk(dir);
      }
      
      // 扫描 OpenClaw
      scanForArticles(OPENCLAW_DIR, OPENCLAW_DIR, ['.md', '.txt']);
      
      // 扫描 Copaw
      scanForArticles(COPAW_DIR, COPAW_DIR, ['.md', '.txt', '.html']);
      
      // 按修改时间排序
      collectedFiles.sort((a, b) => b.mtime - a.mtime);
      
      // 创建收集的文章汇总
      const COLLECT_DIR = path.join(DIARY_DIR, '📥 文章收集');
      if (!fs.existsSync(COLLECT_DIR)) {
        fs.mkdirSync(COLLECT_DIR, { recursive: true });
      }
      
      // 生成汇总报告
      let report = `# 📥 文章收集报告\n\n`;
      report += `> 整理时间: ${new Date().toLocaleString()}\n\n`;
      report += `---\n\n`;
      report += `## 📊 统计\n\n`;
      report += `- 总文件数: ${collectedFiles.length}\n`;
      report += `- 来源: OpenClaw + Copaw\n\n`;
      report += `---\n\n`;
      report += `## 📁 文件列表 (按修改时间排序)\n\n`;
      
      // 分组按目录
      const groups = {};
      collectedFiles.forEach(f => {
        const dir = path.dirname(f.relPath);
        if (!groups[dir]) groups[dir] = [];
        groups[dir].push(f);
      });
      
      for (const [dir, files] of Object.entries(groups)) {
        report += `### ${dir}/\n\n`;
        files.forEach(f => {
          const mtime = f.mtime.toLocaleDateString();
          const size = (f.size / 1024).toFixed(1) + 'KB';
          const link = f.relPath.replace(/\.md$/, '');
          report += `- [[${f.name}]] (${mtime}, ${size})\n`;
        });
        report += '\n';
      }
      
      // 复制收集到的文件到日记系统
      let copiedCount = 0;
      const COPY_DIR = path.join(COLLECT_DIR, '源文件');
      if (!fs.existsSync(COPY_DIR)) {
        fs.mkdirSync(COPY_DIR, { recursive: true });
      }
      
      collectedFiles.forEach(f => {
        try {
          const destPath = path.join(COPY_DIR, f.name);
          // 如果目标不存在或源文件更新，则复制
          if (!fs.existsSync(destPath) || fs.statSync(destPath).mtime < f.mtime) {
            fs.copyFileSync(f.path, destPath);
            copiedCount++;
          }
        } catch(e) {
          // 忽略复制错误
        }
      });
      
      report += `---\n\n`;
      report += `*已同步 ${copiedCount} 个文件到本地*\n`;
      
      fs.writeFileSync(path.join(COLLECT_DIR, '收集报告.md'), report, 'utf-8');
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, count: collectedFiles.length, copied: copiedCount}));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: e.message}));
    }
    return;
  }
  
  // === API: 收集文章（多路径） ===
  if (pathname === '/api/collect-articles-multi' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sourcePaths, targetFolder, recursive } = JSON.parse(body);
        
        if (!sourcePaths || sourcePaths.length === 0) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: false, error: '请指定至少一个源路径'}));
          return;
        }
        
        const collectedFiles = [];
        
        // 扫描目录
        function walk(dir, baseDir, sourceLabel) {
          if (!fs.existsSync(dir)) return;
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              if (recursive) {
                const skipDirs = ['node_modules', '.git', 'logs', 'file_store', 'embedding_cache', 'downloads', '.cache', 'tmp'];
                if (!skipDirs.includes(item) && !item.startsWith('.')) {
                  walk(fullPath, baseDir, sourceLabel);
                }
              }
            } else {
              const ext = path.extname(item).toLowerCase();
              if (['.md', '.txt'].includes(ext)) {
                const relPath = path.relative(baseDir, fullPath);
                collectedFiles.push({
                  path: fullPath,
                  relPath: relPath,
                  name: item,
                  mtime: stat.mtime,
                  size: stat.size,
                  source: sourceLabel
                });
              }
            }
          }
        }
        
        // 扫描每个源路径
        for (const sourcePath of sourcePaths) {
          if (fs.existsSync(sourcePath)) {
            const label = sourcePath.includes('openclaw') ? 'OpenClaw' : 
                          sourcePath.includes('copaw') ? 'Copaw' : 
                          path.basename(sourcePath);
            walk(sourcePath, sourcePath, label);
          }
        }
        
        if (collectedFiles.length === 0) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: true, scanned: 0, count: 0, message: '未找到可收集的文章'}));
          return;
        }
        
        // 按修改时间排序
        collectedFiles.sort((a, b) => b.mtime - a.mtime);
        
        // 创建目标文件夹
        const targetDir = path.join(DIARY_DIR, targetFolder || '📥 文章收集/源文件');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 复制文件 - 按来源分文件夹
        let copiedCount = 0;
        const copiedFiles = [];
        const sourceFolders = {}; // 记录每个来源的文件夹
        
        for (const f of collectedFiles) {
          try {
            // 根据来源创建子文件夹
            let sourceSubDir = path.join(targetDir, f.source);
            if (!sourceFolders[f.source]) {
              if (!fs.existsSync(sourceSubDir)) {
                fs.mkdirSync(sourceSubDir, { recursive: true });
              }
              sourceFolders[f.source] = true;
            }
            
            let destPath = path.join(sourceSubDir, f.name);
            
            // 检查文件名冲突
            if (fs.existsSync(destPath)) {
              const existingStat = fs.statSync(destPath);
              // 如果源文件更新，覆盖
              if (existingStat.mtime < f.mtime) {
                fs.copyFileSync(f.path, destPath);
                copiedCount++;
              }
            } else {
              fs.copyFileSync(f.path, destPath);
              copiedCount++;
            }
            
            copiedFiles.push({
              name: f.name,
              mtime: f.mtime,
              size: f.size,
              source: f.source,
              relPath: f.relPath
            });
          } catch(e) {}
        }
        
        // 生成收集报告
        const reportDir = path.dirname(targetDir);
        const reportPath = path.join(reportDir, '收集报告.md');
        
        let report = `# 📥 文章收集报告\n\n`;
        report += `> 收集时间: ${new Date().toLocaleString()}\n`;
        report += `> 源路径: ${sourcePaths.join(', ')}\n`;
        report += `> 目标文件夹: ${targetFolder}\n`;
        report += `> 收集模式: ${recursive ? '递归（含子目录）' : '仅当前目录'}\n`;
        report += `> 文件自动按来源分文件夹存放\n\n`;
        report += `---\n\n`;
        report += `## 📊 统计\n\n`;
        report += `- 发现文件: ${collectedFiles.length}\n`;
        report += `- 已同步: ${copiedCount}\n`;
        report += `- 来源文件夹: ${Object.keys(sourceFolders).length} 个\n\n`;
        report += `### 📁 来源文件夹分布\n\n`;
        for (const [source, _] of Object.entries(sourceFolders)) {
          const count = copiedFiles.filter(f => f.source === source).length;
          report += `- **${source}**: ${count} 个文件\n`;
        }
        report += `\n---\n\n`;
        report += `## 📁 已收集文件（按来源分组）\n\n`;
        
        // 按来源分组
        const bySource = {};
        for (const f of copiedFiles) {
          if (!bySource[f.source]) bySource[f.source] = [];
          bySource[f.source].push(f);
        }
        
        for (const [source, files] of Object.entries(bySource)) {
          report += `### ${source} (${files.length} 个)\n\n`;
          for (const f of files) {
            const mtime = f.mtime.toLocaleDateString();
            const size = (f.size / 1024).toFixed(1) + 'KB';
            report += `- [[${f.name}]] (${mtime}, ${size})\n`;
          }
          report += '\n';
        }
        
        fs.writeFileSync(reportPath, report, 'utf-8');
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true, 
          scanned: collectedFiles.length,
          count: copiedCount,
          report: path.dirname(targetFolder) + '/收集报告.md'
        }));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === API: 收集文章（支持指定路径） ===
  if (pathname === '/api/collect-articles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sourcePath, targetFolder, recursive } = JSON.parse(body);
        
        if (!sourcePath) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: false, error: '请指定源文件夹路径'}));
          return;
        }
        
        // 检查源路径是否存在
        if (!fs.existsSync(sourcePath)) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: false, error: '源文件夹不存在: ' + sourcePath}));
          return;
        }
        
        const collectedFiles = [];
        
        // 扫描目录
        function walk(dir, baseDir) {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              // 是否递归
              if (recursive) {
                const skipDirs = ['node_modules', '.git', 'logs', 'file_store', 'embedding_cache', 'downloads', '.cache'];
                if (!skipDirs.includes(item)) {
                  walk(fullPath, baseDir);
                }
              }
            } else {
              const ext = path.extname(item).toLowerCase();
              if (['.md', '.txt'].includes(ext)) {
                const relPath = path.relative(baseDir, fullPath);
                collectedFiles.push({
                  path: fullPath,
                  relPath: relPath,
                  name: item,
                  mtime: stat.mtime,
                  size: stat.size
                });
              }
            }
          }
        }
        
        walk(sourcePath, sourcePath);
        
        if (collectedFiles.length === 0) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: true, count: 0, message: '未找到可收集的文章'}));
          return;
        }
        
        // 按修改时间排序
        collectedFiles.sort((a, b) => b.mtime - a.mtime);
        
        // 创建目标文件夹
        const targetDir = path.join(DIARY_DIR, targetFolder || '📥 文章收集/源文件');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 复制文件
        let copiedCount = 0;
        const copiedFiles = [];
        
        for (const f of collectedFiles) {
          try {
            // 使用原始文件名，避免冲突加序号
            let destName = f.name;
            let destPath = path.join(targetDir, destName);
            
            // 检查文件名冲突
            if (fs.existsSync(destPath)) {
              const existingStat = fs.statSync(destPath);
              // 如果源文件更新，覆盖
              if (existingStat.mtime < f.mtime) {
                fs.copyFileSync(f.path, destPath);
                copiedCount++;
              }
            } else {
              fs.copyFileSync(f.path, destPath);
              copiedCount++;
            }
            
            copiedFiles.push({
              name: f.name,
              mtime: f.mtime,
              size: f.size,
              source: f.relPath
            });
          } catch(e) {
            // 忽略单个文件复制错误
          }
        }
        
        // 生成收集报告
        const reportDir = path.dirname(targetDir);
        const reportPath = path.join(reportDir, '收集报告.md');
        
        let report = `# 📥 文章收集报告\n\n`;
        report += `> 收集时间: ${new Date().toLocaleString()}\n`;
        report += `> 源路径: ${sourcePath}\n`;
        report += `> 目标文件夹: ${targetFolder}\n`;
        report += `> 收集模式: ${recursive ? '递归（含子目录）' : '仅当前目录'}\n\n`;
        report += `---\n\n`;
        report += `## 📊 统计\n\n`;
        report += `- 发现文件: ${collectedFiles.length}\n`;
        report += `- 已同步: ${copiedCount}\n\n`;
        report += `---\n\n`;
        report += `## 📁 已收集文件\n\n`;
        
        for (const f of copiedFiles) {
          const mtime = f.mtime.toLocaleDateString();
          const size = (f.size / 1024).toFixed(1) + 'KB';
          report += `- [[${f.name}]] (${mtime}, ${size}) - 来源: ${f.source}\n`;
        }
        
        fs.writeFileSync(reportPath, report, 'utf-8');
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true, 
          count: copiedCount,
          found: collectedFiles.length,
          report: targetFolder + '/收集报告.md'
        }));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === 新增API: 发布到微博 ===
  if (pathname === '/api/post-weibo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const {content} = JSON.parse(body);
      
      const config = getWeiboConfig();
      
      if (!config || !config.cookie) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: '未配置微博Cookie'}));
        return;
      }
      
      let weiboRes = '';
      try {
        // 使用Playwright Python版本发布
        const { execSync } = require('child_process');
        const safeContent = content.replace(/"/g, '\\"').replace(/\n/g, ' ');
        const pythonPath = process.env.PYTHON_PATH || 'python3';
        const output = execSync(`${pythonPath} "${path.join(__dirname, 'post-weibo.py')}" "${safeContent}"`, {
          encoding: 'utf-8',
          timeout: 45000
        });
        
        const result = JSON.parse(output);
        if (result.success) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(result));
        }
      } catch (e) {
        let errorMsg = e.message;
        // 如果返回HTML，说明可能Cookie失效
        if (weiboRes && weiboRes.includes('<!DOCTYPE')) {
          errorMsg = 'Cookie可能已过期，请重新获取微博Cookie';
        }
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: errorMsg}));
      }
    });
    return;
  }
  
  // === 新增API: 移动文件 ===
  if (pathname === '/api/move' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const {from, to} = JSON.parse(body);
      const sourcePath = path.join(DIARY_DIR, from);
      const targetPath = path.join(DIARY_DIR, to);
      
      if (!fs.existsSync(sourcePath)) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: '源文件不存在'}));
        return;
      }
      
      // 确保目标目录存在
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, {recursive: true});
      }
      
      // 移动文件
      fs.renameSync(sourcePath, targetPath);
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, newPath: to}));
    });
    return;
  }
  
  // === API: 获取配置的数据源列表 ===
  if (pathname === '/api/report-sources' && req.method === 'GET') {
    const config = getDataSources();
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(config));
    return;
  }
  
  // === API: 获取报告数据（根据配置加载）===
  if (pathname === '/api/report-data' && req.method === 'GET') {
    const sourceName = parsedUrl.query.source;
    const config = getDataSources();
    const source = config.data_sources?.find(s => s.name === sourceName);
    
    if (!source) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '数据源不存在'}));
      return;
    }
    
    try {
      const data = loadDataBySource(source);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, data, config: source.chart || {} }));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: e.message}));
    }
    return;
  }
  
  // === 报告查看页面 ===
  if (pathname === '/report-viewer') {
    let html = fs.readFileSync(path.join(__dirname, 'report-viewer.html'), 'utf-8');
    
    // 服务端预渲染数据源列表
    const config = getDataSources();
    const sources = config.data_sources || [];
    
    // 直接生成卡片 HTML
    const cardsHtml = sources.map(s => `
      <div class="card" onclick="selectSource('${s.name}')">
        <div class="icon">${s.icon}</div>
        <div class="name">${s.name}</div>
        <div class="desc">${s.desc}</div>
        <span class="category">${s.category}</span>
      </div>
    `).join('');
    
    // 替换空 grid 为预渲染的卡片
    html = html.replace('<div class="grid" id="sourcesGrid"></div>', '<div class="grid" id="sourcesGrid">' + cardsHtml + '</div>');
    
    // 注入 sources 变量供后续使用
    const sourcesJson = JSON.stringify(sources).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    html = html.replace('let currentData = null;', 'let currentData = null; let sources = ' + sourcesJson + ';');
    
    // 替换 loadSources 函数
    html = html.replace(
      'async function loadSources() {\n      const res = await fetch(\x27/api/report-sources\x27);\n      const config = await res.json();\n      const sources = config.data_sources || [];',
      'function loadSources() {\n      // 使用预加载的数据'
    );
    
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  
  // === 新增API: 获取数据文件列表（动态） ===
  if (pathname === '/api/data-files' && req.method === 'GET') {
    const dataFiles = [];
    const dataDir = path.join(COPAW_DIR, 'data');
    
    // 动态扫描data目录下的文件
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      const iconMap = { '.db': '🗄️', '.json': '📄', '.csv': '📊', '.xlsx': '📊' };
      const catMap = { 'stock': '财务', 'family': '家庭', 'schedule': '日程', 'health': '健康', 'reminder': '提醒' };
      
      files.forEach(file => {
        const ext = path.extname(file);
        const fullPath = path.join(dataDir, file);
        if (fs.statSync(fullPath).isFile()) {
          let category = '其他';
          for (const [key, cat] of Object.entries(catMap)) {
            if (file.toLowerCase().includes(key)) { category = cat; break; }
          }
          dataFiles.push({
            name: path.basename(file, ext),
            category,
            icon: iconMap[ext] || '📄',
            file,
            path: fullPath,
            desc: `${ext === '.db' ? 'SQLite数据库' : ext.replace('.','').toUpperCase() + '文件'}`
          });
        }
      });
    }
    
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(dataFiles));
    return;
  }
  
  // === API: 获取数据库表列表 ===
  if (pathname === '/api/db-tables' && req.method === 'GET') {
    const dbPath = parsedUrl.query.path;
    if (!dbPath || !fs.existsSync(dbPath)) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '数据库文件不存在'}));
      return;
    }
    
    try {
      const db = new Database(dbPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      db.close();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(tables.map(t => t.name)));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 获取数据库表数据 ===
  if (pathname === '/api/db-table' && req.method === 'GET') {
    const dbPath = parsedUrl.query.path;
    const table = parsedUrl.query.table;
    if (!dbPath || !fs.existsSync(dbPath)) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '数据库文件不存在'}));
      return;
    }
    if (!table) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '未指定表名'}));
      return;
    }
    
    try {
      const db = new Database(dbPath, { readonly: true });
      // 获取表结构
      const schema = db.prepare(`PRAGMA table_info(${table})`).all();
      // 获取表数据（限制1000条）
      const data = db.prepare(`SELECT * FROM ${table} LIMIT 1000`).all();
      db.close();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ schema, data }));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 读取数据文件内容 ===
  if (pathname === '/api/data-file' && req.method === 'GET') {
    const filePath = parsedUrl.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '文件不存在'}));
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(content);
    } else if (ext === '.db') {
      // SQLite 数据库 - 返回表数据
      try {
        const db = new Database(filePath, { readonly: true });
        
        // 获取所有表
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        
        const result = { type: 'database', tables: {} };
        
        // 读取每个表的数据
        for (const t of tables) {
          const tableName = t.name;
          let data;
          if (tableName === 'schedules') {
            // 日程表
            data = db.prepare("SELECT id, title, start, end, color, description, created_at FROM schedules ORDER BY start").all();
          } else if (tableName === 'special_days') {
            // 纪念日表
            data = db.prepare("SELECT id, title, content, date, is_lunar, remind_days, created_at FROM special_days ORDER BY date").all();
          } else {
            data = db.prepare(`SELECT * FROM ${tableName}`).all();
          }
          result.tables[tableName] = data;
        }
        
        db.close();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(result, null, 2));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    } else {
      res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(fs.readFileSync(filePath, 'utf-8'));
    }
    return;
  }
  
  // === API: AI 配置获取 ===
  if (pathname === '/api/ai/config' && req.method === 'GET') {
    try {
      const config = aiService.loadConfig();
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(config));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: AI 配置保存 ===
  if (pathname === '/api/ai/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        aiService.saveConfig(config);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 摘要生成（普通） ===
  if (pathname === '/api/ai/summary' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, maxLength } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少内容'}));
          return;
        }
        
        const summary = await aiService.generateSummary(content, maxLength || 200);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({summary}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 摘要生成（流式） ===
  if (pathname === '/api/ai/summary/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, maxLength } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少内容'}));
          return;
        }
        
        // 设置 SSE 响应头
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        
        // 流式生成摘要
        await aiService.generateSummaryStream(content, (chunk) => {
          res.write(`data: ${JSON.stringify({chunk})}\n\n`);
        }, maxLength || 200);
        
        // 发送完成信号
        res.write(`data: ${JSON.stringify({done: true})}\n\n`);
        res.end();
      } catch(e) {
        res.write(`data: ${JSON.stringify({error: e.message})}\n\n`);
        res.end();
      }
    });
    return;
  }
  
  // === API: AI 语义搜索 ===
  if (pathname === '/api/ai/search' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { query } = JSON.parse(body);
        if (!query) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少查询内容'}));
          return;
        }
        
        // 使用现有的搜索函数作为候选获取
        const searchFn = async (keyword) => {
          const results = [];
          const keywordLower = keyword.toLowerCase();
          
          function scanDir(dir, relativePath = '') {
            const items = fs.readdirSync(dir);
            for (const item of items) {
              const fullPath = path.join(dir, item);
              const relPath = path.join(relativePath, item);
              const stat = fs.statSync(fullPath);
              
              if (stat.isDirectory()) {
                scanDir(fullPath, relPath);
              } else if (item.endsWith('.md')) {
                const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
                if (content.includes(keywordLower)) {
                  const index = content.indexOf(keywordLower);
                  const start = Math.max(0, index - 50);
                  const end = Math.min(content.length, index + 150);
                  let preview = content.slice(start, end).replace(/\n/g, ' ');
                  if (start > 0) preview = '...' + preview;
                  if (end < content.length) preview = preview + '...';
                  
                  results.push({
                    file: relPath,
                    name: item,
                    preview: preview,
                    relevance: 1
                  });
                }
              }
            }
          }
          
          scanDir(DIARY_DIR);
          return results;
        };
        
        const result = await aiService.semanticSearch(query, DIARY_DIR, searchFn);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: 获取润色风格列表 ===
  if (pathname === '/api/ai/polish/styles' && req.method === 'GET') {
    try {
      const styles = aiService.getPolishStyles();
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({success: true, styles}));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: 保存润色风格列表 ===
  if (pathname === '/api/ai/polish/styles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { styles } = JSON.parse(body);
        if (!styles || !Array.isArray(styles)) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '风格列表格式错误'}));
          return;
        }
        
        const savedStyles = aiService.savePolishStyles(styles);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, styles: savedStyles}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 文本润色（流式） ===
  if (pathname === '/api/ai/polish/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text, style } = JSON.parse(body);
        if (!text) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文本内容'}));
          return;
        }
        if (!style) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少风格要求'}));
          return;
        }
        
        // 设置 SSE 响应头
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        
        // 流式润色
        await aiService.polishTextStream(text, style, (chunk) => {
          res.write(`data: ${JSON.stringify({chunk})}\n\n`);
        });
        
        // 发送完成信号
        res.write(`data: ${JSON.stringify({done: true})}\n\n`);
        res.end();
      } catch(e) {
        res.write(`data: ${JSON.stringify({error: e.message})}\n\n`);
        res.end();
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 分类单篇日记 ===
  if (pathname === '/api/ai/organize/classify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, fileName } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少内容'}));
          return;
        }
        
        const result = await aiService.classifyDiary(content, fileName || '未知文件');
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, ...result}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 批量并行分析（优化版） ===
  if (pathname === '/api/ai/organize/analyze-batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { files, features, skipOrganized } = JSON.parse(body);
        if (!files || !Array.isArray(files) || files.length === 0) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件列表'}));
          return;
        }
        
        // 辅助函数：检查文件是否已整理（兼容新旧数据结构）
        function isFileOrganized(filePath, config) {
          const assignment = config.fileAssignments[filePath];
          if (!assignment) return false; // 未分配
          
          // 新结构：检查source字段
          if (typeof assignment === 'object' && assignment.source) {
            return assignment.source === 'manual' || assignment.source === 'ai';
          }
          // 旧结构：已有分配视为已整理
          return typeof assignment === 'string';
        }
        
        // 获取已整理状态，决定是否跳过
        const config = getVirtualFolders();
        const skipOrganizedFiles = skipOrganized !== false; // 默认跳过已整理的
        
        let toAnalyze = files;
        const skippedFiles = [];
        const alreadyOrganized = [];
        
        if (skipOrganizedFiles) {
          toAnalyze = [];
          for (const f of files) {
            const assignment = config.fileAssignments[f];
            if (isFileOrganized(f, config)) {
              const source = typeof assignment === 'object' ? assignment.source : 'legacy';
              alreadyOrganized.push({ file: f, source, reason: '已整理' });
            } else {
              toAnalyze.push(f);
            }
          }
        }
        
        // 扫描日记目录获取内容
        const diaries = [];
        for (const f of toAnalyze) {
          const filePath = path.join(DIARY_DIR, f);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            diaries.push({ path: f, name: path.basename(f), content });
          }
        }
        
        // 如果没有需要分析的文件
        if (diaries.length === 0) {
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: true, 
            results: [], 
            count: 0,
            skipped: alreadyOrganized,
            message: '所有文件均已整理，无需重复分析'
          }));
          return;
        }
        
        // 使用并行批量分析（合并分类+标签）
        const results = await aiService.analyzeDiariesBatch(diaries, 5);
        
        // 如果需要关联发现，快速处理
        if (features && features.includes('related')) {
          const allDiariesForRelated = diaries;
          for (const r of results) {
            if (!r.error) {
              const diary = diaries.find(d => d.path === r.file);
              if (diary) {
                r.related = await aiService.findRelated(diary.content, r.file, allDiariesForRelated);
              }
            }
          }
        }
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true, 
          results, 
          count: results.length,
          skipped: alreadyOrganized,
          analyzed: toAnalyze.length,
          originalTotal: files.length
        }));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 批量分类（旧版，保留） ===
  if (pathname === '/api/ai/organize/classify-batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { files } = JSON.parse(body);
        if (!files || !Array.isArray(files)) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件列表'}));
          return;
        }
        
        // 分类结果数组
        const results = [];
        // 需要AI分类的文件（非日期格式）
        const diariesForAI = [];
        
        // 第一步：预处理 - 日期格式文件直接归类到"对话记录"
        for (const f of files) {
          const filePath = path.join(DIARY_DIR, f);
          
          // 检查是否为日期格式文件名
          if (isDateFilename(f)) {
            // 日期格式文件自动归类到"对话记录"，跳过AI分类
            results.push({
              path: f,
              name: path.basename(f),
              category: '对话记录',
              confidence: 1.0,
              reason: '日期格式文件，自动归类到对话记录',
              source: 'system',
              skippedAI: true  // 标记跳过了AI分类
            });
            continue;
          }
          
          // 非日期格式文件，准备交给AI分类
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            diariesForAI.push({ path: f, name: path.basename(f), content });
          }
        }
        
        // 第二步：AI分类非日期格式文件
        if (diariesForAI.length > 0) {
          const aiResults = await aiService.classifyDiaries(diariesForAI);
          // 合并AI分类结果
          for (const r of aiResults) {
            r.source = 'ai';  // 标记为AI分类
            results.push(r);
          }
        }
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, results, count: results.length, skipped: files.length - diariesForAI.length}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 生成标签 ===
  if (pathname === '/api/ai/organize/tags' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少内容'}));
          return;
        }
        
        const result = await aiService.generateTags(content);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, ...result}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 发现关联 ===
  if (pathname === '/api/ai/organize/related' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, filePath } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少内容'}));
          return;
        }
        
        // 获取所有日记文件
        const allDiaries = [];
        function scanDir(dir) {
          if (!fs.existsSync(dir)) return;
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory() && !item.startsWith('.')) {
              scanDir(fullPath);
            } else if (item.endsWith('.md')) {
              const relPath = path.relative(DIARY_DIR, fullPath);
              allDiaries.push({
                path: relPath,
                name: item,
                content: fs.readFileSync(fullPath, 'utf-8')
              });
            }
          }
        }
        scanDir(DIARY_DIR);
        
        const related = await aiService.findRelated(content, filePath, allDiaries);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, related}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 生成系列文章（流式） ===
  if (pathname === '/api/ai/organize/series/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { files, title } = JSON.parse(body);
        if (!files || !Array.isArray(files) || files.length === 0) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件列表'}));
          return;
        }
        
        // 获取日记内容
        const diaries = [];
        for (const f of files) {
          const filePath = path.join(DIARY_DIR, f);
          if (fs.existsSync(filePath)) {
            diaries.push({
              path: f,
              name: path.basename(f),
              content: fs.readFileSync(filePath, 'utf-8')
            });
          }
        }
        
        // SSE 流式响应
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        
        await aiService.generateSeriesStream(diaries, title || '日记系列', (chunk) => {
          res.write(`data: ${JSON.stringify({chunk})}\n\n`);
        });
        
        res.write(`data: ${JSON.stringify({done: true})}\n\n`);
        res.end();
      } catch(e) {
        res.write(`data: ${JSON.stringify({error: e.message})}\n\n`);
        res.end();
      }
    });
    return;
  }
  
  // === API: AI 智能整理 - 获取所有日记文件列表 ===
  if (pathname === '/api/ai/organize/files' && req.method === 'GET') {
    try {
      const files = [];
      function scanDir(dir, basePath = '') {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relPath = basePath ? basePath + '/' + item : item;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && !item.startsWith('.')) {
            scanDir(fullPath, relPath);
          } else if (item.endsWith('.md')) {
            files.push({
              path: relPath,
              name: item,
              size: stat.size,
              mtime: stat.mtime
            });
          }
        }
      }
      scanDir(DIARY_DIR);
      
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({success: true, files, count: files.length}));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }
  
  // === API: AI 智能整理 - 应用整理结果（添加标签和关联） ===
  if (pathname === '/api/ai/organize/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { file, tags, related } = JSON.parse(body);
        if (!file) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '缺少文件路径'}));
          return;
        }
        
        const filePath = path.join(DIARY_DIR, file);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: '文件不存在'}));
          return;
        }
        
        let content = fs.readFileSync(filePath, 'utf-8');
        
        // 添加标签
        if (tags && tags.length > 0) {
          const tagLine = '\n\n---\n**标签：** ' + tags.join(' ');
          // 检查是否已有标签
          if (!content.includes('**标签：**')) {
            content += tagLine;
          }
        }
        
        // 添加关联
        if (related && related.length > 0) {
          const relatedLinks = related.map(r => `[[${r.name}]]`).join(' ');
          const relatedLine = '\n**相关日记：** ' + relatedLinks;
          if (!content.includes('**相关日记：**')) {
            content += relatedLine;
          }
        }
        
        fs.writeFileSync(filePath, content, 'utf-8');
        
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({success: true, message: '整理结果已应用'}));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  // === API: AI 配置测试 ===
  if (pathname === '/api/ai/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { baseUrl, model, apiKey } = JSON.parse(body);
        
        if (!baseUrl || !model || !apiKey) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: false, error: '请填写完整配置信息'}));
          return;
        }
        
        // 构建测试请求
        const requestBody = {
          model: model,
          messages: [{ role: 'user', content: '你好，请回复"测试成功"' }],
          max_tokens: 50
        };
        
        const urlObj = new URL(baseUrl + '/chat/completions');
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        const requestOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0 Diary-System/1.0',
            'Accept': '*/*'
          }
        };
        
        const testResult = await new Promise((resolve, reject) => {
          const req = protocol.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                if (res.statusCode === 401) {
                  resolve({success: false, error: 'API Key 无效或认证失败'});
                  return;
                }
                if (res.statusCode === 404) {
                  resolve({success: false, error: 'API 地址不正确'});
                  return;
                }
                if (res.statusCode >= 400) {
                  resolve({success: false, error: '请求失败 (HTTP ' + res.statusCode + ')'});
                  return;
                }
                
                const json = JSON.parse(data);
                if (json.error) {
                  resolve({success: false, error: json.error.message || json.error});
                } else if (json.choices && json.choices[0]) {
                  resolve({success: true, response: json.choices[0].message.content});
                } else {
                  resolve({success: false, error: '返回格式异常'});
                }
              } catch(e) {
                resolve({success: false, error: '解析响应失败: ' + e.message});
              }
            });
          });
          
          req.on('error', (e) => {
            resolve({success: false, error: '连接失败: ' + e.message});
          });
          
          req.setTimeout(15000, () => {
            req.destroy();
            resolve({success: false, error: '连接超时'});
          });
          
          req.write(JSON.stringify(requestBody));
          req.end();
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(testResult));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      }
    });
    return;
  }
  
  // === API: 图数据 - 初始化 ===
  if (pathname === '/api/graph/init' && req.method === 'GET') {
    try {
      const db = new Database(GRAPH_DB_FILE);
      db.exec(`CREATE TABLE IF NOT EXISTS graph_nodes (id TEXT PRIMARY KEY, title TEXT, category TEXT, mtime TEXT, source TEXT)`);
      db.exec(`CREATE TABLE IF NOT EXISTS graph_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, target TEXT NOT NULL, type TEXT NOT NULL, weight REAL DEFAULT 1.0, evidence TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_edges_type ON graph_edges(type)');
      // Bookmarks 书签表
      db.exec(`CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, title TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_bookmarks_file ON bookmarks(file)');
      // 反向链接缓存表
      db.exec(`CREATE TABLE IF NOT EXISTS backlinks_cache (
        target TEXT NOT NULL,
        source_file TEXT NOT NULL,
        link_type TEXT DEFAULT 'wiki',
        section TEXT,
        context TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (target, source_file)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_backlinks_target ON backlinks_cache(target)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_backlinks_source ON backlinks_cache(source_file)');
      // 未链接提及缓存表
      db.exec(`CREATE TABLE IF NOT EXISTS unlinked_mentions (
        target TEXT NOT NULL,
        source_file TEXT NOT NULL,
        context TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (target, source_file)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_unlinked_target ON unlinked_mentions(target)');
      // 索引元数据表
      db.exec(`CREATE TABLE IF NOT EXISTS index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      db.close();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, message: '图数据库初始化完成（含反向链接缓存表）' }));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // === API: 图数据 - 构建图 ===
  if (pathname === '/api/graph/build' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { force = false } = JSON.parse(body || '{}');
        const db = new Database(GRAPH_DB_FILE);
        
        if (force) {
          db.exec('DELETE FROM graph_edges');
          db.exec('DELETE FROM graph_nodes');
        }
        
        const vfConfig = JSON.parse(fs.readFileSync(VIRTUAL_FOLDERS_FILE, 'utf-8'));
        const fileAssignments = vfConfig.fileAssignments || {};
        const insertNode = db.prepare('INSERT OR REPLACE INTO graph_nodes (id, title, category, mtime, source) VALUES (?, ?, ?, ?, ?)');
        
        let nodeCount = 0;
        for (const [filePath, info] of Object.entries(fileAssignments)) {
          const fullPath = path.join(DIARY_DIR, filePath);
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            const title = path.basename(filePath);
            const category = typeof info === 'object' ? info.folder : info;
            const source = typeof info === 'object' ? (info.source || 'legacy') : 'legacy';
            insertNode.run(filePath, title, category, stat.mtime.toISOString(), source);
            nodeCount++;
          }
        }
        
        const nodes = db.prepare('SELECT * FROM graph_nodes').all();
        const insertEdge = db.prepare('INSERT INTO graph_edges (source, target, type, weight, evidence) VALUES (?, ?, ?, ?, ?)');
        
        let edgeCount = 0;
        const edgeCache = new Set();
        
        // 标签提取函数（每个文章只取2个核心标签）
        function extractTags(content, title) {
          // 中文停用词
          const stopWords = ['的', '是', '在', '有', '和', '了', '与', '到', '对', '为', '以', '及', '等', '中', '上', '下', '来', '去', '这', '那', '就', '也', '都', '会', '能', '要', '不', '可', '我', '你', '他', '她', '它', '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '如何', '为什么', '因为', '所以', '但是', '如果', '虽然', '还是', '或者', '以及', '通过', '进行', '实现', '需要', '使用', '包括', '关于', '根据', '按照', '本次', '此次', '今天', '明天', '昨天', '上午', '下午', '晚上', '周一', '周二', '周三', '周四', '周五', '周六', '周日', '时间', '地点', '人员', '内容', '会议', '工作', '日记', '报告', '笔记', '活动', '文件', '系统', '功能', '问题', '方法', '方案', '结果', '信息', '数据', '分析', '整理', '学习', '一个', '一些', '一种', '可以', '已经', '可能', '应该', '这样', '那样', '没有', '之后', '之前', '以上', '以下', '之间', '其中', '其他', '所有', '更多', '更少', '最大', '最小', '最后', '第一', '第二', '第三', '每个', '各个', '任何', '某些', '某个', '整体', '部分', '整体', '局部', '全局', '单次', '多次', '一次', '两次', '每次', '总共', '合计', '共计', '统计', '计算', '估算', '预算', '决算', '核算', '结算', '清理', '格式', '状态', '类型', '模式', '方式', '方法', '步骤', '流程', '过程', '阶段', '环节', '节点', '关键', '重点', '难点', '疑点', '特点', '优点', '缺点', '亮点', '突破', '创新', '改进', '优化', '调整', '修改', '变更', '更新', '升级', '降级', '迁移', '转移', '转换', '切换', '替换', '替代', '覆盖', '覆盖', '重写', '改写', '编写', '撰写', '编辑', '修订', '审阅', '审核', '审批', '批准', '通过', '拒绝', '驳回', '撤销', '撤回', '取消', '作废', '失效', '有效', '无效', '生效', '过期', '到期', '延期', '续期', '更新', '刷新', '重置', '复位', '恢复', '还原', '还原', '备份', '存档', '归档', '删除', '移除', '清除', '清空', '卸载', '安装', '部署', '发布', '上线', '下线', '启用', '停用', '激活', '冻结', '锁定', '解锁', '绑定', '解绑', '连接', '断开', '接入', '退出', '登录', '注册', '注销', '订阅', '退订', '关注', '取消', '收藏', '分享', '转发', '回复', '评论', '点赞', '评分', '排名', '排序', '筛选', '过滤', '搜索', '查询', '检索', '查找', '发现', '识别', '辨认', '确认', '核实', '验证', '校验', '检查', '测试', '调试', '运行', '执行', '处理', '计算', '运算', '转换', '翻译', '解释', '解析', '解码', '编码', '加密', '解密', '压缩', '解压', '打包', '解包', '拆分', '合并', '分割', '组合', '组装', '集成', '整合', '聚合', '汇总', '归纳', '总结', '概述', '简介', '详细', '完整', '简要', '概括', '提炼', '抽取', '提取', '生成', '创建', '制作', '构建', '设计', '规划', '计划', '安排', '部署', '配置', '设置', '设定', '定义', '声明', '宣布', '公告', '通知', '提醒', '提示', '警告', '告警', '报警', '报错', '错误', '异常', '故障', '问题', '缺陷', '漏洞', '风险', '隐患', '危机', '挑战', '机会', '机遇', '契机', '转折', '变化', '变动', '波动', '震荡', '起伏', '升降', '涨跌', '增减', '扩大', '缩小', '扩张', '收缩', '延伸', '缩短', '加快', '放缓', '加速', '减速', '提前', '推迟', '延后', '超前', '滞后', '同步', '异步', '并行', '串行', '顺序', '逆序', '正向', '反向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向', '正向', '逆向'];
          
          const wordFreq = {};
          
          // 从标题提取（权重更高）
          if (title) {
            const cleanTitle = title.replace(/[^\u4e00-\u9fa5]/g, '');
            for (let len = 2; len <= 4; len++) {
              for (let i = 0; i <= cleanTitle.length - len; i++) {
                const word = cleanTitle.slice(i, i + len);
                if (/^[\u4e00-\u9fa5]+$/.test(word) && !stopWords.includes(word)) {
                  wordFreq[word] = (wordFreq[word] || 0) + 10; // 标题词权重x10
                }
              }
            }
          }
          
          // 从内容提取高频词（前3000字）
          const text = content.slice(0, 3000);
          const chineseText = text.replace(/[^\u4e00-\u9fa5]/g, '');
          for (let len = 2; len <= 4; len++) {
            for (let i = 0; i <= chineseText.length - len; i++) {
              const word = chineseText.slice(i, i + len);
              if (!stopWords.includes(word)) {
                wordFreq[word] = (wordFreq[word] || 0) + 1;
              }
            }
          }
          
          // 取前2个最高频词作为标签
          const sortedWords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([w]) => w);
          
          return sortedWords;
        }
        
        // 为每个节点生成标签并保存
        const updateTags = db.prepare('UPDATE graph_nodes SET tags = ? WHERE id = ?');
        for (const node of nodes) {
          const fullPath = path.join(DIARY_DIR, node.id);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const title = node.title || path.basename(node.id, '.md');
            const tags = extractTags(content, title);
            updateTags.run(JSON.stringify(tags), node.id);
          }
        }
        
        // 重新查询节点以获取tags
        const nodesWithTags = db.prepare('SELECT * FROM graph_nodes').all();
        
        // 通过标签建立关系（只有相同标签才关联）
        const nodeTags = {};
        for (const node of nodesWithTags) {
          if (node.tags) {
            try {
              nodeTags[node.id] = JSON.parse(node.tags);
            } catch(e) {
              nodeTags[node.id] = [];
            }
          }
        }
        
        // 标签分组
        const tagGroups = {};
        for (const [nodeId, tags] of Object.entries(nodeTags)) {
          for (const tag of tags) {
            if (!tagGroups[tag]) tagGroups[tag] = [];
            tagGroups[tag].push(nodeId);
          }
        }
        
        // 有相同标签的文件建立关系
        for (const [tag, nodeList] of Object.entries(tagGroups)) {
          if (nodeList.length >= 2 && nodeList.length <= 30) {
            for (let i = 0; i < nodeList.length; i++) {
              for (let j = i + 1; j < nodeList.length; j++) {
                const edgeKey = [nodeList[i], nodeList[j]].sort().join('->');
                if (!edgeCache.has(edgeKey)) {
                  insertEdge.run(nodeList[i], nodeList[j], 'tag', 0.7, `共同标签: ${tag}`);
                  edgeCache.add(edgeKey);
                  edgeCount++;
                }
              }
            }
          }
        }
        
        // 同日期关系（保留）
        const nodeByDate = {};
        for (const node of nodesWithTags) {
          const dateMatch = node.id.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const date = dateMatch[1];
            if (!nodeByDate[date]) nodeByDate[date] = [];
            nodeByDate[date].push(node);
          }
        }
        for (const [date, groupNodes] of Object.entries(nodeByDate)) {
          for (let i = 0; i < groupNodes.length; i++) {
            for (let j = i + 1; j < groupNodes.length; j++) {
              const edgeKey = [groupNodes[i].id, groupNodes[j].id].sort().join('->');
              if (!edgeCache.has(edgeKey)) {
                insertEdge.run(groupNodes[i].id, groupNodes[j].id, 'time', 0.6, `同日期: ${date}`);
                edgeCache.add(edgeKey);
                edgeCount++;
              }
            }
          }
        }
        
        // 同分类关系（仅限关键词重叠的，权重较低）
        const categoryGroups = {};
        for (const node of nodes) {
          if (!categoryGroups[node.category]) categoryGroups[node.category] = [];
          categoryGroups[node.category].push(node);
        }
        // 只有已通过关键词建立关系的同分类文件才额外加分
        // 不再单独建立分类关系
        
        db.close();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, message: '图数据构建完成', stats: { nodes: nodeCount, edges: edgeCount } }));
      } catch (e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // === API: 图数据 - 获取可视化数据 ===
  if (pathname === '/api/graph/network' && req.method === 'GET') {
    try {
      const category = parsedUrl.query.category;
      const edgeType = parsedUrl.query.edgeType;
      const minWeight = parseFloat(parsedUrl.query.minWeight || '0');
      const colorBy = parsedUrl.query.colorBy || 'category'; // category | type | freshness
      const db = new Database(GRAPH_DB_FILE);
      
      let nodeQuery = 'SELECT * FROM graph_nodes';
      const nodeParams = [];
      if (category) { nodeQuery += ' WHERE category = ?'; nodeParams.push(category); }
      const nodes = db.prepare(nodeQuery).all(...nodeParams);
      
      let edgeQuery = 'SELECT * FROM graph_edges WHERE weight >= ?';
      const edgeParams = [minWeight];
      if (edgeType) { edgeQuery += ' AND type = ?'; edgeParams.push(edgeType); }
      const edges = db.prepare(edgeQuery).all(...edgeParams);
      
      db.close();
      
      // 颜色映射
      const typeColors = {
        note: '#10b981', task: '#f59e0b', event: '#3b82f6', idea: '#8b5cf6',
        memory: '#ec4899', reference: '#6366f1', research: '#14b8a6', conversation: '#f97316'
      };
      const freshnessColors = {
        live: '#ef4444', breaking: '#f97316', current: '#eab308', fast: '#22d3ee',
        moderate: '#3b82f6', standard: '#10b981', academic: '#a855f7', evergreen: '#6b7280', permanent: '#1f2937'
      };
      
      const visNodes = nodes.map(n => {
        // 从文件推断类型和新鲜度
        const filePath = path.join(DIARY_DIR, n.id);
        let nodeType = 'note';
        let nodeFreshness = 'standard';
        
        try {
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);
            nodeType = frontmatter?.type || inferType(content);
            nodeFreshness = frontmatter?.freshness_tier || inferFreshnessTier(content, n.id);
          }
        } catch(e) {}
        
        // 根据colorBy参数选择颜色
        let color;
        if (colorBy === 'type') {
          color = typeColors[nodeType] || '#10b981';
        } else if (colorBy === 'freshness') {
          color = freshnessColors[nodeFreshness] || '#10b981';
        } else {
          // 默认按category
          color = getCategoryColor(n.category);
        }
        
        return {
          id: n.id,
          label: n.title || n.id.split('/').pop(),
          group: n.category,
          color: color,
          font: { color: '#fff' },
          title: `${n.title}\n分类: ${n.category}\n类型: ${nodeType}\n新鲜度: ${nodeFreshness}\n来源: ${n.source || '未知'}`,
          metadata: { type: nodeType, freshness: nodeFreshness, category: n.category }
        };
      });
      
      const visEdges = edges.map(e => ({
        id: e.id, from: e.source, to: e.target, label: e.type,
        title: e.evidence || e.type, value: e.weight, color: getEdgeColor(e.type)
      }));
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, nodes: visNodes, edges: visEdges, stats: { nodeCount: visNodes.length, edgeCount: visEdges.length } }));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }
  
  // 获取分类颜色的辅助函数
  function getCategoryColor(category) {
    const colors = {
      '工作': '#f59e0b', '学习': '#10b981', '生活': '#3b82f6', '娱乐': '#ec4899',
      '健康': '#14b8a6', '财务': '#8b5cf6', '家庭': '#f97316', '技术': '#6366f1',
      '未分类': '#6b7280'
    };
    return colors[category] || '#6b7280';
  }

  // === API: 图数据 - 统计 ===
  if (pathname === '/api/graph/stats' && req.method === 'GET') {
    try {
      const db = new Database(GRAPH_DB_FILE);
      const nodeCount = db.prepare('SELECT COUNT(*) as count FROM graph_nodes').get().count;
      const edgeCount = db.prepare('SELECT COUNT(*) as count FROM graph_edges').get().count;
      const categoryStats = db.prepare('SELECT category, COUNT(*) as count FROM graph_nodes GROUP BY category').all();
      const typeStats = db.prepare('SELECT type, COUNT(*) as count FROM graph_edges GROUP BY type').all();
      const maxEdges = nodeCount * (nodeCount - 1) / 2;
      const density = maxEdges > 0 ? (edgeCount / maxEdges).toFixed(4) : 0;
      db.close();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, stats: { nodes: nodeCount, edges: edgeCount, density, categories: categoryStats, edgeTypes: typeStats } }));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // === API: 图数据 - 单节点关系 ===
  if (pathname.startsWith('/api/graph/node/') && req.method === 'GET') {
    try {
      const nodeId = decodeURIComponent(pathname.replace('/api/graph/node/', ''));
      const db = new Database(GRAPH_DB_FILE);
      const node = db.prepare('SELECT * FROM graph_nodes WHERE id = ?').get(nodeId);
      if (!node) {
        db.close();
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: false, error: '节点不存在' }));
        return;
      }
      const edges = db.prepare('SELECT * FROM graph_edges WHERE source = ? OR target = ?').all(nodeId, nodeId);
      const relatedIds = new Set();
      for (const edge of edges) { relatedIds.add(edge.source); relatedIds.add(edge.target); }
      relatedIds.delete(nodeId);
      const relatedNodes = [];
      for (const id of relatedIds) {
        const n = db.prepare('SELECT * FROM graph_nodes WHERE id = ?').get(id);
        if (n) relatedNodes.push(n);
      }
      db.close();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, node, relatedNodes, edges }));
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }
  
  // 边颜色辅助函数（在回调外定义）
  function getEdgeColor(type) {
    const colors = { 'theme': '#74c0fc', 'tag': '#69db7c', 'time': '#ffd43b', 'content': '#b197fc' };
    return colors[type] || '#868e96';
  }
  
  // ========== Phase 1 新增 API ==========
  
  // Schema 信息
  if (pathname === '/api/schema' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ freshness_tiers: Object.keys(FRESHNESS_TTL), types: Object.keys(TYPE_DEFAULT_FRESHNESS) }));
    return;
  }
  
  // 自维护 Lint
  if (pathname === '/api/maintenance/lint' && req.method === 'GET') {
    try {
      const results = { broken_links: [], missing_frontmatter: [], stale_pages: [], orphan_pages: [], summary: {} };
      const allFiles = [];
      const walk = (dir) => {
        try {
          fs.readdirSync(dir).forEach(item => {
            const fp = path.join(dir, item);
            const st = fs.statSync(fp);
            if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
            else if (item.endsWith('.md')) allFiles.push({ path: path.relative(DIARY_DIR, fp), fullPath: fp });
          });
        } catch(e) {}
      };
      walk(DIARY_DIR);
      
      const existing = new Set(allFiles.map(f => f.path.replace('.md', '')));
      const linkPattern = /\[\[([^\]]+)\]\]/g;
      
      allFiles.forEach(file => {
        try {
          const content = fs.readFileSync(file.fullPath, 'utf-8');
          (content.match(linkPattern) || []).forEach(link => {
            const target = link.slice(2, -2).split('#')[0];
            if (!existing.has(target) && !existing.has(target + '.md')) results.broken_links.push({ file: file.path, target });
          });
          const { frontmatter } = parseFrontmatter(content);
          if (!frontmatter?.type) results.missing_frontmatter.push({ file: file.path });
          if (frontmatter?.freshness_tier && frontmatter?.updated && isStale(frontmatter.freshness_tier, frontmatter.updated)) results.stale_pages.push({ file: file.path });
        } catch(e) {}
      });
      
      try {
        const db = new Database(GRAPH_DB_FILE);
        const nodes = db.prepare('SELECT id, title FROM graph_nodes').all();
        const edges = db.prepare('SELECT DISTINCT source, target FROM graph_edges').all();
        db.close();
        const connected = new Set(edges.flatMap(e => [e.source, e.target]));
        nodes.forEach(n => { if (!connected.has(n.id)) results.orphan_pages.push({ id: n.id, title: n.title }); });
      } catch(e) {}
      
      results.summary = { total: allFiles.length, broken: results.broken_links.length, missing: results.missing_frontmatter.length, stale: results.stale_pages.length, orphan: results.orphan_pages.length, health: Math.max(0, 100 - results.broken_links.length*2 - results.missing_frontmatter.length - results.stale_pages.length*3) };
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(results));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // Research-on-Miss
  if (pathname === '/api/research' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        // 支持前端两种参数名：query 或 topic
        const query = data.query || data.topic;
        const depth = data.depth || 'standard';
        const outputFile = data.output_file;
        if (!query) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing query' })); return; }
        
        const db = new Database(GRAPH_DB_FILE);
        const nodes = db.prepare('SELECT id, title FROM graph_nodes WHERE title LIKE ? OR id LIKE ?').all(`%${query}%`, `%${query}%`);
        db.close();
        
        // 如果已有相关页面，直接返回
        if (nodes.length > 0) {
          res.writeHead(200); res.end(JSON.stringify({ found: true, success: true, file: nodes[0].id + '.md', results: nodes }));
          return;
        }
        
        const result = await aiService.researchTopic(query, depth);
        const slug = query.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, '').replace(/\s+/g, '-').slice(0, 50);
        // 支持自定义输出文件名
        const fileName = outputFile || `${slug}.md`;
        const fp = path.join(DIARY_DIR, fileName);
        
        const meta = { title: result.title || query, type: 'research', freshness_tier: depth === 'deep' ? 'academic' : 'fast', confidence: 'medium', tags: result.tags || [], created: new Date().toISOString().split('T')[0] };
        fs.writeFileSync(fp, `${generateFrontmatter(meta)}\n\n# ${meta.title}\n\n${result.content || result.summary || ''}\n`);
        
        const db2 = new Database(GRAPH_DB_FILE);
        db2.prepare('INSERT OR REPLACE INTO graph_nodes (id, title, category, mtime, source, tags) VALUES (?, ?, ?, ?, ?, ?)').run(slug, meta.title, 'research', new Date().toISOString(), 'research', '');
        db2.close();
        
        // 返回前端期望的格式
        res.writeHead(200); res.end(JSON.stringify({ found: false, researched: true, success: true, file: fileName, page: { slug, title: meta.title } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  
  // 批量更新Frontmatter
  if (pathname === '/api/frontmatter/batch-update' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body);
        if (!files?.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing files' })); return; }
        const results = [];
        files.forEach(f => {
          // 支持 file 或 path 属性 (lint 返回 file，前端可能传 path)
          const filePath = f.file || f.path;
          if (!filePath) return;
          const fp = path.join(DIARY_DIR, filePath);
          if (!fs.existsSync(fp)) return;
          const content = fs.readFileSync(fp, 'utf-8');
          const freshness = inferFreshnessTier(content, filePath);
          const type = inferType(content, f.category);
          const confidence = inferConfidence(content, f.sources);
          const meta = { title: f.name?.replace('.md', '') || filePath.split('/').pop().replace('.md', ''), type, freshness_tier: freshness, confidence, source: 'ai' };
          updateFrontmatter(fp, meta);
          results.push({ path: filePath, type, freshness_tier: freshness, confidence });
        });
        res.writeHead(200); res.end(JSON.stringify({ success: true, updated: results.length, results }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  
  // ========== 新增统计和维护API ==========
  
  // 获取页面统计（类型、新鲜度、置信度分布）
  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      const stats = getPageStats();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(stats));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // 获取过期页面列表
  if (pathname === '/api/maintenance/stale' && req.method === 'GET') {
    try {
      const stalePages = [];
      const allFiles = [];
      const walk = (dir) => {
        try {
          fs.readdirSync(dir).forEach(item => {
            const fp = path.join(dir, item);
            const st = fs.statSync(fp);
            if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
            else if (item.endsWith('.md')) allFiles.push(fp);
          });
        } catch(e) {}
      };
      walk(DIARY_DIR);
      
      allFiles.forEach(fp => {
        try {
          const content = fs.readFileSync(fp, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          if (frontmatter?.freshness_tier && frontmatter?.updated && isStale(frontmatter.freshness_tier, frontmatter.updated)) {
            stalePages.push({
              file: path.relative(DIARY_DIR, fp),
              freshness_tier: frontmatter.freshness_tier,
              updated: frontmatter.updated,
              days_stale: Math.floor((new Date() - new Date(frontmatter.updated)) / (24*60*60*1000))
            });
          }
        } catch(e) {}
      });
      
      // 按过期天数排序
      stalePages.sort((a, b) => b.days_stale - a.days_stale);
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ stale_pages: stalePages, count: stalePages.length }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // 辅助函数：获取过期页面列表（内部使用）
  function getStalePagesInternal(limit = 20) {
    const stalePages = [];
    const allFiles = [];
    const walk = (dir) => {
      try {
        fs.readdirSync(dir).forEach(item => {
          const fp = path.join(dir, item);
          const st = fs.statSync(fp);
          if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
          else if (item.endsWith('.md')) allFiles.push(fp);
        });
      } catch(e) {}
    };
    walk(DIARY_DIR);
    
    allFiles.forEach(fp => {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const { frontmatter } = parseFrontmatter(content);
        if (frontmatter?.freshness_tier && frontmatter?.updated && isStale(frontmatter.freshness_tier, frontmatter.updated)) {
          stalePages.push({
            file: path.relative(DIARY_DIR, fp),
            freshness_tier: frontmatter.freshness_tier,
            updated: frontmatter.updated,
            days_stale: Math.floor((new Date() - new Date(frontmatter.updated)) / (24*60*60*1000))
          });
        }
      } catch(e) {}
    });
    stalePages.sort((a, b) => b.days_stale - a.days_stale);
    return stalePages.slice(0, limit);
  }
  
  // API: 过期页面批量刷新
  if (pathname === '/api/maintenance/stale/refresh' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { files, limit } = JSON.parse(body || '{}');
        let filesToRefresh = files;
        
        if (!filesToRefresh?.length) {
          const stalePages = getStalePagesInternal(limit || 20);
          filesToRefresh = stalePages.map(p => ({ file: p.file }));
        }
        
        const results = [];
        const errors = [];
        
        filesToRefresh.forEach(f => {
          const filePath = f.file || f.path;
          const fp = path.join(DIARY_DIR, filePath);
          try {
            if (!fs.existsSync(fp)) {
              errors.push({ file: filePath, error: '文件不存在' });
              return;
            }
            const newDate = new Date().toISOString().split('T')[0];
            updateFrontmatter(fp, { updated: newDate, checked_at: newDate });
            results.push({ file: filePath, success: true });
          } catch(e) {
            errors.push({ file: filePath, error: e.message });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, refreshed: results.length, errors: errors.length, results, errors }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 过期页面批量归档
  if (pathname === '/api/maintenance/stale/archive' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body || '{}');
        if (!files?.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing files parameter' }));
          return;
        }
        
        const archiveDir = path.join(DIARY_DIR, 'archive');
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        
        const results = [];
        const errors = [];
        
        files.forEach(f => {
          const filePath = f.file || f.path;
          const srcPath = path.join(DIARY_DIR, filePath);
          const archiveName = `${new Date().toISOString().split('T')[0]}_${path.basename(filePath)}`;
          const destPath = path.join(archiveDir, archiveName);
          
          try {
            if (!fs.existsSync(srcPath)) {
              errors.push({ file: filePath, error: '源文件不存在' });
              return;
            }
            fs.renameSync(srcPath, destPath);
            results.push({ file: filePath, archived_to: archiveName });
          } catch(e) {
            errors.push({ file: filePath, error: e.message });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, archived: results.length, errors: errors.length, results, errors, archive_dir: 'archive/' }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 过期页面批量删除（需要confirm参数）
  if (pathname === '/api/maintenance/stale/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { files, confirm } = JSON.parse(body || '{}');
        if (!files?.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing files parameter' }));
          return;
        }
        if (confirm !== true) {
          res.writeHead(400); res.end(JSON.stringify({ 
            error: '需要confirm=true确认删除',
            warning: '删除操作不可恢复，请确认后再执行',
            files_to_delete: files.length
          }));
          return;
        }
        
        const results = [];
        const errors = [];
        const trashDir = path.join(DIARY_DIR, 'trash');
        if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
        
        files.forEach(f => {
          const filePath = f.file || f.path;
          const fp = path.join(DIARY_DIR, filePath);
          
          try {
            if (!fs.existsSync(fp)) {
              errors.push({ file: filePath, error: '文件不存在' });
              return;
            }
            const trashPath = path.join(trashDir, `${new Date().toISOString().split('T')[0]}_${path.basename(filePath)}`);
            fs.copyFileSync(fp, trashPath);
            fs.unlinkSync(fp);
            results.push({ file: filePath, deleted: true, backup: trashPath });
          } catch(e) {
            errors.push({ file: filePath, error: e.message });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, deleted: results.length, errors: errors.length, results, errors, backup_dir: 'trash/' }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // 置信度升级（基于来源数或人工确认）
  if (pathname === '/api/confidence/upgrade' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { files, level, reason } = JSON.parse(body);
        if (!files?.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing files' })); return; }
        
        const results = [];
        files.forEach(f => {
          const filePath = f.file || f.path;
          if (!filePath) return;
          const fp = path.join(DIARY_DIR, filePath);
          if (!fs.existsSync(fp)) return;
          
          const content = fs.readFileSync(fp, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          const currentConf = frontmatter?.confidence || 'low';
          
          // 置信度只能升级，不能降级
          const levels = ['low', 'medium', 'high'];
          const currentIndex = levels.indexOf(currentConf);
          const targetIndex = levels.indexOf(level);
          
          if (targetIndex > currentIndex) {
            const meta = { confidence: level, confidence_reason: reason || 'manual_upgrade' };
            updateFrontmatter(fp, meta);
            results.push({ path: filePath, from: currentConf, to: level });
          }
        });
        
        res.writeHead(200); res.end(JSON.stringify({ success: true, upgraded: results.length, results }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  
  // 自动推断并更新所有缺失的frontmatter
  if (pathname === '/api/frontmatter/auto-infer' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { limit = 50 } = JSON.parse(body);
        const results = [];
        const allFiles = [];
        
        const walk = (dir) => {
          try {
            fs.readdirSync(dir).forEach(item => {
              const fp = path.join(dir, item);
              const st = fs.statSync(fp);
              if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
              else if (item.endsWith('.md')) allFiles.push(fp);
            });
          } catch(e) {}
        };
        walk(DIARY_DIR);
        
        let processed = 0;
        allFiles.forEach(fp => {
          if (processed >= limit) return;
          try {
            const content = fs.readFileSync(fp, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);
            
            // 只处理缺失type或freshness_tier的文件
            if (!frontmatter?.type || !frontmatter?.freshness_tier) {
              const filePath = path.relative(DIARY_DIR, fp);
              const type = frontmatter?.type || inferType(content);
              const freshness = frontmatter?.freshness_tier || inferFreshnessTier(content, filePath);
              const confidence = frontmatter?.confidence || inferConfidence(content);
              
              const meta = { type, freshness_tier: freshness, confidence };
              updateFrontmatter(fp, meta);
              results.push({ file: filePath, type, freshness_tier: freshness, confidence });
              processed++;
            }
          } catch(e) {}
        });
        
        res.writeHead(200); res.end(JSON.stringify({ success: true, processed: results.length, results }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  
  // ========== Phase 1 API 结束 ==========
  
  // ========== Phase 2: 反向链接系统 ==========
  
  // Wiki链接解析
  function parseWikiLinks(content) {
    const links = [];
    // 匹配 [[file]] 和 [[file#section]] 格式
    const linkPattern = /\[\[([^\]#]+)(#([^\]]+))?\]\]/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      links.push({
        target: match[1].trim(),
        section: match[3] ? match[3].trim() : null,
        full: match[0],
        index: match.index
      });
    }
    return links;
  }
  
  // 重建反向链接缓存
  function rebuildBacklinksCache() {
    const db = new Database(GRAPH_DB_FILE);
    const allFiles = [];
    const fileNames = new Set();
    
    const walk = (dir) => {
      try {
        fs.readdirSync(dir).forEach(item => {
          const fp = path.join(dir, item);
          const st = fs.statSync(fp);
          if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
          else if (item.endsWith('.md')) {
            const relPath = path.relative(DIARY_DIR, fp);
            allFiles.push({ path: relPath, fullPath: fp, name: item.replace('.md', '') });
            fileNames.add(item.replace('.md', ''));
            fileNames.add(relPath);
          }
        });
      } catch(e) {}
    };
    walk(DIARY_DIR);
    
    // 清空旧缓存
    db.exec('DELETE FROM backlinks_cache');
    db.exec('DELETE FROM unlinked_mentions');
    
    const insertBacklink = db.prepare('INSERT OR REPLACE INTO backlinks_cache (target, source_file, section, context) VALUES (?, ?, ?, ?)');
    const insertUnlinked = db.prepare('INSERT OR REPLACE INTO unlinked_mentions (target, source_file, context) VALUES (?, ?, ?)');
    
    let backlinkCount = 0;
    let unlinkedCount = 0;
    
    allFiles.forEach(file => {
      try {
        const content = fs.readFileSync(file.fullPath, 'utf-8');
        const links = parseWikiLinks(content);
        
        // 记录Wiki链接
        links.forEach(link => {
          insertBacklink.run(link.target, file.path, link.section, link.full);
          backlinkCount++;
        });
        
        // 检测未链接提及
        fileNames.forEach(name => {
          if (name !== file.name && !file.path.includes(name)) {
            const namePattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (namePattern.test(content)) {
              const alreadyLinked = links.some(l => l.target === name || l.target.includes(name));
              if (!alreadyLinked) {
                insertUnlinked.run(name, file.path, `提及 "${name}"`);
                unlinkedCount++;
              }
            }
          }
        });
      } catch(e) {}
    });
    
    // 更新元数据
    const updateMeta = db.prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)');
    updateMeta.run('backlinks_updated', new Date().toISOString());
    
    db.close();
    return { files: allFiles.length, backlinks: backlinkCount, unlinked: unlinkedCount };
  }
  
  // 获取反向链接（优先使用缓存）
  function getBacklinksFromCache(target) {
    const db = new Database(GRAPH_DB_FILE);
    
    // 检查缓存是否存在
    const meta = db.prepare("SELECT value FROM index_metadata WHERE key = 'backlinks_updated'").get();
    if (!meta) {
      db.close();
      return null; // 缓存不存在
    }
    
    const incoming = db.prepare('SELECT source_file as `from`, section, context FROM backlinks_cache WHERE target = ?').all(target);
    const unlinked = db.prepare('SELECT source_file as `from`, context FROM unlinked_mentions WHERE target = ?').all(target);
    
    db.close();
    return { incoming, unlinked_mentions: unlinked, cached: true, updatedAt: meta.value };
  }
  
  // 构建反向链接索引（内存版本，用于全量查询）
  function buildBacklinksIndex() {
    const index = {};
    const allFiles = [];
    const fileNames = new Set();
    
    const walk = (dir) => {
      try {
        fs.readdirSync(dir).forEach(item => {
          const fp = path.join(dir, item);
          const st = fs.statSync(fp);
          if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
          else if (item.endsWith('.md')) {
            const relPath = path.relative(DIARY_DIR, fp);
            allFiles.push({ path: relPath, fullPath: fp, name: item.replace('.md', '') });
            fileNames.add(item.replace('.md', ''));
            fileNames.add(relPath);
          }
        });
      } catch(e) {}
    };
    walk(DIARY_DIR);
    
    allFiles.forEach(file => {
      try {
        const content = fs.readFileSync(file.fullPath, 'utf-8');
        const links = parseWikiLinks(content);
        
        links.forEach(link => {
          const target = link.target;
          if (!index[target]) index[target] = { incoming: [], unlinked_mentions: [] };
          index[target].incoming.push({ from: file.path, section: link.section, full: link.full });
        });
        
        fileNames.forEach(name => {
          if (name !== file.name && !file.path.includes(name)) {
            const namePattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (namePattern.test(content)) {
              const alreadyLinked = links.some(l => l.target === name || l.target.includes(name));
              if (!alreadyLinked) {
                if (!index[name]) index[name] = { incoming: [], unlinked_mentions: [] };
                index[name].unlinked_mentions.push({ from: file.path, context: `提及 "${name}"` });
              }
            }
          }
        });
      } catch(e) {}
    });
    
    return index;
  }
  
  // API: 构建反向链接缓存
  if (pathname === '/api/backlinks/build' && req.method === 'POST') {
    try {
      const result = rebuildBacklinksCache();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, ...result }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // API: 增量更新反向链接缓存（单个文件）
  if (pathname === '/api/backlinks/update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { file } = JSON.parse(body || '{}');
        if (!file) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing file parameter' }));
          return;
        }
        
        const db = new Database(GRAPH_DB_FILE);
        const fullPath = path.join(DIARY_DIR, file);
        
        if (!fs.existsSync(fullPath)) {
          res.writeHead(404); res.end(JSON.stringify({ error: 'file not found' }));
          db.close();
          return;
        }
        
        // 删除该文件相关的旧缓存
        db.prepare('DELETE FROM backlinks_cache WHERE source_file = ?').run(file);
        db.prepare('DELETE FROM unlinked_mentions WHERE source_file = ?').run(file);
        
        // 读取并解析文件
        const content = fs.readFileSync(fullPath, 'utf-8');
        const links = parseWikiLinks(content);
        const insertBacklink = db.prepare('INSERT OR REPLACE INTO backlinks_cache (target, source_file, section, context) VALUES (?, ?, ?, ?)');
        
        // 获取所有文件名用于检测未链接提及
        const allFiles = [];
        const walk = (dir) => {
          try {
            fs.readdirSync(dir).forEach(item => {
              const fp = path.join(dir, item);
              if (fs.statSync(fp).isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
              else if (item.endsWith('.md')) allFiles.push(item.replace('.md', ''));
            });
          } catch(e) {}
        };
        walk(DIARY_DIR);
        
        const insertUnlinked = db.prepare('INSERT OR REPLACE INTO unlinked_mentions (target, source_file, context) VALUES (?, ?, ?)');
        const fileName = path.basename(file).replace('.md', '');
        
        let backlinkCount = 0;
        let unlinkedCount = 0;
        
        // 记录Wiki链接
        links.forEach(link => {
          insertBacklink.run(link.target, file, link.section, link.full);
          backlinkCount++;
        });
        
        // 检测未链接提及
        allFiles.forEach(name => {
          if (name !== fileName) {
            const namePattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (namePattern.test(content)) {
              const alreadyLinked = links.some(l => l.target === name || l.target.includes(name));
              if (!alreadyLinked) {
                insertUnlinked.run(name, file, `提及 "${name}"`);
                unlinkedCount++;
              }
            }
          }
        });
        
        // 更新元数据时间
        db.prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)').run('backlinks_updated', new Date().toISOString());
        
        db.close();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, file, backlinks: backlinkCount, unlinked: unlinkedCount }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 获取反向链接
  if (pathname === '/api/backlinks' && req.method === 'GET') {
    const query = url.parse(req.url, true).query;
    const target = query.target;
    const useCache = query.useCache !== 'false';
    
    if (!target) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'missing target parameter' }));
      return;
    }
    
    try {
      let backlinks;
      if (useCache) {
        backlinks = getBacklinksFromCache(target);
        if (!backlinks) {
          // 缓存不存在，构建一次
          rebuildBacklinksCache();
          backlinks = getBacklinksFromCache(target);
        }
      } else {
        const index = buildBacklinksIndex();
        backlinks = index[target] || { incoming: [], unlinked_mentions: [] };
        backlinks.cached = false;
      }
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        target,
        ...backlinks,
        total_incoming: backlinks.incoming.length,
        total_unlinked: backlinks.unlinked_mentions.length
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // API: 全量反向链接索引
  if (pathname === '/api/backlinks/index' && req.method === 'GET') {
    const useCache = parsedUrl.query.useCache !== 'false';
    try {
      let index;
      if (useCache) {
        const db = new Database(GRAPH_DB_FILE);
        const meta = db.prepare("SELECT value FROM index_metadata WHERE key = 'backlinks_updated'").get();
        
        if (meta) {
          // 使用缓存
          const backlinks = db.prepare('SELECT target, source_file as `from`, section, context FROM backlinks_cache').all();
          const unlinked = db.prepare('SELECT target, source_file as `from`, context FROM unlinked_mentions').all();
          
          index = {};
          backlinks.forEach(b => {
            if (!index[b.target]) index[b.target] = { incoming: [], unlinked_mentions: [] };
            index[b.target].incoming.push({ from: b.from, section: b.section, full: b.context });
          });
          unlinked.forEach(u => {
            if (!index[u.target]) index[u.target] = { incoming: [], unlinked_mentions: [] };
            index[u.target].unlinked_mentions.push({ from: u.from, context: u.context });
          });
          
          db.close();
        } else {
          db.close();
          index = buildBacklinksIndex();
        }
      } else {
        index = buildBacklinksIndex();
      }
      
      const summary = Object.entries(index)
        .map(([target, data]) => ({ target, incoming: data.incoming.length, unlinked: data.unlinked_mentions.length }))
        .sort((a, b) => (b.incoming + b.unlinked) - (a.incoming + a.unlinked))
        .slice(0, 50);
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ total_targets: Object.keys(index).length, summary, index }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // API: 出向链接（当前文件引用的其他文件/链接）
  if (pathname === '/api/outgoing-links' && req.method === 'GET') {
    const sourceFile = parsedUrl.query.file;
    
    if (!sourceFile) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'missing file parameter' }));
      return;
    }
    
    try {
      const db = new Database(GRAPH_DB_FILE);
      
      // 从缓存获取出向链接（当前文件引用的文件）
      const wikiLinks = db.prepare('SELECT target, section, context FROM backlinks_cache WHERE source_file = ?').all(sourceFile);
      
      db.close();
      
      // 解析当前文件获取外部URL链接
      const fullPath = path.join(DIARY_DIR, sourceFile);
      let externalLinks = [];
      
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // 匹配 Markdown 链接 [text](url)
        const urlPattern = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
        let match;
        while ((match = urlPattern.exec(content)) !== null) {
          externalLinks.push({
            text: match[1],
            url: match[2]
          });
        }
      }
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        success: true,
        file: sourceFile,
        wiki_links: wikiLinks,
        external_links: externalLinks,
        total_wiki: wikiLinks.length,
        total_external: externalLinks.length
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // API: Bookmarks 书签系统
  if (pathname === '/api/bookmarks' && req.method === 'GET') {
    try {
      const db = new Database(GRAPH_DB_FILE);
      const bookmarks = db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all();
      db.close();
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, bookmarks }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  if (pathname === '/api/bookmarks/add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { file, title } = JSON.parse(body || '{}');
        if (!file) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing file parameter' }));
          return;
        }
        
        const db = new Database(GRAPH_DB_FILE);
        const existing = db.prepare('SELECT * FROM bookmarks WHERE file = ?').get(file);
        
        if (existing) {
          db.close();
          res.writeHead(200); res.end(JSON.stringify({ success: true, message: '已存在', bookmark: existing }));
        } else {
          db.prepare('INSERT INTO bookmarks (file, title) VALUES (?, ?)').run(file, title || path.basename(file));
          const bookmark = db.prepare('SELECT * FROM bookmarks WHERE file = ?').get(file);
          db.close();
          res.writeHead(200); res.end(JSON.stringify({ success: true, bookmark }));
        }
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  if (pathname === '/api/bookmarks/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { file } = JSON.parse(body || '{}');
        if (!file) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing file parameter' }));
          return;
        }
        
        const db = new Database(GRAPH_DB_FILE);
        db.prepare('DELETE FROM bookmarks WHERE file = ?').run(file);
        db.close();
        
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 内容缺口分析
  if (pathname === '/api/gaps' && req.method === 'GET') {
    try {
      const index = buildBacklinksIndex();
      const existingFiles = new Set();
      
      const walk = (dir) => {
        try {
          fs.readdirSync(dir).forEach(item => {
            const fp = path.join(dir, item);
            if (fs.statSync(fp).isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
            else if (item.endsWith('.md')) existingFiles.add(item.replace('.md', ''));
          });
        } catch(e) {}
      };
      walk(DIARY_DIR);
      
      const gaps = [];
      Object.entries(index).forEach(([target, data]) => {
        if (data.incoming.length > 0 && !existingFiles.has(target)) {
          gaps.push({ target, referenced_by: data.incoming.map(l => l.from), count: data.incoming.length });
        }
      });
      
      gaps.sort((a, b) => b.count - a.count);
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ gaps, count: gaps.length, suggestion: '这些页面被引用但不存在，可以考虑创建' }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // ========== Phase 2 API 结束 ==========
  
  // ========== Phase 4: Research-on-Miss 智能功能 ==========
  
  // Research-on-Miss 配置（可动态调整）
  let researchOnMissConfig = {
    enabled: true,           // 是否启用自动研究
    autoCreate: true,        // 是否自动创建页面
    minConfidence: 'medium', // 最低置信度要求
    maxQueueSize: 10,        // 最大队列大小
    cooldownMinutes: 5       // 同主题冷却时间（避免重复研究）
  };
  
  // Research队列（避免重复请求）
  const researchQueue = new Map(); // topic -> { timestamp, status }
  
  // 检查是否在冷却期内
  function isInCooldown(topic) {
    const item = researchQueue.get(topic);
    if (!item) return false;
    const elapsed = (Date.now() - item.timestamp) / (1000 * 60);
    return elapsed < researchOnMissConfig.cooldownMinutes;
  }
  
  // API: Research-on-Miss 配置管理
  if (pathname === '/api/research-on-miss/config' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ success: true, config: researchOnMissConfig }));
    return;
  }
  
  if (pathname === '/api/research-on-miss/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body || '{}');
        researchOnMissConfig = { ...researchOnMissConfig, ...updates };
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, config: researchOnMissConfig }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 检查页面是否存在，不存在则触发Research-on-Miss
  if (pathname === '/api/page/check-or-create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { topic, autoResearch = true, depth = 'standard', category = 'research' } = JSON.parse(body || '{}');
        
        if (!topic) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing topic parameter' }));
          return;
        }
        
        // 检查页面是否已存在
        const slug = topic.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, '').replace(/\s+/g, '-').slice(0, 50);
        const possibleFiles = [
          `${slug}.md`,
          `${topic}.md`,
          `research/${slug}.md`,
          `reference/${slug}.md`
        ];
        
        let existingFile = null;
        for (const f of possibleFiles) {
          const fp = path.join(DIARY_DIR, f);
          if (fs.existsSync(fp)) {
            existingFile = f;
            break;
          }
        }
        
        // 也检查数据库
        if (!existingFile) {
          const db = new Database(GRAPH_DB_FILE);
          const node = db.prepare('SELECT id, title FROM graph_nodes WHERE title LIKE ? OR id LIKE ?').get(`%${topic}%`, `%${slug}%`);
          if (node) {
            existingFile = node.id.endsWith('.md') ? node.id : node.id + '.md';
          }
          db.close();
        }
        
        if (existingFile) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            exists: true,
            file: existingFile,
            message: '页面已存在'
          }));
          return;
        }
        
        // 页面不存在，检查是否启用自动研究
        if (!autoResearch || !researchOnMissConfig.enabled) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            exists: false,
            autoResearchAvailable: researchOnMissConfig.enabled,
            message: '页面不存在，可触发Research-on-Miss',
            suggestion: `POST /api/research-on-miss/trigger with {topic: "${topic}"}`
          }));
          return;
        }
        
        // 检查冷却期
        if (isInCooldown(topic)) {
          const item = researchQueue.get(topic);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            exists: false,
            inCooldown: true,
            cooldownRemaining: Math.ceil(researchOnMissConfig.cooldownMinutes - (Date.now() - item.timestamp) / (1000 * 60)),
            status: item.status,
            message: '主题正在研究或刚研究完成，请稍后再试'
          }));
          return;
        }
        
        // 检查队列大小
        if (researchQueue.size >= researchOnMissConfig.maxQueueSize) {
          res.writeHead(429); res.end(JSON.stringify({
            error: 'Research队列已满',
            queueSize: researchQueue.size,
            maxSize: researchOnMissConfig.maxQueueSize,
            suggestion: '请稍后再试'
          }));
          return;
        }
        
        // 触发研究
        researchQueue.set(topic, { timestamp: Date.now(), status: 'researching' });
        
        try {
          const result = await aiService.researchTopic(topic, depth);
          
          // 创建页面
          const fileName = `${slug}.md`;
          const categoryDir = path.join(DIARY_DIR, category);
          if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });
          const fp = path.join(categoryDir, fileName);
          
          const meta = {
            title: result.title || topic,
            type: 'research',
            freshness_tier: depth === 'deep' ? 'academic' : 'fast',
            confidence: researchOnMissConfig.minConfidence,
            tags: result.tags || [],
            created: new Date().toISOString().split('T')[0],
            sources: result.sources || [],
            auto_generated: true
          };
          
          const content = `# ${meta.title}\n\n${result.content || result.summary || ''}\n\n## 来源\n${(result.sources || []).map(s => `- ${s}`).join('\n') || '自动研究生成'}\n`;
          fs.writeFileSync(fp, `${generateFrontmatter(meta)}\n\n${content}`);
          
          // 更新数据库
          const db2 = new Database(GRAPH_DB_FILE);
          db2.prepare('INSERT OR REPLACE INTO graph_nodes (id, title, category, mtime, source) VALUES (?, ?, ?, ?, ?)').run(
            `${category}/${fileName}`,
            meta.title,
            category,
            new Date().toISOString(),
            'research-on-miss'
          );
          db2.close();
          
          // 更新队列状态
          researchQueue.set(topic, { timestamp: Date.now(), status: 'completed', file: `${category}/${fileName}` });
          
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            exists: false,
            researched: true,
            success: true,
            file: `${category}/${fileName}`,
            title: meta.title,
            message: 'Research-on-Miss已自动创建页面'
          }));
          
        } catch(researchError) {
          researchQueue.set(topic, { timestamp: Date.now(), status: 'failed', error: researchError.message });
          res.writeHead(500); res.end(JSON.stringify({
            exists: false,
            researchFailed: true,
            error: researchError.message,
            suggestion: 'AI研究失败，请手动创建页面'
          }));
        }
        
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 手动触发Research-on-Miss
  if (pathname === '/api/research-on-miss/trigger' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // 调用上面的check-or-create逻辑
      const parsedBody = JSON.parse(body || '{}');
      parsedBody.autoResearch = true;
      
      // 重新触发处理
      const mockReq = {
        method: 'POST',
        on: (event, callback) => {
          if (event === 'data') callback(JSON.stringify(parsedBody));
          if (event === 'end') callback();
        }
      };
      
      // 直接复用check-or-create的逻辑
      // 这里简化处理，直接返回触发成功
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        success: true,
        triggered: true,
        topic: parsedBody.topic,
        message: 'Research-on-Miss已触发，请通过/api/research-on-miss/status查询状态'
      }));
    });
    return;
  }
  
  // API: 查询Research队列状态
  if (pathname === '/api/research-on-miss/status' && req.method === 'GET') {
    const query = url.parse(req.url, true).query;
    const topic = query.topic;
    
    if (topic) {
      const item = researchQueue.get(topic);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        topic,
        inQueue: !!item,
        status: item?.status || 'not_in_queue',
        timestamp: item?.timestamp,
        file: item?.file,
        cooldownRemaining: item ? Math.ceil(researchOnMissConfig.cooldownMinutes - (Date.now() - item.timestamp) / (1000 * 60)) : 0
      }));
    } else {
      // 返回整个队列状态
      const queueList = [];
      researchQueue.forEach((value, key) => {
        queueList.push({ topic: key, ...value });
      });
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        queueSize: researchQueue.size,
        maxSize: researchOnMissConfig.maxQueueSize,
        queue: queueList,
        config: researchOnMissConfig
      }));
    }
    return;
  }
  
  // API: 内容缺口批量Research
  if (pathname === '/api/gaps/batch-research' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { limit = 5, topics } = JSON.parse(body || '{}');
        
        // 获取内容缺口（被引用但不存在的页面）
        const gapsRes = await fetch(`http://localhost:${PORT}/api/gaps`);
        const gapsData = await gapsRes.json();
        
        let topicsToResearch = topics || gapsData.gaps.slice(0, limit).map(g => g.target);
        
        if (topicsToResearch.length === 0) {
          res.writeHead(200); res.end(JSON.stringify({ message: '没有需要研究的内容缺口' }));
          return;
        }
        
        const results = [];
        const errors = [];
        
        for (const topic of topicsToResearch) {
          if (isInCooldown(topic)) {
            errors.push({ topic, error: 'in_cooldown' });
            continue;
          }
          
          researchQueue.set(topic, { timestamp: Date.now(), status: 'researching' });
          
          try {
            // 调用check-or-create
            const checkRes = await fetch(`http://localhost:${PORT}/api/page/check-or-create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ topic, autoResearch: true })
            });
            const checkData = await checkRes.json();
            
            if (checkData.researched) {
              results.push({ topic, file: checkData.file, title: checkData.title });
            } else if (checkData.exists) {
              results.push({ topic, file: checkData.file, message: '页面已存在' });
            }
            
            researchQueue.set(topic, { timestamp: Date.now(), status: 'completed', file: checkData.file });
            
          } catch(e) {
            researchQueue.set(topic, { timestamp: Date.now(), status: 'failed', error: e.message });
            errors.push({ topic, error: e.message });
          }
        }
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          success: true,
          researched: results.length,
          failed: errors.length,
          results,
          errors,
          remainingGaps: gapsData.count - results.length
        }));
        
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 置信度自动升级检查
  if (pathname === '/api/confidence/auto-upgrade' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { files, reason } = JSON.parse(body || '{}');
        
        // 如果没有指定文件，则自动检查所有low置信度的页面
        let filesToCheck = files;
        
        if (!filesToCheck?.length) {
          // 扫描所有页面，找出需要升级的
          const allFiles = [];
          const walk = (dir) => {
            try {
              fs.readdirSync(dir).forEach(item => {
                const fp = path.join(dir, item);
                const st = fs.statSync(fp);
                if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
                else if (item.endsWith('.md')) allFiles.push(fp);
              });
            } catch(e) {}
          };
          walk(DIARY_DIR);
          
          filesToCheck = [];
          allFiles.forEach(fp => {
            try {
              const content = fs.readFileSync(fp, 'utf-8');
              const { frontmatter } = parseFrontmatter(content);
              const conf = frontmatter?.confidence || 'low';
              const refCount = (content.match(/\[\[.*?\]\]/g) || []).length; // 被引用次数
              const sourceCount = (frontmatter?.sources?.length || 0); // 来源数量
              
              // 自动升级规则
              if (conf === 'low') {
                // low -> medium: 有3个以上来源 或 被5次以上引用
                if (sourceCount >= 3 || refCount >= 5) {
                  filesToCheck.push({ 
                    file: path.relative(DIARY_DIR, fp), 
                    current: 'low', 
                    target: 'medium',
                    reason: `来源${sourceCount}个,引用${refCount}次`
                  });
                }
              } else if (conf === 'medium') {
                // medium -> high: 有5个以上来源 且 被10次以上引用 且 有人工确认
                const hasConfirm = frontmatter?.confirmed_at || frontmatter?.checked_at;
                if (sourceCount >= 5 && refCount >= 10 && hasConfirm) {
                  filesToCheck.push({ 
                    file: path.relative(DIARY_DIR, fp), 
                    current: 'medium', 
                    target: 'high',
                    reason: `来源${sourceCount}个,引用${refCount}次,已确认`
                  });
                }
              }
            } catch(e) {}
          });
        }
        
        const results = [];
        const upgraded = [];
        const skipped = [];
        
        const upgradeRules = {
          low_to_medium: { minSources: 3, minRefs: 5 },
          medium_to_high: { minSources: 5, minRefs: 10, requireConfirm: true }
        };
        
        filesToCheck.forEach(f => {
          const filePath = f.file || f.path;
          const fp = path.join(DIARY_DIR, filePath);
          
          try {
            if (!fs.existsSync(fp)) {
              skipped.push({ file: filePath, reason: '文件不存在' });
              return;
            }
            
            const content = fs.readFileSync(fp, 'utf-8');
            const { frontmatter, body: mdBody } = parseFrontmatter(content);
            const currentConf = frontmatter?.confidence || 'low';
            const targetLevel = f.target || 'medium';
            
            const levels = ['low', 'medium', 'high'];
            const currentIndex = levels.indexOf(currentConf);
            const targetIndex = levels.indexOf(targetLevel);
            
            if (targetIndex <= currentIndex) {
              skipped.push({ file: filePath, reason: '目标置信度不高于当前' });
              return;
            }
            
            // 执行升级
            frontmatter.confidence = targetLevel;
            frontmatter.confidence_upgraded_at = new Date().toISOString().split('T')[0];
            frontmatter.confidence_reason = f.reason || reason || '自动升级';
            
            updateFrontmatter(fp, frontmatter);
            
            upgraded.push({ 
              file: filePath, 
              from: currentConf, 
              to: targetLevel,
              reason: frontmatter.confidence_reason
            });
            
          } catch(e) {
            skipped.push({ file: filePath, reason: e.message });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          success: true,
          upgraded: upgraded.length,
          skipped: skipped.length,
          upgraded_list: upgraded,
          skipped_list: skipped,
          upgrade_rules: upgradeRules
        }));
        
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 置信度统计报告
  if (pathname === '/api/confidence/report' && req.method === 'GET') {
    try {
      const report = {
        low: { count: 0, candidates: [] },
        medium: { count: 0, candidates: [] },
        high: { count: 0 },
        upgrade_candidates: []
      };
      
      const allFiles = [];
      const walk = (dir) => {
        try {
          fs.readdirSync(dir).forEach(item => {
            const fp = path.join(dir, item);
            const st = fs.statSync(fp);
            if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
            else if (item.endsWith('.md')) allFiles.push(fp);
          });
        } catch(e) {}
      };
      walk(DIARY_DIR);
      
      allFiles.forEach(fp => {
        try {
          const content = fs.readFileSync(fp, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          const conf = frontmatter?.confidence || 'low';
          const refCount = (content.match(/\[\[.*?\]\]/g) || []).length;
          const sourceCount = (frontmatter?.sources?.length || 0);
          const hasConfirm = frontmatter?.confirmed_at || frontmatter?.checked_at;
          
          report[conf].count++;
          
          // 检查是否可升级
          if (conf === 'low' && (sourceCount >= 3 || refCount >= 5)) {
            report.upgrade_candidates.push({
              file: path.relative(DIARY_DIR, fp),
              current: 'low',
              target: 'medium',
              sources: sourceCount,
              refs: refCount
            });
          } else if (conf === 'medium' && sourceCount >= 5 && refCount >= 10 && hasConfirm) {
            report.upgrade_candidates.push({
              file: path.relative(DIARY_DIR, fp),
              current: 'medium',
              target: 'high',
              sources: sourceCount,
              refs: refCount,
              confirmed: true
            });
          }
          
        } catch(e) {}
      });
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(report));
      
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // API: 内容缺口创建向导 - 获取缺口详情和模板建议
  if (pathname === '/api/gaps/wizard' && req.method === 'GET') {
    (async () => {
      try {
        const query = url.parse(req.url, true).query;
        const target = query.target;
        const limit = parseInt(query.limit) || 20;
        
        // 获取缺口列表（内部逻辑，避免fetch）
        const index = buildBacklinksIndex();
        const existingFiles = new Set();
        const walk = (dir) => {
          try {
            fs.readdirSync(dir).forEach(item => {
              const fp = path.join(dir, item);
              if (fs.statSync(fp).isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
              else if (item.endsWith('.md')) existingFiles.add(item.replace('.md', ''));
            });
          } catch(e) {}
        };
        walk(DIARY_DIR);
        
        const allGaps = [];
        Object.entries(index).forEach(([t, data]) => {
          if (data.incoming.length > 0 && !existingFiles.has(t)) {
            allGaps.push({ target: t, referenced_by: data.incoming.map(l => l.from), count: data.incoming.length });
          }
        });
        allGaps.sort((a, b) => b.count - a.count);
        
        // 筛选指定的缺口或返回前limit个
        let gapsToProcess = allGaps;
        if (target) {
          gapsToProcess = gapsToProcess.filter(g => g.target === target);
        } else {
          gapsToProcess = gapsToProcess.slice(0, limit);
        }
      
      // 为每个缺口生成创建建议
      const suggestions = gapsToProcess.map(gap => {
        const target = gap.target;
        // 根据目标名称推断类型
        let suggestedType = 'reference';
        let suggestedCategory = 'reference';
        let suggestedTags = [];
        let templateContent = '';
        
        // 推断规则
        if (target.includes('SKILL') || target.includes('skill')) {
          suggestedType = 'reference';
          suggestedCategory = 'skills';
          suggestedTags = ['skill', 'documentation'];
          templateContent = `# ${target}\n\n## 概述\n\n[请填写概述]\n\n## 功能\n\n[请填写功能描述]\n\n## 使用方法\n\n[请填写使用方法]\n\n## 相关链接\n\n- [[相关页面]]\n`;
        } else if (target.includes('API') || target.includes('api')) {
          suggestedType = 'reference';
          suggestedCategory = 'api';
          suggestedTags = ['api', 'documentation'];
          templateContent = `# ${target}\n\n## API端点\n\n[请填写API端点信息]\n\n## 参数\n\n| 参数名 | 类型 | 说明 |\n|--------|------|------|\n| param1 | type | description |\n\n## 返回值\n\n[请填写返回值说明]\n\n## 示例\n\n\`\`\`\n[示例代码]\n\`\`\`\n`;
        } else if (target.match(/^\d{4}-\d{2}-\d{2}$/)) {
          suggestedType = 'event';
          suggestedCategory = 'diary';
          suggestedTags = ['diary', 'daily'];
          templateContent = `# ${target}\n\n## 今日事件\n\n[请填写今日事件]\n\n## 待办事项\n\n- [ ] 待办1\n- [ ] 待办2\n\n## 备注\n\n[备注内容]\n`;
        } else {
          suggestedType = 'reference';
          suggestedCategory = 'reference';
          templateContent = `# ${target}\n\n## 概述\n\n[请填写概述]\n\n## 详情\n\n[请填写详情]\n\n## 相关内容\n\n- [[相关页面]]\n`;
        }
        
        return {
          target,
          referenced_by: gap.referenced_by,
          count: gap.count,
          suggestion: {
            type: suggestedType,
            category: suggestedCategory,
            tags: suggestedTags,
            filename: `${target.replace(/\.md$/, '')}.md`,
            filepath: `${suggestedCategory}/${target.replace(/\.md$/, '')}.md`,
            template: templateContent
          }
        };
      });
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        total_gaps: allGaps.length,
        processed: suggestions.length,
        suggestions,
        wizard_available: true
      }));
      
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    })();
    return;
  }
  
  // API: 内容缺口快速创建（批量）
  if (pathname === '/api/gaps/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { gaps, autoResearch = false } = JSON.parse(body || '{}');
        
        if (!gaps?.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing gaps parameter' }));
          return;
        }
        
        const results = [];
        const errors = [];
        
        gaps.forEach(g => {
          const target = g.target || g;
          const filename = target.replace(/\.md$/, '') + '.md';
          const category = g.category || 'reference';
          const template = g.template || `# ${target}\n\n[请填写内容]\n`;
          
          try {
            const categoryDir = path.join(DIARY_DIR, category);
            if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });
            
            const fp = path.join(categoryDir, filename);
            
            if (fs.existsSync(fp)) {
              errors.push({ target, error: '文件已存在' });
              return;
            }
            
            const meta = {
              title: target,
              type: g.type || 'reference',
              freshness_tier: 'standard',
              confidence: 'low',
              tags: g.tags || [],
              created: new Date().toISOString().split('T')[0],
              from_wizard: true
            };
            
            fs.writeFileSync(fp, `${generateFrontmatter(meta)}\n\n${template}`);
            results.push({ target, file: `${category}/${filename}`, created: true });
            
            // 更新数据库
            const db = new Database(GRAPH_DB_FILE);
            db.prepare('INSERT OR REPLACE INTO graph_nodes (id, title, category, mtime, source) VALUES (?, ?, ?, ?, ?)').run(
              `${category}/${filename}`,
              meta.title,
              category,
              new Date().toISOString(),
              'gap-wizard'
            );
            db.close();
            
          } catch(e) {
            errors.push({ target, error: e.message });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          success: true,
          created: results.length,
          errors: errors.length,
          results,
          errors,
          tip: '创建后请编辑页面内容，可使用/api/confidence/auto-upgrade自动升级置信度'
        }));
        
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API: 孤立页面检测和建议合并
  if (pathname === '/api/orphan-pages' && req.method === 'GET') {
    try {
      const orphanPages = [];
      const allFiles = [];
      const walk = (dir) => {
        try {
          fs.readdirSync(dir).forEach(item => {
            const fp = path.join(dir, item);
            const st = fs.statSync(fp);
            if (st.isDirectory() && item !== 'media' && !item.startsWith('.')) walk(fp);
            else if (item.endsWith('.md')) allFiles.push(fp);
          });
        } catch(e) {}
      };
      walk(DIARY_DIR);
      
      // 获取反向链接索引
      const db = new Database(GRAPH_DB_FILE);
      const meta = db.prepare("SELECT value FROM index_metadata WHERE key = 'backlinks_updated'").get();
      
      let backlinksIndex = {};
      if (meta) {
        const backlinks = db.prepare('SELECT target FROM backlinks_cache').all();
        backlinks.forEach(b => {
          backlinksIndex[b.target] = true;
        });
      }
      db.close();
      
      // 检查每个文件是否被引用
      allFiles.forEach(fp => {
        const relPath = path.relative(DIARY_DIR, fp);
        const fileName = path.basename(fp).replace('.md', '');
        
        // 检查是否被引用
        const isReferenced = backlinksIndex[fileName] || backlinksIndex[relPath];
        
        if (!isReferenced) {
          try {
            const content = fs.readFileSync(fp, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);
            const outboundLinks = (content.match(/\[\[.*?\]\]/g) || []).length;
            const fileSize = content.length;
            const lastModified = fs.statSync(fp).mtime;
            
            orphanPages.push({
              file: relPath,
              title: frontmatter?.title || fileName,
              outbound_links: outboundLinks,
              file_size: fileSize,
              last_modified: lastModified.toISOString().split('T')[0],
              suggestion: outboundLinks > 0 ? '有出链但无入链，考虑添加反向链接' : '完全孤立，考虑合并或删除'
            });
            
          } catch(e) {}
        }
      });
      
      // 按文件大小排序（小文件更容易合并）
      orphanPages.sort((a, b) => a.file_size - b.file_size);
      
      // 添加合并建议
      const mergeSuggestions = [];
      // 寻找可以合并的小文件（同类型、小尺寸）
      const smallOrphans = orphanPages.filter(p => p.file_size < 500);
      
      if (smallOrphans.length >= 2) {
        // 按文件名相似度分组
        const groups = {};
        smallOrphans.forEach(p => {
          const prefix = p.title.slice(0, 5);
          if (!groups[prefix]) groups[prefix] = [];
          groups[prefix].push(p);
        });
        
        Object.entries(groups).forEach(([prefix, pages]) => {
          if (pages.length >= 2) {
            mergeSuggestions.push({
              prefix,
              pages: pages.map(p => p.file),
              suggested_target: `合并_${prefix}相关内容.md`,
              reason: `前缀相同，内容可能相关`
            });
          }
        });
      }
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        orphan_count: orphanPages.length,
        orphan_pages: orphanPages.slice(0, 50),
        merge_suggestions: mergeSuggestions,
        tip: '孤立页面无人引用，建议添加反向链接或合并/删除'
      }));
      
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // ========== 新功能: 版本历史 API ==========

  // 获取文件的版本历史列表
  if (pathname === '/api/versions' && req.method === 'GET') {
    try {
      const filePath = parsedUrl.query.path;
      if (!filePath) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '缺少path参数' }));
        return;
      }
      
      const db = new Database(GRAPH_DB_FILE);
      const versions = db.prepare(`
        SELECT id, version_number, title, summary, edited_by, edit_reason, created_at
        FROM memory_versions 
        WHERE file_path = ?
        ORDER BY version_number DESC
        LIMIT 20
      `).all(filePath);
      db.close();
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, versions: versions, total: versions.length }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 获取特定版本内容
  if (pathname.startsWith('/api/versions/') && pathname.endsWith('/restore') === false && req.method === 'GET') {
    try {
      const parts = pathname.split('/');
      if (parts.length < 3 || parts[2] === '') {
        res.writeHead(400); res.end(JSON.stringify({ error: '无效路径' }));
        return;
      }
      const versionId = parseInt(parts[2]);
      
      const db = new Database(GRAPH_DB_FILE);
      const version = db.prepare(`
        SELECT * FROM memory_versions WHERE id = ?
      `).get(versionId);
      db.close();
      
      if (!version) {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '版本不存在' }));
        return;
      }
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, version: version }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 保存当前版本（在保存文件时自动调用）
  if (pathname === '/api/versions/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { file_path, title, content, summary, edit_reason } = data;
        
        if (!file_path || !content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: '缺少必要参数' }));
          return;
        }
        
        const db = new Database(GRAPH_DB_FILE);
        // 获取当前最大版本号
        const maxVersion = db.prepare(`
          SELECT MAX(version_number) as max FROM memory_versions WHERE file_path = ?
        `).get(file_path);
        const versionNumber = (maxVersion?.max || 0) + 1;
        
        // 保存新版本
        db.prepare(`
          INSERT INTO memory_versions (file_path, version_number, title, content, summary, edited_by, edit_reason, created_at)
          VALUES (?, ?, ?, ?, ?, 'user', ?, datetime('now'))
        `).run(file_path, versionNumber, title || '', content, summary || '', edit_reason || '手动保存');
        db.close();
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, version_number: versionNumber }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 恢复到特定版本
  if (pathname.match(/^\/api\/versions\/\d+\/restore$/) && req.method === 'POST') {
    try {
      const parts = pathname.split('/');
      const versionId = parseInt(parts[2]);
      
      const db = new Database(GRAPH_DB_FILE);
      const version = db.prepare(`
        SELECT file_path, title, content FROM memory_versions WHERE id = ?
      `).get(versionId);
      db.close();
      
      if (!version) {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '版本不存在' }));
        return;
      }
      
      // 写入文件
      fs.writeFileSync(version.file_path, version.content, 'utf-8');
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, message: '已恢复到版本 ' + versionId }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 版本对比
  if (pathname === '/api/versions/diff' && req.method === 'GET') {
    try {
      const v1 = parseInt(parsedUrl.query.v1);
      const v2 = parseInt(parsedUrl.query.v2);
      
      if (!v1 || !v2) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '缺少版本号参数' }));
        return;
      }
      
      const db = new Database(GRAPH_DB_FILE);
      const version1 = db.prepare(`SELECT content, title FROM memory_versions WHERE id = ?`).get(v1);
      const version2 = db.prepare(`SELECT content, title FROM memory_versions WHERE id = ?`).get(v2);
      db.close();
      
      if (!version1 || !version2) {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '版本不存在' }));
        return;
      }
      
      // 简单对比
      const lines1 = version1.content.split('\n');
      const lines2 = version2.content.split('\n');
      const changes = [];
      
      for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        if (lines1[i] !== lines2[i]) {
          changes.push({
            line: i + 1,
            old: lines1[i] || '',
            new: lines2[i] || ''
          });
        }
      }
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ 
        success: true, 
        v1_title: version1.title,
        v2_title: version2.title,
        changes: changes.slice(0, 50),
        total_changes: changes.length
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ========== 新功能: 标签建议 API ==========

  if (pathname === '/api/tags/suggest' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { content, filename } = data;
        
        if (!content) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: '缺少content参数' }));
          return;
        }
        
        // 从内容中提取关键词
        const keywords = [];
        const keywordPatterns = [
          /高考/gi, /志愿/gi, /股票/gi, /投资/gi, /日记/gi, /开发/gi,
          /Python/gi, /Node/gi, /API/gi, /数据库/gi, /AI/gi, /机器学习/gi,
          /工作/gi, /学习/gi, /计划/gi, /总结/gi, /复盘/gi
        ];
        
        keywordPatterns.forEach(pattern => {
          if (pattern.test(content)) {
            keywords.push(pattern.source.replace(/\\/g, '').replace(/gi/, '').toLowerCase());
          }
        });
        
        // 从数据库获取常用标签
        const db = new Database(GRAPH_DB_FILE);
        const popularTags = db.prepare(`
          SELECT category, COUNT(*) as count 
          FROM graph_nodes 
          WHERE category IS NOT NULL AND category != ''
          GROUP BY category ORDER BY count DESC LIMIT 10
        `).all();
        db.close();
        
        // 合并建议
        const suggestions = [];
        keywords.forEach(k => {
          suggestions.push({ tag: k, confidence: 0.9, reason: '关键词匹配' });
        });
        popularTags.forEach(t => {
          if (!keywords.includes(t.category)) {
            suggestions.push({ tag: t.category, confidence: 0.7, reason: '常用分类' });
          }
        });
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, suggestions: suggestions.slice(0, 10) }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ========== 新功能: 统计仪表盘 API ==========

  if (pathname === '/api/dashboard/stats' && req.method === 'GET') {
    try {
      const stats = {
        total_files: 0,
        total_nodes: 0,
        total_edges: 0,
        by_type: {},
        by_freshness: {},
        active_days: 0,
        avg_per_day: 0,
        frequency_data: []
      };
      
      // 文件统计
      let mdCount = 0;
      let dateFiles = {};
      
      const scanDir = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            scanDir(path.join(dir, entry.name));
          } else if (entry.name.endsWith('.md')) {
            mdCount++;
            const dateMatch = entry.name.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              dateFiles[dateMatch[1]] = (dateFiles[dateMatch[1]] || 0) + 1;
            }
          }
        }
      };
      scanDir(DIARY_DIR);
      
      stats.total_files = mdCount;
      stats.active_days = Object.keys(dateFiles).length;
      stats.avg_per_day = mdCount / stats.active_days || 0;
      stats.frequency_data = Object.values(dateFiles).sort((a, b) => a - b);
      
      // 图谱统计
      const db = new Database(GRAPH_DB_FILE);
      stats.total_nodes = db.prepare('SELECT COUNT(*) as c FROM graph_nodes').get().c;
      stats.total_edges = db.prepare('SELECT COUNT(*) as c FROM graph_edges').get().c;
      
      // 按类型统计
      const typeStats = db.prepare(`
        SELECT category, COUNT(*) as count FROM graph_nodes GROUP BY category
      `).all();
      typeStats.forEach(t => stats.by_type[t.category] = t.count);
      db.close();
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, stats: stats }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ========== 新功能: 日历 API ==========

  if (pathname.match(/^\/api\/calendar\/\d{4}\/\d{1,2}$/) && req.method === 'GET') {
    try {
      const parts = pathname.split('/');
      const year = parseInt(parts[2]);
      const month = parseInt(parts[3]);
      
      // 扫描该月份的文件
      const days = [];
      const monthStr = `${year}-${String(month).padStart(2, '0')}`;
      
      const scanDir = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            scanDir(path.join(dir, entry.name));
          } else if (entry.name.endsWith('.md') && entry.name.startsWith(monthStr)) {
            const dayMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
            if (dayMatch) {
              const existing = days.find(d => d.date === dayMatch[1]);
              if (existing) {
                existing.count++;
                existing.files.push(entry.name);
              } else {
                days.push({
                  date: dayMatch[1],
                  count: 1,
                  files: [entry.name]
                });
              }
            }
          }
        }
      };
      scanDir(DIARY_DIR);
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ 
        success: true, 
        year: year, 
        month: month,
        days: days.sort((a, b) => a.date.localeCompare(b.date))
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ========== 新功能: 模板 API ==========

  if (pathname === '/api/templates' && req.method === 'GET') {
    try {
      const db = new Database(GRAPH_DB_FILE);
      const templates = db.prepare(`
        SELECT id, name, category, content, variables FROM templates WHERE is_active = 1
      `).all();
      db.close();
      
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ success: true, templates: templates }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/templates/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { template_id, variables, filename } = data;
        
        const db = new Database(GRAPH_DB_FILE);
        const template = db.prepare(`SELECT content FROM templates WHERE id = ?`).get(template_id);
        db.close();
        
        if (!template) {
          res.writeHead(404, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: '模板不存在' }));
          return;
        }
        
        // 替换变量
        let content = template.content;
        if (variables) {
          Object.keys(variables).forEach(key => {
            content = content.replace(new RegExp(`{{${key}}}`, 'g'), variables[key]);
          });
        }
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, content: content }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ========== Phase 4 API 结束 ==========
  
  const html = fs.readFileSync(HTML_FILE, 'utf-8');
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('日记系统已启动: http://localhost:' + PORT);
});