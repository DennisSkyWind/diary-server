#!/usr/bin/env node
const { chromium } = require('/home/ubuntu/venv-copaw/lib/python3.12/site-packages/playwright/driver/package/cli.js');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = '/home/ubuntu/logseq-notes/.weibo-config.json';

async function postWeibo(content) {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  const cookie = config.cookie;
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iOS(7.4.7.0) __weibo__7.4.7.0)'
  });
  
  // 添加Cookie
  const cookies = cookie.split(';').map(c => {
    const [name, value] = c.trim().split('=');
    return { name, value, domain: '.weibo.cn' };
  });
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  
  try {
    // 访问发布页面
    await page.goto('https://m.weibo.cn/compose', { timeout: 15000 });
    await page.waitForSelector('textarea', { timeout: 10000 });
    
    // 输入内容
    await page.fill('textarea', content);
    
    // 点击发布按钮
    await page.click('.send');
    
    // 等待发布结果
    await page.waitForTimeout(3000);
    
    // 检查是否成功
    const url = page.url();
    if (url.includes('detail')) {
      const mid = url.split('/detail/')[1];
      console.log(JSON.stringify({ 
        success: true, 
        url: `https://m.weibo.cn/detail/${mid}`,
        weiboUrl: `https://weibo.com/detail/${mid}`
      }));
    } else {
      // 检查是否有错误
      const errorText = await page.textContent('.layer_point').catch(() => '');
      console.log(JSON.stringify({ 
        success: false, 
        error: errorText || '发布失败'
      }));
    }
  } catch (e) {
    console.log(JSON.stringify({ 
      success: false, 
      error: e.message 
    }));
  } finally {
    await browser.close();
  }
}

// 获取命令行参数
const args = process.argv.slice(2);
const content = args.join(' ') || '测试发布';
postWeibo(content);