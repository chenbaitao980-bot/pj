with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'r', encoding='utf-8') as f:
    c = f.read()

# Add Kotlin example after Rust example
kotlin_block = '\n// 标准格式示例（Kotlin + kotlin.test）\nimport kotlin.test.*\nclass ExampleTest {\n    @Test fun test_add_should_return_sum() {\n        assertEquals(3, 1 + 2)\n    }\n}\n'

# Find where to insert: after Rust example, before "规则："
marker_rust_end = '    // 3. Then -- #[should_panic] asserts panic\n    }\n}'
idx = c.find(marker_rust_end)
if idx >= 0:
    end_of_rust = c.find('\n```\n', idx) + 5  # after ```
    if 'kotlin.test' not in c[end_of_rust:end_of_rust+200]:
        c = c[:end_of_rust] + '\n' + kotlin_block + '\n' + c[end_of_rust:]
        print('OK: Kotlin example added')
    else:
        print('Kotlin already exists')

with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'w', encoding='utf-8') as f:
    f.write(c)

# Final verification
for term in ['@ExtendWith', 't.Run', 'describe(', '@Test fun', 'tests/CMakeLists.txt', 'kotlin.test', '#[should_panic]', '.csproj', 'Package.swift', 'phpunit.xml', '.rspec']:
    found = 'yes' if term in c else 'NO'
    print(f'  {term}: {found}')
