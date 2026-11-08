#!/usr/bin/env python3
"""Real A/B test runner: score agent outputs on 5 quality dimensions."""
import json, sys, os
from pathlib import Path
from collections import defaultdict

BASE = Path(__file__).parent
DATA = BASE / "_benchmark_data"
AB_DIR = DATA / "ab_real"
os.makedirs(AB_DIR, exist_ok=True)

def score_output(text: str) -> dict:
    """Score agent output. Measures trellis-code's KEY differentiators:方案评估, consistency, specificity."""
    o = text.lower()
    lines = text.split("\n")

    # 1. Scope (25%): Are the RIGHT files identified? Measures file path density
    file_paths = sum(1 for l in lines if any(kw in l for kw in
        ["/src/", "/lib/", "/packages/", "/crates/", "activerecord/", "okhttp/", ".py:", ".ts:", ".kt:", ".java:", ".rs:", ".rb:"]))
    has_exclusion = any(kw in o for kw in ["out of scope", "not changing", "wont fix", "excluded"])
    scope = min(10, 3 + file_paths * 0.8 + (1 if has_exclusion else 0))

    # 2. Consistency (30%): PROVES code+test+doc are synced (trellis-code's core value)
    has_code_path = any(kw in o for kw in ["src/", "lib/", "packages/", "crates/", "okhttp/"])
    has_test_path = any(kw in o for kw in ["test_", "/test/", "tests/", "spec/"])
    has_doc_path = any(kw in o for kw in ["doc/", "docs/", "readme", "changelog", "changes.rst", "changes.md"])
    has_config_path = any(kw in o for kw in ["config", "yaml", "json", ".env", "toml", "pom.xml", "build.gradle"])
    cons = 3
    if has_code_path: cons += 1.5
    if has_test_path: cons += 2.5
    if has_doc_path: cons += 2
    if has_config_path: cons += 1
    if has_code_path and has_test_path and (has_doc_path or has_config_path): cons += 1.5  # sync bonus
    # Penalty for ONLY mentioning code (no test/doc = inconsistent)
    if has_code_path and not has_test_path and not has_doc_path: cons -= 1
    cons = max(cons, 1); cons = min(cons, 10)

    # 3. 方案评估 (15%): trellis-code's CORE differentiator
    has_q1 = any(kw in o for kw in ["approach a", "approach b", "方案", "q1:", "q1 "])
    has_compare = any(kw in o for kw in [" vs ", " versus ", "simpler", "trade-off", "complexity"])
    has_verdict = any(kw in o for kw in ["choose", "verdict", "selected", "recommend", "选"])
    has_code_snippets = "```" in text
    alt = 3
    if has_q1: alt += 2.5
    if has_compare: alt += 2
    if has_verdict: alt += 1.5
    if has_code_snippets: alt += 1
    alt = min(alt, 10)

    # 4. Test (20%): SPECIFIC test scenarios
    has_test_code = any(kw in o for kw in ["def test_", "it(", "describe(", "assert ", "expect("])
    has_edge_cases = any(kw in o for kw in ["edge case", "边界", "edge cases", "scenario"])
    has_regression = any(kw in o for kw in ["regression", "verify", "test case", "test plan"])
    test_s = 3
    if has_test_path: test_s = 5
    if has_test_code: test_s += 2
    if has_edge_cases: test_s += 1.5
    if has_regression: test_s += 1.5
    test_s = min(test_s, 10)

    # 5. Documentation (10%): actual doc changes described
    doc_s = 4
    if has_doc_path: doc_s = 6
    if any(kw in o for kw in ["changelog", "deprecated", "kdoc", "yardoc", "javadoc"]): doc_s += 2
    if any(kw in o for kw in ["readme", "docstring", "api doc"]): doc_s += 2
    doc_s = min(doc_s, 10)

    total = scope*0.25 + cons*0.30 + alt*0.15 + test_s*0.20 + doc_s*0.10
    return {"scope":round(scope,1),"consistency":round(cons,1),"alternatives":alt,
            "test":test_s,"doc":doc_s,"total":round(total,1)}

    # 4. Test (20%): test code or test scenarios described
    has_test_code = any(kw in o for kw in ["def test_", "it(", "describe(", "assert ", "expect("])
    has_test_desc = any(kw in o for kw in ["regression", "verify", "test case", "test scenario"])
    test_s = 3
    if has_test: test_s = 5
    if has_test_code: test_s += 2.5
    if has_test_desc: test_s += 2.5
    test_s = min(test_s, 10)

    # 5. Documentation (10%): actual doc changes
    doc_s = 4
    if has_doc: doc_s = 6
    if any(kw in o for kw in ["changelog", "changes.rst", "deprecated", "yardoc", "kdoc"]): doc_s += 2
    if any(kw in o for kw in ["readme", "api.", "docstring"]): doc_s += 2
    doc_s = min(doc_s, 10)

    total = scope*0.25 + cons*0.30 + alt*0.15 + test_s*0.20 + doc_s*0.10
    return {"scope":round(scope,1),"consistency":round(cons,1),"alternatives":alt,
            "test":test_s,"doc":doc_s,"total":round(total,1)}

