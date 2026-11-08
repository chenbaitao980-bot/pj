"""
Step 4b: Find existing tests in project tests/ + check freshness.
Usage: python _step4b_find.py
Output: JSON to stdout with SELECTED_TESTS list
"""
import sys, os, json, glob
from pathlib import Path

# Add _common.py to path
sys.path.insert(0, str(Path(__file__).parent))
# Also add project paths
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "remote" / "relay"))
sys.path.insert(0, str(ROOT / "remote" / "noconfig"))

from _common import *

def main():
    ensure_dirs()

    symbols = get_affected_symbols()
    if not symbols:
        # Infer from git diff
        files = git_diff_files()
        for f in files[:10]:
            stem = Path(f).stem
            if stem not in symbols:
                symbols.append(stem)
        set_affected_symbols(symbols)

    if not symbols:
        print(json.dumps({"error": "no symbols", "tests": [], "history_fixes": []}))
        return

    # 1. Find existing tests
    found_tests = {}
    for sym in symbols:
        tests = find_tests_for_symbol(sym)
        if tests:
            found_tests[sym] = tests

    # 2. Check freshness for all found tests
    stale_tests = []
    fresh_tests = []
    unchecked_tests = []
    for sym, tests in found_tests.items():
        for t in tests:
            status, detail = check_freshness(t)
            if status == "stale":
                stale_tests.append({"test": t, "symbol": sym, "detail": detail})
            elif status == "fresh":
                fresh_tests.append({"test": t, "symbol": sym})
            else:
                unchecked_tests.append({"test": t, "symbol": sym})

    # 3. Delete stale tests
    for item in stale_tests:
        f = ROOT / item["test"]
        if f.exists():
            try:
                f.unlink()
                print(f"  [DELETE] stale test: {item['test']}", file=sys.stderr)
            except OSError:
                pass

    # 4. History fixes
    src_files = [f for f in git_diff_files() if f.endswith(".py")]
    fixes = history_fixes_for_files(src_files)

    result = {
        "symbols": symbols,
        "fresh_tests": [t["test"] for t in fresh_tests],
        "stale_tests": stale_tests,
        "unchecked_tests": [t["test"] for t in unchecked_tests],
        "history_fixes": fixes,
        "all_tests": list(dict.fromkeys(
            [t["test"] for t in fresh_tests] +
            [t["test"] for t in unchecked_tests]
        )),
        "needs_generate": [s for s in symbols if s not in found_tests]
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))

    # Save for report
    if result["history_fixes"]:
        hf = TESTS_DIR / ".history_fixes"
        hf.write_text("\n".join(f"{f['hash']} {f['msg']} ({f['file']})" for f in fixes), encoding="utf-8")


if __name__ == "__main__":
    main()
