#!/usr/bin/env python3
"""Sunny 工艺单金标准夹具生成器（LibreOffice 重算 Excel 原件）。

用法：
  python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --all
  python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --only blinds,vinyl
  python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --scan-blinds-slots
  python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --only drapes-6cm,drapes-7cm --real-orders

原件按 SHA-256 识别（文件名随意，.xlsx / .xls / .et 均可），见 SOURCES；拍板后写进原件的公式补丁见 PATCHES，
真实订单见 REAL_ORDERS（--real-orders：原样只读保存值，写 fixtures/real-orders.json）。输出写到
src/lib/sunny-process/__tests__/fixtures/<name>.json。用例由固定随机种子生成，
同一原件重跑结果逐字节一致；夹具出现 diff 即说明原件或生成器变了。
"""
import argparse
import hashlib
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lo  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXTURES = os.path.join(REPO, "src", "lib", "sunny-process", "__tests__", "fixtures")

SOURCES = {
    "blinds": "85d45d6277624e35091b5e433e828cdde4d58c103bbc2319f29c6a4d56871e0c",
    "domestic": "32830359e00d273b0d35ad60dda36b2776673cf934051c9f601709a438cf1f90",
    # 6cm 改用新版模板（真实订单 G1024 所在工作簿，2026-10-26；成品高按 cm 扣减 + ROUND）。
    # 旧版 6cm 原件 9ec1b57e…（2025-09-18，按英寸扣减 + ROUNDDOWN）已退役，见报告 §3.4。
    "drapes-6cm": "c10789aba32e3134abfaeb8535f1297130858d76e1bb52fec1a1d3201485f886",
    # 7cm 仍是旧版原件；新版公式由 PATCHES 按拍板（U-1）写入后重算
    "drapes-7cm": "acb309364313d09736f78d8e738e91d25c32b54cfc819566db2a5f84bd5312a8",
    "vinyl": "70fc3cdb5c9535cbfbf352169eb851e2ebbde4405b05f4c2e3f249f0398ef13c",
}

# 真实订单（只读已保存的值，不写输入、不重算）——回归对照用
REAL_ORDERS = {
    "G0927": ("domestic", "f6ffe11ad373ae925329c78b727138ae1dcfad9e0add217c7f2b7902f05ff457"),
    "G1024": ("drapes-6cm", "c10789aba32e3134abfaeb8535f1297130858d76e1bb52fec1a1d3201485f886"),
    "G1025": ("drapes-6cm", "f76a3119780dd8df41c9a80d2c7da2ae4311185ebe9ac60968f3f8c1d7e421af"),
}

DRAPE_ROWS = range(5, 20)
DRAPE_HEIGHT_NEW = ('=IF(D{r}>0,ROUND(D{r}*2.54-IF(R{r}="顶装C",6,IF(OR(S{r}="方单轨",S{r}="圆单轨"),8,'
                    'IF(S{r}="圆双轨",9,IF(S{r}="方双轨",6,0)))),0),0)')
DRAPE_FINISHED_MINUS2 = "=IF(F{r}>0,F{r}-2,0)"

# 拍板后写进原件再重算的公式补丁（夹具 source.patches 里逐条记录）
PATCHES = {
    "drapes-6cm": [
        ("U-1 成品帘子高 = 成品高 − 2cm（韩褶 / 蛇形一样）", "工艺单", "I{r}", DRAPE_FINISHED_MINUS2, DRAPE_ROWS),
    ],
    "drapes-7cm": [
        ("U-1 成品高改用新版公式（cm 扣减 + ROUND，同 6cm 新版）", "工艺单", "F{r}", DRAPE_HEIGHT_NEW, DRAPE_ROWS),
        ("U-1 成品帘子高 = 成品高 − 2cm（韩褶 / 蛇形一样）", "工艺单", "I{r}", DRAPE_FINISHED_MINUS2, DRAPE_ROWS),
    ],
}

