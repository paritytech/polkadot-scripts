import "@polkadot/api-augment"
import { ApiPromise} from "@polkadot/api";
import { Percent } from "@polkadot/types/interfaces/"
import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { KeyringPair } from "@polkadot/keyring/types";
import { ISubmittableResult } from "@polkadot/types/types/"
import BN from "bn.js";
import { dryRun, sendAndFinalize } from "../helpers";

export async function chillOther(api: ApiPromise, account: KeyringPair, sendTx: boolean, noDryRun?: boolean, limit?: number) {
	const threshold = api.createType('Balance', (await api.query.staking.minNominatorBond())).toBn();
	const chillThreshold = (await api.query.staking.chillThreshold()).unwrapOrDefault();
	console.log(`📣 DOT threshold for chilling is ${api.createType('Balance', threshold).toHuman()}`);
	console.log(`📣 ratio threshold for chilling is ${chillThreshold.toHuman()}`);
	console.log(`📣 current status is ${await api.query.staking.counterForNominators()} / ${await api.query.staking.maxNominatorsCount()} nominators -- ${await api.query.staking.counterForValidators()} / ${await api.query.staking.maxValidatorsCount()} validators`);

	const transactions = await buildChillTxs(api, threshold, chillThreshold, limit)
	const batch = api.tx.utility.batchAll(transactions);

	if (noDryRun && sendTx) {
		const { success, included } = await sendAndFinalize(batch, account);
		console.log(`ℹ️ success = ${success}. Events = ${included}`)
	} else {
		const success = await dryRun(api, account, batch);
		if (success && sendTx) {
			const { success, included } = await sendAndFinalize(batch, account);
			console.log(`ℹ️ success = ${success}. Events =`)
			for (const ev of included) {
				process.stdout.write(`${ev.event.section}::${ev.event.method}`)
			}
		} else {
			console.log(`warn: dy-run failed. not submitting anything.`)
		}
	}
}

async function buildChillTxs(api: ApiPromise, threshold: BN, chillThreshold: Percent, maybeLimit?: number): Promise<SubmittableExtrinsic<"promise", ISubmittableResult>[]> {
	let allVotes = 0;
	const AllNominatorsRawPromise = (await api.query.staking.nominators.entries())
		.map(async ([stashKey, nomination]) => {
			const stash = api.createType('AccountId', stashKey.slice(-32));
			// all nominators should have a stash and ledger; qed.
			const ctrl = (await api.query.staking.bonded(stash)).unwrap()
			const ledger = (await api.query.staking.ledger(ctrl));
			const stake = ledger.unwrapOrDefault().active.toBn();
			allVotes += nomination.unwrapOrDefault().targets.length;
			return { ctrl, stake, ledger }
		})

	const allNominatorsRaw = await Promise.all(AllNominatorsRawPromise);
	const allNominators = allNominatorsRaw
		.filter( ({ ctrl, stake, ledger }) => {
			if (stake.isZero() && ledger.isNone) {
				console.log(`😱 ${ctrl} seems to have no ledger. This is a state bug.`);
				return false
			} else {
				return true
			}
		})

	// sort
	allNominators.sort((n1, n2) => n1.stake.cmp(n2.stake));
	// filter those that are below
	const toRemoveAll = allNominators.filter((n) => n.stake.lt(threshold));
	const ejectedStake = toRemoveAll
		.map(({ stake }) => stake)
		.reduce((prev, current) => prev = current.add(prev));

	const maxNominators = (await api.query.staking.maxNominatorsCount()).unwrapOrDefault();
	const minNominators = chillThreshold.mul(maxNominators).divn(100);
	const maxChillable = allNominators.length - minNominators.toNumber();
	console.log(`📊 a total of ${toRemoveAll.length} accounts with sum stake ${api.createType("Balance", ejectedStake).toHuman()} (from the ${allNominators.length} total and ${allVotes} votes) are below the nominator threshold..`)
	console.log(`\t.. which can be lowered to a minimum of ${minNominators} via chill..`)
	console.log(`\t.. thus ${Math.min(maxChillable, toRemoveAll.length)} can be chilled to stay below the ${chillThreshold.toHuman()} limit..`)

	// take some, or all
	const toRemoveFinal = maybeLimit === null ? toRemoveAll : toRemoveAll.slice(0, maybeLimit);
	console.log(`\t.. of which ${toRemoveFinal.length} will be removed in this execution.`)

	if (toRemoveFinal.length === 0) {
		throw Error("no one to chill. cannot build batch tx.")
	}

	return toRemoveFinal.map(({ ctrl, stake }) => {
		console.log(`will chill ${ctrl.toHuman()} with stake ${api.createType('Balance', stake).toHuman()}`);
		return api.tx.staking.chillOther(ctrl);
	});
}
