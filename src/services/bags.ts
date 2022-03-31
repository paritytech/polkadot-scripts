import { ApiPromise } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";

import BN from "bn.js"
import { AccountId, Balance, } from "@polkadot/types/interfaces/runtime"
import { PalletBagsListListNode, PalletBagsListListBag } from "@polkadot/types/lookup"
import { strict as assert } from 'assert'
import { dryRun, dryRunMaybeSendAndFinalize, sendAndFinalize } from '../helpers'
import { ApiDecoration } from "@polkadot/api/types";
import { formatBalance } from "@polkadot/util"
import { Option } from "@polkadot/types-codec";

interface Bag {
	head: AccountId,
	tail: AccountId,
	upper: Balance,
	nodes: AccountId[],
}

async function correctWeightOf(node: PalletBagsListListNode, api: ApiDecoration<"promise">): Promise<BN> {
	const currentAccount = node.id;
	const currentCtrl = (await api.query.staking.bonded(currentAccount)).unwrap();
	return (await api.query.staking.ledger(currentCtrl)).unwrapOrDefault().active.toBn()
}

async function needsRebag(
	api: ApiDecoration<"promise">,
	bagThresholds: BN[],
	node: PalletBagsListListNode,
): Promise<boolean> {
	const currentWeight = await correctWeightOf(node, api);
	const canonicalUpper = bagThresholds.find((t) => t.gt(currentWeight)) || new BN("18446744073709551615");
	if (canonicalUpper.gt(node.bagUpper)) {
		console.log(`\t ☝️ ${node.id} needs a rebag from ${node.bagUpper.toHuman()} to higher ${formatBalance(canonicalUpper)} [real weight = ${formatBalance(currentWeight)}]`)
		return true
	} else if (canonicalUpper.lt(node.bagUpper)) {
		// this should ALMOST never happen: we handle all rebags to lower accounts, except if a
		// slash happens.
		console.log(`\t 👇 ☢️ ${node.id} needs a rebag from ${node.bagUpper.toHuman()} to lower ${formatBalance(canonicalUpper)} [real weight = ${formatBalance(currentWeight)}]`)
		return true
	} else {
		// correct spot.
		return false
	}
}

export async function doRebagSingle(api: ApiPromise, signer: KeyringPair, target: string, sendTx: boolean): Promise<void> {
	const node = (await api.query.bagsList.listNodes(target)).unwrap();
	const bagThresholds = api.consts.bagsList.bagThresholds.map((x) => api.createType('Balance', x));
	if (await needsRebag(api, bagThresholds, node)) {
		const tx = api.tx.bagsList.rebag(node.id);
		const maybeSubmit = await dryRunMaybeSendAndFinalize(api, tx, signer, sendTx);
		if (maybeSubmit) {
			const { success, included } = maybeSubmit
			console.log(`ℹ️ success = ${success}. Events =`)
			for (const ev of included) {
				process.stdout.write(`${ev.event.section}::${ev.event.method}`)
			}
		}

	}
}