SOURCE_TITLES = {
    "blinds": "Blinds 工艺单_圆盒侧盖加厚标准版（20241007 新）",
    "domestic": "Blinds 国内下单表（斑马帘 卷帘 香格里拉帘 蜂窝帘 梦幻帘）1",
    "drapes-6cm": "6cm 窗帘工艺单（Drapes and Sheer）新版 · G1024-02R4S8AL139-458",
    "drapes-7cm": "7cm 窗帘工艺单（Drapes and Sheer）",
    "vinyl": "Vinyl shutters 工艺单 AIV1（整合版）",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


SPREADSHEET_EXT = (".xlsx", ".xls", ".et")


def find_sources(src_dir, table=None):
    """按 SHA-256 识别；table = {key: sha}（默认 SOURCES）。"""
    table = table or SOURCES
    found = {}
    for name in sorted(os.listdir(src_dir)):
        p = os.path.join(src_dir, name)
        if not name.lower().endswith(SPREADSHEET_EXT) or not os.path.isfile(p):
            continue
        digest = sha256(p)
        for key, want in table.items():
            if digest == want:
                found[key] = p
    return found


def apply_patches(wb, name):
    applied = []
    for label, sheet, cell, formula, rows in PATCHES.get(name, []):
        for r in rows:
            wb.set_formula(sheet, cell.format(r=r), formula.format(r=r))
        applied.append({"label": label, "sheet": sheet, "cells": f"{cell.format(r=rows[0])}:{cell.format(r=rows[-1])}",
                        "formula": formula.format(r=rows[0])})
    return applied


def sixteenth(rng, lo_in, hi_in):
    return rng.randint(lo_in * 16, hi_in * 16) / 16


def norm(v):
    """原件输出 → 夹具值：数字保留、文本保留、错误记为 {"error"}。"""
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return v
    return v


def write_fixture(name, path, cases, extra=None, patches=None):
    os.makedirs(FIXTURES, exist_ok=True)
    source = {"title": SOURCE_TITLES[name], "sha256": SOURCES[name]}
    if patches:
        source["patches"] = patches
    doc = {
        "source": source,
        "generator": "scripts/sunny-process-oracle/oracle.py",
        "cases": cases,
    }
    if extra:
        doc.update(extra)
    out = os.path.join(FIXTURES, f"{name}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"  wrote {os.path.relpath(out, REPO)} ({len(cases)} cases)")


# ─────────────────────────── Blinds ───────────────────────────

BLINDS_PRODUCTS = ["卷帘", "斑马帘", "香格里拉"]
# 系统口径 → 原件口径（原件下拉写"电机"，系统沿用"电动"）
BLINDS_CONTROLS = {"普通": "普通", "无绳": "无绳", "电动": "电机"}
BLINDS_HEADRAILS = ["亮白插片圆盒", "哑灰方型罩盒", "哑白方型罩盒", "灰弧", "白弧", "双轨无盒", "双轨半盒", "单轨无盒"]
BLINDS_MEASURES = ["IN", "OUT", "Tight"]
ZEBRA_RATIOS = [(3, 2), (3.125, 2.125), (3.5, 2.25), (3.25, 2.1875), (2.875, 2), (3, 1.9375), (4.8125, 3.5)]
# 拉绳分档边界附近的高度（高×0.8×0.0254 落在 0.1/0.6/0.8/1.0/1.2/1.5/1.8/2.0/2.2 两侧）
CORD_EDGE_HEIGHTS = []
for m in (0.1, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.2):
    h = m / (0.8 * 0.0254)
    base = round(h * 16)
    CORD_EDGE_HEIGHTS += [(base - 1) / 16, base / 16, (base + 1) / 16]

BLINDS_INPUT_CELLS = {  # 工艺单第 6 行 = 第 1 窗位
    "location": "B", "width": "C", "height": "D", "fabricSku": "E", "productType": "F",
    "measureType": "G", "controlType": "H", "controlSide": "I", "headrailType": "J",
    "mountType": "K", "fabricRatio": "L", "silkRatio": "M",
}


def blinds_cases(rng):
    cases = []
    i = 0
    for pt in BLINDS_PRODUCTS:
        for ct in BLINDS_CONTROLS:
            for ht in BLINDS_HEADRAILS:
                for mt in BLINDS_MEASURES:
                    for _ in range(2):
                        i += 1
                        fr, sr = (rng.choice(ZEBRA_RATIOS) if pt == "斑马帘" else (None, None))
                        cases.append({
                            "id": f"B{i:04d}",
                            "input": {
                                "location": f"W{i}", "width": sixteenth(rng, 12, 110),
                                "height": sixteenth(rng, 12, 110), "fabricSku": f"SKU-{i}",
                                "productType": pt, "measureType": mt, "controlType": ct,
                                "controlSide": rng.choice(["L", "R"]), "headrailType": ht,
                                "mountType": rng.choice(["顶装", "墙装"]),
                                "fabricRatio": fr, "silkRatio": sr,
                            },
                        })
    for h in CORD_EDGE_HEIGHTS:
        i += 1
        cases.append({"id": f"B{i:04d}", "input": {
            "location": f"W{i}", "width": 40.0, "height": h, "fabricSku": "EDGE",
            "productType": "卷帘", "measureType": "IN", "controlType": "普通", "controlSide": "L",
            "headrailType": "亮白插片圆盒", "mountType": "顶装", "fabricRatio": None, "silkRatio": None}})
    return cases


def blinds_write_inputs(wb, row, inp):
    for key, col in BLINDS_INPUT_CELLS.items():
        v = inp.get(key)
        if key == "controlType":
            v = BLINDS_CONTROLS[v]
        wb.set("工艺单", f"{col}{row}", v)


def blinds_read_block(wb, top, vref_row):
    """工艺组装一个窗位块（top=“订单号”所在行）。"""
    g = lambda c: wb.get("工艺组装", c)  # noqa: E731
    r = lambda off, col: g(f"{col}{top + off}")  # noqa: E731
    return {
        "cutHeadrail": r(4, "B"), "cutTube38": r(4, "C"), "cutRollerBar": r(4, "E"),
        "cutZebraBar": r(4, "F"), "cutCoreRod": r(4, "G"), "cutShangrilaBar": r(4, "H"),
        "cutFabricWidth": r(4, "I"), "cutFabricLength": r(4, "J"), "zebraCutPos": r(4, "K"),
        "insertSize": r(2, "I"), "cordTier": r(2, "K"),
        "qty": {"headrail": r(5, "B"), "tube38": r(5, "C"), "rollerBar": r(5, "E"),
                "zebraBar": r(5, "F"), "coreRod": r(5, "G"), "shangrilaBar": r(5, "H"),
                "fabricWidth": r(5, "I"), "fabricLength": r(5, "J")},
        "cutCategory": r(5, "K"),
        "zebraCutPosRaw": wb.get("纵向Ref", f"C{vref_row}"),
    }


def run_blinds(sess, path):
    rng = random.Random(20261027)
    wb = sess.open(path)
    cases = blinds_cases(rng)
    for n, case in enumerate(cases):
        wb.clear("工艺单", "B6:M6")
        wb.set("工艺单", "E2", "ORACLE-1")
        blinds_write_inputs(wb, 6, case["input"])
        wb.recalc()
        exp = blinds_read_block(wb, 3, 28)
        exp["squareFeet"] = wb.get("工艺单", "N6")
        # 《开料表（布料）》第 3 行 J/K 引用工艺单 D6（第 1 窗位）
        exp["sheetCordLength"] = wb.get("开料表（布料）", "J3")
        exp["sheetCordSleeve"] = wb.get("开料表（布料）", "K3")
        exp["label"] = [wb.get("LABEL PRINT", c) for c in ("B1", "B2", "B3", "D3", "B4", "C4")]
        case["expected"] = exp
        if n % 100 == 0:
            print(f"  blinds {n}/{len(cases)}")
    wb.close()
    write_fixture("blinds", path, cases, {"slot": "工艺单第 6 行（第 1 窗位，模板）"})


def blinds_probes(rng):
    probes = []
    for pt in BLINDS_PRODUCTS:
        for ct in BLINDS_CONTROLS:
            for ht in BLINDS_HEADRAILS:
                fr, sr = rng.choice(ZEBRA_RATIOS[1:]) if pt == "斑马帘" else (None, None)
                probes.append({"width": sixteenth(rng, 20, 90), "height": rng.choice([20.0, 29.5, 47.25, 60.0, 71.5]),
                               "productType": pt, "measureType": rng.choice(BLINDS_MEASURES),
                               "controlType": ct, "headrailType": ht, "fabricRatio": fr, "silkRatio": sr,
                               "location": "P", "fabricSku": "S", "controlSide": "L", "mountType": "顶装"})
    return probes


def static_slot_scan(path):
    """公式级：把 52 个窗位块的公式按块内相对行号归一化，与第 1 窗位逐格比对。"""
    import re
    import warnings
    import openpyxl
    warnings.filterwarnings("ignore")
    ws = openpyxl.load_workbook(path)["工艺组装"]
    starts = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "订单号"]
    src_ref = re.compile(r"工艺单!\$?([A-Z]{1,2})\$?(\d+)")
    local_ref = re.compile(r"(?<![A-Za-z!$])(\$?)([A-Z]{1,2})(\$?)(\d+)(?![\d(])")

    def norm(v, start, srcrow):
        if not isinstance(v, str):
            return repr(v)
        f = src_ref.sub(lambda m: f"工艺单!{m.group(1)}[{int(m.group(2)) - srcrow}]" if int(m.group(2)) >= 6 else m.group(0), v)
        f = re.sub(r"纵向Ref!\$?D\$?\d+", "纵向Ref!D<k>", f)
        parts = re.split(r"([^\s(,=+\-*/<>&]+![$A-Z0-9:<>\[\]-]+)", f)
        return "".join(p if "!" in p else local_ref.sub(lambda m: f"{m.group(2)}<{int(m.group(4)) - start}>", p) for p in parts)

    blocks = []
    for k, s0 in enumerate(starts):
        m = re.search(r"工艺单!\$?A\$?(\d+)", str(ws[f"K{s0}"].value))
        srcrow = int(m.group(1)) if m else 6 + k
        cells = {}
        for r in range(s0, s0 + 6):
            for c in range(1, 12):
                v = ws.cell(r, c).value
                if isinstance(v, str) and v.startswith("="):
                    cells[(r - s0, c)] = norm(v, s0, srcrow)
        blocks.append((k + 1, s0, srcrow, cells))
    tmpl = blocks[0][3]
    out = []
    for slot, s0, srcrow, cells in blocks[1:]:
        for key in sorted(set(tmpl) | set(cells)):
            if tmpl.get(key) != cells.get(key):
                out.append({"slot": slot, "cell": f"{openpyxl.utils.get_column_letter(key[1])}{s0 + key[0]}",
                            "template": tmpl.get(key), "actual": cells.get(key)})
    return out


def scan_blinds_slots(sess, path):
    """数值级：每个窗位填不同探针（轮换 72 轮），与"只填第 1 窗位"的模板结果比对，列出原件缺陷窗位。"""
    rng = random.Random(7)
    probes = blinds_probes(rng)
    wb = sess.open(path)
    tops = [rr for rr in range(1, 383) if wb.get("工艺组装", f"A{rr}") == "订单号"]
    ref = []
    for p in probes:
        wb.clear("工艺单", "B6:M57")
        blinds_write_inputs(wb, 6, p)
        wb.recalc()
        ref.append(blinds_read_block(wb, tops[0], 28))
    diffs = {}
    for rnd in range(len(probes)):
        wb.clear("工艺单", "B6:M57")
        for slot in range(52):
            blinds_write_inputs(wb, 6 + slot, probes[(slot + rnd) % len(probes)])
        wb.recalc()
        for k, top in enumerate(tops):
            pi = (k + rnd) % len(probes)
            got = blinds_read_block(wb, top, 28 + 7 * k)
            for field, want in ref[pi].items():
                if field == "zebraCutPosRaw":
                    continue
                if want != got[field]:
                    d = diffs.setdefault((k + 1, field), {"count": 0, "example": None})
                    d["count"] += 1
                    if d["example"] is None:
                        p = probes[pi]
                        d["example"] = {"probe": {kk: p[kk] for kk in ("productType", "controlType", "headrailType", "measureType", "width", "height", "fabricRatio", "silkRatio")},
                                        "template": want, "slot": got[field]}
        if rnd % 12 == 0:
            print(f"  slot scan round {rnd}/{len(probes)}")
    wb.close()
    numeric = [{"slot": slot, "field": field, **v} for (slot, field), v in sorted(diffs.items())]
    out = os.path.join(FIXTURES, "blinds-slot-defects.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": {"title": SOURCE_TITLES["blinds"], "sha256": SOURCES["blinds"]},
                   "note": "原件缺陷证据：第 2–52 窗位与第 1 窗位模板的差异；不作为期望值。",
                   "probes": len(probes), "numeric": numeric, "formula": static_slot_scan(path)},
                  f, ensure_ascii=False, indent=1, default=str)
        f.write("\n")
    print(f"  wrote {os.path.relpath(out, REPO)} ({len(numeric)} numeric slot/field defects)")


