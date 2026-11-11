"""Browser smoke test against the cached demo API; no live XHS searches."""

import json
from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(locale="zh-CN")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8089/?cached=1", wait_until="domcontentloaded")
    assert page.locator(".cache-notice").is_visible()
    page.locator("#request").fill("今晚想一个人沿苏州河安静散步")
    page.locator("#search-button").click()
    page.locator("#ideas .idea-card").first.wait_for(timeout=60000)
    cards = page.locator("#ideas .idea-card")
    count = cards.count()
    links = page.locator("#ideas .source-links a").count()
    first_titles = cards.locator("h3").all_text_contents()
    query_rows = page.locator("#retrieval-queries .retrieval-query").count()
    keyword_chips = page.locator("#keyword-list .keyword-chip").count()
    angles = page.locator("#ideas .card-angle").all_text_contents()
    assert count == 3
    assert links >= 3
    assert query_rows == 2
    assert keyword_chips == 2
    assert len(set(angles)) == 3
    page.locator("#request").fill("想看静安的小路和建筑，不想逛商场")
    page.locator("#search-button").click()
    page.locator("#ideas .idea-card").first.wait_for(timeout=60000)
    second_titles = page.locator("#ideas .idea-card h3").all_text_contents()
    print(json.dumps({"firstTitles": first_titles, "secondTitles": second_titles,
           "angles": angles, "queryRows": query_rows, "keywordChips": keyword_chips,
           "sourceLinks": page.locator("#ideas .source-links a").count(), "pageErrors": errors}, ensure_ascii=True))
    assert len(second_titles) == 3
    assert first_titles != second_titles
    assert not errors
    browser.close()
