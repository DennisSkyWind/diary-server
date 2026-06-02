/**
 * AI 服务模块 - 处理与各种 AI API 的交互
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 加载配置
let aiConfig = null;

function loadConfig() {
  const configPath = path.join(__dirname, 'ai-config.json');
  if (fs.existsSync(configPath)) {
    aiConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return aiConfig;
}

function saveConfig(config) {
  const configPath = path.join(__dirname, 'ai-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  aiConfig = config;
}

/**
 * 调用 AI API
 */
async function callAI(prompt, options = {}) {
  const config = loadConfig();
  if (!config) {
    throw new Error('AI 配置未加载');
  }

  const provider = config.providers[config.provider];
  if (!provider) {
    throw new Error('未配置 AI 服务提供商');
  }

  const baseUrl = provider.baseUrl || config.providers[config.provider]?.baseUrl;
  const model = options.model || config.model || provider.defaultModel;
  const apiKey = config.apiKey || '';

  if (!baseUrl) {
    throw new Error('请配置 API 地址');
  }
  if (!apiKey) {
    throw new Error('请配置 API Key');
  }

  // 构建请求体
  const requestBody = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens || 1024,
    temperature: options.temperature || 0.7
  };

  return await callOpenAIFormat(baseUrl, apiKey, requestBody);
}

/**
 * 调用 OpenAI 格式的 API（纯 Node.js 实现）
 */
async function callOpenAIFormat(baseUrl, apiKey, requestBody) {
  const fullUrl = baseUrl + '/chat/completions';
  const urlObj = new URL(fullUrl);
  
  const isHttps = urlObj.protocol === 'https:';
  const protocol = isHttps ? https : http;
  
  const bodyStr = JSON.stringify(requestBody);
  
  const requestOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Mozilla/5.0 Diary-System/1.0',
      'Accept': '*/*'
    }
  };

  return new Promise((resolve, reject) => {
    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 401) {
            reject(new Error('API Key 无效或认证失败'));
            return;
          }
          if (res.statusCode === 404) {
            reject(new Error('API 地址不正确'));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error('请求失败 (HTTP ' + res.statusCode + ')'));
            return;
          }
          
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
          } else if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error('AI 返回格式异常'));
          }
        } catch (e) {
          reject(new Error('解析响应失败: ' + e.message));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error('网络请求失败: ' + e.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    // 设置超时
    req.setTimeout(120000);  // 120秒超时，Coding API响应较慢
    
    req.write(bodyStr);
    req.end();
  });
}

/**
 * 流式调用 AI API（用于实时显示）
 * @param {string} prompt - 提示词
 * @param {function} onChunk - 每收到一块数据时的回调
 * @param {object} options - 选项
 */
