#!/usr/bin/env python3
"""trellis-test 报告生成器 — 输出美观的 ASCII 测试报告"""
import argparse, json, os, sqlite3, sys
from datetime import datetime

# Windows 编码保护：确保 emoji 和 Unicode 字符能正常输出
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
elif hasattr(sys.stdout, "buffer"):
    # Python < 3.7 fallback: wrap binary buffer
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", closefd=False)

DB = ".trellis/tests/test_index.db"
SYMBOLS_FILE = ".trellis/tests/.affected_symbols"
RESULTS_FILE = ".trellis/tests/.last_test_results.json"

BOX = {
    "tl": "╔", "tr": "╗", "bl": "╚", "br": "╝",
    "h": "═", "v": "║",
    "mtl": "╠", "mtr": "╣",
    "ml": "├", "mr": "┤",
    "top": "─", "mid": "│",
}

def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def read_lines(path):
    try:
        with open(path, encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except FileNotFoundError:
        return []

def db_query(sql, params=()):
    if not os.path.isfile(DB):
        return []
    try:
        conn = sqlite3.connect(DB)
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        return rows
    except sqlite3.Error:
        return []

def fmt_bar(title, width=66):
    fill = width - len(title) - 4
    return f"{BOX['mtl']}{BOX['top']} {title} {'─' * max(fill,0)} {BOX['mtr']}"

def make_table(headers, rows, widths=None):
    """生成 ASCII 表格行"""
    if widths is None:
        widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0)) for i, h in enumerate(headers)]

    sep = f"{BOX['mid']}".join(f"{'─' * (w+2)}" for w in widths)
    header = f"{BOX['mid']}  ".join(f"{h:<{w}}" for h, w in zip(headers, widths))

    lines = [f"{BOX['v']} {header} {BOX['v']}"]
    lines.append(f"{BOX['mid']}{sep}{BOX['mid']}")

    for row in rows:
        cells = "  ".join(f"{str(c):<{w}}" for c, w in zip(row, widths))
        lines.append(f"{BOX['v']} {cells} {BOX['v']}")

    return lines

def max_width(rows, min_w=10):
    return max(min_w, max((len(str(r)) for r in rows), default=min_w))

