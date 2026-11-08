"""Apply remaining cross-language optimizations to push all languages to 90+"""
import os

path = r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# === 1. Java: Step 3b JUnit 5 example ===
old = '```java\n// 标准格式示例（Java）\n@Test\npublic void test_{method}_{scenario}_{expected}() {\n    // 1. Given — 准备输入数据和 mock\n    List<Integer> input = Arrays.asList(1, 2, 3);\n    MockRecordSet mockRs = new MockRecordSet();\n    mockRs.whenQueryContains("COUNT", 1);  // mock 返回存在\n    \n    // 2. When — 执行真实业务方法\n    job.upsertSyncRecords(input, mockRs);\n    \n    // 3. Then — 验证输出/副作用\n    assertEquals("UPDATE", mockRs.getLastSqlType());\n    assertEquals(3, mockRs.getTotalExecutions());\n}'
new = '```java\n// 标准格式示例（Java/JUnit 5 + Mockito）\n@ExtendWith(MockitoExtension.class)\nclass OrderServiceTest {\n    @Mock OrderRepository mockRepo;\n    @InjectMocks OrderService service;\n\n    @Test\n    void testCancelOrder_Shipped_ShouldThrow() {\n        // 1. Given\n        when(mockRepo.findById(1002L)).thenReturn(shippedOrder);\n        // 2. When & Then\n        assertThrows(OrderCannotCancelException.class,\n            () -> service.cancelOrder(1002L, "不想要"));\n        verify(mockRepo).findById(1002L);\n    }\n\n    @Test\n    void testCancelOrder_Normal_ShouldRefund() {\n        // 1. Given\n        when(mockRepo.findById(1001L)).thenReturn(pendingOrder);\n        // 2. When\n        service.cancelOrder(1001L, "用户取消");\n        // 3. Then\n        verify(mockRepo).save(argThat(o -> "CANCELLED".equals(o.status)));\n    }\n}'
if old in content:
    content = content.replace(old, new)
    changes += 1
    print(f'OK: Java JUnit 5 example')

# === 2. C#: Step 3b xUnit example (insert after C example) ===
old_csharp = '| C/C++ (CMake) | CTest / Google Test | 手写 Mock | `*_test.c` |'
new_csharp = '| C/C++ (CMake) | CTest / Google Test | 手写 Mock | `*_test.c` |\n| C# (.NET) | xUnit / NUnit | Moq | `*Tests.cs` |\n\n```csharp\n// 标准格式示例（C# xUnit + Moq）\n[Fact]\npublic void CancelOrder_Shipped_ShouldThrow() {\n    // 1. Given\n    mockRepo.Setup(r => r.FindById(1002L)).Returns(shippedOrder);\n    var service = new OrderService(mockRepo.Object);\n    // 2. When & Then\n    Assert.Throws<OrderCannotCancelException>(() => service.CancelOrder(1002L));\n    mockPaySvc.Verify(p => p.Refund(It.IsAny<decimal>()), Times.Never);\n}\n```'
# Don't replace if the C# table line already exists
if '| C# (.NET) | xUnit / NUnit | Moq | `*Tests.cs` |' not in content:
    if old_csharp in content:
        content = content.replace(old_csharp, new_csharp)
        changes += 1
        print(f'OK: C# xUnit example')

# === 3. C++: Step 3b Google Test example (insert after C example area) ===
old_cpp = '```cpp\n// Google Test 示例（适用于 C++ CMake 项目 DIRECT 测试）\n#include <gtest/gtest.h>\nTEST(OrderServiceTest, CancelOrderShippedShouldThrow) {\n    // Given\n    OrderService service;\n    // When & Then\n    EXPECT_THROW(service.CancelOrder(1002L), OrderCannotCancelException);\n}'
# Already has this content? Check
if 'Google Test 示例' not in content:
    # Find the C/C++ section and add after it
    old_cc = '| C/C++ (CMake) | CTest / Google Test | 手写 Mock | `*_test.c` |'
    new_cc = '| C/C++ (CMake) | CTest / Google Test | 手写 Mock | `*_test.c` |\n\n```cpp\n// Google Test 示例（适用于 C++ CMake 项目）\n#include <gtest/gtest.h>\nTEST(OrderServiceTest, CancelOrderShippedShouldThrow) {\n    // 1. Given\n    OrderService service;\n    // 2. When & Then\n    EXPECT_THROW(service.CancelOrder(1002L), OrderCannotCancelException);\n}\n```'
    if old_cc in content:
        content = content.replace(old_cc, new_cc)
        changes += 1
        print(f'OK: Google Test example')

