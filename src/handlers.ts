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
import { IEvent, IEventData } from '@polkadot/types/types';
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
	const rcApi = await getApi("ws://localhost:9955");
	const ahApi = await getApi("ws://localhost:9966");

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

export async function ExposureStats({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);

	const era = (await api.query.staking.currentEra()).unwrap();
	const overviews = (await api.query.staking.erasStakersOverview.entries(era)).map(([key, value]) => {
		const stash = key.args[1].toHuman();
		const metadata = value.unwrap();
		return { stash, metadata }
	});
	console.log(`overviews/exposed validators: ${overviews.length}`);
	const sumNominators = overviews.map(({ metadata}) => metadata.nominatorCount.toNumber()).reduce((a, b) => a + b, 0);
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
	await ExposureStats(args);
}
