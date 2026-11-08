#!/usr/bin/env python3
"""Score A/B test outputs"""
import json, sys
from pathlib import Path

BASE = Path(__file__).parent
AB_DIR = BASE / "_benchmark_data" / "ab_test"
AB_DIR.mkdir(exist_ok=True)

def score_output(output: str) -> dict:
    o = output.lower()
    scope = 4 if o.count("file") <= 1 else (7 if o.count("file") <= 3 else (9 if o.count("file") <= 6 else 5))
    has_test = any(kw in o for kw in ["test", "pytest", "unittest"])
    has_config = any(kw in o for kw in ["config", "yaml", "json", ".env"])
    has_doc = any(kw in o for kw in ["doc", "changelog", "rst", "readme"])
    consistency = min(10, 5 + (2 if has_test else 0) + (1.5 if has_config else 0) + (1.5 if has_doc else 0))
    diff_q = 5 + (2 if any(k in o for k in ["diff", "---", "+++"]) else 0) + (2 if "```" in o else 0)
    test_s = 8 if any(k in o for k in ["def test", "pytest.warns", "pytest"]) else 4
    doc_s = 7 if has_doc else 5
    total = scope * 0.25 + consistency * 0.30 + diff_q * 0.15 + test_s * 0.20 + doc_s * 0.10
    return {"scope": scope, "consistency": consistency, "diff": diff_q, "test": test_s, "doc": doc_s, "total": round(total, 1)}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"

    if cmd == "save-with":
        # Save with-skill output from stdin
        with open(AB_DIR / "with_flask_5899.txt", "w", encoding="utf-8") as f:
            f.write(sys.stdin.read())
        print("saved")

    elif cmd == "score":
        label = sys.argv[2]
        inp = (AB_DIR / f"{label}.txt").read_text(encoding="utf-8")
        result = score_output(inp)
        result["label"] = label
        print(json.dumps(result, ensure_ascii=False))

    elif cmd == "all":
        results = []
        for f in sorted(AB_DIR.glob("*.txt")):
            label = f.stem
            inp = f.read_text(encoding="utf-8")
            result = score_output(inp)
            result["label"] = label
            results.append(result)
            print(f"{label}: total={result['total']} scope={result['scope']} consistency={result['consistency']} test={result['test']} doc={result['doc']}")

        # Group by PR
        groups = {}
        for r in results:
            pr = "_".join(r["label"].split("_")[1:3]) if "_" in r["label"] else r["label"]
            groups.setdefault(pr, {})[r["label"].split("_")[0]] = r

        print("\n=== COMPARISON ===")
        for pr, scores in sorted(groups.items()):
            w = scores.get("without", {})
            wi = scores.get("with", {})
            delta = wi.get("total", 0) - w.get("total", 0)
            marker = "+" if delta > 0 else ""
            print(f"{pr}: without={w.get('total','?')} with={wi.get('total','?')} delta={marker}{delta:.1f}")
