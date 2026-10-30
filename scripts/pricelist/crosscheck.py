#!/usr/bin/env python3
"""三方逐格比对：HTML seed / Excel 价格矩阵 / 青砚 pricing-data。
用法：crosscheck.py <seed.json> <模板.xlsx> <qingyan-pricing.json>
退出码：0 = 老产品零差异；1 = 有差异或缺表（差异本身不是错，是要进 config/pricelist 的增量）。"""
import json, sys
import openpyxl

seed = json.load(open(sys.argv[1], encoding="utf-8"))
wb = openpyxl.load_workbook(sys.argv[2], data_only=False)
qy = json.load(open(sys.argv[3], encoding="utf-8"))
S = seed["data"]["products"]
problems = 0

def tables_of(p):
    t = {fn: fv["msrp"] for fn, fv in p["fabrics"].items() if isinstance(fv, dict) and "msrp" in fv}
    t.update(p.get("msrpTables", {}))
    return t

print("### A. HTML seed vs 青砚 pricing-data（青砚版本 %s）" % qy.get("version"))
for name, p in S.items():
    qb = qy["BRACKETS"].get(name)
    if not qb:
        print(f"- {name}: 青砚无此产品 → 增量"); problems += 1; continue
    same = p["brackets"]["widths"] == qb["widths"] and p["brackets"]["heights"] == qb["heights"]
    print(f"- {name}: 档位同={same}")
    if not same: problems += 1
    qt = qy["MSRP"].get(name, {})
    for fn, m in tables_of(p).items():
        qm = qt.get(fn)
        if qm is None:
            print(f"    · {fn!r}: 青砚缺表 → 增量"); problems += 1; continue
        diffs = [(hi, wi, a, qm[hi][wi]) for hi, row in enumerate(m) for wi, a in enumerate(row)
                 if hi >= len(qm) or wi >= len(qm[hi]) or abs(a - qm[hi][wi]) > 1e-6]
        print(f"    · {fn!r}: {len(m)}x{len(m[0])} 差异格数={len(diffs)}" + (f" 例 {diffs[:3]}" if diffs else ""))
        if diffs: problems += 1

print("\n### B. Excel 价格矩阵 vs HTML seed")
grid = [[c.value for c in r] for r in wb["价格矩阵"].iter_rows()]
i = 0
while i < len(grid):
    row = grid[i]
    nxt = grid[i + 1] if i + 1 < len(grid) else None
    if isinstance(row[0], str) and nxt and any(isinstance(v, (int, float)) for v in nxt[1:]) \
            and all(isinstance(v, (int, float)) for v in nxt[1:] if v is not None):
        title = row[0]; widths = [v for v in nxt[1:] if v is not None]
        j = i + 2; heights = []; mat = []
        while j < len(grid) and isinstance(grid[j][0], (int, float)):
            heights.append(grid[j][0]); mat.append(grid[j][1:1 + len(widths)]); j += 1
        prod, fab = [s.strip() for s in title.split("|", 1)] if "|" in title else (title.strip(), None)
        p = S.get(prod)
        src = None
        if p:
            if "msrpTables" in p and fab in p["fabrics"]:
                src = p["msrpTables"][p["fabrics"][fab]["msrpRef"]]
            elif fab in p["fabrics"] and "msrp" in p["fabrics"][fab]:
                src = p["fabrics"][fab]["msrp"]
        if src is None:
            print(f"- {title}: seed 无对应表（特殊规则产品属正常，如 Door Screen Sheer）")
        else:
            same = widths == p["brackets"]["widths"] and heights == p["brackets"]["heights"]
            diffs = [(hi, wi) for hi, r in enumerate(mat) for wi, a in enumerate(r) if a is None or abs(float(a) - src[hi][wi]) > 0.01]
            print(f"- {title}: 档位同={same} 差异格数={len(diffs)}")
            if not same or diffs: problems += 1
        i = j
    else:
        i += 1

print("\n青砚折扣", qy["DEFAULT_DISCOUNTS"]); print("青砚最低价", qy["PRICE_FLOOR"]); print("青砚安装", qy["INSTALL_RULES"], qy["consts"])
print("新价表安装", seed["data"]["install"], "运费", seed["data"]["delivery"])
sys.exit(1 if problems else 0)
