"""
Step 5: Generate test report with why-changed, flowcharts, manual verify points.
Multi-language compatible.
Usage: python _step5_report.py --affected-symbols '["sym1","sym2"]' --test-results results.json --output-file report.md
"""
import json, sys, os, argparse
from pathlib import Path

ROOT = Path.cwd()
for parent in [ROOT] + list(ROOT.parents):
    if (parent / ".git").exists():
        ROOT = parent
        break
TESTS_DIR = ROOT / ".trellis" / "tests"


def load_json(path):
    if not os.path.isfile(path):
        return {}
    try:
        return json.loads(open(path, encoding="utf-8").read())
    except Exception:
        return {}


def load_jsonl(path):
    if not os.path.isfile(path):
        return []
    results = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                results.append(json.loads(line))
            except Exception:
                pass
    return results


def generate_report(args):
    symbols = json.loads(args.affected_symbols) if args.affected_symbols else []
    test_results = load_jsonl(args.test_results) if args.test_results else []
    config = load_json(args.config) if args.config else {}
    history_fixes = []
    if args.history_fixes and os.path.isfile(args.history_fixes):
        for line in open(args.history_fixes, encoding="utf-8"):
            line = line.strip()
            if line:
                history_fixes.append(line)

    manual_items = []
    mf = TESTS_DIR / ".manual_verify_items"
    if mf.exists():
        try:
            manual_items = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            pass

    spec_report = TESTS_DIR / ".spec_audit_report"
    spec_lines = []
    if args.spec_audit and os.path.isfile(args.spec_audit):
        with open(args.spec_audit, encoding="utf-8") as f:
            spec_lines = [l.strip() for l in f if l.strip()]
    elif spec_report.exists():
        spec_lines = [l.strip() for l in spec_report.read_text(encoding="utf-8").splitlines() if l.strip()]

    runner = config.get("runner", "pytest")
    lang = config.get("lang", "python")

    # Calculate stats
    total = len(test_results)
    passed = sum(1 for r in test_results if r.get("status") == "PASS")
    failed = total - passed
    duration = sum(r.get("duration", 0) for r in test_results)

    lines = []
    lines.append("# trellis-test 最终报告")
    lines.append("")
    lines.append("## 总体摘要")
    lines.append(f"| 项目 | 值 |")
    lines.append(f"|------|-----|")
    lines.append(f"| 语言/框架 | {lang} / {runner} |")
    lines.append(f"| 变更符号 | {', '.join(symbols[:10])}{'...' if len(symbols) > 10 else ''} |")
    lines.append(f"| 测试结果 | {passed}/{total} PASS ({failed} failed) |")
    if duration > 0:
        lines.append(f"| 耗时 | {duration:.1f}s |")
    lines.append("")

    # Why changed
    lines.append("## 变更范围（含修改原因）")
    lines.append("")
    for sym in symbols[:10]:
        sym_clean = sym.replace("_", " ").title()
        lines.append(f"### {sym}")
        lines.append("")
        lines.append(f"**修改前**: 参见 Step 1b 的 git diff 和 codegraph 分析")
        lines.append(f"**修改后**: 参见 Step 3 生成的测试文件")
        lines.append("")
        lines.append("```")
        lines.append(f"修改前流程: ... → {sym} (旧行为) → 问题路径")
        lines.append(f"修改后流程: ... → {sym} (新行为) → 预期路径 ✅")
        lines.append("```")
        lines.append("")

    # Test results
    lines.append("## 测试结果")
    lines.append("")
    lines.append("| 文件 | 状态 | 耗时 | 输出 |")
    lines.append("|------|------|------|------|")
    for r in test_results:
        status = "✅ PASS" if r.get("status") == "PASS" else "❌ FAIL"
        fname = Path(r.get("file", "")).name
        lines.append(f"| {fname} | {status} | {r.get('duration', 0):.2f}s | {r.get('output', '')[:60]} |")
    lines.append(f"| **总计** | **{passed}/{total}** | **{duration:.1f}s** | |")
    lines.append("")

    # History fixes
    if history_fixes:
        lines.append("## 历史回归发现")
        lines.append("")
        lines.append("| 修复 | 来源 |")
        lines.append("|------|------|")
        for hf in history_fixes[:20]:
            lines.append(f"| {hf[:80]} | Step 1e |")
        lines.append("")

    # Manual verify
    if manual_items:
        lines.append("## 手动验证点")
        lines.append("")
        lines.append("| # | 项目 | 位置 | 原因 | 验证方法 |")
        lines.append("|---|------|------|------|---------|")
        for i, item in enumerate(manual_items, 1):
            loc = item.get("location", item.get("file", "?"))
            reason = item.get("reason", item.get("why", "需要手动环境"))
            method = item.get("method", "staging 验证")
            lines.append(f"| {i} | {item.get('name', '?')} | {loc} | {reason} | {method} |")
        lines.append("")

    # Spec compliance
    if spec_lines:
        lines.append("## Spec/PRD 合规验证")
        lines.append("")
        lines.append("| Spec 文件 | 规则 | 结论 |")
        lines.append("|----------|------|------|")
        for sl in spec_lines:
            parts = sl.split("|")
            if len(parts) >= 3:
                lines.append(f"| {parts[0].strip()} | {parts[1].strip()} | {parts[2].strip()} |")
            else:
                lines.append(f"| {sl[:80]} | | |")
        lines.append("")

    # Notes
    lines.append("## 注意事项")
    lines.append("")
    lines.append("| 注意点 | 说明 |")
    lines.append("|--------|------|")
    lines.append(f"| 测试框架 | {runner} |")
    lines.append(f"| 运行方式 | `{config.get('command', 'pytest')}` |")
    lines.append(f"| 手动验证 | {len(manual_items)} 项需人工确认 |")
    if spec_lines:
        lines.append(f"| Spec 审计 | {len(spec_lines)} 条规范已检查 |")
    else:
        lines.append("| Spec 审计 | 无 spec 目录或无需检查 |")
    lines.append("")

    report = "\n".join(lines)

    if args.output_file:
        out = Path(args.output_file)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report, encoding="utf-8")
        print(f"[REPORT] 已写入 {out}")
    else:
        print(report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--affected-symbols", default="[]")
    parser.add_argument("--history-fixes", default="")
    parser.add_argument("--test-results", default="")
    parser.add_argument("--config", default="")
    parser.add_argument("--spec-audit", default="")
    parser.add_argument("--output-file", default="")
    args = parser.parse_args()
    generate_report(args)