# === 4. Rust: Step 3b #[should_panic] example (after existing Rust example) ===
old_rust_end = 'assert_eq!(result, "INSERT");\n    }\n}'
new_rust = 'assert_eq!(result, "INSERT");\n    }\n\n    #[test]\n    #[should_panic(expected = "order is already shipped")]\n    fn test_cancel_order_shipped_should_panic() {\n        // 1. Given\n        let order = Order { status: "SHIPPED" };\n        // 2. When\n        cancel_order(&order);\n        // 3. Then -- #[should_panic] asserts panic\n    }\n}'
if old_rust_end in content:
    # Only add if not already there
    if '#[should_panic]' not in content:
        content = content.replace(old_rust_end, new_rust)
        changes += 1
        print(f'OK: Rust #[should_panic] example')

# === 5. Kotlin: Step 3b kotlin.test example ===
old_rust_close = 'assert_eq!(result, "INSERT");\n    }\n}'
new_kotlin = 'assert_eq!(result, "INSERT");\n    }\n}\n\n```\n```kotlin\n// 标准格式示例（Kotlin + kotlin.test）\nimport kotlin.test.*\nclass CancelOrderTest {\n    @Test\n    fun test_cancel_order_shipped_should_reject() {\n        // 1. Given\n        val order = Order("SHIPPED", amount = 100.0)\n        // 2. When\n        val result = cancelOrder(order, "不想要")\n        // 3. Then\n        assertTrue(result.isFailure)\n        assertEquals("已发货不可取消", result.exceptionOrNull()?.message)\n    }\n}\n```'
# Find the Rust example and add Kotlin after it
rust_section = '```rust\n// 标准格式示例（Rust）'
idx = content.find(rust_section)
if idx >= 0:
    # Find end of Rust section (``` after the closing })
    end_rust = content.find('```', idx + 50)
    if end_rust >= 0:
        after_rust = content[end_rust+3:end_rust+10]
        if 'kotlin' not in content[end_rust:end_rust+100].lower():
            # Insert Kotlin example after Rust example
            kotlin_snippet = '\n```kotlin\n// 标准格式示例（Kotlin + kotlin.test）\nimport kotlin.test.*\nclass CancelOrderTest {\n    @Test\n    fun test_cancel_order_shipped_should_reject() {\n        // 1. Given\n        val order = Order("SHIPPED", amount = 100.0)\n        // 2. When\n        val result = cancelOrder(order, "不想要")\n        // 3. Then\n        assertTrue(result.isFailure)\n        assertEquals("已发货不可取消", result.exceptionOrNull()?.message)\n    }\n}\n```\n'
            content = content[:end_rust+3] + kotlin_snippet + content[end_rust+3:]
            changes += 1
            print(f'OK: Kotlin kotlin.test example')

# === 6. Node: Step 3b jest.mock() with beforeEach example ===
old_node_example = '```javascript\n// 标准格式示例（Node/Jest）'
if old_node_example in content:
    # Find the end of the JS self-contained example
    js_end = content.find('}\n```\n\n// 标准格式示例（Go）', content.find(old_node_example))
    if js_end >= 0:
        node_mock = '\n// 标准格式示例（Node/Jest + Mock）\nconst mockDb = { query: jest.fn() };\njest.mock("../db", () => ({ getDb: () => mockDb }));\n\nbeforeEach(() => {\n    mockDb.query.mockReset();\n});\n\ntest("test_upsert_new_record_should_insert", async () => {\n    // 1. Given\n    mockDb.query.mockResolvedValueOnce([]);\n    // 2. When\n    const result = await upsertSyncRecords([1, 2, 3], mockDb);\n    // 3. Then\n    expect(mockDb.query).toHaveBeenCalledTimes(3);\n});\n'
        content = content[:js_end] + node_mock + content[js_end:]
        changes += 1
        print(f'OK: Node jest.mock() example')

# === 7. Step 0b: Kotlin detection in Gradle branch ===
old_gradle = '''elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then
    if grep -qi "com\\.android" build.gradle* 2>/dev/null; then _LANG="android"; _RUNNER="gradle"; _TEST_DIR="src/test"
    else _LANG="java"; _RUNNER="gradle"; _TEST_DIR="src/test"; fi'''
new_gradle = '''elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then
    if grep -qi "com\\.android" build.gradle* 2>/dev/null; then _LANG="android"; _RUNNER="gradle"; _TEST_DIR="src/test"
    elif find src/ -name "*.kt" 2>/dev/null | grep -q . && ! find src/ -name "*.java" 2>/dev/null | grep -q .; then
        _LANG="kotlin"; _RUNNER="gradle"; _TEST_DIR="src/test/kotlin"
    else _LANG="java"; _RUNNER="gradle"; _TEST_DIR="src/test"; fi'''
if old_gradle in content:
    content = content.replace(old_gradle, new_gradle)
    changes += 1
    print(f'OK: Kotlin Gradle detection')

