from pathlib import Path

from playwright.sync_api import sync_playwright


output = Path('data/captures/layout')
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True,
        executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    for name, width, height in [('desktop', 1280, 900), ('mobile', 390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page.goto('http://127.0.0.1:3001/explore.html?mock=1')
        page.evaluate("""() => {
            const section = document.querySelector('#analysis');
            section.hidden = false;
            document.querySelector('#analysis-title').textContent = '正在搜索小红书';
            document.querySelector('#analysis-state').textContent = '分析中 · 2/3';
            document.querySelector('#analysis-message').textContent = '搜索 2/2：北京海淀 网球后咖啡 · 23 条笔记';
            document.querySelector('#analysis-progress-bar').style.width = '50%';
            document.querySelector('#analysis-updates').innerHTML = '<li>搜索 1/2：北京海淀 网球后吃饭 · 18 条笔记</li><li>已生成 2 个检索词</li>';
            section.querySelectorAll('[data-analysis-step]')[0].classList.add('is-complete');
            section.querySelectorAll('[data-analysis-step]')[1].classList.add('is-active');
        }""")
        page.locator('#analysis').scroll_into_view_if_needed()
        page.screenshot(path=str(output / f'progress-{name}.png'), full_page=True)
        sizes = page.evaluate('({ viewport: innerWidth, scroll: document.documentElement.scrollWidth })')
        print(name, sizes)
        page.close()
    browser.close()
