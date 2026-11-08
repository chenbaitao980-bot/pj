# Change Plan: Extract `:table_name` as explicit kwarg in join table helpers

**PR:** rails/rails #58249
**Commit:** 3fe7cc7 / 2c41b9fce634b2a173b8a5a1e3927dd8e13cc78a
**Author:** kamipo
**Status:** Merged into main (Jul 26, 2026)

---

## 1. Problem Statement

The three join table helpers (`create_join_table`, `build_create_join_table_definition`, `drop_join_table`) in `SchemaStatements` accepted `:table_name` via `**options`, relying on a helper method `find_join_table_name` to extract it with a side-effect `options.delete(:table_name)` before forwarding the rest to `create_table`/`drop_table`. This `delete` was necessary because leaving `:table_name` in `options` would trip `create_table`'s option validation.

Additionally, the `ActiveRecord::Migration::JoinTable` module that housed this helper was included in `CommandRecorder`, but that inclusion has been dead code since 2012 when `invert_create_join_table` was changed to return `[:drop_join_table, args, block]` instead of `[:drop_table, [resolved_join_table_name]]`.

## 2. Files Changed (5 files, +26/-10 lines)

### File 1: `activerecord/lib/active_record/connection_adapters/abstract/schema_statements.rb`

**Status:** Changed (+6, -8)

**Changes:**

**(a) Remove `include ActiveRecord::Migration::JoinTable`** from the `SchemaStatements` module body. This concern is being deleted entirely, making the include obsolete.

**(b) `create_join_table` signature change:**

```ruby
# Before:
def create_join_table(table_1, table_2, column_options: {}, **options)
  join_table_name = find_join_table_name(table_1, table_2, options)

# After:
def create_join_table(table_1, table_2, table_name: nil, column_options: {}, **options)
  join_table_name = table_name || ModelSchema.derive_join_table_name(table_1, table_2)
```

- Add `table_name: nil` as an explicit keyword argument before `column_options:`
- Replace the `find_join_table_name` call with the direct inline expression `table_name || ModelSchema.derive_join_table_name(table_1, table_2)`

**(c) `build_create_join_table_definition` signature change:** Same pattern as above.

```ruby
# Before:
def build_create_join_table_definition(table_1, table_2, column_options: {}, **options)
  join_table_name = find_join_table_name(table_1, table_2, options)

# After:
def build_create_join_table_definition(table_1, table_2, table_name: nil, column_options: {}, **options)
  join_table_name = table_name || ModelSchema.derive_join_table_name(table_1, table_2)
```

**(d) `drop_join_table` signature change:** Same pattern.

```ruby
# Before:
def drop_join_table(table_1, table_2, **options)
  join_table_name = find_join_table_name(table_1, table_2, options)

# After:
def drop_join_table(table_1, table_2, table_name: nil, **options)
  join_table_name = table_name || ModelSchema.derive_join_table_name(table_1, table_2)
```

### File 2: `activerecord/lib/active_record/migration/join_table.rb`

**Status:** Deleted (-16 lines)

The entire file is removed. Its contents were:

```ruby
# frozen_string_literal: true

module ActiveRecord
  module Migration
    module JoinTable
      private
        def find_join_table_name(table_1, table_2, options = {})
          options.delete(:table_name) || ModelSchema.derive_join_table_name(table_1, table_2)
        end
    end
  end
end
```

The `find_join_table_name` method is no longer needed because:
- `:table_name` is never placed inside `options` (it is captured by the explicit `table_name:` kwarg), so the `options.delete(:table_name)` side-effect is eliminated.
- The `ModelSchema.derive_join_table_name(table_1, table_2)` fallback is inlined directly at the three call sites.

### File 3: `activerecord/lib/active_record/migration.rb`

**Status:** Changed (-1)

**Change:** Remove the autoload line for `JoinTable`:

```ruby
# Remove this line:
autoload :JoinTable, "active_record/migration/join_table"
```

Since the file `join_table.rb` is being deleted, the autoload entry pointing to it must be removed to avoid `LoadError`.

### File 4: `activerecord/lib/active_record/migration/command_recorder.rb`

**Status:** Changed (-1)

**Change:** Remove `include JoinTable` from `CommandRecorder`. This inclusion was dead code since 2012 (commit `bd155d2`) when `invert_create_join_table` was changed to return `[:drop_join_table, args, block]` instead of `[:drop_table, [resolved_join_table_name]]`. The `CommandRecorder` never actually uses `find_join_table_name`.

### File 5: `activerecord/test/cases/migration/schema_definitions_test.rb`

**Status:** Changed (+2, -2)

**Change:** Two assertions comparing `join_td.name` against a symbol `:comments_posts` are updated to compare against a string `"comments_posts"`.

```ruby
# Before in both assertions:
assert_equal :comments_posts, join_td.name

# After:
assert_equal "comments_posts", join_td.name
```

This is necessary because the return type of `join_td.name` may have changed (the `delete` on options hash was returning whatever was passed, which could be a symbol; now the kwarg `table_name: nil` defaults to `nil` and the fallback `ModelSchema.derive_join_table_name` returns a string).

