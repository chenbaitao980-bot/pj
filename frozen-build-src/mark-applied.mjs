import * as reapply from "file:///C:/Users/Administrator/.dsh/plugins/dsh-purge/lib/reapply.js";
const sha = reapply.markPatchesApplied();
console.log("marked:", sha);
console.log("read:", JSON.stringify(reapply.readAppliedStamp()));
