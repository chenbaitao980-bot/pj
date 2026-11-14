import * as reapply from "../dsh-purge/lib/reapply.js";
const sha = reapply.markPatchesApplied();
console.log("marked:", sha);
console.log("read:", JSON.stringify(reapply.readAppliedStamp()));
