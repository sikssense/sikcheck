import { fetchPlanSnapshot } from "../src/lib/figma.ts";
const snap = await fetchPlanSnapshot(process.argv[2]);
console.log(snap.sectionName, "screens", snap.screens.length, "orphanDescs", snap.orphanDescs.length, "others", snap.others.length);
for (const s of snap.screens) console.log(`- ${s.key} | texts ${s.texts.length} | desc ${s.desc ? s.desc.texts.length : "없음"}`);
console.log("orphan:", snap.orphanDescs.map(o => o.key));
console.log("others:", snap.others.map(o => o.name));
const s0 = snap.screens.find(s => s.key === "AST-REG-01 (AWP)_PC");
console.log("AWP desc sample:", s0?.desc?.texts.slice(0, 8).map(t => t.text.slice(0, 60)));
