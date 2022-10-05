import { SlashingSpans } from '@polkadot/types/interfaces/staking';
import { Option } from '@polkadot/types/';
import { ApiPromise } from '@polkadot/api';
import { dryRun, sendAndFinalize } from '../helpers';
import { KeyringPair } from '@polkadot/keyring/types';

export async function reapStash(
	api: ApiPromise,
	account: KeyringPair,
	sendTx: boolean,
	txCount: number
) {
	const ED = await api.consts.balances.existentialDeposit;
	console.log(`💸 ED = ${ED.toHuman()}`);
	const ledgers = await api.query.staking.ledger.entries();
	let count = 0;
	let stale = 0;

	const transformSpan = (optSpans: Option<SlashingSpans>): number =>
		optSpans.isNone ? 0 : optSpans.unwrap().prior.length + 1;

	const toReap = [];
	for (const [ctrl, ledger] of ledgers) {
		const total = ledger.unwrapOrDefault().total;
		count += 1;
		const stash = ledger.unwrapOrDefault().stash;
		const maybeBonded = await api.query.staking.bonded(stash);
		if (total.toBn().lt(ED) && maybeBonded.isSome) {
			stale += 1;
			toReap.push(stash);
			console.log(
				`🎣 ${ctrl.args[0] ? ctrl.args[0] : ctrl} is stale. ledger.total=${api
					.createType('Balance', total)
					.toHuman()}.`
			);
		} else if (maybeBonded.isNone) {
			console.log(
				`❌ controller ${ctrl.args[0]} seems to have a ledger ${ledger}, but not linked via Bonded to its stash ${stash}`
			);
		}

		if (txCount > -1 && stale >= txCount) {
			break;
		}
	}

	const tx = api.tx.utility.batchAll(
		await Promise.all(
			toReap.map(async (s) =>
				api.tx.staking.reapStash(s, transformSpan(await api.query.staking.slashingSpans(s)))
			)
		)
	);

	console.log(`${stale} (stale) / ${count} (total examined)`);

	const [success, result] = await dryRun(api, account, tx);
	if (success && sendTx) {
		const { success, included } = await sendAndFinalize(tx, account);
		console.log(`ℹ️ success = ${success}. Events =`);
		for (const ev of included) {
			process.stdout.write(`${ev.event.section}::${ev.event.method}`);
		}
	} else if (!success) {
		console.log(`warn: dy-run failed.`, result.asOk.toString());
	} else {
		console.log('no reap-stash batch tx sent');
	}
}
