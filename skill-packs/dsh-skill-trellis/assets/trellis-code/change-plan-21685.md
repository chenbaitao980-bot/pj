# Change Plan: Restore BaseFinder.find() removed during 6.1 deprecation cleanup

**PR:** django/django #21685
**Commit:** ee6370f2cb64f5bf028970c86390f76fd121eb87
**Author:** Nick Pope (ngnpope)
**Status:** Merged into main (Jul 27, 2026)

---

## 1. Problem Statement

Commit `a146fe293099d7f860ba13e4b3a571bbda55af22` (part of the Django 6.1 deprecation cycle cleanup) removed the deprecated `all` keyword argument from `find()` methods across `django.contrib.staticfiles.finders`. In that commit, the deprecation-handling `**kwargs` absorption pattern was stripped from every `find()` method and the supporting helper `_check_deprecated_find_param` was deleted.

The cleanup overzealously removed the **entire** `find()` method from `BaseFinder`, not just the deprecation wrapper. `BaseFinder` is the abstract base class for the finder hierarchy -- it is the contract that all custom finders must implement. Removing `find()` from `BaseFinder` means:

- The finder interface is no longer documented in the base class.
- There is no guard against third-party finder subclasses that forget to implement `find()` -- they would silently fail with `AttributeError` at call time rather than a clear `NotImplementedError` at development time.
- The `get_finder()` function validates that a finder class is a subclass of `BaseFinder`, but without `find()` on `BaseFinder`, that check is weakened -- a class that subclasses `BaseFinder` but omits `find()` would pass the `issubclass` check but fail at runtime.

The concrete subclasses (`FileSystemFinder`, `AppDirectoriesFinder`, `BaseStorageFinder`) retained their own `find()` methods -- only the abstract base definition was lost.

## 2. Files Changed (2 files, +25/-0 lines)

### File 1: `django/contrib/staticfiles/finders.py`

**Status:** Modified (+11, -0)

**Location:** `BaseFinder` class body, between `check()` and `list()`.

**Change:** Insert a `find()` method with the same signature and `NotImplementedError`-raising body that existed before the cleanup:

```python
def find(self, path, find_all=False):
    """
    Given a relative file path, find an absolute file path.

    If the ``find_all`` parameter is False (default) return only the first
    found file path; if True, return a list of all found files paths.
    """
    raise NotImplementedError(
        "subclasses of BaseFinder must provide a find() method"
    )
```

The method:
- Accepts `path` (str) and `find_all` (bool, default `False`).
- Raises `NotImplementedError` with a clear message directing subclasses to provide their own `find()`.
- Has a full docstring documenting the contract (matching the style of `list()` on the same class).

**Before (BaseFinder class body):**

```python
class BaseFinder:
    """..."""

    def check(self, **kwargs):
        raise NotImplementedError(
            "subclasses may provide a check() method to verify the finder is "
            "configured correctly."
        )

    def list(self, ignore_patterns):
        """..."""
        raise NotImplementedError(
            "subclasses of BaseFinder must provide a list() method"
        )
```

**After:**

```python
class BaseFinder:
    """..."""

    def check(self, **kwargs):
        raise NotImplementedError(
            "subclasses may provide a check() method to verify the finder is "
            "configured correctly."
        )

    def find(self, path, find_all=False):
        """
        Given a relative file path, find an absolute file path.

        If the ``find_all`` parameter is False (default) return only the first
        found file path; if True, return a list of all found files paths.
        """
        raise NotImplementedError(
            "subclasses of BaseFinder must provide a find() method"
        )

    def list(self, ignore_patterns):
        """..."""
        raise NotImplementedError(
            "subclasses of BaseFinder must provide a list() method"
        )
```

### File 2: `tests/staticfiles_tests/test_finders.py`

**Status:** Modified (+14, -0)

**Location:** At the top of the test file, before the existing `TestFinders` mixin class.

