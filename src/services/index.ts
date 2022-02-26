export * from "./bags"
export * from "./election_score_stats"

import { ApiPromise } from "@polkadot/api";
import BN from 'bn.js';
import { AccountId32 } from '@polkadot/types/interfaces';
import {  PalletStakingIndividualExposure } from '@polkadot/types/lookup'

export async function nominatorThreshold(api: ApiPromise) {
	const DOT = 10000000000;
	const t = new BN(DOT).mul(new BN(140));
	const np = (await api.query.staking.nominators.entries()).map(async ([sk, _]) => {
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

	// a map from all nominators to their total stake.
	const assignments: Map<AccountId32, BN> = new Map();
	const currentEra = (await api.query.staking.currentEra()).unwrap();
	const stakers = await api.query.staking.erasStakers.entries(currentEra);
	stakers.map((x) => x[1].others).flat(1).forEach((x) => {
		const nominator = (x as PalletStakingIndividualExposure).who;
		const amount = (x as PalletStakingIndividualExposure).value;
		const val = assignments.get(nominator)
		assignments.set(nominator, val ? amount.toBn().add(val) : amount.toBn())
	})

	// nominator stake
	{
		const threshold = await api.query.staking.minNominatorBond();
		const stakes = Array.from(assignments.values());
		stakes.sort((a, b) => a.cmp(b));
		const min = stakes[0];
		console.log(`nominator stake: threshold: ${b(threshold)} / min: ${b(min)}`)
	}

	// nominator count
	{
		const active = Array.from(assignments.keys()).length
		const total = await api.query.staking.maxNominatorsCount();
		console.log(`nominator count: active: ${active} / total: ${total}`)
	}

	// validator stake
	{
		const threshold = await api.query.staking.minValidatorBond();
		const stakes = stakers.map((x) => x[1].total.toBn());
		stakes.sort((a, b) => a.cmp(b));
		const minTotal = stakes[0];
		const selfStakes = stakers.map((x) => x[1].own.toBn());
		selfStakes.sort((a, b) => a.cmp(b));
		const minSelf = selfStakes[0];
		console.log(`validator stake: threshold: ${b(threshold)} / minTotal: ${b(minTotal)} / minSelf ${b(minSelf)}`)
	}

	// validator count
	{
		const total = await api.query.staking.maxValidatorsCount();
		console.log(`validator count: active: ${stakers.length} / total: ${total}`)
	}
}
