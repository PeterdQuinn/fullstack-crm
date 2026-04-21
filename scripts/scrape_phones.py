"""
Scrapes phone numbers from company websites for leads missing a phone.
Run: python3 scripts/scrape_phones.py
Outputs: scripts/scraped_phones.csv
"""

import csv
import re
import time
import urllib.request
from html.parser import HTMLParser

LEADS = [
    # Paste any lead here as {"name": "...", "website": "..."}
    # Or just run as-is for the Apollo leads missing numbers
    {"name": "Keyack Technology Solutions", "website": ""},
    {"name": "All Season's Landscape & Masonry", "website": ""},
    # Add more below — copy/paste name + website from your CRM
]

PHONE_RE = re.compile(
    r'(\+?1[\s.-]?)?'
    r'\(?\d{3}\)?[\s.\-]'
    r'\d{3}[\s.\-]'
    r'\d{4}'
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


class TextExtractor(HTMLParser):
    """Strip HTML tags and return plain text."""
    def __init__(self):
        super().__init__()
        self.chunks = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self.chunks.append(data)

    def get_text(self):
        return " ".join(self.chunks)


def fetch(url: str, timeout: int = 8) -> str:
    if not url:
        return ""
    if not url.startswith("http"):
        url = "https://" + url
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(150_000)  # first 150kb is plenty
            charset = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(charset, errors="replace")
    except Exception as e:
        print(f"  ✗ fetch failed: {e}")
        return ""


def find_phone(html: str) -> str:
    if not html:
        return ""
    parser = TextExtractor()
    parser.feed(html)
    text = parser.get_text()
    match = PHONE_RE.search(text)
    return match.group(0).strip() if match else ""


def main():
    results = []
    for lead in LEADS:
        name = lead["name"]
        site = lead["website"].strip()
        if not site:
            print(f"[SKIP] {name} — no website")
            results.append({"name": name, "website": site, "phone": "no website"})
            continue

        print(f"[...] {name} → {site}")
        html = fetch(site)
        phone = find_phone(html)
        status = phone if phone else "not found"
        print(f"  → {status}")
        results.append({"name": name, "website": site, "phone": status})
        time.sleep(1)  # be polite, avoid getting blocked

    out = "scripts/scraped_phones.csv"
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "website", "phone"])
        writer.writeheader()
        writer.writerows(results)

    found = sum(1 for r in results if r["phone"] not in ("not found", "no website"))
    print(f"\nDone — {found}/{len(results)} numbers found → {out}")


if __name__ == "__main__":
    main()
