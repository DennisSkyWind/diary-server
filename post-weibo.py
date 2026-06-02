#!/usr/bin/env python3
import json
import os
import sys
from playwright.sync_api import sync_playwright

CONFIG_FILE = os.environ.get('WEIBO_CONFIG_FILE', os.path.join(os.path.dirname(__file__), 'weibo-config.json'))

def post_weibo(content):
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
    
    cookie_str = config.get('cookie', '')
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
        context = browser.new_context(
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iOS(7.4.7.0))'
        )
        
        # 添加Cookie
        cookies = []
        for c in cookie_str.split(';'):
            if '=' in c:
                name, value = c.strip().split('=', 1)
                cookies.append({
                    'name': name,
                    'value': value,
                    'domain': '.weibo.cn',
                    'path': '/'
                })
        context.add_cookies(cookies)
        
        page = context.new_page()
        
        try:
            page.goto('https://m.weibo.cn/compose', timeout=15000)
            page.wait_for_selector('textarea', timeout=10000)
            
            # 输入内容
            page.fill('textarea', content)
            
            # 点击发布按钮 - 使用多种可能的选择器
            try:
                page.click('.send', timeout=3000)
            except:
                try:
                    page.click('a[\"node-type\"=\"submit\"]', timeout=3000)
                except:
                    page.click('div[action-type=\"submit\"]', timeout=3000)
            
            # 等待
            page.wait_for_timeout(3000)
            
            url = page.url
            if 'detail' in url:
                mid = url.split('/detail/')[-1]
                print(json.dumps({
                    'success': True,
                    'url': f'https://m.weibo.cn/detail/{mid}'
                }))
            else:
                print(json.dumps({
                    'success': False,
                    'error': '发布失败'
                }))
        except Exception as e:
            print(json.dumps({
                'success': False,
                'error': str(e)
            }))
        finally:
            browser.close()

if __name__ == '__main__':
    content = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else '测试发布'
    post_weibo(content)