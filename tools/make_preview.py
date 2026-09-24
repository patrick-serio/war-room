#!/usr/bin/env python3
"""Build a single-file preview (demo league only) for hosting where files cannot sit side by side."""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
site = root / "site"
css = (site / "style.css").read_text()
logic = (site / "logic.js").read_text()
app = (site / "app.js").read_text()
demo = json.dumps(json.loads((site / "data" / "demo.json").read_text()), separators=(",", ":")).replace("</", "<\\/")
html = f"""<title>War Room</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style>
{css}
</style>
<div id="app" aria-live="polite"></div>
<script>window.__PREVIEW__ = {demo};</script>
<script>
{logic}
</script>
<script>
{app}
</script>
"""
out = root / "preview" / "war-room-preview.html"
out.write_text(html)
print("wrote", out, len(html) // 1024, "KB")
