"""
trellis-test 核心流程库。所有 Step 脚本的公共依赖。
"""
import json, os, sys, subprocess, glob, re, time
from pathlib import Path
from datetime import datetime
from typing import Optional

ROOT = Path.cwd()
# Walk up to find project root (has .git or .trellis/tests)
for parent in [ROOT] + list(ROOT.parents):
    if (parent / ".git").exists():
        ROOT = parent
        break
# Fallback: use .trellis marker
if not (ROOT / ".git").exists():
    for parent in [ROOT] + list(ROOT.parents):
        if (parent / ".trellis").exists() and not (parent.name.startswith(".")):
            ROOT = parent
            break
TESTS_DIR = ROOT / ".trellis" / "tests"
GENERATED_DIR = TESTS_DIR / "generated"
CURRENT_MONTH = datetime.now().strftime("%Y/%m")
ACTIVE_GEN_DIR = GENERATED_DIR / CURRENT_MONTH


def ensure_dirs():
    ACTIVE_GEN_DIR.mkdir(parents=True, exist_ok=True)
    (TESTS_DIR / "generated").mkdir(parents=True, exist_ok=True)
    (ROOT / "trellis" / "scripts").mkdir(parents=True, exist_ok=True)


def git_diff_files() -> list[str]:
    """Step 1a: return list of changed files"""
    result = subprocess.run(
        ["git", "diff", "--name-only", "HEAD"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=ROOT
    )
    files = set(result.stdout.strip().split("\n"))
    result2 = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=ROOT
    )
    for line in result2.stdout.strip().split("\n"):
        if line.startswith("??"):
            files.add(line[3:].strip())
    return sorted(f for f in files if f and os.path.isfile(ROOT / f))


def get_affected_symbols() -> list[str]:
    """Read .affected_symbols file"""
    f = TESTS_DIR / ".affected_symbols"
    if not f.exists():
        return []
    symbols = []
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            symbols.append(line)
    return symbols


def set_affected_symbols(symbols: list[str]):
    sym_file = TESTS_DIR / ".affected_symbols"
    sym_file.write_text("\n".join(symbols) + "\n", encoding="utf-8")


def find_tests_for_symbol(symbol: str) -> list[str]:
    """Step 4b: grep tests/ for existing tests referencing symbol"""
    results = []
    for test_dir in [ROOT / "tests", GENERATED_DIR]:
        if not test_dir.exists():
            continue
        for f in test_dir.rglob("*.py"):
            if "__pycache__" in str(f):
                continue
            try:
                if symbol in f.read_text(encoding="utf-8", errors="ignore"):
                    results.append(str(f.relative_to(ROOT)))
            except Exception:
                continue
    return results


def get_current_hash() -> str:
    r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=ROOT)
    return r.stdout.strip() or "unknown"


def check_freshness(test_file: str) -> tuple[str, str]:
    """Check if test file is fresh. Returns (status, detail).
    status: 'fresh' | 'stale' | 'unchecked'"""
    f = ROOT / test_file
    if not f.exists():
        return "unchecked", "file not found"

    head = f.read_text(encoding="utf-8", errors="ignore")[:2000]
    src_match = re.search(r"TestedSource:\s*\S+@(\S+)", head)
    if not src_match:
        # No TestedSource -> file-level reference check
        refs = set()
        for m in re.finditer(r"(?:from|import)\s+([a-zA-Z_]\w*)", head):
            refs.add(m.group(1))
        affected = set()
        af = TESTS_DIR / ".affected_files"
        if af.exists():
            for line in af.read_text(encoding="utf-8").splitlines():
                if line and not line.startswith("#"):
                    affected.add(Path(line).stem)
        if refs & affected:
            return "stale", f"references changed files: {refs & affected}"
        return "fresh", "no TestedSource, references unchanged"

    tested_commit = src_match.group(1)
    current = get_current_hash()
    if tested_commit == current:
        return "fresh", f"TestedCommit={tested_commit} == HEAD"
    return "stale", f"TestedCommit={tested_commit} != HEAD={current}"


def history_fixes_for_files(files: list[str], since_days: int = 14) -> list[dict]:
    """Step 1e: find historical fix commits"""
    fixes = []
    since = f"{since_days} days ago"
    for f in files:
        r = subprocess.run(
            ["git", "log", "--oneline", f'--since={since}',
             "--extended-regexp", '--grep=fix|bug|hotfix|修|回滚|回归',
             "--", f],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=ROOT
        )
        for line in (r.stdout or "").strip().split("\n"):
            if line:
                parts = line.split(" ", 1)
                fixes.append({"hash": parts[0], "msg": parts[1] if len(parts) > 1 else "", "file": f})
    return fixes


def write_manual_verify_items(items: list[dict]):
    """Write manual verification items to file"""
    f = TESTS_DIR / ".manual_verify_items"
    f.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def read_manual_verify_items() -> list[dict]:
    f = TESTS_DIR / ".manual_verify_items"
    if not f.exists():
        return []
    return json.loads(f.read_text(encoding="utf-8"))