# ─────────────────────────── 国内下单 ───────────────────────────

DOMESTIC_PRODUCTS = ["卷帘", "斑马帘", "香格里拉", "蜂窝帘", "梦幻帘"]


def run_domestic(sess, path):
    rng = random.Random(1027)
    wb = sess.open(path)
    cases = []
    for ci in range(12):
        n = rng.randint(1, 52) if ci else 52
        rows = []
        for r in range(n):
            rows.append({
                "code": rng.choice(["", f"Ly26-{r + 1}", f"K{ci}-{r}"]),
                "widthIn": sixteenth(rng, 10, 120) if rng.random() > 0.05 else 0,
                "heightIn": sixteenth(rng, 10, 120),
                "productType": rng.choice(DOMESTIC_PRODUCTS),
                "sku": rng.choice(["", "CEL-01", "DRM-22", "ZB-7"]),
                "measure": rng.choice(["内装", "外装"]),
                "control": rng.choice(["普通", "电机", "无绳"]),
                "side": rng.choice(["左", "右", "无", ""]),
                "headrail": rng.choice(BLINDS_HEADRAILS),
                "mount": rng.choice(["墙装", "顶装"]),
                "remark": rng.choice(["", "加急"]),
            })
        order_no = rng.choice(["", f"G1027-0{ci}"]) if ci else "G1027-00"
        wb.clear("工艺单", "B6:N57")
        wb.set("工艺单", "C2", order_no)
        cols = {"code": "B", "widthIn": "C", "heightIn": "D", "productType": "G", "sku": "H", "measure": "I",
                "control": "J", "side": "K", "headrail": "L", "mount": "M", "remark": "N"}
        for r, row in enumerate(rows):
            for key, col in cols.items():
                wb.set("工艺单", f"{col}{6 + r}", row[key])
        wb.recalc()
        exp_rows = []
        for r in range(n):
            exp_rows.append({"widthCm": wb.get("工艺单", f"E{6 + r}"), "heightCm": wb.get("工艺单", f"F{6 + r}"),
                             "sqm": wb.get("工艺单", f"P{6 + r}")})
        labels = []
        for k in range(52):
            lines = [wb.get("LABEL PRINT", f"A{4 * k + j}") for j in range(1, 5)]
            if not any(lines):
                break
            labels.append(lines)
        cases.append({"id": f"D{ci + 1:03d}", "input": {"orderNo": order_no, "rows": rows},
                      "expected": {"rows": exp_rows, "labels": labels,
                                   "labelCount": wb.get("LABEL PRINT", "X10")}})
    wb.close()
    write_fixture("domestic", path, cases)


