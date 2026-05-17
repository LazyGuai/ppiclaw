import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function collectTestFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const st = statSync(fullPath);
		if (st.isDirectory()) {
			out.push(...collectTestFiles(fullPath));
			continue;
		}
		if (entry.endsWith(".test.ts")) {
			out.push(fullPath);
		}
	}
	return out;
}

const testFiles = collectTestFiles("test").sort();
if (testFiles.length === 0) {
	console.error("No test files found under test/**/*.test.ts");
	process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", "--import", "tsx", ...testFiles], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
