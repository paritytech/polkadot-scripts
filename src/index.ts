import { ApiPromise, WsProvider } from "@polkadot/api";
import axios from "axios";
import BN from "bn.js"
import yargs from 'yargs';
import { hideBin } from "yargs/helpers"

const optionsPromise = yargs(hideBin(process.argv))
	.option('endpoint', {
		alias: 'e',
		type: 'string',
		description: 'the wss endpoint. It must allow unsafe RPCs.',
		required: true,
	})
	.argv

async function main() {
	const options = await optionsPromise;
	const provider = new WsProvider(options.endpoint);
	const api = await ApiPromise.create({ provider });
	console.log(`Connected to node: ${options.endpoint} ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	// @ts-ignore
	await accountHistory(api)
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

async function electionScoreStats() {
	const chain = "polkadot";
	const endpoint = chain === "polkadot" ? "wss://rpc.polkadot.io" : "wss://kusama-rpc.polkadot.io"
	const provider = new WsProvider(endpoint);
	const api = await ApiPromise.create({ provider });
	console.log(`Connected to node: ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

	const key = process.env['API'];

	const count = 50
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

	console.log(avg);

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
}

