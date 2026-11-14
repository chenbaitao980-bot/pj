// Apply dsh-purge patches to the STAGED app copy only.
import * as core from "../dsh-purge/lib/core.js";

const aiBase = process.env.DSH_BASE || String.raw`D:\dsh-freeze-build\payload\resources\app\dsh\node_modules\@deepseek-ai`;
const backup = await core.backupAll(aiBase);
console.log("backup files:", backup.made.length, "errors:", backup.errors.length);

const report = await core.applyPatches(aiBase, core.ALL_PATCHES, {
  preserveClientBundles: false,
  forApply: true,
});

const tally = {};
for (const r of report) tally[r.status] = (tally[r.status] || 0) + 1;
console.log("tally:", JSON.stringify(tally));
for (const r of report) {
  if (!["applied", "already", "na", "skipped", "missing_file", "off"].includes(r.status)) {
    console.log(`  ! #${r.patch_id} ${r.name}: ${r.status} ${r.path || ""}`);
  }
}
console.log("applied:", report.filter((r) => r.status === "applied").length);
