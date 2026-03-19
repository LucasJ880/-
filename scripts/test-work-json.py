#!/usr/bin/env python3
"""task_and_event 专项验收脚本"""

import json
import urllib.request
import sys
import re
from datetime import datetime

API = "http://localhost:3000/api/ai/chat"

TESTS = [
    # (id, input, expected_type)
    ("TE1", "周五下午两点给客户汇报季度成果", "task_and_event"),
    ("TE2", "明天上午十点在会议室做产品演示，PPT今天要准备好", "task_and_event"),
    ("TE3", "下周三下午和供应商开会讨论新合同条款", "task_and_event"),
    ("TE4", "后天下午三点向领导汇报项目进展，需要整理数据", "task_and_event"),
    ("E1", "明天下午两点开周会", "event"),
    ("E2", "周四上午客户来访，在3楼会议室", "event"),
    ("E3", "今晚七点部门聚餐", "event"),
    ("E4", "下周一早上九点面试一个前端工程师", "event"),
    ("T1", "周五前提交季度报告", "task"),
    ("T2", "准备一下明天的会议", "task"),
    ("T3", "三天内把报价单发给张经理", "task"),
    ("T4", "整理上周会议纪要", "task"),
    ("N1", "帮我规划一下这周的工作重点", "none"),
    ("N2", "你觉得我应该先准备汇报还是先改合同？", "none"),
    ("N3", "好的，我知道了", "none"),
]

def call_ai(text):
    body = json.dumps({"messages": [{"role": "user", "content": text}]}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
    full = ""
    with urllib.request.urlopen(req, timeout=60) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if data_str == "[DONE]":
                continue
            try:
                obj = json.loads(data_str)
                full += obj.get("content", "")
            except:
                pass
    return full

def extract_work_json(text):
    m = re.search(r'\[WORK_JSON\](.*?)\[/WORK_JSON\]', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except:
            return {"_raw": m.group(1).strip(), "_parse_error": True}
    m2 = re.search(r'\[TASK_JSON\](.*?)\[/TASK_JSON\]', text, re.DOTALL)
    if m2:
        try:
            return {"type": "task(legacy)", "task": json.loads(m2.group(1).strip())}
        except:
            return None
    return None

def main():
    print(f"{'='*60}")
    print(f"  青砚 WORK_JSON 专项验收  {datetime.now():%Y-%m-%d %H:%M}")
    print(f"{'='*60}\n")

    results = []
    for tid, text, expected in TESTS:
        print(f"━━━ [{tid}] {text}")
        print(f"    期望: {expected}")
        sys.stdout.flush()

        try:
            full = call_ai(text)
            wj = extract_work_json(full)
        except Exception as e:
            print(f"    ❌ API 错误: {e}\n")
            results.append((tid, expected, "error", False, str(e)))
            continue

        if wj is None:
            actual = "none"
            print(f"    实际: 无建议")
            match = expected == "none"
        elif wj.get("_parse_error"):
            actual = "parse_error"
            print(f"    ❌ JSON 解析失败: {wj['_raw'][:100]}")
            match = False
        else:
            actual = wj.get("type", "unknown")
            print(f"    实际: {actual}")
            if actual == "task" and wj.get("task"):
                t = wj["task"]
                print(f"    task.title: {t.get('title','')}")
                print(f"    task.dueDate: {t.get('dueDate','')}")
                print(f"    task.priority: {t.get('priority','')}")
            elif actual == "event" and wj.get("event"):
                e = wj["event"]
                print(f"    event.title: {e.get('title','')}")
                print(f"    event.startTime: {e.get('startTime','')}")
                print(f"    event.endTime: {e.get('endTime','')}")
                print(f"    event.location: {e.get('location','')}")
            elif actual == "task_and_event":
                t = wj.get("task", {})
                e = wj.get("event", {})
                print(f"    task.title: {t.get('title','')}")
                print(f"    task.dueDate: {t.get('dueDate','')}")
                print(f"    event.title: {e.get('title','')}")
                print(f"    event.startTime: {e.get('startTime','')}")
                print(f"    event.location: {e.get('location','')}")
                if t.get("title") == e.get("title"):
                    print(f"    ⚠️  task.title == event.title (标题雷同)")
            match = actual == expected

        status = "✅ PASS" if match else "❌ FAIL"
        print(f"    {status}\n")
        results.append((tid, expected, actual, match, ""))

    # Summary
    print(f"\n{'='*60}")
    print("  验收结果汇总")
    print(f"{'='*60}\n")
    print(f"{'ID':<6} {'期望':<18} {'实际':<18} {'结果'}")
    print(f"{'-'*56}")
    pass_count = 0
    for tid, expected, actual, match, err in results:
        s = "✅" if match else "❌"
        print(f"{tid:<6} {expected:<18} {actual:<18} {s}")
        if match:
            pass_count += 1
    total = len(results)
    print(f"\n通过: {pass_count}/{total}")
    if pass_count < total:
        print("\n失败用例:")
        for tid, expected, actual, match, err in results:
            if not match:
                print(f"  [{tid}] 期望 {expected}, 实际 {actual} {err}")

if __name__ == "__main__":
    main()
