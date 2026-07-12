#!/usr/bin/env python3
"""
青砚 PostFlow worker — 小红书矩阵半自动发布（M3）

职责：轮询青砚 worker API 认领 channel=postflow 的发布任务 →
下载视频 → FFmpeg 去重化 → 调 PostFlow CLI 发布到小红书 → 回报结果。

跑在自建服务器上（与 PostFlow、FFmpeg 同机），只依赖 Python 标准库。

环境变量：
  QINGYAN_API_URL        青砚地址（如 https://qingyan.example.com）
  POSTFLOW_WORKER_TOKEN  与青砚侧 POSTFLOW_WORKER_TOKEN 一致
  POSTFLOW_CLI           PostFlow 命令，默认 "postflow"
  POLL_INTERVAL_SEC      轮询间隔秒数，默认 60
  WORK_DIR               临时文件目录，默认 /tmp/postflow-worker
  UNIQUIFY               "0" 关闭视频去重化，默认开启
  PUBLISH_GAP_SEC        同一轮内两次发布之间的间隔秒数，默认 180（防风控）
"""

import json
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

API_URL = os.environ.get("QINGYAN_API_URL", "").rstrip("/")
TOKEN = os.environ.get("POSTFLOW_WORKER_TOKEN", "")
POSTFLOW_CLI = os.environ.get("POSTFLOW_CLI", "postflow")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SEC", "60"))
WORK_DIR = Path(os.environ.get("WORK_DIR", "/tmp/postflow-worker"))
UNIQUIFY = os.environ.get("UNIQUIFY", "1") != "0"
PUBLISH_GAP = int(os.environ.get("PUBLISH_GAP_SEC", "180"))

XHS_TITLE_MAX = 20


def log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def api(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{API_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "qingyan-postflow-worker/1.0"})
    with urllib.request.urlopen(req, timeout=300) as res, open(dest, "wb") as f:
        shutil.copyfileobj(res, f)


def uniquify(src: Path, dest: Path) -> None:
    """FFmpeg 去重化：轻微裁切 + 色彩抖动 + 重编码 + 去元数据。

    目标是让平台内容指纹认不出同一条视频，同时肉眼不可辨差异。
    每次调用参数随机，保证同一视频发不同账号时产物各不相同。
    """
    crop = random.randint(2, 6)  # 每边裁掉 2-6 像素
    brightness = round(random.uniform(-0.02, 0.02), 4)
    contrast = round(random.uniform(0.98, 1.02), 4)
    saturation = round(random.uniform(0.98, 1.02), 4)
    crf = random.randint(21, 24)

    vf = (
        f"crop=iw-{crop * 2}:ih-{crop * 2}:{crop}:{crop},"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2,"
        f"eq=brightness={brightness}:contrast={contrast}:saturation={saturation}"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
            "-c:a", "aac", "-b:a", "128k",
            "-map_metadata", "-1",
            "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
        capture_output=True,
    )


def split_caption(caption: str, video_title: str) -> tuple[str, str]:
    """小红书要求标题 ≤20 字：文案首行作标题（超长截断），其余作正文。"""
    lines = [ln.strip() for ln in caption.strip().splitlines() if ln.strip()]
    if not lines:
        return video_title[:XHS_TITLE_MAX], caption.strip()
    title = lines[0][:XHS_TITLE_MAX]
    desc = "\n".join(lines[1:]).strip() or lines[0]
    return title, desc


def hashtags_to_tags(hashtags: str | None) -> str | None:
    """"#智能窗帘 #多伦多" → "智能窗帘,多伦多"（PostFlow --tags 格式）"""
    if not hashtags:
        return None
    tags = [t.lstrip("#") for t in hashtags.split() if t.lstrip("#")]
    return ",".join(tags) if tags else None


def publish(job: dict, video: Path) -> None:
    account = job["account"]["postflowAccount"]
    if not account:
        raise RuntimeError("矩阵账号未配置 PostFlow account 名（externalChannelId）")

    title, desc = split_caption(job["captionText"], job["videoTitle"])
    cmd = [
        POSTFLOW_CLI, "xiaohongshu", "upload-video",
        "--account", account,
        "--file", str(video),
        "--title", title,
        "--desc", desc,
    ]
    tags = hashtags_to_tags(job.get("hashtags"))
    if tags:
        cmd += ["--tags", tags]
    if job.get("scheduledAt"):
        dt = datetime.fromisoformat(job["scheduledAt"].replace("Z", "+00:00")).astimezone()
        if dt > datetime.now().astimezone():
            cmd += ["--schedule", dt.strftime("%Y-%m-%d %H:%M")]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "PostFlow CLI 失败").strip()[-800:])


def process_job(job: dict) -> None:
    job_dir = WORK_DIR / job["id"]
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        raw = job_dir / "raw.mp4"
        log(f"  下载视频: {job['videoTitle']}")
        download(job["videoUrl"], raw)

        final = raw
        if UNIQUIFY:
            final = job_dir / "unique.mp4"
            log("  FFmpeg 去重化…")
            uniquify(raw, final)

        log(f"  发布到 @{job['account']['handle']}…")
        publish(job, final)
        api("/api/operations/worker/report", {"jobId": job["id"], "ok": True})
        log("  ✅ 完成")
    except Exception as e:  # noqa: BLE001 — 单任务失败回报后继续
        msg = str(e)
        log(f"  ❌ 失败: {msg}")
        try:
            api("/api/operations/worker/report", {"jobId": job["id"], "ok": False, "error": msg})
        except Exception as report_err:  # noqa: BLE001
            log(f"  回报失败（任务将在 30 分钟后自动重入队）: {report_err}")
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def main() -> None:
    if not API_URL or not TOKEN:
        sys.exit("缺少 QINGYAN_API_URL / POSTFLOW_WORKER_TOKEN 环境变量")
    if UNIQUIFY and not shutil.which("ffmpeg"):
        sys.exit("未找到 ffmpeg（或设置 UNIQUIFY=0 关闭去重化）")

    log(f"PostFlow worker 启动，轮询 {API_URL}（间隔 {POLL_INTERVAL}s）")
    while True:
        try:
            data = api("/api/operations/worker/claim", {"limit": 5})
            jobs = data.get("jobs", [])
            if jobs:
                log(f"认领 {len(jobs)} 个任务")
            for i, job in enumerate(jobs):
                process_job(job)
                if i < len(jobs) - 1:
                    gap = PUBLISH_GAP + random.randint(0, 60)
                    log(f"  防风控间隔 {gap}s…")
                    time.sleep(gap)
        except urllib.error.HTTPError as e:
            log(f"API 错误 {e.code}: {e.read().decode(errors='ignore')[:200]}")
        except Exception as e:  # noqa: BLE001 — worker 常驻，任何异常都不退出
            log(f"轮询异常: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
