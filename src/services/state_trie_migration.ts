import { Option,  } from "@polkadot/types/"
import { ApiPromise } from "@polkadot/api";
import { dryRun, sendAndFinalize } from "../helpers";
import { KeyringPair } from "@polkadot/keyring/types";
import { strict as assert } from "assert/strict"
import BN from "bn.js";

export async function stateTrieMigration(api: ApiPromise, account: KeyringPair, itemLimit: number, sizeLimit: number, count?: number) {
	api.registerTypes({
		MigrationLimits: {
			"size": "U32",
			"item": "U32"
		}
	})
	const maxLimits = api.consts.stateTrieMigration.signedMigrationMaxLimits;
	assert(
		// @ts-ignore
		maxLimits["size_"].gte(new BN(sizeLimit)) && maxLimits["item"].gte(new BN(itemLimit)),
		`cli limits more than maximum: max ${maxLimits.toString()}, cli: ${itemLimit} / ${sizeLimit}`,
	);

	async function tryWithBackOff() {
		let div = 1;
		while (true) {
			const limits = { item: itemLimit / div, size: sizeLimit };
			const sizeUpperLimit = sizeLimit * 2;
			const currentTask = await api.query.stateTrieMigration.migrationProcess();
			// we hope this won't fail, but it might.
			const tx = api.tx.stateTrieMigration.continueMigrate(limits, sizeUpperLimit, currentTask);

			const [success, dryRunOutcome]  = await dryRun(api, account, tx);
			console.log(`🌵 dry-run of transaction: success = ${success} ${dryRunOutcome.asOk.toString()}`)
			if (success) {
				const submitResult = await sendAndFinalize(tx, account);
				if (submitResult.success) {
					submitResult.included
						.filter((e) => e.event.method.toLowerCase().includes("migrate"))
						.forEach((e) => console.log(`\t🎤 ${e.event.toString()}`));
					break;
				} else {
					console.log(`despite Dry-running, transaction failed. Aborting`);
					throw "Can't even migrate one storage key. This probably means that this transaction failed to pass relay chain PoV limit. Script needs to run again with different params. Aborting";
				}
			} else if (dryRunOutcome.isOk && dryRunOutcome.asOk.isErr && dryRunOutcome.asOk.asErr.isModule && dryRunOutcome.asOk.asErr.asModule.error.eq(3)) {
				// oh beautiful ts.. you make my heart smile^^..anyways: error index 3 is
				// `SizeUpperBoundExceeded`, which means the number of items that we trie to migrate
				// next failed the 2x size limit. If auto-scale is set to true, we halve the number
				// of items in our limit and retry, else we halt.
				div *= 2;
				console.log(`🖖 halving the number of items to migrate from ${itemLimit} to ${itemLimit / div}`)
				if (itemLimit / div < 1) {
					// NOTE: if you reach this point, it probably means that the next key(s) that
					// need to be migrated have a rather large size, such that `sizeUpperLimit =
					// sizeLimit * 2` is not enough to cover them. Re-run this script with a higher
					// --item-limit argument, and be careful: if you mess this up, you could get
					// slashed. Luckily, we always dryRun the transaction beforehand, which makes it
					// more unlikely, so, you're welcome.
					throw "Can't even migrate one storage key. Aborting";
				}
			} else {
				throw "unexpected error in dry-run. Aborting."
			}
		}
	}

	function isFinished(task: any): boolean {
		// @ts-ignore
		const currentTop: Option<Uint8Array> = task["currentTop"];
		// @ts-ignore
		const currentChild: Option<Uint8Array> = task["currentChild"];
		return currentTop.isNone && currentChild.isNone
	}

	let init = false;
	let currentTask = await api.query.stateTrieMigration.migrationProcess();
	let migrated = 0;
	while(!init || !isFinished(currentTask)) {
		console.log(`\n🎬 current task is ${currentTask.toString()}`)
		init = true;
		const preBalance = (await api.query.system.account(account.address)).data.free;
		await tryWithBackOff();
		const postBalance = (await api.query.system.account(account.address)).data.free;
		console.log(`💸 spent ${postBalance.sub(preBalance)} on submission`)
		currentTask = await api.query.stateTrieMigration.migrationProcess();
		migrated += 1;
		if (count && migrated >= count) {
			console.log(`🛑 reached count limit ${count}`);
			break;
		}
	}

}
