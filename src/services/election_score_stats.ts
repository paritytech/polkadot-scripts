import { ApiPromise } from "@polkadot/api";
import BN from "bn.js"
import axios from "axios";

export async function electionScoreStats(chain: string, api: ApiPromise, apiKey: string) {
	const count = 30
	const percent = new BN(50);

	const data = await axios.post(`https://${chain}.api.subscan.io/api/scan/extrinsics`, {
		"row": count,
		"page": 0,
		"module": "electionprovidermultiphase",
		"call": "submit_unsigned",
		"signed": "all",
		"no_params": false,
		"address": "",
	}, { headers: { "X-API-Key": apiKey } })

	// @ts-ignore
	const exts = data.data.data.extrinsics.slice(0, count);
	const scores = exts.map((e: any) => {
		const parsed = JSON.parse(e.params);
		return parsed[0].value.score
	})

	const avg = [new BN(0), new BN(0), new BN(0)]
	for (const score of scores) {
		console.log(score);
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

	console.log(`current minimum untrusted score is ${(await api.query.electionProviderMultiPhase.minimumUntrustedScore()).unwrapOrDefault().map((x) => api.createType('Balance', x).toHuman())}`)
}
