// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import {
	doRebagAll,
	nominatorThreshold,
	electionScoreStats,
	stakingStats,
	doRebagSingle,
	canPutInFrontOf,
	runCommandCenter,
	NETWORK_CONFIGS
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
import { StorageKey } from "@polkadot/types/";


/// TODO: split this per command, it is causing annoyance.
export interface HandlerArgs {
	ws: string;
	ws2?: string;
	sendTx?: boolean;
	count?: number;
	noDryRun?: boolean;
	target?: string;
	seed?: string;
	at?: string;

	itemLimit?: number;
	sizeLimit?: number;

	// Command Center specific args
	rcUri?: string;
	ahUri?: string;
	network?: string;
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

function colorize(text: string, colorCode: string): string {
	return `\x1b[${colorCode}m${text}\x1b[0m`;
}

function bold(text: string): string {
	return `\x1b[1m${text}\x1b[0m`;
}

function boldColorize(text: string, colorCode: string): string {
	return `\x1b[1m\x1b[${colorCode}m${text}\x1b[0m`;
}

export async function commandCenterHandler({ rcUri, ahUri, network }: HandlerArgs): Promise<void> {
	let finalRcUri: string;
	let finalAhUri: string;

	// Handle network shorthands and explicit URIs
	if (network) {
		if (network in NETWORK_CONFIGS) {
			const config = NETWORK_CONFIGS[network as keyof typeof NETWORK_CONFIGS];
			finalRcUri = config.rcUri;
			finalAhUri = config.ahUri;
		} else {
			throw new Error(`Unknown network: ${network}. Supported networks: ${Object.keys(NETWORK_CONFIGS).join(', ')}`);
		}
	} else if (rcUri && ahUri) {
		finalRcUri = rcUri;
		finalAhUri = ahUri;
	} else {
		throw new Error('Either provide a network (westend/paseo) or both --rc-uri and --ah-uri');
	}

	console.log(`Starting command center with RC: ${finalRcUri}, AH: ${finalAhUri}`);

	// Run the command center
	await runCommandCenter(finalRcUri, finalAhUri);
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

export async function isExposed(ws: string, stash: string): Promise<void> {
	const api = await getApi(ws);
	const balance = (x: BN) => api.createType('Balance', x).toHuman();
	const era = (await api.query.staking.currentEra()).unwrap();
	console.log(`era: ${era}`);
	const overviews = (await api.query.staking.erasStakersOverview.entries(era)).map(([key, value]) => {
		const stash = key.args[1].toHuman();
		const metadata = value.unwrap();
		return { stash, metadata }
	});
	console.log(`MaxExposurePageSize: ${api.consts.staking.maxExposurePageSize}`);
	console.log(`overviews/exposed validators: ${overviews.length}`);
	for (let overview of overviews) {
		console.log(`stash: ${overview.stash}, page_count: ${overview.metadata.pageCount.toNumber()}, nominators: ${overview.metadata.nominatorCount.toNumber()}`);
	}
	const sumNominators = overviews.map(({ metadata }) => metadata.nominatorCount.toNumber()).reduce((a, b) => a + b, 0);
	console.log(`sumNominators: ${sumNominators}`);

	// find them in the bags-list
	console.log(`searching for ${stash} in the bags-list`);
	const node = await api.query.voterList.listNodes(stash);
	if (node.isSome) {
		const nodeData = node.unwrap();
		console.log(`found in bags-list: ${nodeData.toString()}`);
		console.log(`score: ${balance(nodeData.score)}`);
		console.log(`bagUpper: ${balance(nodeData.bagUpper)}`);
	} else {
		console.log(`not found in bags-list`);
	}

	// search for stash in all pages of the exposure in the current era.
	const all_exposures = [];
	for (let overview of overviews) {
		for (let page = 0; page < overview.metadata.pageCount.toNumber(); page++) {
			let page_exposure = (await api.query.staking.erasStakersPaged(era, overview.stash, page)).unwrap();
			let backing = page_exposure.others.find((x) => {
				return x.who.toString() == stash
			});
			all_exposures.push(backing);
		}
	}

	all_exposures.forEach((exposure) => {
		if (exposure) {
			console.log(`stash: ${exposure.who.toString()}, exposure: ${exposure.value.toString()}`);
		}
	});
}

export async function ExposureStats({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);

	const era = (await api.query.staking.currentEra()).unwrap();
	const overviews = (await api.query.staking.erasStakersOverview.entries(era)).map(([key, value]) => {
		const stash = key.args[1].toHuman();
		const metadata = value.unwrap();
		return { stash, metadata }
	});
	console.log(`overviews/exposed validators: ${overviews.length}`);
	const sumNominators = overviews.map(({ metadata }) => metadata.nominatorCount.toNumber()).reduce((a, b) => a + b, 0);
	console.log(`sumNominators: ${sumNominators}`);
}

export async function controllerStats({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);
	const bonded = await api.query.staking.bonded.entries();

	let same = 0;
	let different = 0;
	for (const [key, value] of bonded) {
		const stash = key.args[0].toHuman();
		const ctrl = value.unwrap().toHuman();
		if (stash == ctrl) {
			same += 1
		}
		else {
			different += 1
		}
	}
	console.log(`bonded: same=${same}, different=${different}`)
}

export async function playgroundHandler(args: HandlerArgs): Promise<void> {
	// Placeholder for playground functionality
	console.log('Playground handler called with args:', args);
}
