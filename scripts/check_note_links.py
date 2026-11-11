import json
import sqlite3
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


db = sqlite3.connect('data/trial.sqlite')
row = db.execute("SELECT data FROM stages WHERE stage = 'complete-run' ORDER BY saved_at DESC LIMIT 1").fetchone()
db.close()
if not row:
    raise RuntimeError('No saved discovery result for link check')
saved = json.loads(row[0])
output = saved['output']
fixture = {
    'keywordPlan': output['keywordPlan'],
    'searchResult': output['searchResult'],
    'cards': output['cards'],
    'quality': output['quality'],
    'runId': saved['run']['id'],
}
script = f"""window.gogogoAgentAdapter = {{
  async *discover() {{
    yield {{ type: 'stage.started', stage: 'keywords', message: 'checking' }};
    yield {{ type: 'discovery.results', ...{json.dumps(fixture, ensure_ascii=False)} }};
  }}
}};"""

output_dir = Path('data/captures/layout')
output_dir.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True,
        executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    for name, width, height, user_agent in [
        ('desktop', 1280, 900, None),
        ('mobile-browser', 390, 844,
         'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
         '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
        ('wechat-mobile', 390, 844,
         'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
         '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50'),
    ]:
        context = browser.new_context(viewport={'width': width, 'height': height},
            user_agent=user_agent) if user_agent else browser.new_context(viewport={'width': width, 'height': height})
        page = context.new_page()
        page.add_init_script(script)
        page.goto('http://127.0.0.1:3001/explore.html?mock=1')
        page.locator('#location').fill('北京海淀')
        page.locator('#brief-form button[type=submit]').click()
        page.locator('.idea-card').first.wait_for()
        links = page.locator('.idea-card .source-link-row a')
        assert links.count() > 0, 'No note links rendered'
        assert page.locator('.idea-card img').count() == 0, 'Card still renders an image'
        assert all(links.nth(i).get_attribute('target') == '_self' for i in range(links.count()))
        if name == 'wechat-mobile':
            assert page.locator('#note-open-hint').is_visible()
            assert all('xhsshare=WeixinSession' in links.nth(i).get_attribute('href') for i in range(links.count()))
            assert all('xsec_token=' in links.nth(i).get_attribute('href') for i in range(links.count()))
            page.locator('.source-link-row .copy-note-link').first.click()
            expect(page.locator('.source-link-row .copy-note-link').first).to_have_text('已复制')
            page.locator('.select-direction-button').first.click()
            assert 'xhsshare=WeixinSession' in page.locator('#selected-direction-sources a').first.get_attribute('href')
        else:
            assert all('xsec_token=' in links.nth(i).get_attribute('href') for i in range(links.count()))
        assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
        page.screenshot(path=str(output_dir / f'note-links-{name}.png'), full_page=True)
        print(name, 'cards', page.locator('.idea-card').count(), 'links', links.count())
        context.close()
    browser.close()
