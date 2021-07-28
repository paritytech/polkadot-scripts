import { ApiPromise, WsProvider } from "@polkadot/api";
import axios from "axios";
import BN from "bn.js"

async function main() {
	const key = process.env['API'];
	const chain = "kusama";
	// @ts-ignore
	const endpoint = chain === "polkadot" ? "wss://rpc.polkadot.io" : "wss://kusama-rpc.polkadot.io"

	const count = 50
	const percent = new BN(60);

	const provider = new WsProvider(endpoint);
	const api = await ApiPromise.create({ provider });
	console.log(`Connected to node: ${(await api.rpc.system.chain()).toHuman()} [ss58: ${api.registry.chainSS58}]`)

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

main().catch(console.error).finally(() => process.exit());

