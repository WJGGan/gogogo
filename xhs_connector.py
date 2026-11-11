"""Small, read-only Xiaohongshu browser connector for local development.

The browser performs the site's own search requests. No private API signing or
publishing capabilities are included here.
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


ROOT = Path(__file__).resolve().parent
SESSION_FILE = Path(os.environ.get("XHS_COOKIE_FILE") or ROOT / "data" / "xhs_cookies.json").expanduser().resolve()
LEGACY_COOKIE_FILE = ROOT / "tools" / "cookies.json"


def _browser_options():
    configured = os.environ.get("XHS_BROWSER_PATH")
    if configured:
        return {"executable_path": configured}
    if os.name != "nt":
        return {}  # Playwright-managed Chromium on Linux.
    if Path("C:/Program Files/Google/Chrome/Application/chrome.exe").exists():
        return {"channel": "chrome"}
    cache = Path.home() / "AppData/Local/xiaohongshu-mcp/browser"
    matches = sorted(cache.glob("*/browser/chrome.exe"), reverse=True)
    if matches:
        return {"executable_path": str(matches[0])}
    return {"channel": "chrome"}


def _load_cookies():
    path = SESSION_FILE if SESSION_FILE.exists() or os.environ.get("XHS_COOKIE_FILE") else LEGACY_COOKIE_FILE
    if not path.exists():
        raise RuntimeError("没有登录会话；先运行 python xhs_connector.py login")
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = data["cookies"] if isinstance(data, dict) else data
    fields = {"name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"}
    return [{key: value for key, value in cookie.items() if key in fields} for cookie in raw]


class XhsConnector:
    def __init__(self, playwright, headless=True):
        self.browser = playwright.chromium.launch(headless=headless, **_browser_options())
        self.context = self.browser.new_context(locale="zh-CN")
        self.context.add_cookies(_load_cookies())

    def close(self):
        self.browser.close()

    def login_status(self):
        page = self.context.new_page()
        try:
            page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_function("() => window.__INITIAL_STATE__?.user?.loggedIn !== undefined", timeout=15000)
            return bool(page.evaluate("() => window.__INITIAL_STATE__.user.loggedIn.value ?? window.__INITIAL_STATE__.user.loggedIn._value ?? window.__INITIAL_STATE__.user.loggedIn"))
        finally:
            page.close()

    def search_notes(self, keyword):
        if not isinstance(keyword, str):
            raise ValueError("搜索词必须是字符串")
        keyword = keyword.strip()
        if not keyword:
            raise ValueError("搜索词不能为空")
        page = self.context.new_page()
        url = "https://www.xiaohongshu.com/search_result?" + urlencode(
            {"keyword": keyword, "source": "web_explore_feed"}
        )
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_function(
                "() => { const f = window.__INITIAL_STATE__?.search?.feeds; "
                "return Array.isArray(f?.value ?? f?._value) && (f.value ?? f._value).length > 0 }",
                timeout=25000,
            )
            feeds = page.evaluate(
                "() => { const f = window.__INITIAL_STATE__.search.feeds; "
                "return f.value ?? f._value }"
            )
            results = []
            seen = set()
            for feed in feeds:
                feed_id, token = feed.get("id"), feed.get("xsecToken")
                if feed.get("modelType") != "note" or not feed_id or not token or feed_id in seen:
                    continue
                seen.add(feed_id)
                card = feed.get("noteCard") or {}
                user = card.get("user") or {}
                cover = card.get("cover") or {}
                try:
                    source_url = self.note_url(feed_id, token)
                except UnicodeEncodeError:
                    # A malformed upstream token must not discard the other notes.
                    continue
                results.append({
                    "id": feed_id,
                    "xsecToken": token,
                    "title": card.get("displayTitle", ""),
                    "type": card.get("type", ""),
                    "author": user.get("nickname") or user.get("nickName") or "",
                    "coverUrl": cover.get("urlDefault") or cover.get("url") or "",
                    "url": source_url,
                })
            return results
        finally:
            page.close()

    @staticmethod
    def note_url(feed_id, token):
        return "https://www.xiaohongshu.com/explore/" + feed_id + "?" + urlencode(
            {"xsec_token": token, "xsec_source": "pc_feed"}
        )

    def get_note_detail(self, feed_id, token):
        if not isinstance(feed_id, str) or not feed_id.strip():
            raise ValueError("笔记 ID 不能为空")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("xsecToken 不能为空")
        feed_id, token = feed_id.strip(), token.strip()
        page = self.context.new_page()
        try:
            page.goto(self.note_url(feed_id, token), wait_until="domcontentloaded", timeout=30000)
            page.wait_for_function(
                "id => !!window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]",
                arg=feed_id,
                timeout=25000,
            )
            try:
                page.wait_for_function(
                    "id => { const d = window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]; "
                    "const expected = Number(d?.note?.interactInfo?.commentCount || 0); "
                    "return expected === 0 || (d?.comments?.list?.length || 0) > 0 }",
                    arg=feed_id,
                    timeout=8000,
                )
            except PlaywrightTimeoutError:
                pass
            detail = page.evaluate(
                "id => window.__INITIAL_STATE__.note.noteDetailMap[id]", feed_id
            )
            note = detail.get("note") or {}
            comments = (detail.get("comments") or {}).get("list") or []
            return {
                "id": feed_id,
                "xsecToken": token,
                "title": note.get("title", ""),
                "description": note.get("desc", ""),
                "comments": [item.get("content", "") for item in comments],
                "images": [image.get("urlDefault") or image.get("urlPre") for image in note.get("imageList", []) if image.get("urlDefault") or image.get("urlPre")],
                "publishedAt": note.get("time"),
                "author": (note.get("user") or {}).get("nickname", ""),
                "url": self.note_url(feed_id, token),
            }
        finally:
            page.close()


def login(fresh=False):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False, **_browser_options())
        context = browser.new_context(locale="zh-CN")
        if not fresh and (SESSION_FILE.exists() or (not os.environ.get("XHS_COOKIE_FILE") and LEGACY_COOKIE_FILE.exists())):
            context.add_cookies(_load_cookies())
        page = context.new_page()
        try:
            page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=30000)
            print("请在打开的浏览器中扫码登录（最多等待 3 分钟）...", flush=True)
            page.wait_for_function(
                "() => !!(window.__INITIAL_STATE__?.user?.loggedIn?.value ?? window.__INITIAL_STATE__?.user?.loggedIn?._value)",
                timeout=180000,
            )
            SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
            if fresh and SESSION_FILE.exists():
                backup_dir = ROOT / "data" / "xhs_sessions"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup = backup_dir / f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
                shutil.copy2(SESSION_FILE, backup)
                print(f"旧会话已备份到 {backup}")
            SESSION_FILE.write_text(json.dumps(context.cookies(), ensure_ascii=False), encoding="utf-8")
            print("登录成功，会话已保存。")
        finally:
            browser.close()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    login_parser = sub.add_parser("login")
    login_parser.add_argument("--fresh", action="store_true", help="使用全新浏览器会话扫码，成功后备份旧会话")
    sub.add_parser("status")
    search = sub.add_parser("search")
    search.add_argument("keyword")
    detail = sub.add_parser("detail")
    detail.add_argument("feed_id")
    detail.add_argument("xsec_token")
    args = parser.parse_args()
    if args.command == "login":
        login(fresh=args.fresh)
        return
    with sync_playwright() as playwright:
        connector = XhsConnector(playwright)
        try:
            if args.command == "status":
                result = {"loggedIn": connector.login_status()}
            elif args.command == "search":
                result = connector.search_notes(args.keyword)
            else:
                result = connector.get_note_detail(args.feed_id, args.xsec_token)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            connector.close()


if __name__ == "__main__":
    main()
