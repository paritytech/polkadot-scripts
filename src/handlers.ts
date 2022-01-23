// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import { bagsListCheck, nominatorThreshold, electionScoreStats } from './services';
import { getAccountFromEnvOrArgElseAlice, getApi } from './helpers';
import { reapStash } from './services/reap_stash';
import { chillOther } from './services/chill_other';


/// TODO: split this per command, it is causing annoyance.
export interface HandlerArgs {
	ws: string;
	sendTx?: boolean;
	count?: number,
	noDryRun?: boolean,
	seed?: string
}

export async function bagsHandler({ ws, sendTx, count, seed }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed)
	await bagsListCheck(api, account, sendTx, count);
}

export async function chillOtherHandler({ ws, sendTx, count, noDryRun, seed }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}
	if (noDryRun === undefined) {
		noDryRun = false
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed)
	await chillOther(api, account, sendTx, noDryRun, count);
}

export async function nominatorThreshHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);
	await nominatorThreshold(api);
}

export async function electionScoreHandler({ ws }: HandlerArgs): Promise<void> {
	const api = await getApi(ws);

	const apiKey = process.env['API'] || "DEFAULT_KEY";
	console.log(`using api key: ${apiKey}`);

	const chainName = await api.rpc.system.chain();
	await electionScoreStats(chainName.toString().toLowerCase(), api, apiKey);
}

export async function reapStashHandler({ ws, sendTx, count, seed }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api, seed)
	await reapStash(api, account, sendTx, count);
}

export async function playgroundHandler({ ws }: HandlerArgs): Promise<void> {
	return;
}
