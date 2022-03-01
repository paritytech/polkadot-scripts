export * from "./bags"
export * from "./election_score_stats"

import { ApiPromise } from "@polkadot/api";
import BN from 'bn.js';
import { AccountId32 } from '@polkadot/types/interfaces';
import {  PalletStakingIndividualExposure } from '@polkadot/types/lookup'

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
	const stakeOf = async (stash: AccountId32) => {
		// all stashes must have a controller ledger, and a ledger.
		const controller = (await api.query.staking.bonded(stash)).unwrap();
		const stake = (await api.query.staking.ledger(controller)).unwrap().total.toBn();
		return stake
	}

	// a map from all nominators to their total stake.
	const assignments: Map<AccountId32, BN> = new Map();
	const currentEra = (await api.query.staking.currentEra()).unwrap();
	const stakers = await api.query.staking.erasStakers.entries(currentEra);
	stakers.sort((a, b) => a[1].total.toBn().cmp(b[1].total.toBn()))

	stakers.map((x) => x[1].others).flat(1).forEach((x) => {
		const nominator = (x as PalletStakingIndividualExposure).who;
		const amount = (x as PalletStakingIndividualExposure).value;
		const val = assignments.get(nominator)
		assignments.set(nominator, val ? amount.toBn().add(val) : amount.toBn())
	})

	// nominator stake
	{
		const minIntentionThreshold = await api.query.staking.minNominatorBond();

		let minWaitingThreshold = new BN(0)
		const snapshot = (await api.query.electionProviderMultiPhase.snapshot());
		if (snapshot.isSome) {
			const voters = snapshot.unwrap().voters;
			voters.sort((a, b) => a[1].cmp(b[1]));
			minWaitingThreshold = api.createType('Balance', voters[0]);
		}

		const stakes = Array.from(assignments.values());
		stakes.sort((a, b) => a.cmp(b));
		const minExposedThreshold = stakes[0];
		console.log(`nominator stake: min-intention-threshold: ${b(minIntentionThreshold)} / min-waiting-threshold: ${b(minWaitingThreshold)} / min-exposed-threshold: ${b(minExposedThreshold)}`)
	}

	// nominator count
	{
		const intentionCount = await api.query.staking.counterForNominators();
		let waitingCount = 0;
		const snapshot = (await api.query.electionProviderMultiPhase.snapshot());
		if (snapshot.isSome) {
			waitingCount = snapshot.unwrap().voters.length;
		}
		const exposedCount = assignments.size;

		const intentionMax = await api.query.staking.maxNominatorsCount();
		const waitingMax = api.consts.electionProviderMultiPhase.voterSnapshotPerBlock;
		const exposedMax = waitingMax;

		console.log(`nominator count: intentions ${intentionCount} / waiting ${waitingCount} / exposed: ${exposedCount}`)
		console.log(`nominator count: intention max: ${intentionMax} / waiting max ${waitingMax} / exposed max: ${exposedMax} `)
	}

	// validator stake
	{
		const minIntentionThreshold = await api.query.staking.minValidatorBond();

		// NOTE: this needs to be fetched from the snapshot, but since the actual stake is not
		// recorded in the snapshot, we make a best effort at fetching their stake NOW, which might
		// be slightly different than what is recorded in the snapshot.
		let minWaitingThreshold = new BN(0);
		const snapshot = (await api.query.electionProviderMultiPhase.snapshot());
		if (snapshot.isSome) {
			interface Target {
				stake: BN,
				who: AccountId32,
			}
			const targetsAndStake: Target[] = await Promise.all(snapshot.unwrap().targets.map(async (t) => {
				return { who: t, stake: await stakeOf(t) }
			}));
			targetsAndStake.sort((a, b) => a.stake.cmp(b.stake));
			minWaitingThreshold = targetsAndStake[0].stake;
		}

		const minExposedThreshold = stakers[0][1].total.toBn();
		console.log(`validator stake:min-intention-threshold: ${b(minIntentionThreshold)} / min-waiting-threshold: ${b(minWaitingThreshold)} / min-exposed-threshold: ${b(minExposedThreshold)}`)
	}

	// validator count
	{
		const intentionCount = await api.query.staking.counterForValidators();
		let waitingCount = 0;
		const snapshot = (await api.query.electionProviderMultiPhase.snapshot());
		if (snapshot.isSome) {
			waitingCount = snapshot.unwrap().targets.length;
		}
		const exposedCount = stakers.length;

		const intentionMax = await api.query.staking.maxValidatorsCount();
		const waitingMax = await api.query.staking.maxValidatorsCount();
		const exposedMax = await api.query.staking.validatorCount();

		console.log(`validator count: intentions ${intentionCount} / waiting ${waitingCount} / exposed: ${exposedCount}`)
		console.log(`validator count: intention max: ${intentionMax} / waiting max ${waitingMax} / exposed max: ${exposedMax} `)
	}

	console.log(`
**Definitions**:

The staking election system follows a 3 step system for both validator and nominators, namely "intention", "waiting", and "active".

- intending to validate: an account that has stated the intention to validate. also called, simply "validate".
- waiting validator: a validator who is selected to be a part of the NPoS election. This selection can be based on different criteria, usually stake and done via the "bags-list" pallet.
- active validator: a validator who came out of the NPoS election as a winner, consequently earning rewards, and being exposed to slashing.

- intending to nominate: an account that has stated the intention to nominate. also called, simply "nominator".
- waiting nominator: a nominator who is selected to be a part of the NPoS election. This selection can be based on different criteria, usually stake and done via the "bags-list" pallet.
- active nominator: a nominator who came out of the NPoS election backing an active validator, sharing their reward ane being exposed to their slash.

Thus,

- for nominator counters, we have:
	1. count of intentions aka nominator, and maximum possible intentions.
	2. count of waiting nominators, and maximum possible waiting nominators.
	3. count of active nominators, and maximum possible active nominators.

- for nominator stake, we have:
	1. min-intention-threshold: minimum stake to declare the intention to nominate.
	2. min-waiting-threshold: minimum stake to be part of the waiting set.
	3. min-exposed-threshold: minimum stake to be exposed.

Similarly,

- for validator counters we have:
	1. count of intentions aka validators, and maximum possible intentions.
	2. count of waiting nominators, and maximum possible waiting nominators.
	3. count of active nominators, and maximum possible active nominators.

- for validator stake, we have:
	1. min-intention-threshold: minimum (self) stake to declare intention.
	2. min-waiting-threshold: minimum (self) stake to be part of the waiting set.
	3. min-exposed-threshold: minimum (total) stake to be exposed.

With the only exception that a validator has two types of stake: self stake and total stake. In the first two steps, their total stake is unknown. In the last step, but the total stake and self stake is known.
By default, we mean self stake in the first two steps, and total stake in the third.
`)
}