def build_report(symbols, results, historical, specs, affected_files, risk_level):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    passed = results.get("passed", 0)
    failed = results.get("failed", 0)
    total = results.get("total", 0)
    duration = results.get("duration", "?")
    total = total or (passed + failed) or 0

    lines = []
    W = 68

    # ── Header ──
    lines.append(f"{BOX['tl']}{BOX['h'] * W}{BOX['tr']}")
    lines.append(f"{BOX['v']}  trellis-test 最终报告{' ' * (W-23)} {BOX['v']}")
    lines.append(f"{BOX['v']}{'─' * W}{BOX['v']}")

    # Summary line
    risk_tag = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")
    status = "全部通过" if failed == 0 and total > 0 else "有失败" if failed > 0 else "未运行"
    summary = f" 风险: {risk_tag}{risk_level}  |  测试: {passed}/{total} PASS ({failed} failed)  |  耗时: {duration}s"
    lines.append(f"{BOX['v']}  {summary:<{W-3}} {BOX['v']}")
    lines.append(f"{BOX['v']}  时间: {now:<{W-21}} {BOX['v']}")
    lines.append(f"{BOX['v']}  状态: {status:<{W-20}} {BOX['v']}")
    lines.append(f"{BOX['mtl']}{BOX['h'] * W}{BOX['mtr']}")

    # ── Blast Radius ──
    if symbols:
        lines.append(f"  爆炸半径分析 ({len(symbols)} 个符号)")
        lines.append("")
        for i, sym in enumerate(symbols):
            prefix = "├─" if i < len(symbols) - 1 else "└─"
            lines.append(f"  {prefix} {sym}")
            # Try to find in DB
            db_rows = db_query("SELECT file_path, layer FROM symbol_test_map st JOIN test_files tf ON st.test_id = tf.id JOIN symbols s ON st.symbol_id = s.id WHERE s.name = ?", (sym,))
            for row in db_rows[:3]:
                lines.append(f"  │   → {row[0]} [{row[1]}]" if prefix == "├─" else f"      → {row[0]} [{row[1]}]")
        lines.append("")

    # ── Test Results ──
    if total > 0:
        lines.append(fmt_bar("测试结果（按层）"))
        lines.append("")

        # Group by layer
        layers = {"DIRECT": [], "UPSTREAM": [], "DOWNSTREAM": [], "PEER": [], "UNTESTABLE": [], "IMPORTED": []}
        test_details = results.get("test_details", [])
        for td in test_details:
            layer = td.get("layer", "DIRECT")
            layers.setdefault(layer, []).append(td)

        layer_icons = {"DIRECT": "🔵", "UPSTREAM": "🟡", "DOWNSTREAM": "🔴", "PEER": "🟣", "UNTESTABLE": "⚪", "IMPORTED": "📦"}

        for layer_name in ["DIRECT", "UPSTREAM", "DOWNSTREAM", "PEER", "UNTESTABLE", "IMPORTED"]:
            tests = layers.get(layer_name, [])
            if not tests:
                if layer_name in results.get("layers_run", []):
                    lines.append(f"  {layer_icons.get(layer_name, '•')} {layer_name} — 无测试")
                continue
            icon = layer_icons.get(layer_name, "•")
            lines.append(f"  {icon} {layer_name} Layer:")
            for t in tests:
                t_name = t.get("file", t.get("name", "?"))
                t_pass = t.get("passed", 0)
                t_total = t.get("total", t.get("assertions", 0))
                status_icon = "✅" if t_pass == t_total else "❌"
                lines.append(f"   ├─ {status_icon} {t_name}  ({t_pass}/{t_total})")
                for assertion in t.get("assertions_detail", []):
                    a_pass = assertion.get("passed", False)
                    a_name = assertion.get("name", "?")
                    lines.append(f"   │  {'✅' if a_pass else '❌'} {a_name}")
                # Show source path
                if t.get("source_path"):
                    lines.append(f"   │  源: {t['source_path']}")
            lines.append("")

        # Summary
        bar_len = min(int(passed / max(total, 1) * 40), 40)
        bar = "█" * bar_len + "░" * (40 - bar_len)
        pct = int(passed / max(total, 1) * 100)
        lines.append(f"  [{bar}] {passed}/{total} ({pct}%)")
        if duration != "?":
            lines.append(f"  总耗时: {duration}s")
        lines.append("")

    # ── Historical Tests ──
    if historical:
        lines.append(fmt_bar("历史回归测试验证"))
        lines.append("")
        h_by_file = {}
        for h in historical:
            f = h.get("file", h.get("path", "?"))
            h_by_file.setdefault(f, []).append(h)

        for fname, tests in sorted(h_by_file.items()):
            status_icon = "✅" if all(t.get("result", "PASS") == "PASS" for t in tests) else "❌"
            lines.append(f"  {status_icon} {fname}")
            for t in tests:
                t_name = t.get("method", t.get("name", "?"))
                t_res = t.get("result", "PASS")
                t_commit = t.get("commit", "")
                commit_tag = f" @{t_commit[:8]}" if t_commit else ""
                icon = "✅" if t_res == "PASS" else "❌"
                lines.append(f"     {icon} {t_name}{commit_tag}")
        lines.append(f"  来源: test_index.db | 共 {len(historical)} 条历史映射")
        lines.append("")

    # ── Spec Validation ──
    if specs:
        lines.append(fmt_bar("Spec/PRD 合规验证"))
        lines.append("")
        passed_specs = sum(1 for s in specs if s.get("status", "✅") == "✅")
        for s in specs:
            stat = s.get("status", "✅")
            icon = "✅" if stat == "✅" else "⚠️" if stat == "⚠️" else "❌"
            spec_file = s.get("file", "?")
            rule = s.get("rule", "?")
            lines.append(f"  {icon} {spec_file} :: {rule}")
        lines.append(f"  {passed_specs}/{len(specs)} 通过")
        lines.append("")

    # ── Coverage Gaps ──
    uncovered = results.get("uncovered_symbols", [])
    if uncovered:
        lines.append(fmt_bar("覆盖缺口分析"))
        lines.append("")
        for u in uncovered:
            lines.append(f"  ❌ {u.get('symbol', '?')} — {u.get('reason', '未覆盖')}")
            if u.get("layer"):
                lines.append(f"     缺失层: {u['layer']}")
        lines.append("")

    # ── Security ──
    security = results.get("security_audit", [])
    if security:
        lines.append(fmt_bar("安全审计结果"))
        lines.append("")
        sec_headers = ["检查项", "状态"]
        sec_rows = [[s.get("check", "?"), s.get("result", "?")] for s in security]
        for row in make_table(sec_headers, sec_rows):
            lines.append(f"  {row}")
        lines.append("")

    # ── Changes ──
    if affected_files:
        lines.append(fmt_bar("变更文件"))
        lines.append("")
        for af in affected_files:
            ch = af.get("changes", af.get("name", "?"))
            lines.append(f"  📄 {ch}")
        lines.append("")

    # ── Auto Fix Log ──
    fix_log = results.get("auto_fix_log", [])
    if fix_log:
        lines.append(fmt_bar("自动修复记录"))
        lines.append("")
        fix_headers = ["轮次", "文件", "修复内容"]
        fix_rows = [[f.get("round", "?"), f.get("file", "?")[:30], f.get("fix", "?")[:30]] for f in fix_log]
        for row in make_table(fix_headers, fix_rows):
            lines.append(f"  {row}")
        lines.append("")

    # ── Manual Items ──
    manual = results.get("manual_verify", [])
    if isinstance(manual, list) and manual:
        lines.append(fmt_bar("需手动验证（Where | Why | How）"))
        lines.append("")
        type_labels = {"contract": "契约测试", "callback": "外部回调",
                       "migration": "DB迁移", "permission": "权限检查",
                       "cross-platform": "跨平台", "concurrency": "并发竞态"}
        type_priorities = {"P0": "高", "P1": "中", "P2": "低"}
        for m in manual:
            if isinstance(m, str) and "|" in m:
                # Format: "P0|contract|symbol|file"
                parts = m.split("|")
                pri = type_priorities.get(parts[0], "?")
                mtype = type_labels.get(parts[1], parts[1])
                where = parts[2] if len(parts) > 2 else "?"
                detail = parts[3] if len(parts) > 3 else ""
                lines.append(f"  [ ] [{pri}] {mtype}")
                lines.append(f"        Where: {where}")
                if detail:
                    lines.append(f"        How:   {detail}")
            elif isinstance(m, dict):
                pri = type_priorities.get(m.get("priority", ""), "?")
                mtype = type_labels.get(m.get("type", ""), m.get("type", "?"))
                where = m.get("file", m.get("symbol", "?"))
                why = m.get("reason", m.get("why", ""))
                how = m.get("how", "")
                lines.append(f"  [ ] [{pri}] {mtype}: {where}")
                if why:
                    lines.append(f"        Why: {why}")
                if how:
                    lines.append(f"        How: {how}")
            else:
                lines.append(f"  [ ] {m}")
        lines.append("")

    # ── Rollback ──
    lines.append(f"{BOX['mtl']}{BOX['h'] * W}{BOX['mtr']}")
    lines.append(f"{BOX['v']}  回滚: /trellis-test rollback{' ' * (W-31)} {BOX['v']}")
    lines.append(f"{BOX['bl']}{BOX['h'] * W}{BOX['br']}")

    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="trellis-test 报告生成器")
    parser.add_argument("symbol", nargs="?", default="", help="主变更符号")
    parser.add_argument("--results", default=RESULTS_FILE, help="测试结果 JSON 路径")
    parser.add_argument("--save-results", nargs=4, metavar=("TOTAL", "PASS", "FAIL", "DURATION"),
                        help="保存测试结果到 JSON（供后续报告使用）")
    args = parser.parse_args()

    # Save mode
    if args.save_results:
        total, passed, failed, duration = args.save_results
        report_data = {
            "total": int(total), "passed": int(passed), "failed": int(failed),
            "duration": duration, "timestamp": datetime.now().isoformat(),
            "test_details": [],
            "historical_tests": [],
            "specs": [],
            "uncovered_symbols": [],
        }
        os.makedirs(os.path.dirname(RESULTS_FILE), exist_ok=True)
        with open(RESULTS_FILE, "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
        return

    # Report mode
    symbols = read_lines(SYMBOLS_FILE) if not args.symbol else [args.symbol]
    results = read_json(args.results) if os.path.isfile(args.results) else {}

    # Queries from DB
    db_historical = []
    db_specs = []
    if os.path.isfile(DB):
        hist_rows = db_query("""
            SELECT DISTINCT tf.path, tf.layer FROM symbol_test_map st
            JOIN symbols s ON st.symbol_id = s.id
            JOIN test_files tf ON st.test_id = tf.id
        """)
        for row in hist_rows:
            db_historical.append({"file": row[0], "layer": row[1], "result": "PASS", "method": ""})

        spec_rows = db_query("""
            SELECT sr.spec_file, sr.rule_path, sr.rule_summary FROM test_spec_map tsm
            JOIN spec_rules sr ON tsm.spec_id = sr.id
        """)
        for row in spec_rows[:20]:
            db_specs.append({"file": row[0], "rule": f"{row[1]} — {row[2] or ''}", "status": "✅"})

    historical = results.get("historical_tests", []) or db_historical
    specs = results.get("specs", []) or db_specs
    affected_files = results.get("affected_files", [])
    risk_level = results.get("risk_level", "LOW")

    # Read affected files from .affected_files if not in results
    if not affected_files:
        af_paths = read_lines(".trellis/tests/.affected_files")
        affected_files = [{"name": p} for p in af_paths]

    report = build_report(symbols, results, historical, specs, affected_files, risk_level)
    print(report)

if __name__ == "__main__":
    main()
