with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# 1. Step 0b: Add _TEST_FRAMEWORK variable
old = '_LANG="" ; _RUNNER="" ; _TEST_DIR="" ; _EXT=""'
new = '_LANG="" ; _RUNNER="" ; _TEST_DIR="" ; _EXT="" ; _TEST_FRAMEWORK=""'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print('OK: added _TEST_FRAMEWORK var')

# 2. Step 0b: Add composer.json/Gemfile detection
old = 'elif [ -f requirements.txt ] || [ -f pyproject.toml ]; then _LANG="python"; _RUNNER="pytest"; _TEST_DIR="tests"'
new = 'elif [ -f composer.json ]; then _LANG="php"; _RUNNER="phpunit"; _TEST_DIR="tests"; _TEST_FRAMEWORK="phpunit"\nelif [ -f Gemfile ]; then _LANG="ruby"; _RUNNER="rspec"; _TEST_DIR="spec"; _TEST_FRAMEWORK="rspec"\nelif [ -f requirements.txt ] || [ -f pyproject.toml ]; then _LANG="python"; _RUNNER="pytest"; _TEST_DIR="tests"; _TEST_FRAMEWORK="pytest"'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print('OK: added composer.json/Gemfile detection')

# 3. Step 0f: Add android Gradle config
old = '  gradle)\n    echo \'{"runner":"gradle","command":"./gradlew test","compile":"./gradlew compileJava -q","test_dir":"src/test","cov_cmd":"./gradlew jacocoTestReport"}\' > .trellis/tests/config.json\n    ;;'
new = '  android)\n    echo \'{"runner":"gradle","command":"./gradlew testDebugUnitTest","compile":"./gradlew compileDebugSources -q","test_dir":"src/test","cov_cmd":"./gradlew jacocoTestReport"}\' > .trellis/tests/config.json\n    ;;\n  gradle)\n    echo \'{"runner":"gradle","command":"./gradlew test --tests \\"*Test\\"","compile":"./gradlew classes -q","test_dir":"src/test","cov_cmd":"./gradlew jacocoTestReport"}\' > .trellis/tests/config.json\n    ;;'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print('OK: added android Gradle config')

# 4. Step 4c: Fix Node runner detection
old = '  node)\n    echo "$_TEST_FILES" | xargs npx jest --silent 2>&1 | tail -20\n    ;;'
new = '  node)\n    if [ -f vitest.config.ts ] || [ -f vitest.config.js ]; then\n      echo "$_TEST_FILES" | xargs npx vitest run 2>&1 | tail -20\n    elif [ -f jest.config.ts ] || [ -f jest.config.js ]; then\n      echo "$_TEST_FILES" | xargs npx jest --silent 2>&1 | tail -20\n    elif [ -f .mocharc.js ] || [ -f .mocharc.yml ]; then\n      echo "$_TEST_FILES" | xargs npx mocha 2>&1 | tail -20\n    else\n      npx jest --silent 2>&1 | tail -20\n    fi\n    ;;'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print('OK: fixed Node runner detection')

# 5. Step 4c: Fix PHP/Ruby runners
old = '  php)\n    for _f in .trellis/tests/generated/*Test.php; do [ -f "$_f" ] && php -f "$_f" 2>&1 | tail -10; done\n    ;;\n  ruby)\n    for _f in .trellis/tests/generated/*_test.rb; do [ -f "$_f" ] && ruby "$_f" 2>&1 | tail -10; done\n    ;;'
new = '  php)\n    if [ -f phpunit.xml ] || [ -f phpunit.xml.dist ]; then\n      phpunit 2>&1 | tail -20\n    else\n      for _f in .trellis/tests/generated/*Test.php; do [ -f "$_f" ] && php -f "$_f" 2>&1 | tail -10; done\n    fi\n    ;;\n  ruby)\n    if [ -f .rspec ]; then\n      bundle exec rspec 2>&1 | tail -20\n    else\n      for _f in .trellis/tests/generated/*_test.rb; do [ -f "$_f" ] && ruby -Itest "$_f" 2>&1 | tail -10; done\n    fi\n    ;;'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print('OK: fixed PHP/Ruby runners')

# 6. Step 4c: Fix Go runner
old_go = '''  go)
    # Go: 用包路径
    for _f in $_TEST_FILES; do
      # 文件已复制到项目根目录，用 go test . 即可
      go test -v 2>&1 | tail -20
      break  # 一次 go test . 跑所有本包测试
    done
    ;;'''
new_go = '''  go)
    for _sym in "${AFFECTED_SYMBOLS[@]}"; do
      go test -run "$_sym" ./... 2>&1 | tail -20
    done
    ;;'''
if old_go in content:
    content = content.replace(old_go, new_go)
    changes += 1
    print('OK: fixed Go runner')
else:
    # Try to find the Go section without relying on exact unicode
    if 'go test -v 2>&1 | tail -20' in content:
        print('  Go section found but old_go did not match, trying simple replace')
        content = content.replace(
            'go test -v 2>&1 | tail -20\n      break  # 一次 go test . 跑所有本包测试',
            'go test -run "$_sym" ./... 2>&1 | tail -20'
        )
        changes += 1

# 7. Step 3b: Expand comment header formats
old_hdr = '// Java / C / Go / Rust / JS — 对应语言注释格式，字段相同'
new_hdr = '// Java / C — 对应语言注释格式，字段相同\n// Go 示例（block comment）\n/*\n场景: <功能描述>\n对应变更: <符号名> in <源文件名>\nTestedSource: <符号名>@<git commit hash>\n风险等级: <HIGH/MEDIUM/LOW>\nLayer: <DIRECT/UPSTREAM/DOWNSTREAM/PEER>\n*/\n// Rust 示例（line comments）\n// 场景: <功能描述>\n// 对应变更: <符号名> in <源文件名>\n// TestedSource: <符号名>@<git commit hash>\n// Layer: <DIRECT/UPSTREAM/DOWNSTREAM/PEER>'
if old_hdr in content:
    content = content.replace(old_hdr, new_hdr)
    changes += 1
    print('OK: expanded comment header formats')

with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\nTotal changes: {changes}')
print(f'File size: {len(content)} chars')
