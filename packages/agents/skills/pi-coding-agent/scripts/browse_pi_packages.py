#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from html.parser import HTMLParser
from typing import Any
from urllib.request import Request, urlopen


GALLERY_URL = "https://pi.dev/packages"


class PackageGalleryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.packages: list[dict[str, Any]] = []
        self.card: dict[str, Any] | None = None
        self.description_parts: list[str] = []
        self.in_description = False

    def handle_starttag(
        self, tag: str, attrs_list: list[tuple[str, str | None]]
    ) -> None:
        attrs = dict(attrs_list)
        classes = set((attrs.get("class") or "").split())

        if tag == "article" and attrs.get("data-package-card") == "true":
            downloads = attrs.get("data-package-downloads") or "0"
            self.card = {
                "name": attrs.get("data-package-name") or "",
                "types": (attrs.get("data-package-types") or "").split(),
                "downloads": int(downloads) if downloads.isdigit() else 0,
                "date": attrs.get("data-package-date") or "",
                "search": attrs.get("data-package-search") or "",
                "description": "",
                "gallery_url": "",
                "npm_url": "",
                "repository_url": "",
            }
            self.description_parts = []
            return

        if self.card is None:
            return

        if tag == "p" and "packages-desc" in classes:
            self.in_description = True
        elif tag == "a":
            href = attrs.get("href") or ""
            if href.startswith("/packages/") and not self.card["gallery_url"]:
                self.card["gallery_url"] = f"https://pi.dev{href}"
            elif "npmjs.com/package/" in href:
                self.card["npm_url"] = href
            elif href and "github.com/earendil-works/pi/issues/new" not in href:
                if not self.card["repository_url"]:
                    self.card["repository_url"] = href

    def handle_data(self, data: str) -> None:
        if self.card is not None and self.in_description:
            self.description_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.card is None:
            return
        if tag == "p" and self.in_description:
            self.in_description = False
            self.card["description"] = " ".join(
                "".join(self.description_parts).split()
            )
        elif tag == "article":
            self.packages.append(self.card)
            self.card = None
            self.description_parts = []
            self.in_description = False


def fetch_page(page: int) -> list[dict[str, Any]]:
    request = Request(
        f"{GALLERY_URL}?page={page}",
        headers={"User-Agent": "tools-pi-package-browser/1.0"},
    )
    with urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8")
    parser = PackageGalleryParser()
    parser.feed(html)
    return parser.packages


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Browse package metadata from the public Pi package gallery."
    )
    parser.add_argument(
        "query",
        nargs="?",
        default="",
        help="Case-insensitive text matched against the gallery search metadata.",
    )
    parser.add_argument("--page", type=int, default=1, help="First gallery page.")
    parser.add_argument(
        "--pages", type=int, default=1, help="Number of pages to fetch."
    )
    parser.add_argument(
        "--type",
        choices=("extension", "skill", "prompt", "theme"),
        help="Only return packages carrying this gallery resource badge.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    args = parser.parse_args()
    if args.page < 1:
        parser.error("--page must be at least 1")
    if args.pages < 1:
        parser.error("--pages must be at least 1")
    return args


def main() -> int:
    args = parse_args()
    query = args.query.casefold()
    matches: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        for page in range(args.page, args.page + args.pages):
            for package in fetch_page(page):
                if package["name"] in seen:
                    continue
                seen.add(package["name"])
                if query and query not in package["search"].casefold():
                    continue
                if args.type and args.type not in package["types"]:
                    continue
                package["page"] = page
                package.pop("search", None)
                matches.append(package)
    except Exception as error:
        print(f"failed to browse Pi packages: {error}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(matches, indent=2, sort_keys=True))
        return 0

    if not matches:
        print("No matching packages found in the fetched gallery pages.")
        return 0

    for package in matches:
        resource_types = ",".join(package["types"]) or "package"
        print(
            f"{package['name']}\t{resource_types}\t"
            f"{package['downloads']}/mo\t{package['description']}"
        )
        if package["repository_url"]:
            print(f"  repo: {package['repository_url']}")
        print(f"  gallery: {package['gallery_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
