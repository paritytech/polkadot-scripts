/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ApiPromise } from '@polkadot/api';
import BN from 'bn.js';
import axios from 'axios';
import { exit } from 'process';

async function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function electionScoreStats(chain: string, api: ApiPromise, apiKey: string) {
	const count = 30;
	const percent = new BN(10);

	const data = await axios.post(
		`https://assethub-paseo.api.subscan.io/api/v2/scan/events`,
		{
			row: count,
			page: 0,
			module: 'multiblockelectionverifier',
			event_id: 'queued',
		},
		{ headers: { 'X-API-Key': apiKey } }
	);

	// @ts-ignore
	const events = data.data.data.events

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const eventIds = events.map((e: any) => {
		return e.event_index
	});

	const scores = [];
	for (let i = 0; i < eventIds.length; i++) {
		const eventId = eventIds[i];
		const data = await axios.post(
			`https://assethub-paseo.api.subscan.io/api/scan/event`,
			{
				event_index: eventId,
			},
			{ headers: { 'X-API-Key': apiKey } }
		);
		const score = data.data.data.params[0].value
		console.log(score);
		scores.push([score.minimal_stake, score.sum_stake, score.sum_stake_squared]);
		await sleep(200);
	}

	const avg = [new BN(0), new BN(0), new BN(0)];
	for (const score of scores) {
		avg[0] = avg[0].add(new BN(score[0]));
		avg[1] = avg[1].add(new BN(score[1]));
		avg[2] = avg[2].add(new BN(score[2]));
	}

	avg[0] = avg[0].div(new BN(count));
	avg[1] = avg[1].div(new BN(count));
	avg[2] = avg[2].div(new BN(count));

	console.log(`--- averages`);
	console.log(`${avg[0].toString()}, ${api.createType('Balance', avg[0]).toHuman()}`);
	console.log(`${avg[1].toString()}, ${api.createType('Balance', avg[1]).toHuman()}`);
	console.log(`${avg[2].toString()}, ${api.createType('Balance', avg[2]).toHuman()}`);

	avg[0] = avg[0].mul(percent).div(new BN(100));
	avg[1] = avg[1].mul(percent).div(new BN(100));
	avg[2] = avg[2].mul(new BN(100).add(percent)).div(new BN(100));

	console.log(`--- ${percent.toString()}% thereof:`);
	console.log(`${avg[0].toString()}, ${api.createType('Balance', avg[0]).toHuman()}`);
	console.log(`${avg[1].toString()}, ${api.createType('Balance', avg[1]).toHuman()}`);
	console.log(`${avg[2].toString()}, ${api.createType('Balance', avg[2]).toHuman()}`);

	// @ts-ignore
	const current = (await api.query.multiblockElection.minimumScore()).unwrapOrDefault()
	console.log(
		`--- current minimum untrusted score:
${current.minimalStake.toString()}, ${api.createType('Balance', current.minimalStake).toHuman()}
${current.sumStake.toString()}, ${api.createType('Balance', current.sumStake).toHuman()}
${current.sumStakeSquared.toString()}, ${api.createType('Balance', current.sumStakeSquared).toHuman()}
		`
	);
}
