#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OPENCLAW_REPO = process.env.OPENCLAW_REPO_URL ?? "https://github.com/openclaw/openclaw.git";
const SKILL_NAMES = ["feishu-doc", "feishu-drive", "feishu-perm", "feishu-wiki"];
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function getArgValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index < 0 || index + 1 >= process.argv.length) {
		return undefined;
	}
	return process.argv[index + 1];
}

function getTargetDir() {
	const cliTarget = getArgValue("--target");
	if (cliTarget) {
		return resolve(cliTarget);
	}
	if (getArgValue("--global")) {
		return resolve(join(homedir(), ".pi", "agent", "skills"));
	}
	return resolve(join(SCRIPT_DIR, "..", "skills"));
}

function cloneRepo(tempDir) {
	execFileSync("git", ["clone", "--depth", "1", OPENCLAW_REPO, tempDir], {
		stdio: "inherit",
	});
}

function syncSkills(repoDir, targetDir) {
	const sourceRoot = join(repoDir, "extensions", "feishu", "skills");
	if (!existsSync(sourceRoot)) {
		throw new Error(`OpenClaw feishu skills directory not found: ${sourceRoot}`);
	}

	mkdirSync(targetDir, { recursive: true });

	for (const name of SKILL_NAMES) {
		const source = join(sourceRoot, name);
		const destination = join(targetDir, name);
		if (!existsSync(source)) {
			throw new Error(`Missing skill in source repo: ${name}`);
		}
		cpSync(source, destination, { force: true, recursive: true });
		console.log(`[sync] ${name} -> ${destination}`);
	}
}

function main() {
	const targetDir = getTargetDir();
	const tempDir = mkdtempSync(join(tmpdir(), "openclaw-feishu-skills-"));

	console.log(`[sync] source repo: ${OPENCLAW_REPO}`);
	console.log(`[sync] target dir : ${targetDir}`);

	try {
		cloneRepo(tempDir);
		syncSkills(tempDir, targetDir);
		console.log("[sync] done");
	} finally {
		rmSync(tempDir, { force: true, recursive: true });
	}
}

main();
