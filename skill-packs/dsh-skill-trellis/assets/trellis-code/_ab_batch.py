"""
Batch A/B test: run with-skill agents on 21 PRs (7/type) to validate the retrospective analysis.
"""
import json, sys, os, subprocess
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "_benchmark_data"
PRS_FILE = DATA / "scores.json"
AB_DIR = DATA / "ab_test"
BATCH_DIR = AB_DIR / "batch"
os.makedirs(BATCH_DIR, exist_ok=True)

def load():
    return json.loads(PRS_FILE.read_text(encoding="utf-8"))

def pick_validation_set(n=7):
    """Pick n PRs per type for actual agent validation."""
    prs = load()
    by_type = {}
    for p in prs:
        if any(k in p['title'].lower() for k in ['release','version','bump','upgrade','chore']):
            continue
        by_type.setdefault(p['type'], []).append(p)

    selected = []
    for t in ['frontend','backend','android']:
        pool = by_type.get(t, [])
        pool.sort(key=lambda p: p['score']['total'])
        # pick low/mid/high evenly
        k = min(n, len(pool))
        idxs = [int(len(pool)*i/3) for i in range(1,4)][:k]
        for i in range(k):
            pos = int(len(pool) * (i+1) / (k+1))
            selected.append(pool[min(pos, len(pool)-1)])

    return selected[:n*3]

def make_task(pr: dict) -> str:
    """Create a coding task from the PR description."""
    return f"""## Task: {pr['title']}
Repo: {pr['repo']}
Files changed ({pr.get('changed_files', '?')}): {json.dumps(pr.get('files', [])[:5], ensure_ascii=False)}
Changes: +{pr.get('additions',0)}/-{pr.get('deletions',0)}

Implement the changes described. Follow trellis-code: Analyze -> Plan(Q1/Q2/Q3) -> Execute -> Verify -> Report.
Focus on the方案评估 (Q1: alternatives, Q2: chain impact, Q3: verification)."""

def batch_run():
    selected = pick_validation_set(7)
    print(f"Validation set: {len(selected)} PRs\n")

    for i, pr in enumerate(selected):
        task = make_task(pr)
        print(f"[{i+1}/{len(selected)}] {pr['type']} {pr['repo']}#{pr['number']}")
        print(f"  Without: {pr['score']['total']:.1f} | Title: {pr['title'][:60]}")
        print(f"  Task file: {BATCH_DIR}/task_{pr['type']}_{pr['number']}.txt")

        # Save task for agent
        (BATCH_DIR / f"task_{pr['type']}_{pr['number']}.txt").write_text(task, encoding="utf-8")

    print(f"\nTasks saved to {BATCH_DIR}/")
    print(f"\nTo run: For each PR, spawn an Agent with the task content")
    print(f"\nAfter getting outputs, score with:")
    print(f"  python -c \"exec(open('_scorer_v2.py').read())\"")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pick"
    if cmd == "pick":
        batch_run()
    elif cmd == "score-all":
        # Score all agent outputs saved in batch dir
        from _scorer_v2 import quality_score
        for f in sorted(BATCH_DIR.glob("output_*.txt")):
            label = f.stem.replace("output_", "")
            score = quality_score(f.read_text(encoding="utf-8"))
            print(f"{label}: {score['total']}")