**Change:** Add a new `TestBaseFinder` test class that verifies both `find()` and `list()` raise `NotImplementedError` when called on the base class:

```python
class TestBaseFinder(SimpleTestCase):
    def test_find(self):
        finder = finders.BaseFinder()
        msg = "subclasses of BaseFinder must provide a find() method"
        with self.assertRaisesMessage(NotImplementedError, msg):
            finder.find("file.txt")

    def test_list(self):
        finder = finders.BaseFinder()
        msg = "subclasses of BaseFinder must provide a list() method"
        with self.assertRaisesMessage(NotImplementedError, msg):
            finder.list(None)
```

This class:
- Inherits from `SimpleTestCase` (no database needed, no static files setup required).
- Instantiates `BaseFinder` directly -- the base class is concrete (no abstract methods in the Python `abc` sense, it uses `NotImplementedError` as a runtime guard instead).
- Uses `assertRaisesMessage` to verify both the exception type and the exact error message, which serves as a contract test -- changing the error message in the future will require updating both the source and this test.
- Tests `find()` (the restored method) and `list()` (the existing method) for symmetry, confirming the base class interface is complete.

## 3. Detailed Diff Summary

| File | + | - | Nature of Change |
|------|---|---|------------------|
| `django/contrib/staticfiles/finders.py` | 11 | 0 | Add `find()` method to `BaseFinder` class |
| `tests/staticfiles_tests/test_finders.py` | 14 | 0 | Add `TestBaseFinder` test class |
| **Total** | **25** | **0** | **Net: +25 lines** |

## 4. Root Cause Analysis

The removal happened in commit `a146fe293099d7f860ba13e4b3a571bbda55af22` which cleaned up the `all` -> `find_all` parameter rename deprecation. That commit:

1. Deleted the `_check_deprecated_find_param()` helper function (correct -- no longer needed).
2. Deleted `BaseFinder._check_deprecated_find_param()` instance method (correct -- was only a thin wrapper).
3. Changed all concrete `find()` method signatures from `def find(self, path, find_all=False, **kwargs)` to `def find(self, path, find_all=False)` (correct -- `**kwargs` was only used for deprecation).
4. Removed the deprecation `if kwargs:` blocks from each concrete `find()` body (correct -- no longer needed).
5. **Removed the entire `BaseFinder.find()` method** (incorrect -- the `find()` definition on `BaseFinder` predated the deprecation and was not itself deprecated).

The error is understandable in context: the `BaseFinder.find()` method had the same `**kwargs` deprecation pattern as the others, and the clean-up diff looked structurally similar for all methods. But `BaseFinder.find()` is the abstract interface definition, not a concrete override -- removing it means the interface is undocumented and unenforced.

## 5. Edge Cases and Implications

### (a) Third-party finders that subclass BaseFinder and omit find()

**Risk:** Medium. If a third-party package defines `class MyFinder(BaseFinder):` without overriding `find()`, the behavior changes from `raise NotImplementedError` (before the buggy removal) to `AttributeError` when the module-level `find()` function calls `finder.find(path, find_all=...)`. Restoring `BaseFinder.find()` restores the clear `NotImplementedError` guard.

Between the buggy commit and this fix, any such third-party finder would raise `AttributeError` with a traceback pointing to `BaseFinder` having no `find()` attribute, which is confusing. After this fix, the error is the intended `NotImplementedError: subclasses of BaseFinder must provide a find() method`.

### (b) Subclasses that call super().find()

**Risk:** Low. No subclass in Django's own codebase calls `super().find()`. The concrete finders (`FileSystemFinder`, `AppDirectoriesFinder`, `BaseStorageFinder`) fully override `find()`. A third-party finder that calls `super().find()` between the buggy commit and this fix would crash with `AttributeError: 'super' object has no attribute 'find'`. After this fix, it would get the intended `NotImplementedError` (or, more likely, the subclass overrides `find()` entirely and never calls `super()`).

### (c) Interaction with get_finder() validation

