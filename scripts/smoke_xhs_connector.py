"""Run a safe, read-only search/detail smoke check."""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xhs_connector import XhsConnector


with sync_playwright() as playwright:
    connector = XhsConnector(playwright)
    try:
        for keyword in ("上海安静散步", "上海 安静 下午散步"):
            start = time.monotonic()
            notes = connector.search_notes(keyword)
            print(f"{keyword}: {len(notes)} 条，{time.monotonic() - start:.2f} 秒", flush=True)
        start = time.monotonic()
        detail = connector.get_note_detail(notes[0]["id"], notes[0]["xsecToken"])
        print(
            f"详情：正文 {len(detail['description'])} 字，评论 {len(detail['comments'])} 条，"
            f"{time.monotonic() - start:.2f} 秒",
            flush=True,
        )
    finally:
        connector.close()
