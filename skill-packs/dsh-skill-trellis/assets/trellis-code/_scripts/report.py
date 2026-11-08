#!/usr/bin/env python3
"""trellis-code: 报告生成辅助脚本"""

import json, os, sys
from datetime import datetime
from pathlib import Path

REPORT_DIR = Path(".trellis/code")

def generate_change_report(change_goal: str, affected_files: list, spec_rules: list,
                           gate_results: dict, consistency: dict) -> str:
    """生成变更报告 markdown（edit 模式）"""
    status = "✅" if all(v.get("passed", False) for v in [gate_results, consistency]) else "❌"
    return f"""## 变更报告

### 一、变更摘要
- **任务**: {change_goal}
- **时间**: {datetime.now().strftime("%Y-%m-%d %H:%M")}

### 二、修改的文件
| 文件 | 操作 | 说明 |
|------|------|------|
""" + "\n".join(f"| {f['path']} | {f['action']} | {f.get('note','')} |" for f in affected_files) + f"""

### 三、Spec 合规
| 规则 | 状态 |
|------|------|
""" + "\n".join(f"| {r.get('rule','')} | {'✅' if r.get('pass') else '❌'} |" for r in spec_rules) + f"""

### 四、质量门禁
| 检查项 | 结果 |
|--------|------|
| lint | {'✅' if gate_results.get('lint') else '❌'} |
| type-check | {'✅' if gate_results.get('type') else '❌'} |
| test | {'✅' if gate_results.get('test') else '❌'} |

### 五、一致性验证
| 检查项 | 结果 |
|--------|------|
| 多点一致性 | {'✅' if consistency.get('multi_point') else '❌'} |
| 数据流完整性 | {'✅' if consistency.get('data_flow') else '❌'} |
| Spec 合规 | {'✅' if consistency.get('spec') else '❌'} |

### 六、未完成事项
{consistency.get('todo', '无')}
"""

def generate_new_report(goal: str, files: list, spec_rules: list, gate: dict) -> str:
    """生成新代码报告 markdown（new 模式）"""
    return f"""## 代码生成报告

### 一、生成摘要
- **任务**: {goal}
- **时间**: {datetime.now().strftime("%Y-%m-%d %H:%M")}

### 二、生成的文件
| 文件 | 行数 | 说明 |
|------|------|------|
""" + "\n".join(f"| {f['path']} | {f.get('lines','?')} | {f.get('note','')} |" for f in files) + f"""

### 三、Spec 合规
| 规则 | 状态 |
|------|------|
""" + "\n".join(f"| {r.get('rule','')} | {'✅' if r.get('pass') else '❌'} |" for r in spec_rules) + f"""

### 四、质量门禁
| 检查项 | 结果 |
|--------|------|
| lint | {'✅' if gate.get('lint') else '❌'} |
| type-check | {'✅' if gate.get('type') else '❌'} |
| test | {'✅' if gate.get('test') else '❌'} |

### 五、未完成事项
{gate.get('todo', '无')}
"""

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "edit-report":
        data = json.loads(sys.stdin.read())
        print(generate_change_report(**data))
    elif cmd == "new-report":
        data = json.loads(sys.stdin.read())
        print(generate_new_report(**data))
    else:
        print(f"用法: echo '{{...}}' | python _scripts/report.py edit-report")
