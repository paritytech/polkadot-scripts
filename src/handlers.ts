// CLI command handlers. Responsible for gather all command inputs and calling the
// relevant services with them.

import { bagsListCheck, nominatorThreshold, electionScoreStats } from './services';
import { readFileSync } from 'fs'
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { KeyringPair } from "@polkadot/keyring/types";


/// TODO: split this per command, it is causing annoyance.
interface HandlerArgs {
	ws: string;
	sendTx?: boolean;
	count?: number,
	chain?: 'kusama' | 'polkadot'
}

function getAccount(seedPath: string | undefined, ss58: number | undefined): KeyringPair {
	const keyring = new Keyring({ type: 'sr25519', ss58Format: ss58});
	if (seedPath) {
		let suriData;
		try {
			suriData = readFileSync(seedPath, 'utf-8').toString().trim();
		} catch (e) {
			console.error('Suri file could not be opened');
			throw e;
		}

		return keyring.addFromUri(suriData)
	}

	console.info("creating Alice dev account.")
	return keyring.addFromUri('//Alice');
}

export async function bags({ ws, sendTx, count }: HandlerArgs): Promise<void> {
	if (sendTx === undefined) {
		throw 'sendTx must be a true or false'
	}
	if (count === undefined) {
		count = -1
	}


	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({
		provider,
	});
	console.log(`Connected to node: ${ws} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)


	let account;
	if (process.env["SEED_PATH"]) {
		account = getAccount(process.env["SEED_PATH"], api.registry.chainSS58)
	} else {
		account = getAccount(undefined, api.registry.chainSS58);
	}

	console.log(`📣 using account ${account.address}, info ${await api.query.system.account(account.address)}`)

	await bagsListCheck(api, account, sendTx, count);
}

export async function nominatorThresh({ ws }: HandlerArgs): Promise<void> {
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({
		provider,
	});
	console.log(`Connected to node: ${ws} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	await nominatorThreshold(api);
}

export async function electionScore({ chain }: HandlerArgs): Promise<void> {
	if (!chain) {
		throw 'Must specify a chain'
	}

	const chainLower = chain.toLocaleLowerCase() as 'kusama' | 'polkadot';
	const endpoint = chainLower === "polkadot" ? "wss://rpc.polkadot.io" : "wss://kusama-rpc.polkadot.io"
	const provider = new WsProvider(endpoint);
	const api = await ApiPromise.create({ provider });

	console.log(`Connected to node: ${endpoint} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`);

	const apiKey = process.env['API'] || "DEFAULT_KEY";
	console.log(`using api key: ${apiKey}`);

	await electionScoreStats(chainLower, api, apiKey);
}