# ─────────────────────────── 窗帘 ───────────────────────────

DRAPE_CRAFTS = ["韩褶P", "蛇型R", ""]
DRAPE_RODS = ["方单轨", "圆单轨", "方双轨", "圆双轨", ""]


def run_drapes(sess, path, name):
    rng = random.Random(6 if name == "drapes-6cm" else 7)
    count_col = "W" if name == "drapes-6cm" else "V"
    wb = sess.open(path)
    patches = apply_patches(wb, name)
    cases = []
    for ci in range(40):
        rows = []
        n = 15 if ci % 4 == 0 else rng.randint(1, 15)
        for r in range(n):
            rows.append({
                "widthIn": sixteenth(rng, 18, 220), "heightIn": sixteenth(rng, 30, 130),
                "sku": rng.choice(["635", "650", "S-12", ""]), "qty": rng.choice([1, 2]),
                "craft": rng.choice(DRAPE_CRAFTS) if rng.random() > 0.1 else "蛇型R",
                "layer": rng.choice(["布", "纱"]), "liner": rng.choice(["是", "否", ""]),
                "fullness": rng.choice([1.2, 1.5, 1.6, 1.8, 2.0, 2.3, 2.5]),
                "mount": rng.choice(["顶装C", "墙装W"]), "rod": rng.choice(DRAPE_RODS),
                "rodColor": rng.choice(["黑", "白", "银", "金", "灰", ""]),
            })
        wb.clear("工艺单", "B5:D19")
        wb.clear("工艺单", "J5:N19")
        wb.clear("工艺单", "Q5:T19")
        cols = {"widthIn": "C", "heightIn": "D", "sku": "J", "qty": "K", "craft": "L", "layer": "M",
                "liner": "N", "fullness": "Q", "mount": "R", "rod": "S", "rodColor": "T"}
        for r, row in enumerate(rows):
            for key, col in cols.items():
                wb.set("工艺单", f"{col}{5 + r}", row[key])
        wb.recalc()
        exp_rows = []
        for r in range(n):
            rr = 5 + r
            g = lambda c: wb.get("工艺单", f"{c}{rr}")  # noqa: E731
            m = lambda c: wb.get("Sheet1", f"{c}{3 + r}")  # noqa: E731
            exp_rows.append({
                "widthCm": g("E"), "heightCm": g("F"), "pleatTopCm": g("G"), "finishedWidthCm": g("H"),
                "finishedHeightCm": g("I"), "beadBagCount": g("O"), "beadClip": g("P"),
                "beadCount": g(count_col), "beadCountPlus": g("X"),
                "materials": {"rodM": m("B"), "fabricSqm": m("C"), "beadBagM": m("D"), "hooks": m("E"),
                              "pleatBeads": m("F")},
            })
        totals = {k: wb.get("Sheet1", f"{c}18") for k, c in
                  (("rodM", "B"), ("fabricSqm", "C"), ("beadBagM", "D"), ("hooks", "E"), ("pleatBeads", "F"))}
        cases.append({"id": f"{'C6' if name == 'drapes-6cm' else 'C7'}-{ci + 1:03d}",
                      "input": {"rows": rows}, "expected": {"rows": exp_rows, "totals": totals}})
    wb.close()
    write_fixture(name, path, cases, patches=patches)