async function callAIStream(prompt, onChunk, options = {}) {
  const config = loadConfig();
  if (!config) {
    throw new Error('AI 配置未加载');
  }

  const provider = config.providers[config.provider];
  if (!provider) {
    throw new Error('未配置 AI 服务提供商');
  }

  const baseUrl = provider.baseUrl || config.providers[config.provider]?.baseUrl;
  const model = options.model || config.model || provider.defaultModel;
  const apiKey = config.apiKey || '';

  if (!baseUrl) {
    throw new Error('请配置 API 地址');
  }
  if (!apiKey) {
    throw new Error('请配置 API Key');
  }

  // 构建请求体（启用流式）
  const requestBody = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens || 1024,
    temperature: options.temperature || 0.7,
    stream: true
  };

  const fullUrl = baseUrl + '/chat/completions';
  const urlObj = new URL(fullUrl);
  
  const isHttps = urlObj.protocol === 'https:';
  const protocol = isHttps ? https : http;
  
  const bodyStr = JSON.stringify(requestBody);
  
  const requestOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Mozilla/5.0 Diary-System/1.0',
      'Accept': '*/*'
    }
  };

  return new Promise((resolve, reject) => {
    const req = protocol.request(requestOptions, (res) => {
      let fullContent = '';
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // 解析 SSE 数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // 保留不完整的行
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            try {
              const json = JSON.parse(data);
              if (json.choices && json.choices[0]) {
                const delta = json.choices[0].delta;
                if (delta && delta.content) {
                  const text = delta.content;
                  fullContent += text;
                  onChunk(text);  // 调用回调，实时显示
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      });
      
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('请求失败 (HTTP ' + res.statusCode + ')'));
        } else {
          resolve(fullContent);
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error('网络请求失败: ' + e.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.setTimeout(120000);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * 生成摘要
 */
async function generateSummary(content, maxLength = 200) {
  const config = loadConfig();
  const summaryConfig = config?.features?.summary || {};
  const template = summaryConfig.promptTemplate || 
    '请为以下日记内容生成一个简洁的摘要（不超过{maxLength}字）。只返回摘要内容：\n\n{content}';
  
  const prompt = template
    .replace('{maxLength}', maxLength)
    .replace('{content}', content);

  return await callAI(prompt, { maxTokens: maxLength * 2 });
}

/**
 * 流式生成摘要
 */
async function generateSummaryStream(content, onChunk, maxLength = 200) {
  const config = loadConfig();
  const summaryConfig = config?.features?.summary || {};
  const template = summaryConfig.promptTemplate || 
    '请为以下日记内容生成一个简洁的摘要（不超过{maxLength}字）。只返回摘要内容：\n\n{content}';
  
  const prompt = template
    .replace('{maxLength}', maxLength)
    .replace('{content}', content);

  return await callAIStream(prompt, onChunk, { maxTokens: maxLength * 2 });
}

/**
 * 语义搜索
 */
async function semanticSearch(query, diaryDir, searchFn) {
  const config = loadConfig();
  const searchConfig = config?.features?.semanticSearch || {};
  
  const keywordResults = await searchFn(query);
  
  if (!keywordResults || keywordResults.length === 0) {
    return {
      aiAnswer: '没有找到相关的日记内容。',
      results: []
    };
  }

  const contexts = keywordResults.slice(0, 5).map((r, i) => {
    return `[日记${i+1}: ${r.file}]\n${r.preview}`;
  }).join('\n\n');

  const template = searchConfig.promptTemplate ||
    '用户查询：{query}\n\n以下是用户的日记内容片段：\n{contexts}\n\n请根据这些日记内容回答用户的问题。回答要简洁准确。';

  const prompt = template
    .replace('{query}', query)
    .replace('{contexts}', contexts);

  const aiAnswer = await callAI(prompt, { maxTokens: 500 });

  return {
    aiAnswer: aiAnswer,
    results: keywordResults.slice(0, searchConfig.maxResults || 10)
  };
}

/**
 * 获取润色风格列表
 */
function getPolishStyles() {
  const config = loadConfig();
  return config?.polishStyles || [];
}

/**
 * 保存润色风格列表
 */
function savePolishStyles(styles) {
  const config = loadConfig();
  config.polishStyles = styles;
  saveConfig(config);
  return styles;
}

/**
 * 流式润色文本
 */
async function polishTextStream(text, style, onChunk) {
  const config = loadConfig();
  const polishConfig = config?.features?.polish || {};
  const template = polishConfig.promptTemplate || 
    '请按照以下风格要求润色文本，只返回润色后的内容：\n\n【原文】\n{text}\n\n【风格要求】\n{style}\n\n【润色结果】';
  
  const prompt = template
    .replace('{text}', text)
    .replace('{style}', style);

  return await callAIStream(prompt, onChunk, { maxTokens: text.length * 3 });
}

// === 智能整理功能 ===

/**
 * 分类日记（逻辑分类，不移动文件）
 */
async function classifyDiary(content, fileName, existingFolders = []) {
  const config = loadConfig();
  const organizeConfig = config?.features?.organize || {};
  const categories = organizeConfig.categories || [
    { name: '工作', keywords: ['会议', '项目', '周报', '汇报', '工作'] },
    { name: '家庭', keywords: ['家人', '孩子', '老婆', '老公', '亲子'] },
    { name: '旅游', keywords: ['旅游', '景点', '出游', '动物园', '公园'] },
    { name: '学习', keywords: ['学习', '读书', '笔记', '研究', '课程'] },
    { name: '生活', keywords: ['生活', '美食', '购物', '健康', '日常'] },
    { name: '情感', keywords: ['心情', '感悟', '情绪', '思考'] },
    { name: '纪念', keywords: ['生日', '节日', '纪念日', '庆祝'] }
  ];

  const categoryList = categories.map(c => c.name).join('、');
  
  const prompt = `分析以下日记内容，判断它属于哪个分类。返回JSON格式结果。

【日记文件名】
${fileName}

【日记内容】
${content.slice(0, 500)}

【现有分类】
${categoryList}

【分类标准】
根据内容主题判断，优先匹配关键词和事件类型。

【返回格式】只返回纯JSON，不要使用markdown代码块：
{"category": "分类名称", "confidence": 0.85, "reason": "判断依据简述"}

注意：confidence是置信度(0-1之间的数字)，reason简要说明判断理由。`;

  const result = await callAI(prompt, { maxTokens: 200 });
  
  try {
    // 清理 markdown 代码块标记
    let cleaned = result
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    
    // 提取JSON
    const jsonMatch = cleaned.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { category: '未分类', confidence: 0.5, reason: '无法解析AI结果' };
  } catch (e) {
    return { category: '未分类', confidence: 0.5, reason: '解析错误: ' + e.message };
  }
}

/**
 * 批量分类日记
 */
async function classifyDiaries(diaries) {
  const results = [];
  for (const diary of diaries) {
    const classification = await classifyDiary(diary.content, diary.name);
    results.push({
      file: diary.path,
      name: diary.name,
      ...classification
    });
  }
  return results;
}

/**
 * 【优化】合并分析 - 一次调用完成分类+标签（减少 API 调用）
 */
async function analyzeDiaryCombined(content, fileName) {
  const prompt = `分析以下日记，同时完成分类和标签提取。

【日记内容】
${content.slice(0, 800)}

【任务】
1. 判断日记分类（工作/家庭/旅游/学习/生活/情感/纪念/未分类）
2. 提取标签（人物、地点、事件、主题）

【重要】只返回纯JSON，不要使用markdown代码块：
{
  "category": "分类名称",
  "confidence": 0.85,
  "reason": "判断依据",
  "tags": ["#人物/名", "#地点/名", "#事件/名"],
  "details": {
    "人物": ["名1", "名2"],
    "地点": ["地点1"],
    "事件": ["事件1"],
    "主题": ["主题"]
  }
}`;

  const result = await callAI(prompt, { maxTokens: 400 });
  
  try {
    let cleaned = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        category: parsed.category || '未分类',
        confidence: parsed.confidence || 0.5,
        reason: parsed.reason || '',
        tags: parsed.tags || [],
        details: parsed.details || {}
      };
    }
    return { category: '未分类', confidence: 0.5, reason: '', tags: [], details: {} };
  } catch (e) {
    console.error('[analyzeDiaryCombined] 解析失败:', e.message);
    return { category: '未分类', confidence: 0.5, reason: '解析错误', tags: [], details: {} };
  }
}

/**
 * 【优化】批量并行分析（同时处理多个文件）
 * @param {Array} diaries - 日记列表
 * @param {number} batchSize - 每批并行数量（默认5）
 */
async function analyzeDiariesBatch(diaries, batchSize = 5) {
  const results = [];
  
  // 分批并行处理
  for (let i = 0; i < diaries.length; i += batchSize) {
    const batch = diaries.slice(i, i + batchSize);
    
    // 并行处理一批
    const batchResults = await Promise.all(
      batch.map(async (diary) => {
        try {
          const analysis = await analyzeDiaryCombined(diary.content, diary.name);
          return {
            file: diary.path,
            name: diary.name,
            ...analysis,
            error: null
          };
        } catch (e) {
          return {
            file: diary.path,
            name: diary.name,
            category: '未分类',
            confidence: 0,
            reason: '',
            tags: [],
            details: {},
            error: e.message
          };
        }
      })
    );
    
    results.push(...batchResults);
    
    // 批次间隔（避免 API 压力）
    if (i + batchSize < diaries.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return results;
}

/**
 * 生成标签
 */
async function generateTags(content) {
  const prompt = `分析以下日记内容，提取关键元素生成标签。

【日记内容】
${content.slice(0, 500)}

【提取规则】
- 人物：文中提到的人名
- 地点：文中提到的地点
- 事件：重要事件名称
- 主题：内容主题

【重要】只返回纯JSON，不要使用markdown代码块，格式如下：
{
  "tags": ["#人物/家人", "#地点/公园", "#事件/郊游"],
  "details": {
    "人物": ["家人"],
    "地点": ["昆明动物园"],
    "事件": ["看熊猫"],
    "主题": ["亲子活动"]
  }
}`;

  const result = await callAI(prompt, { maxTokens: 300 });
  console.log('[generateTags] AI返回:', result);
  
  try {
    // 清理 markdown 代码块标记
    let cleaned = result
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    
    // 提取 JSON 部分
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { tags: [], details: {} };
  } catch (e) {
    console.error('[generateTags] 解析失败:', e.message, '原始内容:', result);
    return { tags: [], details: {} };
  }
}

/**
 * 【优化】快速关联发现 - 纯关键词匹配（无 AI，速度快）
 */
async function findRelated(currentContent, currentFile, allDiaries) {
  const candidates = [];
  
  // 提取当前日记关键词和人物
  const currentKeywords = extractKeywords(currentContent);
  const currentPeople = extractPeople(currentContent);
  
  // 如果没有关键词，直接返回空
  if (currentKeywords.length === 0 && currentPeople.length === 0) {
    return [];
  }
  
  for (const diary of allDiaries) {
    if (diary.path === currentFile) continue;
    
    const diaryKeywords = extractKeywords(diary.content || '');
    const diaryPeople = extractPeople(diary.content || '');
    
    // 计算关键词重叠得分
    const keywordOverlap = currentKeywords.filter(k => diaryKeywords.includes(k)).length;
    const peopleOverlap = currentPeople.filter(p => diaryPeople.includes(p)).length;
    
    // 总得分（人物权重更高）
    const score = keywordOverlap * 10 + peopleOverlap * 20;
    
    if (score >= 10) {  // 有一定关联
      candidates.push({
        ...diary,
        keywordScore: score,
        matchedKeywords: currentKeywords.filter(k => diaryKeywords.includes(k)),
        matchedPeople: currentPeople.filter(p => diaryPeople.includes(p))
      });
    }
  }
  
  // 按得分排序，返回前5个
  return candidates
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, 5)
    .map(c => ({
      path: c.path,
      name: c.name,
      score: c.keywordScore,
      reason: `关键词匹配: ${c.matchedKeywords.join(', ')}${c.matchedPeople.length ? ', 人物: ' + c.matchedPeople.join(', ') : ''}`
    }));
}

/**
 * 简单关键词提取（非AI）
 */
function extractKeywords(content) {
  const keywords = [];
  const patterns = [
    /家人/g, /孩子/g, /工作/g, /会议/g, /项目/g,
    /旅游/g, /公园/g, /生日/g, /节日/g
  ];
  patterns.forEach(p => {
    if (p.test(content)) {
      keywords.push(p.source);
    }
  });
  return keywords;
}

/**
 * 简单人物提取（非AI）
 */
function extractPeople(content) {
  const people = [];
  // 用户可自定义常见人名，这里提供示例
  const names = ['张三', '李四', '王经理'];
  names.forEach(name => {
    if (content.includes(name)) {
      people.push(name);
    }
  });
  return people;
}

/**
 * 生成系列文章
 */
async function generateSeriesStream(diaries, seriesTitle, onChunk) {
  const diaryList = diaries.map(d => 
    `【${d.name}】\n${d.content.slice(0, 300)}...`
  ).join('\n\n');
  
  const prompt = `将以下多篇日记整理成一篇系列文章。

【日记列表】
${diaryList}

【整理要求】
1. 添加系列标题：${seriesTitle}
2. 添加引言和总结
3. 每篇日记作为一个章节，保留主要内容
4. 添加过渡段落使文章连贯
5. 标注每段来源

【输出格式】
# {系列标题}

## 引言
{引言内容}

## 第一章：{章节标题}
{内容}（来源：文件名）

## 第二章：{章节标题}
{内容}（来源：文件名）

...

## 总结
{总结内容}

---
本系列由以下日记整理：列出日记文件名

开始输出系列文章：`;

  return await callAIStream(prompt, onChunk, { maxTokens: 2000 });
}

/**
 * Research-on-Miss：自动研究主题
 * @param {string} topic - 要研究的主题
 * @param {string} depth - 研究深度：quick, standard, deep
 * @returns {Object} 研究结果
 */
async function researchTopic(topic, depth = 'standard') {
  const maxTokens = depth === 'quick' ? 500 : depth === 'deep' ? 2000 : 1000;
  
  const prompt = `请对以下主题进行研究并提供结构化的知识摘要：

主题：${topic}

请提供：
1. 主题的简要定义和核心概念
2. 关键要点（3-5条）
3. 相关领域或延伸概念
4. 推荐的进一步阅读方向

请以 JSON 格式返回：
{
  "title": "主题标题",
  "summary": "简要定义（50字以内）",
  "content": "详细内容（包含核心概念和要点）",
  "tags": ["标签1", "标签2"],
  "sources": ["来源1", "来源2"],
  "related_concepts": ["相关概念1", "相关概念2"]
}

只返回 JSON，不要其他解释。`;

  try {
    const response = await callAI(prompt, { maxTokens });
    
    // 解析 JSON
    let result;
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        // 如果没有找到 JSON，构建默认结果
        result = {
          title: topic,
          summary: '自动研究结果',
          content: response,
          tags: [],
          sources: ['AI自动研究'],
          related_concepts: []
        };
      }
    } catch(parseError) {
      result = {
        title: topic,
        summary: '自动研究结果',
        content: response,
        tags: [],
        sources: ['AI自动研究'],
        related_concepts: []
      };
    }
    
    return result;
  } catch(error) {
    // 如果 AI 调用失败，返回基本结构
    return {
      title: topic,
      summary: '研究失败，请手动补充',
      content: `关于 "${topic}" 的研究未能完成。错误：${error.message}`,
      tags: [topic],
      sources: [],
      related_concepts: [],
      error: error.message
    };
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  callAI,
  callAIStream,
  generateSummary,
  generateSummaryStream,
  semanticSearch,
  polishTextStream,
  getPolishStyles,
  savePolishStyles,
  callOpenAIFormat,
  // 智能整理
  classifyDiary,
  classifyDiaries,
  generateTags,
  findRelated,
  generateSeriesStream,
  extractKeywords,
  extractPeople,
  // 优化版
  analyzeDiaryCombined,
  analyzeDiariesBatch,
  // Phase 1 新增
  researchTopic
};