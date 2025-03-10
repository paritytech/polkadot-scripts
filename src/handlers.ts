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
import { ApiDecoration, SubmittableExtrinsic } from '@polkadot/api/types';
import { ApiPromise } from '@polkadot/api';
import { locale } from 'yargs';
import { AccountId } from "@polkadot/types/interfaces"
import { PalletStakingRewardDestination } from "@polkadot/types/lookup"
import { Vec, U8, StorageKey, Option } from "@polkadot/types/"
import { signFakeWithApi, signFake } from '@acala-network/chopsticks-utils'
import { sign } from 'crypto';


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
	console.log(args);
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

export async function fakeSignForChopsticks(api: ApiPromise, sender: string | AccountId, tx: SubmittableExtrinsic<'promise'>): Promise<void> {
	const account = await api.query.system.account(sender)
	const options = {
		nonce: account.nonce,
		genesisHash: api.genesisHash,
		runtimeVersion: api.runtimeVersion,
		blockHash: api.genesisHash,
	};
	const mockSignature = new Uint8Array(64)
	mockSignature.fill(0xcd)
	mockSignature.set([0xde, 0xad, 0xbe, 0xef])
	tx.signFake(sender, options)
	tx.signature.set(mockSignature)
}

export async function playgroundHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);
	const stakers = await api.query.staking.ledger.entries();
	const overstaked = []
	for (const [key, staker] of stakers) {
		const total = staker.unwrap().total;
		const stash = staker.unwrap().stash;
		const locked = await api.query.balances.locks(stash);
		const stash_account = await api.query.system.account(stash);
		const stash_free = stash_account.data.free;
		const staking_locks = locked.filter(lock => lock.id.toString().trim() == '0x7374616b696e6720');

		if (staking_locks.length != 1) {
			console.log(`Staker ${stash} has ${staking_locks.length} staking locks, free: ${stash_free}`);
			overstaked.push({ staker: staker.unwrap(), locked: null, free: stash_free });
			continue
		}

		const staking_lock = staking_locks[0];

		if (staking_lock.amount.toBigInt() != total.toBigInt() || stash_free.toBigInt() < total.toBigInt()) {
			console.log(`Stash: ${stash}, Total: ${total}, Locked: ${staking_lock.amount}, free: ${stash_free}, diff: ${(total.toBigInt() - stash_free.toBigInt()) / BigInt(10e12)}`);
			overstaked.push({ staker: staker, locked: staking_lock.amount, free: stash_free });
		}
	}

	console.log(overstaked.length)
}
