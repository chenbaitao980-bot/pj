#!/usr/bin/env python3
"""trellis-code: 影响分析辅助脚本 - 包装 codegraph/gitnexus/grep 的通用分析"""

import json, subprocess, sys, os
from pathlib import Path

def run_cmd(cmd: list, timeout=30):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except: return ""

def grep_scan(pattern: str, includes=("*.py", "*.js", "*.yaml", "*.json", "*.toml", "*.env", "*.md")):
    ext = " ".join(f'--include="{g}"' for g in includes)
    return run_cmd(f"grep -rn {ext} '{pattern}' . 2>/dev/null | head -50".split())

def codegraph_query(symbols: str, project="."):
    """调用 codegraph_explore 查符号"""
    return run_cmd(["python", "-c", f"""
try:
    from codegraph import explore
    result = explore(query="{symbols}", projectPath="{project}")
    print(result)
except: print("codegraph unavailable")
"""])
def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"

    if cmd == "scan":
        pattern = sys.argv[2]
        result = grep_scan(pattern)
        print(result or "# 未找到匹配")

    elif cmd == "symbols":
        print(codegraph_query(" ".join(sys.argv[2:])))

    elif cmd == "affected":
        """输出受影响文件清单"""
        pattern = sys.argv[2]
        result = grep_scan(pattern)
        files = set()
        for line in result.strip().split("\n"):
            if ":" in line:
                files.add(line.split(":")[0])
        for f in sorted(files):
            print(f)

    elif cmd == "help":
        print("""用法: python _scripts/impact.py <命令> [参数]

命令:
  scan <pattern>      — grep 搜索所有相关文件
  symbols <name>...   — codegraph 查符号定义/引用
  affected <pattern>  — 列出所有受影响文件（去重）

示例:
  python _scripts/impact.py scan "TIMEOUT"
  python _scripts/impact.py affected "load_config"
  python _scripts/impact.py symbols load_config validate_timeout
""")

if __name__ == "__main__":
    main()
