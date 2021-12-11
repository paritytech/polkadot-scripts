// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import { bagsListCheck, nominatorThreshold, electionScoreStats } from './services';
import { ApiPromise,  WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { getAccountFromEnvOrArgElseAlice, getApi } from './helpers';
import { reapStash } from './services/reap_stash';


/// TODO: split this per command, it is causing annoyance.
export interface HandlerArgs {
	ws: string;
	sendTx?: boolean;
	count?: number,
}

export async function bagsHandler({ ws, sendTx, count }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api)
	await bagsListCheck(api, account, sendTx, count);
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

export async function reapStashHandler({ ws, sendTx, count }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}

	const api = await getApi(ws);
	const account = await getAccountFromEnvOrArgElseAlice(api)
	await reapStash(api, account, sendTx, count);
}

export async function playgroundHandler({ ws }: HandlerArgs): Promise<void> {
	return;
}
