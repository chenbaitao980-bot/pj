import json
data = json.load(open('C:/Users/Administrator/.claude/skills/trellis-code/prs.json'))
print(f"Total PRs: {len(data)}")
for p in data[:3]:
    print(f"#{p['number']} {p['title'][:60]} by {p['author']['login']} +{p['additions']}-{p['deletions']}")