**Risk:** None. The `get_finder()` function uses `issubclass(Finder, BaseFinder)` to validate, which only checks the class hierarchy, not method existence. `BaseFinder.find()` being absent does not affect `issubclass`. After restoration, `issubclass` behavior is unchanged.

### (d) The `find` module-level function

**Risk:** None. The module-level `find()` function calls `finder.find(path, find_all=find_all)` on each finder returned by `get_finders()`. It does not itself depend on `BaseFinder.find()` -- it only needs concrete finder instances. However, having the base method defined is good defensive programming: if a misconfigured finder without `find()` somehow ends up in the finder list, the error is caught at development time rather than in production.

## 6. Test Considerations

### New test coverage

The `TestBaseFinder` class covers:
- `BaseFinder.find()` raises `NotImplementedError` -- ensures the abstract base class enforces the interface.
- `BaseFinder.list()` raises `NotImplementedError` -- ensures the existing abstract method is still enforced (regression guard).

### Existing test coverage of finders

The existing `TestFinders` mixin (and its concrete subclasses `TestFileSystemFinder`, `TestAppDirectoriesFinder`, `TestDefaultStorageFinder`) test `find()` and `find_all` on concrete finders. These continue to pass unchanged.

### No flakiness expected

The `TestBaseFinder` tests are purely synchronous, no I/O, no database, no filesystem. They cannot flake.

### Manual verification scenarios

1. Instantiate `BaseFinder()` and verify `find("any/path.txt")` raises `NotImplementedError` with the correct message.
2. Instantiate `BaseFinder()` and verify `list([])` raises `NotImplementedError` with the correct message.
3. Confirm that `FileSystemFinder.find()`, `AppDirectoriesFinder.find()`, and `BaseStorageFinder.find()` still work after the change (the new method does not interfere since they override it).

## 7. Documentation Updates

### Internal documentation (code comments)

No changes needed. The `BaseFinder` class docstring ("A base file finder to be used for custom staticfiles finder classes") is still accurate. The added `find()` method has its own docstring documenting the contract, matching the style of `list()`.

### External documentation

- **No release notes needed** -- this is a bug fix restoring behavior that should not have been removed. From a user perspective, `BaseFinder.find()` was part of the public API before the 6.1 cycle and remains part of it.
- **No migration guide updates needed** -- no API changes, just restoration of existing behavior.
- **No deprecation timeline changes** -- the `all` -> `find_all` deprecation was already finalized.

### Backport note

The PR commit message notes: "This will need backporting to the 6.1 stable branch." Since the removal happened in the 6.1 deprecation cleanup, the restoration must also land in 6.1.x releases so that the stable release series has `BaseFinder.find()`.

## 8. Implementation Order

1. **`django/contrib/staticfiles/finders.py`**: Add the `find()` method to `BaseFinder` between `check()` and `list()`.
2. **`tests/staticfiles_tests/test_finders.py`**: Add the `TestBaseFinder` class before `TestFinders`.
3. Run the staticfiles test suite to verify.

## 9. Verification Steps

1. Run the staticfiles test suite:
   ```
   python -m django test staticfiles_tests.tests.test_finders
   ```
2. Verify the new `TestBaseFinder` tests pass:
   ```
   python -m django test staticfiles_tests.tests.test_finders.TestBaseFinder
   ```
3. Verify existing finder tests still pass:
   ```
   python -m django test staticfiles_tests.tests.test_finders.TestFileSystemFinder
   python -m django test staticfiles_tests.tests.test_finders.TestAppDirectoriesFinder
   python -m django test staticfiles_tests.tests.test_finders.TestDefaultStorageFinder
   python -m django test staticfiles_tests.tests.test_finders.TestMiscFinder
   ```
4. Quick sanity check by importing and instantiating `BaseFinder`:
   ```python
   from django.contrib.staticfiles.finders import BaseFinder
   bf = BaseFinder()
   bf.find("test.txt")  # Should raise NotImplementedError
   ```
