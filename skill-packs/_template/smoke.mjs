const packs = ['dsh-skill-grill-me','dsh-skill-trellis','dsh-skill-officecli','dsh-skill-darwin'];
for (const p of packs) {
  const url = `file:///E:/claude/project4/pj/skill-packs/${p}/lib/index.js`;
  try {
    const m = await import(url);
    const captured = [];
    m.apply({ skills: { registerProvider: (fn) => captured.push(fn()) } }, {});
    const prov = captured[0];
    const list = await prov.list();
    const first = await prov.get(list[0]);
    console.log(`PASS ${p}  plugin=${m.name} inject=${m.inject} provider=${prov.name} skills=${list.length}`);
    console.log(`     e.g. ${list.map(s=>s.name).slice(0,6).join(', ')}${list.length>6?' …':''}`);
    console.log(`     desc[0]=${String(first.description).slice(0,80)}…`);
    console.log(`     content ${String(first.content).length} chars, resourceBase=${first.resourceBase?.path?.split('/').slice(-2).join('/')}`);
  } catch (e) {
    console.log(`FAIL ${p} :: ${e.message}`);
  }
}