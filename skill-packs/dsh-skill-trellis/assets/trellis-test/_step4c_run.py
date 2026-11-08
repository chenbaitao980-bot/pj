"""
Step 4c: Run selected tests. Multi-language support.
Usage: python _step4c_run.py --selected-tests '["test1.py","test2.py"]' --config config.json --output-file results.jsonl --affected-symbols '["sym1","sym2"]'
"""

import argparse, json, subprocess, sys, time, os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--selected-tests", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-file", default="")
    parser.add_argument("--affected-symbols", default="[]")
    args = parser.parse_args()

    try:
        tests = json.loads(args.selected_tests)
        config = json.load(open(args.config))
        affected = json.loads(args.affected_symbols)
    except Exception as e:
        _end({"passed": 0, "failed": 0, "total": 0, "duration": 0,
              "results": [], "error": str(e)})
        return

    runner = config.get("runner", "generic")
    output_file = args.output_file
    total = len(tests)
    passed = failed = 0
    results = []
    start = time.time()

    for test in tests:
        cmd = _build_cmd(runner, test, config, affected)
        if not cmd:
            results.append({"test": test, "status": "FAIL",
                            "output": f"no cmd for runner={runner}"})
            failed += 1
            _append(output_file, results[-1])
            continue

        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace",
                               timeout=config.get("timeout", 120))
            ok = r.returncode == 0
            output = r.stdout if r.stdout else ""
            if r.stderr:
                output += "\n[stderr]\n" + r.stderr
            results.append({"test": test, "status": "PASS" if ok else "FAIL",
                            "output": output[:2000]})
            passed += ok
            failed += not ok
        except subprocess.TimeoutExpired:
            results.append({"test": test, "status": "FAIL", "output": "TIMEOUT"})
            failed += 1
        except Exception as e:
            results.append({"test": test, "status": "FAIL", "output": str(e)})
            failed += 1
        _append(output_file, results[-1])

    _end({"passed": passed, "failed": failed, "total": total,
          "duration": round(time.time() - start, 2), "results": results})


def _build_cmd(runner, test, config, affected):
    lang = runner.lower()
    _gradlew = "./gradlew" if os.name != "nt" else "gradlew.bat"
    mapping = {
        "python": ["python", "-m", "pytest", test, "-q", "--tb=short"],
        "pytest": ["python", "-m", "pytest", test, "-q", "--tb=short"],
        "unittest": ["python", "-m", "unittest", test],
        "go": ["go", "test", "-run", affected[0] if affected else ".", "./..."],
        "rust": ["cargo", "test", "--", test.replace("tests/", "").replace(".rs", "")],
        "cargo": ["cargo", "test", "--", test.replace("tests/", "").replace(".rs", "")],
        "java": ["mvn", "test", "-Dtest=" + (config.get("test_classes", "") or Path(test).stem)],
        "maven": ["mvn", "test", "-Dtest=" + (config.get("test_classes", "") or Path(test).stem)],
        "jest": ["npx", "jest", test],
        "vitest": ["npx", "vitest", "run", test],
        "node": ["node", "--test", test],
        "mocha": ["npx", "mocha", test],
        "phpunit": ["phpunit", test],
        "rspec": ["bundle", "exec", "rspec", test],
        "gradle": [_gradlew, "test", "--tests", "*" + Path(test).stem + "*"],
        "android": [_gradlew, "testDebugUnitTest"],
        "kotlin": [_gradlew, "test", "--tests", "*" + Path(test).stem + "*"],
        "swift": ["swift", "test", "--filter", Path(test).stem],
        "dart": ["dart", "test", test],
        "dotnet": ["dotnet", "test", "--filter", Path(test).stem],
        "ctest": ["ctest", "--output-on-failure"],
        "scala": ["sbt", "test"],
    }
    if lang in mapping:
        return mapping[lang]
    ext = os.path.splitext(test)[1].lower()
    ext_map = {
        ".py": ["python", "-m", "pytest", test, "-q", "--tb=short"],
        ".go": ["go", "test", "-run", ".", "./..."],
        ".rs": ["cargo", "test", "--", Path(test).stem],
        ".js": ["npx", "jest", test],
        ".ts": ["npx", "jest", test],
        ".java": ["mvn", "test", "-Dtest=" + Path(test).stem],
        ".php": ["phpunit", test],
        ".rb": ["bundle", "exec", "rspec", test],
        ".kt": [_gradlew, "test", "--tests", "*" + Path(test).stem + "*"],
        ".swift": ["swift", "test", "--filter", Path(test).stem],
        ".dart": ["dart", "test", test],
        ".cs": ["dotnet", "test", "--filter", Path(test).stem],
        ".c": ["ctest", "--output-on-failure"],
        ".cpp": ["ctest", "--output-on-failure"],
        ".scala": ["sbt", "test"],
    }
    return ext_map.get(ext, [])


def _append(path, obj):
    if path:
        with open(path, "a") as f:
            f.write(json.dumps(obj) + "\n")


def _end(data):
    print(json.dumps(data))
    sys.exit(1 if data.get("failed", 0) > 0 else 0)


if __name__ == "__main__":
    main()
