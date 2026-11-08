import json, sys
with open('C:/Users/Administrator/.claude/skills/trellis-code/prs.json') as f:
    prs = json.load(f)

filtered = []
for p in prs:
    author = p['author']['login']
    title = p['title'].lower()
    if author.endswith('[bot]'):
        continue
    skip_words = ['bump', 'deps', 'dependency', 'lockfile', 'upgrade', 'chore', 'ci skip']
    if any(w in title for w in skip_words):
        continue
    changes = p['additions'] + p['deletions']
    if 50 <= changes <= 500:
        filtered.append(p)

filtered.sort(key=lambda x: x['additions'] + x['deletions'])

with open('C:/Users/Administrator/.claude/skills/trellis-code/pr_results.txt', 'w') as out:
    for p in filtered[:15]:
        c = p['additions'] + p['deletions']
        line = f"#{p['number']} | +{p['additions']}-{p['deletions']}={c} | {p['title'][:80]} | by {p['author']['login']} | {p['mergedAt'][:10]}"
        out.write(line + '\n')
        print(line)
