// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import {
	doRebagAll,
	nominatorThreshold,
	electionScoreStats,
	stakingStats,
	doRebagSingle,
	canPutInFrontOf
} from './services';
import { binarySearchStorageChange, getAccountFromEnvOrArgElseAlice, getApi, getAtApi } from './helpers';
import { reapStash } from './services/reap_stash';
import { chillOther } from './services/chill_other';
import { stateTrieMigration } from './services/state_trie_migration';
import BN from 'bn.js';
import { ApiDecoration } from '@polkadot/api/types';
import { ApiPromise } from '@polkadot/api';
import { locale } from 'yargs';
import { AccountId } from "@polkadot/types/interfaces"
import { Vec, U8, StorageKey, Option } from "@polkadot/types/"

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
	const atApi = await getAtApi(ws, (await api.rpc.chain.getFinalizedHead()).toString())
	await reapStash(atApi, api, account, sendTx, count);
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

export async function scrapePrefixKeys(prefix: string, api: ApiPromise): Promise<string[]> {
	let lastKey = null
	const keys: string[] = [];
	while (true) {
		const pageKeys: any = await api.rpc.state.getKeysPaged(prefix, 1000, lastKey);
		keys.push(...pageKeys.map((k: StorageKey) => k.toHex()));
		if (pageKeys.length < 1000) {
			break;
		}
		lastKey = pageKeys[pageKeys.length - 1].toHex()
	}

	return keys
}

export async function playgroundHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);

	// block when the account staked --should have correct ledger in here.
	const low =  new BN(1515158);
	// fairly recent block, but before Ankan's sudo.
	const high = new BN(18145115);
	const getter = async (api: ApiDecoration<"promise">) => {
		const ledger = await api.query.staking.ledger("5G3rej8vFLEMVcJPeMBnaxRBATtPEj3cXkSPDT2iEgbkMgbs");
		return ledger.unwrapOrDefault().total.toBn();
	}
	const target = (t: BN): boolean => !t.isZero();
	await binarySearchStorageChange( { ws }, low, high, target, getter);

	// const threshold = new BN(100).mul(new BN(10).pow(new BN(10))); // 100 DOT
	// const nominators = (await api.query.staking.nominators.entries()).map(([n, _]) => n.args[0]);
	// console.log(nominators.length)
	// const chilled = await Promise.all(nominators.map(async (n) => {
	// 	const controller = (await api.query.staking.bonded(n)).unwrap();
	// 	const ledger = (await api.query.staking.ledger(controller)).unwrap();
	// 	return ledger.active.toBn().lt(threshold)
	// }));
	// console.log(chilled.filter((x) => x).length)
}