def read_drape_order(wb):
    rows, saved = [], []
    cols = {"widthIn": "C", "heightIn": "D", "sku": "J", "qty": "K", "craft": "L", "layer": "M",
            "liner": "N", "fullness": "Q", "mount": "R", "rod": "S", "rodColor": "T"}
    for k, rr in enumerate(DRAPE_ROWS):
        if wb.get("工艺单", f"C{rr}") in (None, ""):
            continue
        g = lambda c: wb.get("工艺单", f"{c}{rr}")  # noqa: E731
        m = lambda c: wb.get("Sheet1", f"{c}{3 + k}")  # noqa: E731
        rows.append({key: ("" if g(col) is None else g(col)) for key, col in cols.items()} | {"code": g("B") or ""})
        saved.append({
            "widthCm": g("E"), "heightCm": g("F"), "pleatTopCm": g("G"), "finishedWidthCm": g("H"),
            "finishedHeightCm": g("I"), "finishedHeightIsFormula": wb.is_formula("工艺单", f"I{rr}"),
            "beadBagCount": g("O"), "beadClip": g("P"), "beadCount": g("W"),
            "materials": {"rodM": m("B"), "fabricSqm": m("C"), "beadBagM": m("D"), "hooks": m("E"),
                          "pleatBeads": m("F")},
        })
    totals = {k: wb.get("Sheet1", f"{c}18") for k, c in
              (("rodM", "B"), ("fabricSqm", "C"), ("beadBagM", "D"), ("hooks", "E"), ("pleatBeads", "F"))}
    return {"orderNo": wb.get("工艺单", "C2"), "rows": rows}, {"rows": saved, "totals": totals}


