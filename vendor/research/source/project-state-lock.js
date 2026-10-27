const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LOCK_RETRY_DELAY_MS = 25;
const LOCK_TIMEOUT_MS = 20 * 1000;
const STALE_LOCK_AGE_MS = 90 * 1000;

function sleep(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getLockPath(statePath) {
	const resolvedStatePath = path.resolve(statePath);
	return path.join(path.dirname(resolvedStatePath), `.${path.basename(resolvedStatePath)}.lock`);
}

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	}
	catch (error) {
		return error?.code !== 'ESRCH';
	}
}

async function removeStaleLock(lockPath) {
	let stat;
	try {
		stat = await fs.stat(lockPath);
	}
	catch {
		return false;
	}
	let owner = null;
	try {
		owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
	}
	catch {
		// A partially written lock is only removed after it has had time to settle.
	}
	const ageMs = Date.now() - stat.mtimeMs;
	const ownerIsGone = Number.isInteger(owner?.pid) && !isProcessAlive(owner.pid);
	if (!ownerIsGone && ageMs < STALE_LOCK_AGE_MS) {
		return false;
	}
	await fs.rm(lockPath, { force: true }).catch(() => {});
	return true;
}

async function acquireProjectStateLock(statePath, options = {}) {
	const lockPath = getLockPath(statePath);
	const timeoutMs = Math.max(1000, Number(options.timeoutMs) || LOCK_TIMEOUT_MS);
	const deadline = Date.now() + timeoutMs;
	const token = crypto.randomUUID();
	while (true) {
		let handle = null;
		try {
			handle = await fs.open(lockPath, 'wx');
			await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
			await handle.close();
			handle = null;
			return async () => {
				try {
					const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
					if (owner?.token !== token) {
						return;
					}
				}
				catch {
					return;
				}
				await fs.rm(lockPath, { force: true }).catch(() => {});
			};
		}
		catch (error) {
			await handle?.close().catch(() => {});
			if (error?.code !== 'EEXIST') {
				throw error;
			}
			await removeStaleLock(lockPath);
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for project state lock: ${path.basename(statePath)}`);
			}
			await sleep(LOCK_RETRY_DELAY_MS);
		}
	}
}

async function withProjectStateWriteLock(statePath, callback, options = {}) {
	const release = await acquireProjectStateLock(statePath, options);
	try {
		return await callback();
	}
	finally {
		await release();
	}
}

module.exports = {
	acquireProjectStateLock,
	withProjectStateWriteLock,
};
