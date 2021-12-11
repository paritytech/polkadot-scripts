export * from "./bags"
export * from "./election_score_stats"

import { ApiPromise } from "@polkadot/api";
import BN from "bn.js"

export async function nominatorThreshold(api: ApiPromise) {
	const DOT = 10000000000;
	const t = new BN(DOT).mul(new BN(80));
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