def read_domestic_order(wb):
    rows, saved = [], []
    cols = {"code": "B", "widthIn": "C", "heightIn": "D", "productType": "G", "sku": "H", "measure": "I",
            "control": "J", "side": "K", "headrail": "L", "mount": "M", "remark": "N"}
    for rr in range(6, 58):
        if wb.get("工艺单", f"C{rr}") in (None, "") and wb.get("工艺单", f"B{rr}") in (None, ""):
            continue
        rows.append({key: ("" if wb.get("工艺单", f"{col}{rr}") is None else wb.get("工艺单", f"{col}{rr}"))
                     for key, col in cols.items()})
        saved.append({"widthCm": wb.get("工艺单", f"E{rr}"), "heightCm": wb.get("工艺单", f"F{rr}"),
                      "sqm": wb.get("工艺单", f"P{rr}")})
    labels = []
    for k in range(52):
        lines = [wb.get("LABEL PRINT", f"A{4 * k + j}") for j in range(1, 5)]
        if not any(lines):
            break
        labels.append(lines)
    order_no = wb.get("工艺单", "C2")
    return {"orderNo": order_no, "rows": rows}, {"rows": saved, "labels": labels}


def run_real_orders(sess, src_dir):
    """真实订单：原样打开、只读保存值（不改输入、不打补丁）。"""
    found = find_sources(src_dir, {k: sha for k, (_, sha) in REAL_ORDERS.items()})
    missing = [k for k in REAL_ORDERS if k not in found]
    if missing:
        print("missing real orders (by sha256):", ", ".join(missing))
        sys.exit(2)
    cases = []
    for key, (kind, digest) in REAL_ORDERS.items():
        wb = sess.open(found[key])
        inp, saved = read_domestic_order(wb) if kind == "domestic" else read_drape_order(wb)
        wb.close()
        cases.append({"id": key, "kind": kind, "sha256": digest, "input": inp, "saved": saved})
        print(f"  {key}: {kind} {len(inp['rows'])} 行")
    os.makedirs(FIXTURES, exist_ok=True)
    out = os.path.join(FIXTURES, "real-orders.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": {"title": "Sunny 真实订单（G0927 梦幻帘 / G1024 蛇形 / G1025 韩褶）", "sha256": "per-case"},
                   "generator": "scripts/sunny-process-oracle/oracle.py --real-orders", "cases": cases},
                  f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"  wrote {os.path.relpath(out, REPO)} ({len(cases)} cases)")


# ─────────────────────────── Vinyl ───────────────────────────

VINYL_CODES = ["L", "R", "TL", "TR", "TRT", "RT", "LT", "LR", "TLRT", "LRTR", "LLR", "LIR", "LTLR", "LTLTR",
               "LLRR", "LTLRTR", "LRTLR", "LTLTRTR", "LTRTRTR", "LRTLRTLR", "LL", "RR", "LRR", "LLLRRR", "LTR"]
VINYL_SPLITS = ["不切分", "整体1/3", "整体1/2", "整体2/3", "上1/3", "上1/2", "上2/3", "下1/3", "下1/2", "下2/3",
                "上1/3+下1/3", "上1/3+下1/2", "上1/3+下2/3", "上1/2+下1/3", "上1/2+下1/2", "上1/2+下2/3",
                "上2/3+下1/3", "上2/3+下1/2", "上2/3+下2/3"]
