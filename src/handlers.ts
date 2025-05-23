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
import { binarySearchStorageChange, getAccount, getAccountFromEnvOrArgElseAlice, getApi, getAtApi, sendAndFinalize } from './helpers';
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
import { u8aToHex, numberToHex } from "@polkadot/util"
import { signFakeWithApi, signFake } from '@acala-network/chopsticks-utils'
import { IEvent, IEventData, Observable } from '@polkadot/types/types';
import UpdateManager from 'stdout-update';


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

export async function commandCenterHandler(): Promise<void> {
	const rcApi = await getApi("ws://localhost:9945");
	const ahApi = await getApi("ws://localhost:9946");

	const manager = UpdateManager.getInstance();
	// manager.hook();

	let rcOutput: string[] = []
	let ahOutput: string[] = []
	const rcEvents: string[] = []
	const ahEvents: string[] = []


	rcApi.rpc.chain.subscribeFinalizedHeads(async (header) => {
		// --- RC:
		// current session index
		const index = await rcApi.query.session.currentIndex();
		// whether the session pallet has a queued validator set within it
		const hasQueuedInSession = await rcApi.query.session.queuedChanged();
		// the range of historical session data that we have in the RC.
		const historicalRange = await rcApi.query.historical.storedRange();


		// whether there is a validator set queued in ah-client. for this we need to display only the id and the length of the set.
		const hasQueuedInClient = await rcApi.query.stakingNextAhClient.validatorSet();
		// whether we have already passed a new validator set to session, and therefore in the next session rotation we want to pass this id to AH.
		const hasNextActiveId = await rcApi.query.stakingNextAhClient.nextSessionChangesValidators();
		// whether the AhClient pallet is blocked or not, useful for migration signal from the fellowship.
		const isBlocked = await rcApi.query.stakingNextAhClient.isBlocked();

		// Events that we are interested in from RC:
		const eventsOfInterest = (await rcApi.query.system.events())
			.map((e) => e.event)
			.filter((e) => {
				const ahClientEvents = (e: IEventData) => e.section == 'stakingNextAhClient';
				const sessionEvents = (e: IEventData) => e.section == 'session' || e.section == 'historical';
				return ahClientEvents(e.data) || sessionEvents(e.data);
			})
			.map((e) => `${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`);
		rcEvents.push(...eventsOfInterest);
		rcOutput = [
			`RC:`,
			`finalized block ${header.number}`,
			`RC.session: index=${index}, hasQueuedInSession=${hasQueuedInSession}, historicalRange=${historicalRange}`,
			`RC.stakingNextAhClient: hasQueuedInClient=${hasQueuedInClient}, hasNextActiveId=${hasNextActiveId}, isBlocked=${isBlocked}`,
			`RC.events: ${rcEvents}`,
			`----`
		]

		manager.update(rcOutput.concat(ahOutput))
	})

	// AH:
	ahApi.rpc.chain.subscribeFinalizedHeads(async (header) => {
		// the current planned era
		const currentEra = await ahApi.query.staking.currentEra();
		// the active era
		const activeEra = await ahApi.query.staking.activeEra();
		// the starting index of the active era
		const erasStartSessionIndex = await ahApi.query.staking.erasStartSessionIndex(activeEra.unwrap().index)

		// the basic state of the election provider
		const phase = await ahApi.query.multiBlock.currentPhase();
		const round = await ahApi.query.multiBlock.round();
		const snapshotRange = (await ahApi.query.multiBlock.pagedVoterSnapshotHash.entries()).map(([k, v]) => k.args[0]).sort();
		const queuedScore = await ahApi.query.multiBlockVerifier.queuedSolutionScore();
		const signedSubmissions = await ahApi.query.multiBlockSigned.sortedScores(round);

		// Events that we are interested in from RC:
		const eventsOfInterest = (await ahApi.query.system.events())
			.map((e) => e.event)
			.filter((e) => {
				const election = (e: IEventData) => e.section == 'multiBlock' || e.section == 'multiBlockVerifier' || e.section == 'multiBlockSigned' || e.section == 'multiBlockUnsigned';
				const rcClient = (e: IEventData) => e.section == 'stakingNextRcClient';
				const staking = (e: IEventData) => e.section == 'staking' && (e.method == 'EraPaid' || e.method == 'SessionRotated' || e.method == 'PagedElectionProceeded');
				return election(e.data) || rcClient(e.data) || staking(e.data);
			})
			.map((e) => `${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`);
		ahEvents.push(...eventsOfInterest);

		ahOutput = [
			`AH:`,
			`finalized block ${header.number}`,
			`AH.staking: currentEra=${currentEra}, activeEra=${activeEra}, erasStartSessionIndex(${activeEra.unwrap().index})=${erasStartSessionIndex}`,
			`multiBlock: phase=${phase}, round=${round}, snapshotRange=${snapshotRange}, queuedScore=${queuedScore}, signedSubmissions=${signedSubmissions}`,
			`AH.events: ${ahEvents}`,
			`----`,
		]

		manager.update(rcOutput.concat(ahOutput))
	});


	// Prevent the function from returning by creating a promise that never resolves
	return new Promise<void>((resolve) => {
		// Set up signal handlers for graceful shutdown
		process.on('SIGINT', () => {
			console.log('Received SIGINT. Shutting down...');
			process.exit(0);
		});

		process.on('SIGTERM', () => {
			console.log('Received SIGTERM. Shutting down...');
			process.exit(0);
		});
		console.log('Command center running. Press Ctrl+C to exit.');
	});
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

export async function saveWahV1(args: HandlerArgs): Promise<void> {
	let rcApi = await getAtApi("wss://westend-rpc.dwellir.com", "0xd653600210afe2227318a26209faeb7f7899c7c901718d41d9a03881044d71f2");
	// let rcApiNow = await getApi("wss://westend-rpc.dwellir.com");
	// let rcApi = await getApi("ws://localhost:9999");
	let rcApiNow = await getApi("ws://localhost:8000");

	let ledgersRc = await rcApi.query.staking.ledger.entries();
	let ledgerTxs = 0;
	let bondedRc = await rcApi.query.staking.bonded.entries();
	let bondedTxs = 0;

	console.log(`ledgersRc: ${ledgersRc.length}`);
	console.log(`bondedRc: ${bondedRc.length}`);

	let chunkSize = 512;
	type KeyValue = [string, string];

	// ---- ledger
	let ledgerBatchTx = [];
	for (let i = 0; i < ledgersRc.length; i += chunkSize) {
		let chunk = ledgersRc.slice(i, i + chunkSize);
		let kvs: KeyValue[] = []
		for (let j = 0; j < chunk.length; j++) {
			let [k, v] = chunk[j];
			ledgerTxs += 1;
			kvs.push([k.toHex(), v.toHex()])
		}
		const tx = rcApiNow.tx.system.setStorage(kvs)
		ledgerBatchTx.push(tx);
	}
	console.log(`ledgerBatchTx: ${ledgerBatchTx.length}`);
	console.log(`ledgerTxs: ${ledgerTxs}`);

	// ---- bonded
	let bondedBatchTx = [];
	for (let i = 0; i < bondedRc.length; i += chunkSize) {
		let chunk = bondedRc.slice(i, i + chunkSize);
		let kvs: KeyValue[] = []
		for (let j = 0; j < chunk.length; j++) {
			let [k, v] = chunk[j];
			bondedTxs += 1;
			kvs.push([k.toHex(), v.toHex()])
		}
		const tx = rcApiNow.tx.system.setStorage(kvs)
		bondedBatchTx.push(tx);
	}
	console.log(`bondedBatchTx: ${bondedBatchTx.length}`);
	console.log(`bondedTxs: ${bondedTxs}`);

	let signer = getAccount(undefined, 1);
	// -------------------- ^^^ insert seed here to use a different account
	for (let tx of ledgerBatchTx) {
		const sudo = rcApiNow.tx.sudo.sudo(tx);
		await sendAndFinalize(sudo, signer)
	}
	for (let tx of bondedBatchTx) {
		const sudo = rcApiNow.tx.sudo.sudo(tx);
		await sendAndFinalize(sudo, signer)
	}
}

export async function saveWahV2(args: HandlerArgs): Promise<void> {
	const beforeMigApi = await getAtApi("wss://westend-rpc.dwellir.com", "0xd653600210afe2227318a26209faeb7f7899c7c901718d41d9a03881044d71f2");
	const nowApi = await getApi("wss://westend-rpc.dwellir.com");
	const nowWahApi = await getApi("wss://asset-hub-westend-rpc.dwellir.com");

	// pallet, storage value key
	const toSet = [
		["staking", "validatorCount"],
		["staking", "invulnerables"],

		["staking", "minNominatorBond"],
		["staking", "minValidatorBond"],
		["staking", "minimumActiveStake"],

		["staking", "maxValidatorsCount"],
		["staking", "maxNominatorsCount"],

		["staking", "currentEra"],
		["staking", "activeEra"],
		["staking", "bondedEras"],

		["staking", "slashRewardFraction"],

		["nominationPools", "totalValueLocked"],
		["nominationPools", "minJoinBond"],
		["nominationPools", "minCreateBond"],
		["nominationPools", "maxPools"],
		["nominationPools", "maxPoolMembers"],
		["nominationPools", "globalMaxCommission"],
		["nominationPools", "lastPoolId"],

		["fastUnstake", "erasToCheckPerBlock"],

		["referenda", "referendumCount"]
	]

	const kvs: [string, string][] = []
	for (const [pallet, storage] of toSet) {
		const beforeMigValue = await beforeMigApi.query[pallet][storage]()

		// the key has to come from WAH, not Westend, although they are the same since pallet names are the same.
		const key = nowWahApi.query[pallet][storage].key()
		console.log(`before migration ${pallet}.${storage} (${key}): ${Number(beforeMigValue)} (${u8aToHex(beforeMigValue.toU8a())})`);
		kvs.push([key, u8aToHex(beforeMigValue.toU8a())])
	}

	// the system index of WAH is the one we want to use.
	const tx = nowWahApi.tx.system.setStorage(kvs);
	console.log("encoded call to submit in WAH:", tx.inner.toHex());
}

export async function deeplyNestedCall(args: HandlerArgs): Promise<void> {
	const api = await getApi(args.ws);
	let depth = 250;
	let signer = getAccount(undefined, 1);
	const wrapInSomething = true;
	while (true) {
		let call = api.tx.system.remark("foo");
		for (let i = 0; i < depth; i++) {
			call = api.tx.utility.batch([call]);
		}

		if (wrapInSomething) {
			call = api.tx.sudo.sudo(call);
		}
		console.log(`call with depth: ${depth}: ${call.toU8a().length} bytes`);
		console.log(`hex call: ${call.toHex()}`);

		await sendAndFinalize(call, signer);
		depth ++;
	}
}

export async function submitTxFromFile(args: HandlerArgs, fileStart: string): Promise<void> {
	// real
	// const nowWahApi = await getApi("wss://asset-hub-westend-rpc.dwellir.com");
	// local CS for testing
	const nowWahApi = await getApi("ws://localhost:8000");
	// read all files that have the name "call_*.txt" from the given dir
	const dir = "../assets";
	const fs = require('fs');
	const path = require('path');
	const files = fs.readdirSync(dir).filter((file: string) => file.startsWith(fileStart) && file.endsWith(".txt"));

	console.log(`found ${files.length} files to submit:`)
	for (const file of files) {
		const filePath = path.join(dir, file);
		const content = fs.readFileSync(filePath, 'utf8');
		const call = nowWahApi.createType('Call', content);
		const tx = nowWahApi.tx[call.section][call.method](...call.args);

		let signer = getAccount(undefined, 1);
		await sendAndFinalize(tx, signer)
	}
}

export async function playgroundHandler(args: HandlerArgs): Promise<void> {
	// await isExposed(args.ws, "5CMHncn3PkANkyXXcjvd7hN1yhuqbkntofr8o9uncqENCiAU")
	// await saveWahV2(args)
	// await submitTxFromFile(args)
	await deeplyNestedCall(args)

	console.log("submitting sudo set storage txns");
	await submitTxFromFile(args, "call_");

	console.log("submitting sudo fix hold txns");
	await submitTxFromFile(args, "fh_call_");
}
