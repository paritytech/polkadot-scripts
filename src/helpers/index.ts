import { readFileSync } from 'fs'
import { KeyringPair } from "@polkadot/keyring/types";
import { ApiPromise, Keyring, WsProvider} from '@polkadot/api';
import { BN } from '@polkadot/util';
import { HandlerArgs } from '../handlers';
import { ApiDecoration } from '@polkadot/api/types';

export * from './rpc'

export async function getApi(ws: string): Promise<ApiPromise> {
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({
		provider,
	});
	console.log(`Connected to node: ${ws} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)
	return api
}

export function getAccount(seedOrPath: string | undefined, ss58: number | undefined): KeyringPair {
	const keyring = new Keyring({ type: 'sr25519', ss58Format: ss58});
	console.log(`using seed or path: ${seedOrPath}`)
	if (seedOrPath) {
		let suriData;
		try {
			suriData = readFileSync(seedOrPath, 'utf-8').toString().trim();
		} catch (e) {
			console.error('Seed path cannot be opened, treating it as seed data itself');
			suriData = seedOrPath;
		}

		return keyring.addFromUri(suriData)
	}

	console.info("creating Alice dev account.")
	return keyring.addFromUri('//Alice');
}

export async function getAccountFromEnvOrArgElseAlice(api: ApiPromise, arg?: string): Promise<KeyringPair> {
	const account = getAccount(arg || process.env["SEED"], api.registry.chainSS58);
	console.log(`📣 using account ${account.address}, info ${await api.query.system.account(account.address)}`)
	return account;
}

export async function binarySearchStorageChange<T>(
	{ ws }: HandlerArgs,
	low: BN,
	high: BN,
	targetValue: T,
	getter: (api: ApiDecoration<"promise">) => Promise<T>,
): Promise<void> {
	/*

	// example of how to do the binary search.
	const targetValue = "0xffffffffffffffffffffffffffffffff";
	// upper range.
	const high = new BN(10412678)
	// lower range
	const low = new BN(0);
	// what gives us the value of desire in a given block.
	//
	// This MUST have the same type as `targetValue`, and MUST BE COMPARABLE using `===` operator.
	// Really easy to shoot yourself in the foot if you don't pay attention to this detail.
	const getValue = async (api: ApiDecoration<"promise">) => {
		const locks = await api.query.balances.locks("F2i6trfXqFknbgB3d9wcd1X98WWdLLktmFtK8Beud75bjTW");
		// what we are looking for is the maximum lock
		let maxLock = new BN(0);
		locks.forEach((l)  => { if (l.amount.gt(maxLock)) { maxLock = l.amount } });
		return maxLock.toJSON()
	}

	await binarySearchStorageChange( { ws }, low, high, targetValue, getValue);
	*/
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({provider});
	console.log(`Connected to node: ${ws} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	// the assumption is that `getValue` at `high` will return `targetValue`. At some point in the
	// past it was set, and we are looking for that block.

	const getValueAt = async (nowNumber: BN) => {
		const nowHash = await api.rpc.chain.getBlockHash(nowNumber);
		const nowApi = await api.at(nowHash)
		return await getter(nowApi);
	};

	let cond = true
	while (cond) {
		const nowNumber = low.add(high.sub(low).div(new BN(2)));
		console.log(`trying [${low} ${high}] => ${nowNumber}`)
		const nowValue = await getValueAt(nowNumber);

		if (nowValue === targetValue) {
			high = nowNumber
		} else {
			low = nowNumber
		}
		if (low.sub(high).abs().lte(new BN(1))) { cond = false }
	}

	console.log(`desired value @#${low} => ${await getValueAt(low)}`)
	console.log(`desired value @#${high} => ${await getValueAt(high)}`)
}