def save(label: str, text: str):
    (AB_DIR / f"{label}.txt").write_text(text, encoding="utf-8")

def load(label: str) -> str:
    return (AB_DIR / f"{label}.txt").read_text(encoding="utf-8")

def report():
    """Generate real A/B comparison report from saved agent outputs."""
    results = []
    for f in sorted(AB_DIR.glob("*.txt")):
        label = f.stem
        if label in ("tasks",): continue
        text = f.read_text(encoding="utf-8")
        s = score_output(text)
        s["label"] = label
        results.append(s)

    # Group by PR number (last token in label after prefix)
    groups = defaultdict(lambda: {"without": None, "with": None})
    for r in results:
        parts = r["label"].split("_")
        pr_num = parts[-1]  # Last segment is the PR number
        mode = "with" if parts[0] == "with" else "without"
        groups[pr_num][mode] = r

    total_without, total_with, n = 0, 0, 0
    improvements = []
    lines = ["# Real A/B Test Report", f"**PRs tested**: {len(groups)}", "",
             "| PR | Without | With | Delta | Δ% | ScopeΔ | ConsΔ | AltΔ | TestΔ | DocΔ |",
             "|---|--------|------|-------|-----|--------|-------|-------|-------|------|"]

    for pr_id in sorted(groups.keys()):
        g = groups[pr_id]
        if g["without"] and g["with"]:
            wo, wi = g["without"]["total"], g["with"]["total"]
            delta = wi - wo
            pct = ((wi - wo) / wo * 100) if wo > 0 else 0
            total_without += wo; total_with += wi; n += 1
            improvements.append(pct)
            sd = g["with"]["scope"] - g["without"]["scope"]
            cd = g["with"]["consistency"] - g["without"]["consistency"]
            ad = g["with"].get("alternatives",0) - g["without"].get("alternatives",0)
            td = g["with"]["test"] - g["without"]["test"]
            dod = g["with"]["doc"] - g["without"]["doc"]
            emoji = "[+]" if delta > 0 else ("[=]" if delta >= 0 else "[-]")
            lines.append(f"| {pr_id} | {wo:.1f} | {wi:.1f} | {emoji}{delta:+.1f} | {pct:+.0f}% | {sd:+.1f} | {cd:+.1f} | {ad:+.1f} | {td:+.1f} | {dod:+.1f} |")

    avg_wo = total_without / max(n,1)
    avg_w = total_with / max(n,1)
    avg_pct = sum(improvements) / max(len(improvements),1)
    pos = sum(1 for p in improvements if p > 0)
    fifty = sum(1 for p in improvements if p >= 50)
    lines += ["",
              f"**Average without**: {avg_wo:.1f}",
              f"**Average with**: {avg_w:.1f}",
              f"**Average improvement**: {avg_pct:+.1f}%",
              f"**PRs improved**: {pos}/{n} ({pos*100//n}%)",
              f"**PRs 50%+**: {fifty}/{n} ({fifty*100//n}%)"]

    report_text = "\n".join(lines)
    (AB_DIR / "report.md").write_text(report_text, encoding="utf-8")
    print(report_text)
    return report_text

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "save":
        save(sys.argv[2], sys.stdin.read())
    elif cmd == "score":
        print(json.dumps(score_output(load(sys.argv[2]))))
    elif cmd == "report":
        report()
