// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import {
	doRebagAll,
	nominatorThreshold,
	electionScoreStats,
	stakingStats,
	doRebagSingle,
	canPutInFrontOf,
  doPoolsWithdrawalAll
  //doPoolsWithdrawalSingle
} from './services';
import { getAccountFromEnvOrArgElseAlice, getApi, getAtApi } from './helpers';
import { reapStash } from './services/reap_stash';
import { chillOther } from './services/chill_other';
import { stateTrieMigration } from './services/state_trie_migration';

/// TODO: split this per command, it is causing annoyance.
export interface HandlerArgs {
	ws: string;
	sendTx?: boolean;
	count?: number;
	noDryRun?: boolean;
	target?: string;
	seed?: string;
	at?: string;

	itemLimit?: number;
	sizeLimit?: number;
}

export async function inFrontHandler({ ws, target }: HandlerArgs): Promise<void> {
	if (target === undefined) {
		throw 'target must be defined';
	}

	const api = await getApi(ws);
	await canPutInFrontOf(api, target);
}

export async function rebagHandler({ ws, sendTx, target, seed }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false';
	}
	if (target === undefined) {
		target = 'all';
	}

	function isNumeric(str: string) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		return !isNaN(str) && !isNaN(parseFloat(str));
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed);
	if (target == 'all') {
		console.log(`rebagging all accounts`);
		await doRebagAll(api, account, sendTx, Number.POSITIVE_INFINITY);
	} else if (isNumeric(target)) {
		const count = Number(target);
		console.log(`rebagging up to ${count} accounts`);
		await doRebagAll(api, account, sendTx, count);
	} else {
		console.log(`rebagging account ${target}`);
		await doRebagSingle(api, account, target, sendTx);
	}
}

export async function withdrawPoolsHandler({ws, sendTx, target, seed}: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false';
	}
	if (target === undefined) {
		target = 'all';
	}

	function isNumeric(str: string) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		return !isNaN(str) && !isNaN(parseFloat(str));
	}

  const api = await getApi(ws);

	const account = await getAccountFromEnvOrArgElseAlice(api, seed);

  if (target == 'all') {
     await doPoolsWithdrawalAll(api, account, sendTx, Number.POSITIVE_INFINITY);
  } else if (isNumeric(target)) {
    const count = Number(target);
    console.log(`withdraw from unbonded pools up to ${count} chunks`);
    // await doPoolsWithdrawalAll(api, account, sendTx, count);
  } else {
    console.log(`withdraw from unbonded pools for account ${target}`);
    // await doPoolsWithdrawalSingle(api, account, target, sendTx);
  }
}

export async function chillOtherHandler({
	ws,
	sendTx,
	count,
	noDryRun,
	seed
}: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false';
	}
	if (count === undefined) {
		count = -1;
	}
	if (noDryRun === undefined) {
		noDryRun = false;
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed);
	await chillOther(api, account, sendTx, noDryRun, count);
}

export async function nominatorThreshHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);
	await nominatorThreshold(api);
}

export async function electionScoreHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);

	const apiKey = process.env['API'] || 'DEFAULT_KEY';
	console.log(`using api key: ${apiKey}`);

	const chainName = await api.rpc.system.chain();
	await electionScoreStats(chainName.toString().toLowerCase(), api, apiKey);
}

export async function reapStashHandler({ ws, sendTx, count, seed }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false';
	}
	if (count === undefined) {
		count = -1;
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed);
	await reapStash(api, account, sendTx, count);
}

export async function stateTrieMigrationHandler({
	ws,
	seed,
	count,
	itemLimit,
	sizeLimit
}: HandlerArgs): Promise<void> {
	if (itemLimit === undefined || sizeLimit === undefined) {
		throw 'itemLimit and sizeLimit mut be set.';
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed);

	await stateTrieMigration(api, account, itemLimit, sizeLimit, count);
}

export async function stakingStatsHandler(args: HandlerArgs): Promise<void> {
	const api = await getAtApi(args.ws, args.at || '');
	const baseApi = await getApi(args.ws);
	await stakingStats(api, baseApi);
	// lastly, for the sake of completeness, call into the service that fetches the election score
	// medians.
	// await electionScoreHandler(args);
}

export async function playgroundHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);
	// const chain = (await api.rpc.system.chain()).toString().toLowerCase();
	// const limit = api.createType('Balance', chain == "polkadot" ? new BN(500 * Math.pow(10, 10)) : new BN(1 * Math.pow(10, 12)));
	// const lessPromise = (await api.query.staking.validators.keys())
	// 	.map((arg) => arg.args[0])
	// 	.map(async (stash) => {
	// 		const ctrl = await api.query.staking.bonded(stash);
	// 		const ledger = await api.query.staking.ledger(ctrl.unwrap());
	// 		const active = ledger.unwrap().active.toBn();
	// 		return active.lt(limit.toBn());
	// 	})
	// const less = (await Promise.all(lessPromise));
	// console.log(`num validators with less than ${limit.toHuman()}: ${less.filter(x => x).length} / ${(await api.query.staking.validators.keys()).length}`);

	// if (chain == "kusama") {
	// 	const all = (await api.query.staking.nominators.entries());
	// 	const more = all.map((x) => x[1]).map((n) => n.unwrapOrDefault().targets.length).filter((x) => x > 16);
	// 	console.log(`num nominators using more than 16 votes ${more.length} / ${all.length}`)
	// }

	const rangeStart = 100;
	let currentHash = await api.rpc.chain.getFinalizedHead();
	const ADDR = '0xasdasd';
	for (let x = rangeStart; x > rangeStart; x--) {
		const nonceAtBlock = (await api.query.system.account.at(currentHash, ADDR)).nonce;
		if (nonceAtBlock.eq(7)) {
			break;
		}
		// go to the parent block's hash and check that.
		const parentHash = (await api.rpc.chain.getBlock(currentHash)).block.header.parentHash;
		currentHash = parentHash;
	}
}