VINYL_RODS = ["", "后面-旁边", "前面-中间", "后面-中间", "前面-旁边", "隐形拉杆"]
VINYL_FRAMES = [("L", "IN", 4), ("L", "OUT", 4), ("Z", "IN", 4), ("Z", "IN", "3+1"), ("T", "IN", 4),
                ("T", "IN", "3+1"), ("Door", "OUT", 4), ("Door", "OUT", "3+1"),
                # 不受支持组合（原件结果全 0）
                ("L", "IN", "3+1"), ("Z", "OUT", 4), ("Door", "IN", 4), ("", "IN", 4)]


def vinyl_panels_for(code):
    letters = [c for c in code.replace("T", "").replace("I", "").replace("H", "").replace(" ", "")]
    return len(letters)


def vinyl_window(rng, k):
    code = rng.choice(VINYL_CODES)
    frame, inout, fcount = rng.choice(VINYL_FRAMES) if rng.random() > 0.15 else rng.choice(VINYL_FRAMES[:8])
    structure = "无框" if rng.random() < 0.12 else "有框"
    height = sixteenth(rng, 24, 96)
    width = sixteenth(rng, 14, 110)
    w = {
        "location": f"R{k}", "width": width, "height": height,
        "panels": vinyl_panels_for(code) if rng.random() > 0.08 else rng.randint(1, 6),
        "openCode": code, "posts": rng.choice(["", "", "1T", "2T", "1H", "2H", "3T", "4H"]),
        "rail1In": None, "rail1Ratio": None, "rod": rng.choice(VINYL_RODS), "split": "不切分",
        "frame": frame, "frameCount": fcount, "inOut": inout, "structure": structure, "rail2In": None,
    }
    mode = rng.random()
    if mode < 0.35:
        pass  # 无中分档
    elif mode < 0.6:
        w["rail1In"] = round(height * rng.uniform(0.3, 0.6) * 16) / 16
    elif mode < 0.8:
        w["rail1Ratio"] = rng.choice([1 / 3, 1 / 2, 2 / 3])
    else:
        w["rail1In"] = round(height * rng.uniform(0.25, 0.4) * 16) / 16
        w["rail2In"] = round(height * rng.uniform(0.55, 0.8) * 16) / 16 if rng.random() > 0.1 else height + 3
    if rng.random() < 0.45:
        w["split"] = rng.choice(VINYL_SPLITS)
    return w


VINYL_INPUT_COLS = {"location": "B", "width": "C", "height": "D", "panels": "E", "openCode": "F", "posts": "G",
                    "rail1In": "H", "rail1Ratio": "I", "rod": "J", "split": "K", "frame": "L",
                    "frameCount": "M", "inOut": "N", "structure": "P", "rail2In": "Q"}

VINYL_BLOCK_CELLS = {
    "innerWidth": "H2", "innerHeight": "I2", "openKey": "G3", "frameKey": "J10", "rail1Raw": "H4",
    "rail1": "C5", "rail1Actual": "D5", "postKind": "E5", "postCount": "F5", "rodPosition": "F6",
    "panelWidth": "B8", "panelHeight": "D8", "louverTotal": "E9", "louverUpper": "F9", "louverLower": "G9",
    "splitKey": "AA9", "splitWhole": "AB9", "splitUpper": "AC9", "splitLower": "AD9", "splitOn": "AE9",
    "splitError": "AF9", "splitWholeUpper": "AG9", "splitWholeLower": "AH9", "splitUpperUpper": "AI9",
    "splitUpperLower": "AJ9", "splitLowerUpper": "AK9", "splitLowerLower": "AL9", "louverLowerRaw": "AO9",
    "frameW": "C11", "frameW2": "D11", "frameWQty": "E11", "frameWAngleA": "F11", "frameWAngleB": "G11",
    "frameH": "C12", "frameH2": "D12", "frameHQty": "E12", "frameHAngleA": "F12", "frameHAngleB": "G12",
    "zSill": "C13", "zSillQty": "E13", "zSillAngleA": "F13", "zSillAngleB": "G13",
    "postName": "A14", "postLen": "C14", "postQty": "E14",
    "stileLen": "C15", "stileQty": "E15", "pitch": "G15",
    "railLen": "C16", "railQty": "E16", "midRailLen": "C17", "midRailQty": "E17",
    "louverLen": "C18", "louverQty": "E18",
    "rodUpper": "C19", "rodUpper2": "D19", "rodUpperQty": "E19",
    "rodLower": "C20", "rodLower2": "D20", "rodLowerQty": "E20",
    "rail2": "C21", "rail2Actual": "D21", "louverMiddle": "G21", "rodMiddle": "C22", "rodMiddleQty": "E22",
    "message": "A23",
}