# === 8. Step 0b: .csproj detection ===
old_csproj = 'elif [ -f CMakeLists.txt ]; then _LANG="c"; _RUNNER="ctest"; _TEST_DIR="test"'
new_csproj = 'elif ls *.csproj 2>/dev/null | grep -q .; then _LANG="csharp"; _RUNNER="dotnet"; _TEST_DIR="tests"\nelif [ -f CMakeLists.txt ]; then\n    _LANG="c"; _RUNNER="ctest"; _TEST_DIR="test"\n    ls tests/CMakeLists.txt 2>/dev/null | grep -q . && _TEST_DIR="tests"'
if old_csproj in content:
    content = content.replace(old_csproj, new_csproj)
    changes += 1
    print(f'OK: .csproj + CMake detection')

# === 9. Step 0b: Package.swift detection ===
old_swift = 'elif [ -f composer.json ]; then _LANG="php"; _RUNNER="phpunit"; _TEST_DIR="tests"; _TEST_FRAMEWORK="phpunit"'
new_swift = 'elif [ -f Package.swift ]; then _LANG="swift"; _RUNNER="swift"; _TEST_DIR="Tests"\nelif [ -f composer.json ]; then _LANG="php"; _RUNNER="phpunit"; _TEST_DIR="tests"; _TEST_FRAMEWORK="phpunit"'
if old_swift in content:
    content = content.replace(old_swift, new_swift)
    changes += 1
    print(f'OK: Package.swift detection')

# === 10. Step 4c: Go -v -count=1 flags ===
old_go_run = 'go test -run "$_sym" ./... 2>&1 | tail -20'
new_go_run = 'go test -v -count=1 -run "$_sym" ./... 2>&1 | tail -20'
if old_go_run in content:
    content = content.replace(old_go_run, new_go_run)
    changes += 1
    print(f'OK: Go -v -count=1')

# === 11. Step 4c: Rust per-file filter ===
old_cargo = 'cargo)\n    cargo test 2>&1 | tail -20\n    ;;'
new_cargo = 'cargo)\n    for _f in .trellis/tests/generated/*.rs; do\n        [ -f "$_f" ] && cargo test --test "$(basename "$_f" .rs)" 2>&1 | tail -10\n    done\n    ;;'
# Don't replace if already updated
if old_cargo in content and 'cargo test --test' not in content:
    content = content.replace(old_cargo, new_cargo)
    changes += 1
    print(f'OK: Rust per-file cargo test')

# === 12. Step 4c: Swift --filter ===
old_swift_run = 'swift)\n    swift test 2>&1 | tail -20\n    ;;'
new_swift_run = 'swift)\n    if [ -n "$_TEST_FILES" ]; then\n        echo "$_TEST_FILES" | while IFS= read -r _tf; do\n            _TEST_CLASS=$(basename "$_tf" .swift | sed "s/_test$//;s/_Test$//")\n            swift test --filter "$_TEST_CLASS" 2>&1 | tail -10\n        done\n    else\n        swift test 2>&1 | tail -20\n    fi\n    ;;'
if old_swift_run in content and 'swift test --filter' not in content:
    content = content.replace(old_swift_run, new_swift_run)
    changes += 1
    print(f'OK: Swift --filter')

# === 13. Step 4c: Node --reporter=verbose ===
old_node_runner = 'echo "$_TEST_FILES" | xargs npx jest --silent 2>&1 | tail -20'
new_node_runner = 'echo "$_TEST_FILES" | xargs npx jest --reporter=verbose 2>&1 | tail -20'
if old_node_runner in content:
    content = content.replace(old_node_runner, new_node_runner)
    changes += 1
    print(f'OK: Node --reporter=verbose')

# === 14. Step 4c: dotnet --filter ===
old_dotnet = 'dotnet) dotnet test 2>&1 | tail -20 ;;'
new_dotnet = 'dotnet)\n    if [ -n "$_CLASSES" ]; then\n        dotnet test --filter "FullyQualifiedName~$_CLASSES" 2>&1 | tail -20\n    else\n        dotnet test 2>&1 | tail -20\n    fi\n    ;;'
if old_dotnet in content:
    content = content.replace(old_dotnet, new_dotnet)
    changes += 1
    print(f'OK: dotnet --filter')

# === 15. Step 4c: ctest -R ===
old_ctest = 'ctest) ctest --output-on-failure 2>&1 | tail -20 ;;'
new_ctest = 'ctest)\n    if [ -n "$_CLASSES" ]; then\n        ctest --output-on-failure -R "$_CLASSES" 2>&1 | tail -20\n    else\n        ctest --output-on-failure 2>&1 | tail -20\n    fi\n    ;;'
if old_ctest in content:
    content = content.replace(old_ctest, new_ctest)
    changes += 1
    print(f'OK: ctest -R')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\nTotal changes applied: {changes}')
print(f'File size: {len(content)} chars')
