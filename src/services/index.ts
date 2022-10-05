import { ApiPromise } from "@polkadot/api";
import BN from 'bn.js';
import { AccountId32} from '@polkadot/types/interfaces';
import { PalletStakingIndividualExposure } from '@polkadot/types/lookup'
import "@polkadot/api-augment/polkadot"
import { ApiDecoration } from "@polkadot/api/types";

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

export async function stakingStats(api: ApiDecoration<"promise">, baseApi: ApiPromise) {
	// Hack to make things work for now.
	const b = (x: BN): string => baseApi.createType('Balance', x).toHuman()
	const stakeOf = async (stash: string) => {
		// all stashes must have a controller ledger, and a ledger.
		const controller = (await api.query.staking.bonded(stash)).unwrap();
		const stake = (await api.query.staking.ledger(controller)).unwrap().active.toBn();
		return stake
	}
	/// Returns the minimum in the entire bags list.
	const traverseNominatorBags = async (until: number): Promise<[AccountId32, number]> => {
		const bagThresholds = api.consts.voterList.bagThresholds.map((x) => baseApi.createType('Balance', x));
		let taken = 0;
		let next: AccountId32 = baseApi.createType('AccountId', []);
		for (const threshold of bagThresholds.reverse()) {
			const maybeBag = await api.query.voterList.listBags(threshold.toBn());
			let reached = false;
			if (maybeBag.isSome && maybeBag.unwrap().head.isSome) {
				const head = maybeBag.unwrap().head.unwrap();
				next = head;
				let cond = true;
				while (cond) {
					const nextNode = await api.query.voterList.listNodes(next);
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


	const [minNominatorInBags] =
		api.consts.electionProviderMultiPhase.maxElectingVoters ?
			await traverseNominatorBags(api.consts.electionProviderMultiPhase.maxElectingVoters.toNumber()) :
			Array.from(assignments).sort()[0]

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

	// misc stake related stuff
	{
		const totalIssuance = await api.query.balances.totalIssuance();
		const totalActiveStake = await api.query.staking.erasTotalStake(currentEra);

		const validatorTotalStake =
			(await Promise.all(
				(await api.query.staking.validators.entries())
					.map(async ([validator, _prefs]) => await stakeOf(validator.args[0].toString()))
			)).reduce((acc, x) => acc = acc.add(x))
		const validatorActiveStake = stakers.map((x) => x[1].own.toBn()).reduce((acc, x) => acc = acc.add(x))
		const nominatorTotalStake =
			(await Promise.all(
				(await api.query.staking.nominators.entries())
					.map(async ([nominator, _target]) => await stakeOf(nominator.args[0].toString()))
			)).reduce((acc, x) => acc = acc.add(x));
		const nominatorActiveStake = Array.from(assignments.values()).reduce((acc, x) => acc = acc.add(x));
		const totalStaked = validatorTotalStake.add(nominatorTotalStake);
		console.log(`total issuance ${b(totalIssuance)} / staked ${b(totalStaked)} (${totalStaked.mul(new BN(100)).div(totalIssuance)}%) / active staked ${b(totalActiveStake)} (${totalActiveStake.mul(new BN(100)).div(totalIssuance)}%)`)
		console.log(`validator total stake = ${b(validatorTotalStake)} / validatorActiveStake = ${b(validatorActiveStake)}`)
		console.log(`nominator total stake = ${b(nominatorTotalStake)} / validatorActiveStake = ${b(nominatorActiveStake)}`)
	}
}

export * from "./bags"
export * from "./election_score_stats"
export * from "./chill_other"
export * from  "./reap_stash"
export * from  "./state_trie_migration"
