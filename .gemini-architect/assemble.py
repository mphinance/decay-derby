#!/usr/bin/env python3
"""Assemble architect prompt with actual file contents inlined."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

files = {
    "PLACEHOLDER_INDEX": ROOT / "docs/index.html",
    "PLACEHOLDER_CSS": ROOT / "docs/css/styles.css",
    "PLACEHOLDER_PORTFOLIO": ROOT / "docs/js/portfolio.js",
    "PLACEHOLDER_TRACKER": ROOT / "docs/js/tracker.js",
    "PLACEHOLDER_SCREENER": ROOT / "docs/js/screener.js",
    "PLACEHOLDER_SUBSTACK": ROOT / "docs/js/substack.js",
    "PLACEHOLDER_APP": ROOT / "docs/js/app.js",
    "PLACEHOLDER_DATA": ROOT / "docs/data/daily/2026-04-21.json",
}

template = (ROOT / ".gemini-architect/round1_prompt.md").read_text()

for placeholder, fpath in files.items():
    if fpath.exists():
        template = template.replace(placeholder, fpath.read_text())
    else:
        template = template.replace(placeholder, f"[FILE NOT FOUND: {fpath}]")

out = ROOT / ".gemini-architect/round1_assembled.md"
out.write_text(template)
print(f"✓ Assembled: {len(template):,} chars → {out}")
