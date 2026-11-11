"""Local JSON-lines bridge to the read-only browser connector."""

import json
import os
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

from xhs_connector import XhsConnector


def main():
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    with sync_playwright() as playwright:
        connector = None
        last_started = None
        min_interval = max(0, min(int(os.environ.get("XHS_MIN_INTERVAL_MS", "8000")), 120000)) / 1000
        try:
            for line in sys.stdin:
                request = None
                try:
                    request = json.loads(line)
                    command = request.get("command")
                    if command not in ("status", "search", "detail"):
                        raise ValueError("不支持的命令")
                    if connector is None:
                        connector = XhsConnector(playwright)
                    if last_started is not None:
                        time.sleep(max(0, min_interval - (time.monotonic() - last_started)))
                    last_started = time.monotonic()
                    if command == "status":
                        result = {"isLoggedIn": connector.login_status()}
                    elif command == "search":
                        result = connector.search_notes(request.get("keyword"))
                    else:
                        result = connector.get_note_detail(request.get("feedId"), request.get("xsecToken"))
                    response = {"requestId": request.get("requestId"), "success": True, "data": result}
                except Exception as error:
                    response = {"requestId": request.get("requestId") if isinstance(request, dict) else None,
                                "success": False, "error": str(error), "traceback": traceback.format_exc()}
                print(json.dumps(response, ensure_ascii=True), flush=True)
        finally:
            if connector is not None:
                connector.close()


if __name__ == "__main__":
    main()
