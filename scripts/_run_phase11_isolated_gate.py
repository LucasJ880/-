#!/usr/bin/env python3
"""Phase 1.1 Final Validation orchestrator — isolated Neon + migrate×2 + E2E.

Never prints connection strings or API keys. Keeps Neon project for review.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN_ENV = Path("/Users/user/Desktop/青砚/.env")
MAIN_ENV_LOCAL = Path("/Users/user/Desktop/青砚/.env.local")
SECRET_DIR = Path("/Users/user/Desktop/青砚-tender-analysis/.data/phase11-isolated")
SECRET_ENV = SECRET_DIR / "isolated.env"
RESULT_JSON = SECRET_DIR / "gate-result.json"
PDF = ROOT / "fixtures/private/M5000-25-3574 - A - RFP - English.pdf"

PROD_MARKERS = ("ep-super-field", "ep-raspy-credit")
NEON_API = "https://console.neon.tech/api/v2"
ORG_ID = "org-autumn-pine-10800773"


def load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        v = v.strip().strip("'").strip('"')
        out[k.strip()] = v
    return out


def host_hint(url: str) -> tuple[str, str]:
    # crude parse without logging credentials
    m = re.search(r"@([^/?]+)", url)
    host = (m.group(1) if m else "unknown").lower()
    hint = host.split(".")[0]
    fp = hashlib.sha256(url.encode()).hexdigest()[:12]
    return hint, fp


def refuse_prod(url: str, label: str) -> None:
    h, _ = host_hint(url)
    low = url.lower()
    if any(m in low for m in PROD_MARKERS) or "prod" in h:
        raise SystemExit(f"BLOCKED: {label} looks like production ({h})")


def neon_request(api_key: str, method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{NEON_API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        raise SystemExit(f"Neon API {method} {path} failed: HTTP {e.code}: {err}")


def create_neon(api_key: str) -> tuple[str, str, str, str]:
    name = f"qingyan-tender-p11-{int(time.time())}"
    payload = {
        "project": {
            "name": name,
            "region_id": "aws-us-east-1",
            "pg_version": 16,
            "org_id": ORG_ID,
        }
    }
    created = neon_request(api_key, "POST", "/projects", payload)
    project = created.get("project") or {}
    project_id = project.get("id")
    if not project_id:
        raise SystemExit("Neon create: missing project.id")

    # connection_uris may be in create response
    uris = created.get("connection_uris") or []
    pooled = None
    direct = None
    for item in uris:
        cu = item.get("connection_uri") or ""
        if "-pooler." in cu:
            pooled = cu
        else:
            direct = cu
    if not pooled or not direct:
        # fetch connection string
        conn = neon_request(
            api_key,
            "GET",
            f"/projects/{project_id}/connection_uri?database_name=neondb&role_name=neondb_owner",
        )
        uri = conn.get("uri") or ""
        if not uri:
            raise SystemExit("Neon: no connection uri")
        # typical neon returns direct; synthesize pooler by host rewrite if needed
        if "-pooler." in uri:
            pooled = uri
            direct = uri.replace("-pooler.", ".")
        else:
            direct = uri
            pooled = uri.replace(".neon.tech", "-pooler.neon.tech").replace(
                "@ep-", "@ep-", 1
            )
            # more reliable: insert -pooler before .region
            if "-pooler." not in pooled:
                pooled = re.sub(r"(@ep-[^.]+)\.", r"\1-pooler.", uri)

    refuse_prod(pooled, "pooled")
    refuse_prod(direct, "direct")
    return project_id, name, pooled, direct


def run(cmd: list[str], env: dict[str, str], timeout: int = 600) -> subprocess.CompletedProcess:
    print(f"[run] {' '.join(cmd[:6])}{'...' if len(cmd) > 6 else ''}", flush=True)
    return subprocess.run(
        cmd,
        cwd=str(ROOT),
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def main() -> int:
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    # Prisma/tsx toolchain in this worktree may lstat .tmp-tsx
    (ROOT / ".tmp-tsx").mkdir(exist_ok=True)
    if not PDF.exists():
        print("BLOCKED_BY_VALIDATION_BASE_CHANGED: PDF missing")
        return 3

    env_local = load_dotenv(MAIN_ENV_LOCAL)
    env_main = load_dotenv(MAIN_ENV)
    api_key = os.environ.get("NEON_API_KEY") or env_local.get("NEON_API_KEY") or ""
    openai_key = os.environ.get("OPENAI_API_KEY") or env_main.get("OPENAI_API_KEY") or ""
    openai_base = env_main.get("OPENAI_BASE_URL") or env_main.get("OPENAI_API_BASE") or ""
    openai_model = env_main.get("OPENAI_MODEL") or env_main.get("AI_MODEL") or ""

    if not api_key:
        print("BLOCKED_BY_ISOLATED_DATABASE: NEON_API_KEY unavailable")
        return 4

    # reuse existing isolated env if present and valid
    project_id = name = pooled = direct = None
    if SECRET_ENV.exists():
        prev = load_dotenv(SECRET_ENV)
        if prev.get("ISOLATED_DATABASE_URL") and prev.get("NEON_PROJECT_ID"):
            pooled = prev["ISOLATED_DATABASE_URL"]
            direct = prev.get("ISOLATED_DIRECT_URL") or pooled
            project_id = prev["NEON_PROJECT_ID"]
            name = prev.get("NEON_PROJECT_NAME") or "reused"
            refuse_prod(pooled, "reused-pooled")
            print(json.dumps({"gate": "neon", "action": "reuse", "projectId": project_id, "name": name}))
        else:
            project_id = None

    if not project_id:
        project_id, name, pooled, direct = create_neon(api_key)
        hint, fp = host_hint(pooled)
        SECRET_ENV.write_text(
            "\n".join(
                [
                    f"NEON_PROJECT_ID={project_id}",
                    f"NEON_PROJECT_NAME={name}",
                    f"ISOLATED_DATABASE_URL={pooled}",
                    f"ISOLATED_DIRECT_URL={direct}",
                    f"HOST_HINT={hint}",
                    f"URL_FINGERPRINT={fp}",
                    f"CREATED_UTC={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        os.chmod(SECRET_ENV, 0o600)
        print(
            json.dumps(
                {
                    "gate": "neon",
                    "action": "created",
                    "projectId": project_id,
                    "name": name,
                    "hostHint": hint,
                    "fingerprint": fp,
                }
            )
        )

    assert pooled and direct

    base_env = os.environ.copy()
    # strip production DB from child
    for k in ("DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"):
        base_env.pop(k, None)

    migrate_env = {
        **base_env,
        "DATABASE_URL": pooled,
        "DIRECT_URL": direct,
        "ISOLATED_DATABASE_URL": pooled,
        "ISOLATED_DIRECT_URL": direct,
        "DATABASE_ENVIRONMENT": "isolated",
        "ALLOW_DATABASE_MIGRATION": "true",
        "PRISMA_HIDE_UPDATE_MESSAGE": "1",
    }

    # migrate deploy #1
    r1 = run(["npx", "prisma", "migrate", "deploy"], migrate_env, timeout=900)
    print(json.dumps({"gate": "migrate1", "code": r1.returncode, "tail": (r1.stdout + r1.stderr)[-800:]}))
    if r1.returncode != 0:
        print("BLOCKED_BY_ISOLATED_DATABASE: migrate deploy #1 failed")
        return 4

    # migrate deploy #2 idempotent
    r2 = run(["npx", "prisma", "migrate", "deploy"], migrate_env, timeout=900)
    print(json.dumps({"gate": "migrate2", "code": r2.returncode, "tail": (r2.stdout + r2.stderr)[-800:]}))
    if r2.returncode != 0:
        print("BLOCKED_BY_ISOLATED_DATABASE: migrate deploy #2 failed")
        return 4

    rg = run(["npx", "prisma", "generate"], migrate_env, timeout=300)
    print(json.dumps({"gate": "generate", "code": rg.returncode}))
    if rg.returncode != 0:
        print("BLOCKED_BY_ISOLATED_DATABASE: prisma generate failed")
        return 4

    # verify migration history if script exists
    verify_script = ROOT / "scripts" / "verify-migration-history.ts"
    if verify_script.exists():
        rv = run(
            ["npx", "tsx", "scripts/verify-migration-history.ts"],
            migrate_env,
            timeout=180,
        )
        print(
            json.dumps(
                {
                    "gate": "verify_migration_history",
                    "code": rv.returncode,
                    "tail": (rv.stdout + rv.stderr)[-600:],
                }
            )
        )
    else:
        # package.json script
        rv = run(["npm", "run", "verify:migration-history"], migrate_env, timeout=180)
        print(
            json.dumps(
                {
                    "gate": "verify_migration_history",
                    "code": rv.returncode,
                    "tail": (rv.stdout + rv.stderr)[-600:],
                }
            )
        )

    e2e_env = {
        **migrate_env,
        "PRODUCT_CONTENT_LOCAL_STORE": "1",
        "PRODUCT_CONTENT_LOCAL_STORE_DIR": str(ROOT / ".data" / "phase11-blobs"),
        "TENDER_FIXTURE_PDF_PATH": str(PDF),
        "TENDER_ANALYSIS_LLM": "1" if openai_key else "0",
        "OPENAI_API_KEY": openai_key,
    }
    if openai_base:
        e2e_env["OPENAI_BASE_URL"] = openai_base
    if openai_model:
        e2e_env["OPENAI_MODEL"] = openai_model
    # common aliases used by project
    for k in (
        "OPENAI_MODEL_FAST",
        "OPENAI_MODEL_SMART",
        "AI_PROVIDER",
        "LLM_PROVIDER",
    ):
        if env_main.get(k):
            e2e_env[k] = env_main[k]

    if not openai_key:
        print(json.dumps({"gate": "llm", "status": "BLOCKED_BY_REAL_MODEL_ACCESS"}))

    re2e = run(
        ["npx", "tsx", "scripts/tender-phase11-final-validation.ts"],
        e2e_env,
        timeout=1800,
    )
    print(re2e.stdout)
    if re2e.stderr:
        print(re2e.stderr[-2000:], file=sys.stderr)
    print(json.dumps({"gate": "e2e_exit", "code": re2e.returncode}))

    RESULT_JSON.write_text(
        json.dumps(
            {
                "neonProjectId": project_id,
                "neonName": name,
                "hostHint": host_hint(pooled)[0],
                "fingerprint": host_hint(pooled)[1],
                "migrate1": r1.returncode,
                "migrate2": r2.returncode,
                "e2e": re2e.returncode,
                "llmEnabled": bool(openai_key),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return 0 if re2e.returncode == 0 else (4 if r1.returncode != 0 else 2)


if __name__ == "__main__":
    sys.exit(main())