export async function doRebagAll(api: ApiPromise, signer: KeyringPair, sendTx: boolean, count: number): Promise<void> {
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

	console.log(`🧾 collected a total of ${bags.length} active bags.`)
	bags.sort((a, b) => a.upper.cmp(b.upper));

	let counter = 0;
	for (const { head, tail, upper, nodes } of bags) {
		// process the bag.
		let current = head;
		let cond = true
		while (cond) {
			const currentNode = (await finalizedApi.query.bagsList.listNodes(current)).unwrap();
			if (await needsRebag(finalizedApi, bagThresholds, currentNode)) {
				needRebag.push(currentNode.id);
			}
			nodes.push(currentNode.id);
			if (currentNode.next.isSome) {
				current = currentNode.next.unwrap()
			} else {
				cond = false
			}
		}

		assert.deepEqual(nodes[0], head);
		assert.deepEqual(nodes[nodes.length - 1], tail, `last node ${nodes[nodes.length - 1]} not matching tail ${tail} in bag ${upper}`);
		assert(head !== tail || nodes.length > 0)
		counter += nodes.length;

		console.log(`👜 Bag ${upper.toHuman()} - ${nodes.length} nodes: [${head} .. -> ${head !== tail ? tail : ''}]`)
	}

	console.log(`📊 total count of nodes: ${counter}`);
	console.log(`..of which ${needRebag.length} need a rebag`);
	const counterOnchain = await finalizedApi.query.bagsList.counterForListNodes();
	const nominatorsOnChain = await finalizedApi.query.staking.counterForNominators();
	assert.deepEqual(counter, counterOnchain.toNumber());
	assert.deepEqual(counter, nominatorsOnChain.toNumber());

	const txsInner = needRebag.map((who) => api.tx.bagsList.rebag(who)).slice(0, count);
	const tx = api.tx.utility.batchAll(txsInner);
	console.log((await tx.paymentInfo(signer)).toHuman());
	const [success, result] = await dryRun(api, signer, tx);
	console.log(`dry-run outcome is ${success} / ${result}`)
	if (success && sendTx && txsInner.length) {
		const { success, included } = await sendAndFinalize(tx, signer);
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

export async function needsPutInFrontOf(
	api: ApiDecoration<"promise">,
	node: PalletBagsListListNode,
	bag: PalletBagsListListBag,
): Promise<AccountId | undefined> {
	// it is best ot be in a position of a bag as close to the head as possible. So, we start form
	// the head, and if any node's weight is less than ours, then we can go in front of them.
	const ourWeight = await correctWeightOf(node, api);
	let maybeCurrentAccount: Option<AccountId> = bag.head;
	while (maybeCurrentAccount.isSome) {
		const currentNode = (await api.query.bagsList.listNodes(maybeCurrentAccount.unwrap())).unwrap();
		const theirWeight = await correctWeightOf(currentNode, api);
		if (currentNode.toHuman().id === node.toHuman().id) {
			return undefined
		}
		else if (ourWeight.gt(theirWeight)) {
			// we can go in front of them!
			return maybeCurrentAccount.unwrap()
		} else {
			maybeCurrentAccount = currentNode.next
		}
	}
	return undefined
}

export async function doPutInFrontOf(api: ApiPromise, signer: KeyringPair, target: string): Promise<void> {
	const targetAccount = api.createType('AccountId', target);
	const targetNode = (await api.query.bagsList.listNodes(targetAccount)).unwrap();
	const targetCurrentBagThreshold = targetNode.bagUpper;
	const targetBag = (await api.query.bagsList.listBags(targetCurrentBagThreshold)).unwrap();

	const maybeWeaker = await needsPutInFrontOf(api, targetNode, targetBag);

	if (maybeWeaker) {
		const tx = api.tx.bagsList.putInFrontOf(maybeWeaker);
		const maybeSubmit = await dryRunMaybeSendAndFinalize(api, tx, signer, true);
		if (maybeSubmit) {
			const { success, included } = maybeSubmit
			console.log(`ℹ️ success = ${success}. Events =`)
			for (const ev of included) {
				process.stdout.write(`${ev.event.section}::${ev.event.method}`)
			}
		}
	}
}

export async function canPutInFrontOf(api: ApiPromise, target: string): Promise<void> {
	const targetAccount = api.createType('AccountId', target);
	const targetNode = (await api.query.bagsList.listNodes(targetAccount)).unwrap();
	const targetCurrentBagThreshold = targetNode.bagUpper;
	const targetBag = (await api.query.bagsList.listBags(targetCurrentBagThreshold)).unwrap();

	const maybeWeaker = await needsPutInFrontOf(api, targetNode, targetBag);
	if (maybeWeaker === undefined) {
		console.log("\nThe target account cannot be repositioned\n");
	} else {
		console.log(`\nThe target account can be put in front of ${maybeWeaker?.toHuman()}\n`);
	}
}
