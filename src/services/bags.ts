import { ApiPromise } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";

import BN from "bn.js"
import { AccountId, Balance, } from "@polkadot/types/interfaces/runtime"
import { PalletBagsListListNode } from "@polkadot/types/lookup"
import { strict as assert } from 'assert'
import { dryRun, sendAndFinalize } from '../helpers'
import { ApiDecoration } from "@polkadot/api/types";

interface Bag {
	head: AccountId,
	tail: AccountId,
	upper: Balance,
	nodes: AccountId[],
}

async function needsRebag(baseApi: ApiPromise, api: ApiDecoration<"promise">, bagThresholds: Balance[], currentUpper: Balance, node: PalletBagsListListNode): Promise<boolean> {
	const currentAccount = node.id;
	const currentCtrl = (await api.query.staking.bonded(currentAccount)).unwrap();
	const currentWeight = baseApi.createType('Balance', (await api.query.staking.ledger(currentCtrl)).unwrapOrDefault().active);
	const canonicalUpper = bagThresholds.find((t) => t.gt(currentWeight)) || baseApi.createType('Balance', new BN("18446744073709551615"));
	if (canonicalUpper.gt(currentUpper)) {
		console.log(`\t ☝️ ${currentAccount} needs a rebag from ${currentUpper.toHuman()} to higher ${canonicalUpper.toHuman()} [real weight = ${currentWeight.toHuman()}]`)
		return true
	} else if (canonicalUpper.lt(currentUpper)) {
		// this should ALMOST never happen: we handle all rebags to lower accounts, except if a
		// slash happens.
		console.log(`\t 👇 ☢️ ${currentAccount} needs a rebag from ${currentUpper.toHuman()} to lower ${canonicalUpper.toHuman()} [real weight = ${currentWeight.toHuman()}]`)
		return true
	} else {
		// correct spot.
		return false
	}
}

export async function bagsListCheck(api: ApiPromise, account: KeyringPair, sendTx: boolean, count: number): Promise<void> {
	let entries;
	try {
		entries = await api.query.bagsList.listBags.entries();
	} catch  {
		throw 'bags list does not appear to exist for this runtime'
	}

	const bags: Bag[] = [];
	const needRebag: AccountId[] = [];
	const at = await api.rpc.chain.getFinalizedHead();
	const finalizedApi = await api.at(at);
	const bagThresholds = finalizedApi.consts.bagsList.bagThresholds.map((x) => api.createType('Balance', x));

	entries.forEach(([key, bag]) => {
		if (bag.isSome && bag.unwrap().head.isSome && bag.unwrap().tail.isSome) {
			const head = bag.unwrap().head.unwrap();
			const tail = bag.unwrap().tail.unwrap();

			const keyInner = key.args[0];
			const upper = api.createType('Balance', keyInner.toBn());
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
			if (await needsRebag(api, finalizedApi, bagThresholds, upper, currentNode)) {
				needRebag.push(currentNode.id);
			}
			nodes.push(currentNode.id);
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

		console.log(`👜 Bag ${upper.toHuman()} - ${nodes.length} nodes: [${head} .. -> ${head !== tail ? tail : ''}]`)
		if (count > -1 && needsRebag.length > count) {
			break
		}
	}

	console.log(`📊 total count of nodes: ${counter}`);
	console.log(`..of which ${needRebag.length} need a rebag`);
	const counterOnchain = await finalizedApi.query.bagsList.counterForListNodes();
	const nominatorsOnChain = await finalizedApi.query.staking.counterForNominators();
	assert.deepEqual(counter, counterOnchain.toNumber());
	assert.deepEqual(counter, nominatorsOnChain.toNumber());

	const txsInner = needRebag.map((who) => api.tx.bagsList.rebag(who));
	const tx = api.tx.utility.batchAll(txsInner);
	const success = await dryRun(api, account, tx);
	if (success && sendTx) {
		const { success, included } = await sendAndFinalize(tx, account);
		console.log(`ℹ️ success = ${success}. Events =`)
		for (const ev of included) {
			process.stdout.write(`${ev.event.section}::${ev.event.method}`)
		}
	} else if (!success) {
		console.log(`warn: dy-run failed.`)
	} else {
		console.log("no rebag batch tx sent")
	}
}
