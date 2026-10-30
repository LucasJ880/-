#!/usr/bin/env python3
"""从报价工作台 index.html 抽出 <script id="seed"> 价表 JSON。用法：extract-seed.py <index.html> <out.json>"""
import json, re, sys

html = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<script id="seed" type="application/json">(.*?)</script>', html, re.S)
if not m:
    sys.exit("index.html 里没有 <script id=\"seed\">")
seed = json.loads(m.group(1))
json.dump(seed, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("products:", list(seed["data"]["products"].keys()), "version:", seed.get("version"))
