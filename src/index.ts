import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import axios from "axios";
import BN from "bn.js"
import yargs from 'yargs';
import { hideBin } from "yargs/helpers"
import { AccountId, Balance } from "@polkadot/types/interfaces/runtime"
import { strict as assert } from 'assert'
import { readFileSync } from 'fs'

const optionsPromise = yargs(hideBin(process.argv))
	.option('endpoint', {
		alias: 'e',
		type: 'string',
		description: 'the wss endpoint. It must allow unsafe RPCs.',
		default: "wss://rpc.polkadot.io"
	})
	.option('seed', {
		alias: 's',
		type: 'string',
		description: 'path to a raw text file that contains your raw or mnemonic seed.',
		required: false,
	})
	.argv

async function main() {
	const options = await optionsPromise;
	const provider = new WsProvider(options.endpoint);
	const api = await ApiPromise.create({ provider });
	console.log(`Connected to node: ${options.endpoint} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	await bagsListCheck(api)
}

main().catch(console.error).finally(() => process.exit());

async function accountHistory(api: ApiPromise) {
	const account = process.env['WHO'];
	let now = await api.rpc.chain.getFinalizedHead();
	let data = await api.query.system.account(account);

	// @ts-ignore
	while (true) {
		const now_data = await api.query.system.account(account);
		const header = await api.rpc.chain.getHeader(now);
		const number = header.number;
		if (now_data === data) {
			console.log(`change detected at block ${number}`, now_data.toHuman())
			data = now_data;
		}

		now = header.parentHash;
	}
}

async function nominatorThreshold(api: ApiPromise) {
	const DOT = 10000000000;
	const t = new BN(DOT).mul(new BN(80));
	const np = (await api.query.staking.nominators.entries()).map(async ([sk, _]) => {
		const stash = api.createType('AccountId', sk.slice(-32));
		// all nominators must have a controller
		const c = (await api.query.staking.bonded(stash)).unwrap();
		// all controllers must have ledger.
		const stake = (await api.query.staking.ledger(c)).unwrap().total.toBn();
		return { stash, stake }
	});

	const n = await Promise.all(np);
	console.log(`${n.filter(({ stash, stake }) => stake.lt(t)).length} stashes are below ${api.createType('Balance', t).toHuman()}`);
}

async function electionScoreStats(_api: ApiPromise) {
	const chain = "polkadot";
	// @ts-ignore
	const endpoint = chain === "polkadot" ? "wss://rpc.polkadot.io" : "wss://kusama-rpc.polkadot.io"
	const provider = new WsProvider(endpoint);
	const api = await ApiPromise.create({ provider });
	console.log(`Connected to node: ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	const key = process.env['API'] || "DEFAULT_KEY";

	const count = 30
	const percent = new BN(50);

	console.log(`using api key: ${key}`)
	const data = await axios.post(`https://${chain}.api.subscan.io/api/scan/extrinsics`, {
		"row": count,
		"page": 0,
		"module": "electionprovidermultiphase",
		"call": "submit_unsigned",
		"signed": "all",
		"no_params": false,
		"address": "",
	}, { headers: { "X-API-Key": key } })

	// @ts-ignore
	const exts = data.data.data.extrinsics.slice(0, count);
	const scores = exts.map((e: any) => {
		const parsed = JSON.parse(e.params);
		return parsed[0].value.score
	})

	const avg = [new BN(0), new BN(0), new BN(0)]
	for (const score of scores) {
		avg[0] = avg[0].add(new BN(score[0]))
		avg[1] = avg[1].add(new BN(score[1]))
		avg[2] = avg[2].add(new BN(score[2]))
	}

	avg[0] = avg[0].div(new BN(count))
	avg[1] = avg[1].div(new BN(count))
	avg[2] = avg[2].div(new BN(count))

	console.log(`--- averages`)
	console.log(`${avg[0].toString()}, ${api.createType('Balance', avg[0]).toHuman()}`);
	console.log(`${avg[1].toString()}, ${api.createType('Balance', avg[1]).toHuman()}`);
	console.log(`${avg[2].toString()}, ${api.createType('Balance', avg[2]).toHuman()}`);

	avg[0] = avg[0].mul(percent).div(new BN(100))
	avg[1] = avg[1].mul(percent).div(new BN(100))
	avg[2] = avg[2].mul(new BN(100).add(percent)).div(new BN(100))

	console.log(`--- ${percent.toString()}% thereof:`)
	console.log(`${avg[0].toString()}, ${api.createType('Balance', avg[0]).toHuman()}`);
	console.log(`${avg[1].toString()}, ${api.createType('Balance', avg[1]).toHuman()}`);
	console.log(`${avg[2].toString()}, ${api.createType('Balance', avg[2]).toHuman()}`);

	console.log(`current minimum untrusted score is ${await api.query.electionProviderMultiPhase.minimumUntrustedScore()}`)
}

interface Bag {
	head: AccountId,
	tail: AccountId,
	upper: Balance,
	nodes: AccountId[],
}

import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { ISubmittableResult } from "@polkadot/types/types/"
import { KeyringPair } from "@polkadot/keyring/types";
import { EventRecord, } from "@polkadot/types/interfaces/";
import { CodecHash } from "@polkadot/types/interfaces/runtime"

interface ISubmitResult {
	hash: CodecHash,
	success: boolean,
	included: EventRecord[],
	finalized: EventRecord[],
}

async function sendAndFinalize(tx: SubmittableExtrinsic<"promise", ISubmittableResult>, account: KeyringPair): Promise<ISubmitResult> {
	return new Promise(async resolve => {
		let success = false;
		let included: EventRecord[] = []
		let finalized: EventRecord[] = []
		const unsubscribe = await tx.signAndSend(account, ({ events = [], status, dispatchError }) => {
			if (status.isInBlock) {
				success = dispatchError ? false : true;
				console.log(`📀 Transaction ${tx.meta.name}(..) included at blockHash ${status.asInBlock} [success = ${success}]`);
				included = [...events]
			} else if (status.isBroadcast) {
				console.log(`🚀 Transaction broadcasted.`);
			} else if (status.isFinalized) {
				console.log(`💯 Transaction ${tx.meta.name}(..) Finalized at blockHash ${status.asFinalized}`);
				finalized = [...events]
				const hash = status.hash;
				unsubscribe();
				resolve({ success, hash, included, finalized })
			} else if (status.isReady) {
				// let's not be too noisy..
			} else {
				console.log(`🤷 Other status ${status}`)
			}
		})
	})
}

async function dryRun(api: ApiPromise, account: KeyringPair, batch: SubmittableExtrinsic<"promise", ISubmittableResult>): Promise<boolean> {
	const signed = await batch.signAsync(account);
	const dryRun = await api.rpc.system.dryRun(signed.toHex());
	console.log(`dry run of transaction => `, dryRun.toHuman())
	return dryRun.isOk && dryRun.asOk.isOk
}

async function bagsListCheck(api: ApiPromise) {
	// first load the account.
	const keyring = new Keyring({ type: 'sr25519', ss58Format: api.registry.chainSS58 });
	const seedPath = process.env["SEED_PATH"] || "DEFAULT_SEED";
	const seed = readFileSync(seedPath).toString().trim();
	const account = keyring.addFromUri(seed);
	console.log(`📣 using account ${account.address}, info ${await api.query.system.account(account.address)}`)

	const entries = await api.query.bagsList.listBags.entries();
	const bags: Bag[] = [];
	const needRebag: AccountId[] = [];
	const at = await api.rpc.chain.getFinalizedHead();
	const finalizedApi = await api.at(at);
	const bagThresholds = finalizedApi.consts.bagsList.bagThresholds.map((x) => api.createType('Balance', x));
	entries.forEach(([key, bag]) => {
		if (bag.isSome && bag.unwrap().head.isSome && bag.unwrap().tail.isSome) {
			const head = bag.unwrap().head.unwrap();
			const tail = bag.unwrap().tail.unwrap();
			const keyData = key.toU8a();
			// u64 is the last 8 bytes
			const upper = api.createType('Balance', keyData.slice(-8));
			assert(bagThresholds.findIndex((x) => x.eq(upper)) > -1, `upper ${upper} not found in ${bagThresholds}`);
			bags.push({ head, tail, upper, nodes: [] })
		}
	});

	bags.sort((a, b) => a.upper.cmp(b.upper));
	let counter = 0;
	for (const { head, tail, upper, nodes } of bags) {
		// process the bag.
		let current = head;
		while (true) {
			const currentNode = (await finalizedApi.query.bagsList.listNodes(current)).unwrap();
			const currentAccount = currentNode.id;
			const currentCtrl = (await finalizedApi.query.staking.bonded(currentAccount)).unwrap();
			const currentWeight = api.createType('Balance', (await finalizedApi.query.staking.ledger(currentCtrl)).unwrapOrDefault().active);
			const canonicalUpper = bagThresholds.find((t) => t.gt(currentWeight)) || api.createType('Balance', new BN("18446744073709551615"));
			if (canonicalUpper.gt(upper)) {
				console.log(`\t ☝️ ${currentAccount} needs a rebag from ${upper.toHuman()} to higher ${canonicalUpper.toHuman()} [real weight = ${currentWeight.toHuman()}]`)
				needRebag.push(currentAccount);
			} else if (canonicalUpper.lt(upper)) {
				// this should never happen: we handle all rebags to lower accounts, except if a
				// slash happens.
				console.log(`\t 👇 ☢️ ${currentAccount} needs a rebag from ${upper.toHuman()} to lower ${canonicalUpper.toHuman()} [real weight = ${currentWeight.toHuman()}]`)
				needRebag.push(currentAccount);
			} else {
				// correct spot.
			}
			nodes.push(currentAccount);

			if (currentNode.next.isSome) {
				current = currentNode.next.unwrap()
			} else {
				break
			}
		}

		assert.deepEqual(nodes[0], head);
		assert.deepEqual(nodes[nodes.length - 1], tail, `last node ${nodes[nodes.length - 1]} not matching tail ${tail} in bag ${upper}`);
		assert(head !== tail || nodes.length > 0)
		counter += nodes.length;

		console.log(`👜 Bag ${upper.toHuman()} - ${nodes.length} nodes: [${head} .. -> ${head !== tail? tail : ''}]`)
	}

	console.log(`total size: ${counter}`);
	const counterOnchain = await finalizedApi.query.bagsList.counterForListNodes();
	assert.deepEqual(counter, counterOnchain.toNumber());

	const txsInner = needRebag.map((who) => api.tx.bagsList.rebag(who));
	const tx = api.tx.utility.batchAll(txsInner);
	const success = await dryRun(api, account, tx);
	if (success) {
		// const { success, included } = await sendAndFinalize(tx, account);
		// console.log(`ℹ️ success = ${success}. Events =`)
		// for (const ev of included) {
		// 	process.stdout.write(`${ev.event.section}::${ev.event.method}`)
		// }
	} else {
		console.log(`warn: dy-run failed.`)
	}

}
