#!/usr/bin/env python3
"""
trellis-test DB — SQLite 符号↔测试映射管理
独立脚本，零外部依赖（仅需标准库 sqlite3）
"""
import argparse, hashlib, json, os, sqlite3, subprocess, sys
from datetime import datetime

# Windows 编码保护
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DB = ".trellis/tests/test_index.db"

def connect():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            src_file TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS test_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            layer TEXT DEFAULT 'DIRECT',
            commit_hash TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS symbol_test_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol_id INTEGER REFERENCES symbols(id),
            test_id INTEGER REFERENCES test_files(id),
            mapping_type TEXT DEFAULT 'generated',
            UNIQUE(symbol_id, test_id)
        );
        CREATE TABLE IF NOT EXISTS spec_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spec_file TEXT NOT NULL,
            rule_path TEXT NOT NULL,
            rule_summary TEXT DEFAULT '',
            checksum TEXT DEFAULT '',
            UNIQUE(spec_file, rule_path)
        );
        CREATE TABLE IF NOT EXISTS test_spec_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_path TEXT NOT NULL,
            spec_id INTEGER REFERENCES spec_rules(id),
            UNIQUE(test_path, spec_id)
        );
        CREATE INDEX IF NOT EXISTS idx_symbol_name ON symbols(name);
        CREATE INDEX IF NOT EXISTS idx_test_path ON test_files(path);
        CREATE INDEX IF NOT EXISTS idx_map_symbol ON symbol_test_map(symbol_id);
        CREATE INDEX IF NOT EXISTS idx_map_test ON symbol_test_map(test_id);
    """)
    conn.commit()

def cmd_init(args):
    conn = connect()
    init(conn)
    print("[DB] 表结构初始化完成 (symbols, test_files, symbol_test_map, spec_rules, test_spec_map)")
    conn.close()

def cmd_drop_all(args):
    conn = connect()
    conn.executescript("DROP TABLE IF EXISTS test_spec_map; DROP TABLE IF EXISTS spec_rules; DROP TABLE IF EXISTS symbol_test_map; DROP TABLE IF EXISTS test_files; DROP TABLE IF EXISTS symbols;")
    conn.commit()
    conn.close()
    print("[DB] 全部表已删除")

def cmd_full_init(args):
    conn = connect()
    init(conn)
    # Import from INDEX.md if it exists
    index_path = ".trellis/tests/INDEX.md"
    if os.path.isfile(index_path):
        imported = 0
        with open(index_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "→" not in line or line.startswith("#"):
                    continue
                parts = line.split("→")
                if len(parts) < 2:
                    continue
                left = parts[0].strip()
                right = parts[1].strip()
                # left: source_file::source_symbol(risk)
                sym_parts = left.split("::")
                symbol = sym_parts[1].split("(")[0].strip() if len(sym_parts) > 1 else sym_parts[0].strip()
                src_file = sym_parts[0].strip()
                # right: test_path::test_method [layer]
                test_parts = right.split("::")
                test_path = test_parts[0].strip()
                test_method = test_parts[1].split("[")[0].strip() if len(test_parts) > 1 else ""
                layer = "DIRECT"
                if "[" in right:
                    layer = right.split("[")[1].split("]")[0].strip()
                # Insert
                try:
                    conn.execute("INSERT OR IGNORE INTO symbols(name, src_file) VALUES (?, ?)", (symbol, src_file))
                    conn.execute("INSERT OR IGNORE INTO test_files(path, layer) VALUES (?, ?)", (test_path, layer))
                    cur = conn.execute("SELECT id FROM symbols WHERE name=?", (symbol,))
                    sid = cur.fetchone()[0]
                    cur = conn.execute("SELECT id FROM test_files WHERE path=?", (test_path,))
                    tid = cur.fetchone()[0]
                    conn.execute("INSERT OR IGNORE INTO symbol_test_map(symbol_id, test_id) VALUES (?, ?)", (sid, tid))
                    imported += 1
                except Exception:
                    pass
        conn.commit()
        print(f"[DB] INDEX.md 导入完成: {imported} 条映射")

    # Scan generated/ for test files
    gen_dir = ".trellis/tests/generated"
    scanned = 0
    if os.path.isdir(gen_dir):
        for root, dirs, files in os.walk(gen_dir):
            for f in files:
                fpath = os.path.join(root, f)
                relpath = os.path.relpath(fpath, ".trellis/tests")
                try:
                    with open(fpath, encoding="utf-8") as fh:
                        head = fh.read(500)
                except Exception:
                    continue
                symbol = ""
                layer = "DIRECT"
                for line in head.split("\n"):
                    if "对应变更" in line:
                        parts = line.split("对应变更:")
                        if len(parts) > 1:
                            sp = parts[1].strip().split(" in ")
                            symbol = sp[0].strip() if sp else ""
                    if "Layer:" in line:
                        for l in ["DIRECT", "UPSTREAM", "DOWNSTREAM", "PEER", "UNTESTABLE"]:
                            if l in line:
                                layer = l
                                break
                if symbol:
                    try:
                        conn.execute("INSERT OR IGNORE INTO symbols(name) VALUES (?)", (symbol,))
                        conn.execute("INSERT OR IGNORE INTO test_files(path, layer) VALUES (?, ?)", (relpath, layer))
                        cur = conn.execute("SELECT id FROM symbols WHERE name=?", (symbol,))
                        sid = cur.fetchone()[0]
                        cur = conn.execute("SELECT id FROM test_files WHERE path=?", (relpath,))
                        tid = cur.fetchone()[0]
                        conn.execute("INSERT OR IGNORE INTO symbol_test_map(symbol_id, test_id) VALUES (?, ?)", (sid, tid))
                        scanned += 1
                    except Exception:
                        pass
        conn.commit()
        print(f"[DB] generated/ 扫描完成: {scanned} 条新增映射")
    conn.close()
    print("[DB] full-init 完成")

def cmd_add(args):
    """add <symbol> <src_file> <test_path> <layer> <commit_hash> [mapping_type]"""
    conn = connect()
    init(conn)
    conn.execute("INSERT OR IGNORE INTO symbols(name, src_file) VALUES (?, ?)", (args.symbol, args.src_file))
    conn.execute("INSERT OR IGNORE INTO test_files(path, layer, commit_hash) VALUES (?, ?, ?)", (args.test_path, args.layer, args.commit_hash))
    cur = conn.execute("SELECT id FROM symbols WHERE name=?", (args.symbol,))
    sid = cur.fetchone()[0]
    cur = conn.execute("SELECT id FROM test_files WHERE path=?", (args.test_path,))
    tid = cur.fetchone()[0]
    conn.execute("INSERT OR IGNORE INTO symbol_test_map(symbol_id, test_id, mapping_type) VALUES (?, ?, ?)", (sid, tid, args.mapping_type or "generated"))
    conn.commit()
    conn.close()
    print(f"[DB] 映射已添加: {args.symbol} → {args.test_path}")

def cmd_find(args):
    """find <symbol> [symbol2 ...]"""
    conn = connect()
    init(conn)
    if not args.symbols:
        # Return all
        cur = conn.execute("""
            SELECT DISTINCT tf.path, tf.layer, tf.commit_hash FROM test_files tf
            JOIN symbol_test_map st ON tf.id = st.test_id
            ORDER BY tf.path
        """)
    else:
        placeholders = ",".join("?" for _ in args.symbols)
        cur = conn.execute(f"""
            SELECT DISTINCT tf.path, tf.layer, tf.commit_hash FROM symbols s
            JOIN symbol_test_map st ON s.id = st.symbol_id
            JOIN test_files tf ON st.test_id = tf.id
            WHERE s.name IN ({placeholders})
            ORDER BY tf.path
        """, args.symbols)
    rows = cur.fetchall()
    conn.close()
    for row in rows:
        print(f"{row[0]}|{row[1]}|{row[2] or ''}")

def cmd_check_coverage(args):
    """check-coverage <symbol> <layer>"""
    conn = connect()
    init(conn)
    cur = conn.execute("""
        SELECT COUNT(*) FROM symbols s
        JOIN symbol_test_map st ON s.id = st.symbol_id
        JOIN test_files tf ON st.test_id = tf.id
        WHERE s.name = ? AND tf.layer = ?
    """, (args.symbol, args.layer))
    count = cur.fetchone()[0]
    conn.close()
    print("1" if count > 0 else "0")

def cmd_delete(args):
    """delete <test_path>"""
    conn = connect()
    init(conn)
    cur = conn.execute("SELECT id FROM test_files WHERE path=?", (args.test_path,))
    row = cur.fetchone()
    if row:
        conn.execute("DELETE FROM symbol_test_map WHERE test_id=?", (row[0],))
        conn.execute("DELETE FROM test_files WHERE id=?", (row[0],))
        conn.commit()
        print(f"[DB] 已删除: {args.test_path}")
    else:
        print(f"[DB] 未找到: {args.test_path}")
    conn.close()

def cmd_discover(args):
    """discover <src_files...> — 从 git 历史发现测试"""
    conn = connect()
    init(conn)
    for src_file in args.src_files:
        if not os.path.isfile(src_file):
            continue
        basename = os.path.splitext(os.path.basename(src_file))[0]
        # Search git log for commits touching this file
        try:
            result = subprocess.run(
                ["git", "log", "--oneline", "--diff-filter=M", "--", src_file],
                capture_output=True, text=True, timeout=30
            )
            if not result.stdout.strip():
                continue
        except Exception:
            continue
        # Try to find test commits that touch related test files
        test_patterns = [f"test_{basename}", f"{basename}_test"]
        for pattern in test_patterns:
            try:
                result = subprocess.run(
                    ["git", "log", "--all", "--oneline", "--diff-filter=AM", "--", f"*{pattern}*"],
                    capture_output=True, text=True, timeout=30
                )
                if result.stdout.strip():
                    for line in result.stdout.strip().split("\n"):
                        commit = line.split()[0]
                        # Register a discovered mapping
                        sym_name = basename.replace("_", ".")
                        conn.execute("INSERT OR IGNORE INTO symbols(name, src_file) VALUES (?, ?)", (sym_name, src_file))
                        conn.execute("INSERT OR IGNORE INTO test_files(path, layer, commit_hash) VALUES (?, ?, ?)", (f"discovered/{pattern}_test.py", "IMPORTED", commit))
                        cur = conn.execute("SELECT id FROM symbols WHERE name=?", (sym_name,))
                        sid = cur.fetchone()[0]
                        cur = conn.execute("SELECT id FROM test_files WHERE path=?", (f"discovered/{pattern}_test.py",))
                        tid = cur.fetchone()[0]
                        conn.execute("INSERT OR IGNORE INTO symbol_test_map(symbol_id, test_id, mapping_type) VALUES (?, ?, ?)", (sid, tid, "discovered"))
                        print(f"[DISCOVER] {src_file} → {pattern}_test.py @{commit[:8]}")
            except Exception:
                continue
    conn.commit()
    conn.close()

def cmd_find_specs(args):
    """find-specs <test_paths...>"""
    conn = connect()
    init(conn)
    if args.test_paths:
        placeholders = ",".join("?" for _ in args.test_paths)
        cur = conn.execute(f"""
            SELECT DISTINCT sr.spec_file, sr.rule_path, sr.rule_summary, sr.checksum, tsm.test_path
            FROM spec_rules sr
            JOIN test_spec_map tsm ON sr.id = tsm.spec_id
            WHERE tsm.test_path IN ({placeholders})
            ORDER BY sr.spec_file, sr.rule_path
        """, args.test_paths)
    else:
        cur = conn.execute("""
            SELECT DISTINCT sr.spec_file, sr.rule_path, sr.rule_summary, sr.checksum, tsm.test_path
            FROM spec_rules sr
            JOIN test_spec_map tsm ON sr.id = tsm.spec_id
            ORDER BY sr.spec_file, sr.rule_path
        """)
    rows = cur.fetchall()
    conn.close()
    for row in rows:
        print(f"{row[0]}|{row[1]}|{row[2] or ''}|{row[3] or ''}|{row[4] or ''}")

def cmd_add_spec(args):
    """add-spec <spec_file> <rule_path> <rule_summary>"""
    conn = connect()
    init(conn)
    checksum = ""
    spec_path = f".trellis/spec/{args.spec_file}"
    if os.path.isfile(spec_path):
        checksum = hashlib.md5(open(spec_path, "rb").read()).hexdigest()[:12]
    conn.execute("INSERT OR IGNORE INTO spec_rules(spec_file, rule_path, rule_summary, checksum) VALUES (?, ?, ?, ?)",
                 (args.spec_file, args.rule_path, args.rule_summary, checksum))
    conn.commit()
    conn.close()
    print(f"[DB] spec 规则已添加: {args.spec_file} :: {args.rule_path}")

def cmd_map_spec(args):
    """map-spec <test_path> <spec_file> <rule_path> <rule_summary>"""
    conn = connect()
    init(conn)
    checksum = ""
    spec_path = f".trellis/spec/{args.spec_file}"
    if os.path.isfile(spec_path):
        checksum = hashlib.md5(open(spec_path, "rb").read()).hexdigest()[:12]
    cur = conn.execute("SELECT id FROM spec_rules WHERE spec_file=? AND rule_path=?", (args.spec_file, args.rule_path))
    row = cur.fetchone()
    if not row:
        conn.execute("INSERT INTO spec_rules(spec_file, rule_path, rule_summary, checksum) VALUES (?, ?, ?, ?)",
                     (args.spec_file, args.rule_path, args.rule_summary, checksum))
        spec_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        spec_id = row[0]
        conn.execute("UPDATE spec_rules SET checksum=? WHERE id=?", (checksum, spec_id))
    conn.execute("INSERT OR IGNORE INTO test_spec_map(test_path, spec_id) VALUES (?, ?)", (args.test_path, spec_id))
    conn.commit()
    conn.close()
    print(f"[DB] spec 映射已添加: {args.test_path} → {args.spec_file} :: {args.rule_path}")

def cmd_export(args):
    """export — 从 DB 导出 INDEX.md 格式"""
    conn = connect()
    init(conn)
    cur = conn.execute("""
        SELECT s.name, s.src_file, tf.path, tf.layer
        FROM symbols s
        JOIN symbol_test_map st ON s.id = st.symbol_id
        JOIN test_files tf ON st.test_id = tf.id
        ORDER BY s.name, tf.path
    """)
    rows = cur.fetchall()
    conn.close()
    print("# Test-Source Index (auto-generated from DB)")
    print("# Format: source_file::source_symbol(risk) → test_path::test_method [layer]")
    for row in rows:
        src_file = row[1] or "?"
        symbol = row[0]
        test_path = row[2]
        layer = row[3] or "DIRECT"
        print(f"{src_file}::{symbol} → {test_path}::* [{layer}]")

def cmd_stats(args):
    """stats — 显示 DB 统计信息"""
    conn = connect()
    init(conn)
    syms = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
    tests = conn.execute("SELECT COUNT(*) FROM test_files").fetchone()[0]
    maps = conn.execute("SELECT COUNT(*) FROM symbol_test_map").fetchone()[0]
    specs = conn.execute("SELECT COUNT(*) FROM spec_rules").fetchone()[0]
    spec_maps = conn.execute("SELECT COUNT(*) FROM test_spec_map").fetchone()[0]
    conn.close()
    print(f"符号: {syms} | 测试文件: {tests} | 映射: {maps} | Spec规则: {specs} | Spec映射: {spec_maps}")

def main():
    parser = argparse.ArgumentParser(description="trellis-test DB 管理")
    sub = parser.add_subparsers(dest="cmd")

    p_init = sub.add_parser("init", help="初始化表结构")
    p_drop = sub.add_parser("drop-all", help="删除全部表")
    p_full = sub.add_parser("full-init", help="全量初始化（建表+导入INDEX.md+扫描generated/）")
    p_add = sub.add_parser("add", help="添加符号↔测试映射")
    p_add.add_argument("symbol"); p_add.add_argument("src_file"); p_add.add_argument("test_path")
    p_add.add_argument("layer"); p_add.add_argument("commit_hash"); p_add.add_argument("mapping_type", nargs="?", default="generated")

    p_find = sub.add_parser("find", help="查询符号关联的测试")
    p_find.add_argument("symbols", nargs="*")

    p_cc = sub.add_parser("check-coverage", help="检查符号在某层是否有测试")
    p_cc.add_argument("symbol"); p_cc.add_argument("layer")

    p_del = sub.add_parser("delete", help="删除测试及映射")
    p_del.add_argument("test_path")

    p_disc = sub.add_parser("discover", help="从 git 历史发现测试")
    p_disc.add_argument("src_files", nargs="+")

    p_fs = sub.add_parser("find-specs", help="查询测试关联的 spec 规则")
    p_fs.add_argument("test_paths", nargs="*")

    p_as = sub.add_parser("add-spec", help="添加 spec 规则")
    p_as.add_argument("spec_file"); p_as.add_argument("rule_path"); p_as.add_argument("rule_summary")

    p_ms = sub.add_parser("map-spec", help="映射测试到 spec 规则")
    p_ms.add_argument("test_path"); p_ms.add_argument("spec_file"); p_ms.add_argument("rule_path"); p_ms.add_argument("rule_summary")

    sub.add_parser("export", help="导出 INDEX.md")
    sub.add_parser("stats", help="显示统计信息")

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        return

    dispatch = {
        "init": cmd_init, "drop-all": cmd_drop_all, "full-init": cmd_full_init,
        "add": cmd_add, "find": cmd_find, "check-coverage": cmd_check_coverage,
        "delete": cmd_delete, "discover": cmd_discover,
        "find-specs": cmd_find_specs, "add-spec": cmd_add_spec, "map-spec": cmd_map_spec,
        "export": cmd_export, "stats": cmd_stats,
    }
    dispatch[args.cmd](args)

if __name__ == "__main__":
    main()
