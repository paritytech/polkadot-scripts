export * from "./bags"
export * from "./election_score_stats"

import { ApiPromise } from "@polkadot/api";
import BN from 'bn.js';
import { AccountId32} from '@polkadot/types/interfaces';
import { PalletStakingIndividualExposure } from '@polkadot/types/lookup'
import "@polkadot/api-augment"

export async function nominatorThreshold(api: ApiPromise) {
	const DOT = 10000000000;
	const t = new BN(DOT).mul(new BN(140));
	const np = (await api.query.staking.nominators.entries()).map(async ([sk]) => {
		const stash = sk.args[0]
		// all nominators must have a controller
		const c = (await api.query.staking.bonded(stash)).unwrap();
		// all controllers must have ledger.
		const stake = (await api.query.staking.ledger(c)).unwrap().total.toBn();
		return { stash, stake }
	});

	const n = await Promise.all(np);
	console.log(`${n.filter(({ stake }) => stake.lt(t)).length} stashes are below ${api.createType('Balance', t).toHuman()}`);
}

export async function stakingStats(api: ApiPromise) {
	const b = (x: BN): string => api.createType('Balance', x).toHuman()
	const stakeOf = async (stash: string) => {
		// all stashes must have a controller ledger, and a ledger.
		const controller = (await api.query.staking.bonded(stash)).unwrap();
		const stake = (await api.query.staking.ledger(controller)).unwrap().active.toBn();
		return stake
	}
	/// Returns the minimum in the entire bags list.
	const traverseNominatorBags = async (until: number): Promise<[AccountId32, number]> => {
		const bagThresholds = api.consts.bagsList.bagThresholds.map((x) => api.createType('Balance', x));
		let taken = 0;
		let next: AccountId32 = api.createType('AccountId', []);
		for (const threshold of bagThresholds.reverse()) {
			const maybeBag = await api.query.bagsList.listBags(threshold.toBn());
			let reached = false;
			if (maybeBag.isSome && maybeBag.unwrap().head.isSome) {
				const head = maybeBag.unwrap().head.unwrap();
				next = head;
				let cond = true;
				while (cond) {
					const nextNode = await api.query.bagsList.listNodes(next);
					if (nextNode.isSome && nextNode.unwrap().next.isSome) {
						next = nextNode.unwrap().next.unwrap();
						taken += 1;
						if (taken > until) { cond = false; reached = true }
					} else {
						cond = false
					}
				}
			}

			if (reached) { break }
		}

		return [next, taken]
	}

	// a map from all nominators to their total stake.
	const assignments: Map<string, BN> = new Map();
	const currentEra = (await api.query.staking.currentEra()).unwrap();
	const stakers = await api.query.staking.erasStakers.entries(currentEra);
	stakers.sort((a, b) => a[1].total.toBn().cmp(b[1].total.toBn()))

	stakers.map((x) => x[1].others).flat(1).forEach((x) => {
		const nominator = (x as PalletStakingIndividualExposure).who.toString();
		const amount = (x as PalletStakingIndividualExposure).value;
		const val = assignments.get(nominator);
		assignments.set(nominator, val ? amount.toBn().add(val) : amount.toBn())

	})

	const [minNominatorInBags] = await traverseNominatorBags(api.consts.electionProviderMultiPhase.voterSnapshotPerBlock.toNumber());

	// nominator stake
	{
		const minIntentionThreshold = await api.query.staking.minNominatorBond();
		const minElectingThreshold = await stakeOf(minNominatorInBags.toString());

		const nominatorStakes = Array.from(assignments);
		nominatorStakes.sort((a, b) => a[1].cmp(b[1]));
		const minActiveThreshold = nominatorStakes[0][1];
		console.log(`nominator stake: min-intention-threshold: ${b(minIntentionThreshold)} / min-electing = ${b(minElectingThreshold)} / min-active: ${b(minActiveThreshold)}`)
	}

	// nominator count
	{
		const intentionCount = await api.query.staking.counterForNominators();
		const electingCount = assignments.size;
		const activeCount = assignments.size;

		const intentionMax = await api.query.staking.maxNominatorsCount();
		const electingMax = api.consts.electionProviderMultiPhase.voterSnapshotPerBlock;
		const activeMax = electingMax;

		console.log(`nominator count: intentions: ${intentionCount} / electing: ${electingCount} / active: ${activeCount}`)
		console.log(`nominator count: max intention: ${intentionMax} / max electing ${electingMax} / max active: ${activeMax} `)
	}

	// validator stake
	{
		const minIntentionThreshold = await api.query.staking.minValidatorBond();

		// as of now, all validator intentions become electable, so the threshold is the same.
		const minElectableThreshold = minIntentionThreshold;

		const minActiveThreshold = stakers[0][1].total.toBn();
		console.log(`validator stake: min-intention-threshold: ${b(minIntentionThreshold)} / min-electing: ${b(minElectableThreshold)} / min-active: ${b(minActiveThreshold)}`)
	}

	// validator count
	{
		const intentionCount = await api.query.staking.counterForValidators();
		const electableCount = intentionCount;
		const activeCount = stakers.length;

		const intentionMax = await api.query.staking.maxValidatorsCount();
		const electableMax = await api.query.staking.maxValidatorsCount();
		const activeMax = await api.query.staking.validatorCount();

		console.log(`validator count: intentions: ${intentionCount} / electable: ${electableCount} / active: ${activeCount}`)
		console.log(`validator count: max intention: ${intentionMax} / max electable: ${electableMax} / max active: ${activeMax} `)
	}
}
