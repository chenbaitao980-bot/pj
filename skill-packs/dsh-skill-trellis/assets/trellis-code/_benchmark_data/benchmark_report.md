# trellis-code Benchmark Report
**Generated**: 2026-07-29 10:57
**PRs analyzed**: 111
**Overall score**: 6.5/10

## By Category
| Category | PRs | Mean Score |
|----------|-----|-----------|
| android | 30 | 5.9 |
| backend | 41 | 6.5 |
| frontend | 40 | 7.0 |

## Dimension Breakdown
| Dimension | Mean | Description |
|-----------|------|-------------|
| scope | 6.5 | Scope Discipline - focused change size |
| consistency | 6.5 | Multi-point Consistency - code+config+test sync |
| diff_quality | 7.3 | Diff Quality - balanced add/del ratio |
| test_coverage | 6.5 | Test Coverage - includes tests |
| documentation | 6.1 | Documentation - updates docs |

## Bottom 10 PRs (lowest quality scores)
| Repo | # | Scope | Consistency | Test | Doc | Total |
|------|---|-------|-------------|------|-----|-------|
| golang/go | 54390 | 0 | 5 | 4 | 5 | 3.5 |
| android/architecture-components-samples | 1024 | 3 | 5 | 4 | 5 | 4.6 |
| android/architecture-components-samples | 1030 | 3 | 5 | 4 | 5 | 4.8 |
| android/architecture-components-samples | 1023 | 3 | 5 | 4 | 5 | 4.8 |
| vercel/next.js | 96304 | 5 | 5 | 4 | 5 | 5.0 |
| tailwindlabs/tailwindcss | 20334 | 3 | 5 | 4 | 8 | 5.0 |
| django/django | 21692 | 5 | 5 | 4 | 5 | 5.0 |
| Kotlin/kotlinx.coroutines | 4702 | 5 | 5 | 4 | 8 | 5.0 |
| vercel/next.js | 96298 | 5 | 5 | 4 | 5 | 5.1 |
| android/nowinandroid | 2051 | 5 | 5 | 4 | 5 | 5.1 |

## Top 10 PRs (highest quality scores)
| Repo | # | Scope | Consistency | Test | Doc | Total |
|------|---|-------|-------------|------|-----|-------|
| expressjs/express | 7234 | 9 | 9 | 9 | 8 | 8.6 |
| tailwindlabs/tailwindcss | 20314 | 9 | 8 | 9 | 8 | 8.5 |
| tailwindlabs/tailwindcss | 20319 | 9 | 8 | 9 | 8 | 8.5 |
| tailwindlabs/tailwindcss | 20356 | 9 | 8 | 9 | 8 | 8.3 |
| android/architecture-components-samples | 1081 | 9 | 8 | 9 | 5 | 8.2 |
| expressjs/express | 7233 | 7 | 9 | 9 | 8 | 8.2 |
| expressjs/express | 7366 | 9 | 8 | 9 | 8 | 8.2 |
| expressjs/express | 7377 | 9 | 8 | 9 | 8 | 8.2 |
| tailwindlabs/tailwindcss | 20336 | 9 | 8 | 9 | 8 | 8.2 |
| facebook/react | 37113 | 9 | 8 | 9 | 5 | 8.2 |

## Score Distribution
| Range | Count |
|-------|-------|
| 0-3 | 0 |
| 3-5 | 4 #|
| 5-7 | 69 ###############################|
| 7-8 | 25 ###########|
| 8-9 | 13 #####|
| 9-10 | 0 |

## Weakness Analysis (trellis-code optimization targets)

- **Low consistency** (code changes without config/test sync): 59 PRs (53%)
- **No tests**: 55 PRs (49%)
- This is where trellis-code's multi-point consistency check adds the most value
- **Large PRs** (>15 files): 16 PRs - trellis-code's scope discipline check helps here