def vinyl_case(rng, ci):
    header = {"orderNo": rng.choice([f"V1027-{ci:02d}", "", f"G1027-{ci}-V"]) if ci % 7 == 3 else f"V1027-{ci:02d}",
              "louver": 2.5 if ci % 3 == 0 else 3.5, "color": rng.choice(["白色", "米白"]),
              "defaultRod": rng.choice(["", "后面-旁边", "隐形拉杆"])}
    nwin = 30 if ci % 5 == 0 else rng.randint(1, 30)
    windows = [vinyl_window(rng, k + 1) for k in range(nwin)]
    return header, windows


def run_vinyl(sess, path):
    rng = random.Random(30)
    wb = sess.open(path)
    patches = apply_patches(wb, name)
    cases = []
    for ci in range(40):
        header, windows = vinyl_case(rng, ci)
        wb.clear("订单总表", "B7:N36")
        wb.clear("订单总表", "Q7:Q36")
        for r in range(30):
            wb.set("订单总表", f"P{7 + r}", "有框")  # 原件默认值
        wb.set("订单总表", "G2", header["orderNo"])
        wb.set("订单总表", "E4", header["louver"])
        wb.set("订单总表", "C4", header["color"])
        wb.set("订单总表", "J4", header["defaultRod"])
        for k, w in enumerate(windows):
            for key, col in VINYL_INPUT_COLS.items():
                wb.set("订单总表", f"{col}{7 + k}", w[key])
        wb.recalc()
        exp_windows = []
        for k in range(len(windows)):
            base = 30 * k
            cell = {}
            for key, ref in VINYL_BLOCK_CELLS.items():
                col = "".join(ch for ch in ref if ch.isalpha())
                row = int("".join(ch for ch in ref if ch.isdigit()))
                cell[key] = wb.get("工艺单", f"{col}{row + base}")
            cell["sf"] = wb.get("订单总表", f"O{7 + k}")
            exp_windows.append(cell)
        total = int(wb.get("下料总表", "W1") or 0)
        cut = []
        for r in range(total):
            rr = 5 + r
            cut.append({c: wb.get("下料总表", f"{c}{rr}") for c in "ABCDEFG"})
        labels = []
        for k in range(300):
            lines = [wb.get("LABEL PRINT", f"A{4 * k + j}") for j in range(1, 5)]
            if not any(lines):
                break
            labels.append(lines)
        summary = {"sfTotal": wb.get("订单总表", "H4"), "panelTotal": wb.get("订单总表", "C5"),
                   "tPostTotal": wb.get("订单总表", "E5"), "hPostTotal": wb.get("订单总表", "G5"),
                   "cutHeader": wb.get("下料总表", "A2")}
        cases.append({"id": f"V{ci + 1:03d}", "input": {"header": header, "windows": windows},
                      "expected": {"windows": exp_windows, "cutList": cut, "labels": labels, "summary": summary}})
        print(f"  vinyl case {ci + 1}/40 windows={len(windows)} cut={len(cut)} labels={len(labels)}")
    wb.close()
    write_fixture("vinyl", path, cases)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="原件所在目录（按 SHA-256 识别）")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--scan-blinds-slots", action="store_true")
    ap.add_argument("--real-orders", action="store_true", help="同时读取 REAL_ORDERS 里的真实订单")
    ap.add_argument("--port", type=int, default=2011)
    args = ap.parse_args()
    found = find_sources(args.src)
    wanted = list(SOURCES) if args.all else [x for x in args.only.split(",") if x]
    missing = [w for w in wanted if w not in found] + (["blinds"] if args.scan_blinds_slots and "blinds" not in found else [])
    if missing:
        print("missing sources (by sha256):", ", ".join(missing))
        sys.exit(2)
    sess = lo.Session(args.port)
    try:
        for name in wanted:
            print(f"[{name}] {os.path.basename(found[name])}")
            if name == "blinds":
                run_blinds(sess, found[name])
            elif name == "domestic":
                run_domestic(sess, found[name])
            elif name.startswith("drapes"):
                run_drapes(sess, found[name], name)
            elif name == "vinyl":
                run_vinyl(sess, found[name])
        if args.scan_blinds_slots:
            print("[blinds slots]")
            scan_blinds_slots(sess, found["blinds"])
        if args.real_orders:
            print("[real orders]")
            run_real_orders(sess, args.src)
    finally:
        sess.close()


if __name__ == "__main__":
    main()
