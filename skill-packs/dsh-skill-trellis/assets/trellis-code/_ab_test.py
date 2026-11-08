#!/usr/bin/env python3
"""
trellis-code A/B 测试: 对比「用 skill」vs「不用 skill」的代码质量。
选择 N 个真实 PR → AI 实现(有/无 skill) → 评分 → 对比
"""
import json, sys, os
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "_benchmark_data"
AB_DIR = DATA / "ab_test"
os.makedirs(AB_DIR, exist_ok=True)

def load_scores():
    return json.loads((DATA / "scores.json").read_text(encoding="utf-8"))

def pick_test_prs(n=3):
    scores = load_scores()
    candidates = [s for s in scores
                  if 'release' not in s['title'].lower()
                  and 'version' not in s['title'].lower()
                  and 'bump' not in s['title'].lower()]
    by_type = {}
    for s in candidates:
        by_type.setdefault(s['type'], []).append(s)
    selected = []
    for t, prs in sorted(by_type.items()):
        prs.sort(key=lambda r: r['score']['total'])
        if len(prs) >= 3:
            selected.extend([prs[0], prs[len(prs)//2], prs[-1]])
        else:
            selected.extend(prs)
    return selected

def score_output(output: str) -> dict:
    o = output.lower()
    scores = {}

    # scope
    n_files = o.count("file")
    scores["scope"] = 4 if n_files <= 1 else (7 if n_files <= 3 else (9 if n_files <= 6 else 5))

    # consistency
    has_test = any(kw in o for kw in ["test", "unittest", "pytest", "assert"])
    has_config = any(kw in o for kw in ["config", "yaml", "json", ".env", "toml"])
    has_doc = any(kw in o for kw in ["doc", "readme", "comment"])
    scores["consistency"] = min(10, 5 + (2 if has_test else 0) + (1.5 if has_config else 0) + (1.5 if has_doc else 0))

    # diff quality
    scores["diff_quality"] = 5 + (2 if "diff" in o or "change" in o else 0) + (2 if ("+" in o and "-" in o) else 0)

    # test
    scores["test"] = 8 if any(kw in o for kw in ["def test", "it(", "describe(", "pytest", "assert"]) else 4

    # doc
    scores["doc"] = 7 if has_doc else 5

    scores["total"] = (
        scores["scope"] * 0.25 + scores["consistency"] * 0.30 +
        scores["diff_quality"] * 0.15 + scores["test"] * 0.20 + scores["doc"] * 0.10
    )
    return scores

def format_result(pr, without, with_):
    return {
        "repo": pr["repo"],
        "number": pr["number"],
        "title": pr["title"],
        "type": pr["type"],
        "without_score": without["score"]["total"],
        "without_output": without["output"][:300],
        "with_score": with_["score"]["total"],
        "with_output": with_["output"][:300],
        "human_baseline": pr["score"]["total"],
    }

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pick"
    if cmd == "pick":
        for pr in pick_test_prs(3):
            print(f"{pr['repo']}#{pr['number']} | {pr['type']} | score={pr['score']['total']} | {pr['title'][:70]}")
    elif cmd == "score":
        # Usage: replay saved outputs through scorer
        f = sys.argv[2]
        out = open(f, encoding="utf-8").read()
        print(json.dumps(score_output(out)))