## 3. Detailed Diff Summary

| File | + | - | Nature of Change |
|------|---|---|------------------|
| `schema_statements.rb` | 6 | 8 | 3 method signatures changed; `include` line removed |
| `migration.rb` | 0 | 1 | `autoload :JoinTable` removed |
| `command_recorder.rb` | 0 | 1 | `include JoinTable` removed |
| `join_table.rb` | 0 | 16 | File deleted entirely |
| `schema_definitions_test.rb` | 2 | 2 | Symbol literals → string literals in assertions |
| **Total** | **8** | **28** | **Net: -20 lines** |

## 4. Edge Cases and Implications

### (a) Backward compatibility of `table_name:` kwarg

**Risk:** Low. The explicit `table_name: nil` kwarg replaces the old mechanism where `table_name` was passed inside `**options`. Any existing caller that passed `table_name: "foo"` as part of the double-splat would have been silently extracted by `find_join_table_name`. With the new signature, `table_name:` is captured by the explicit keyword and removed from `**options` before it reaches `create_table`/`drop_table` — the end behavior is identical.

### (b) `table_name:` passed as a positional hash

**Risk:** None. If a caller was doing:
```ruby
create_join_table(:posts, :comments, { table_name: :my_join, id: false })
```
Ruby keyword semantics handle this identically whether `table_name` is in the hash or as a keyword.

### (c) Symbol vs String table names

**Risk:** Low. The old code via `options.delete(:table_name)` preserved the caller's type (symbol if passed as `table_name: :foo`). The new code uses `table_name || ModelSchema.derive_join_table_name(...)`. The `ModelSchema.derive_join_table_name` method returns a string. Callers that explicitly pass `table_name:` still get their original type preserved. The test change from `:comments_posts` to `"comments_posts"` reflects that `ModelSchema.derive_join_table_name` returns a string.

### (d) Internal callers of `find_join_table_name`

**Risk:** None. After removing the include from `SchemaStatements`, `find_join_table_name` is no longer available. However, the three methods that called it have all been updated. A grep of the codebase (as confirmed by the author) shows no other callers.

### (e) `CommandRecorder` dead code removal

**Risk:** None. The `include JoinTable` in `CommandRecorder` has served no purpose since 2012. The `CommandRecorder` delegates to `SchemaStatements` methods (recording and inverting them), so the `JoinTable` module's methods were never called from `CommandRecorder` directly.

## 5. Test Considerations

### Existing test modifications needed

The two assertions in `schema_definitions_test.rb` need the symbol-to-string change as described above. These are the only test changes required — no tests need to be added or removed.

### Test coverage of the changed code path

- `create_join_table` with `table_name:` kwarg — implicitly tested by any test passing a custom name
- `create_join_table` without `table_name:` — tested by `test_build_create_join_table_definition_with_block` and `test_build_create_join_table_definition_without_block` (which rely on auto-derivation)
- `drop_join_table` — exercised by migration inversion tests

### Potential flakiness

None expected. The change is purely mechanical — logic is preserved identically.

## 6. Documentation Updates

### Internal documentation (code comments)

The existing YARD/doc comments on `create_join_table`, `build_create_join_table_definition`, and `drop_join_table` already mention the `table_name:` option. The RDoc for `create_join_table` includes:

```
The +table_name+ option will be used as the table name. Otherwise, the table
name will be derived from the two table names in alphabetical order.
```

These doc comments do not need updating because they reference `table_name` as a conceptual option — the parameter now exists as a formal keyword argument, which is compatible with the existing documentation.

### Guides / CHANGELOG

A CHANGELOG entry should note:
- `ActiveRecord::Migration::JoinTable` module removed (internal, not user-facing API)
- `create_join_table`, `drop_join_table` now accept `table_name:` as an explicit keyword argument (backward-compatible — was previously accepted via `**options`)

### Migration guides

Not needed. This is an internal refactoring with no public API breakage — `table_name:` worked before and still works.

## 7. Implementation Order

1. Delete `activerecord/lib/active_record/migration/join_table.rb`
2. Remove `autoload :JoinTable` from `activerecord/lib/active_record/migration.rb`
3. Remove `include JoinTable` from `activerecord/lib/active_record/migration/command_recorder.rb`
4. Update `activerecord/lib/active_record/connection_adapters/abstract/schema_statements.rb`:
   - Remove `include ActiveRecord::Migration::JoinTable`
   - Update the three method signatures to add `table_name: nil`
   - Replace `find_join_table_name(...)` calls with `table_name || ModelSchema.derive_join_table_name(...)`
5. Update test assertions in `activerecord/test/cases/migration/schema_definitions_test.rb`

## 8. Verification Steps

1. Run the migration-specific tests:
   ```
   bundle exec ruby -Itest test/cases/migration/schema_definitions_test.rb
   ```
2. Run the full migration test suite:
   ```
   bundle exec rake test:activerecord
   ```
3. Verify `CommandRecorder` tests still pass (confirming the dead `include` removal had no effect):
   ```
   bundle exec ruby -Itest test/cases/migration/command_recorder_test.rb
   ```
