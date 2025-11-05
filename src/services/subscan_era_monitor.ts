import axios from 'axios';
import { ApiPromise } from '@polkadot/api';
import { WsProvider } from '@polkadot/rpc-provider';

interface SubscanEvent {
	event_index: string;
	block_num: number;
	block_timestamp: number;
}

interface SubscanEventsResponse {
	data: {
		count: number;
		events: SubscanEvent[];
	};
}

interface SubscanEventDetailResponse {
	data: {
		params: Array<{
			type: string;
			type_name: string;
			value: any;
			name?: string;
			block_num: number;
		}>;
	};
}

/**
 * Extract timestamp from a block
 */
async function getBlockTimestamp(api: ApiPromise, blockNumber: number): Promise<number> {
	const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
	const signedBlock = await api.rpc.chain.getBlock(blockHash);

	console.log(`Fetching timestamp from block #${blockNumber} (hash: ${blockHash.toHex()})...`);
	console.log(`Block has `, signedBlock.toHuman());

	// Extract timestamp from Timestamp.set extrinsic
	for (const extrinsic of signedBlock.block.extrinsics) {
		console.log(extrinsic.toHuman());
		const { method: { section, method, args } } = extrinsic;

		if (section === 'timestamp' && method === 'set') {
			return (args[0] as any).toNumber();
		}
	}

	throw new Error(`No timestamp found in block ${blockNumber}`);
}

/**
 * Fetches Staking.EraPaid events from Kusama Asset Hub using Subscan API
 * and prints the timestamp differences between consecutive events.
 *
 * @param apiKey - Subscan API key (get one from pro.subscan.io)
 * @param count - Number of events to fetch (default: 50)
 */
export async function runSubscanEraMonitor(apiKey: string, count: number = 50): Promise<void> {
	const subscanBaseUrl = 'https://assethub-kusama.api.subscan.io';
	const wsUri = 'wss://kusama-asset-hub-rpc.polkadot.io';

	console.log(`Connecting to ${wsUri}...`);
	const api = await ApiPromise.create({ provider: new WsProvider(wsUri) });
	console.log(`Connected to chain: ${await api.rpc.system.chain()}`);
	console.log('');

	console.log(`Fetching the last ${count} Staking.EraPaid events from Kusama Asset Hub via Subscan...`);
	console.log('');

	try {
		// Fetch the list of Staking.EraPaid events
		const eventsResponse = await axios.post<SubscanEventsResponse>(
			`${subscanBaseUrl}/api/v2/scan/events`,
			{
				row: count,
				page: 0,
				module: 'staking',
				event_id: 'erapaid',
			},
			{
				headers: {
					'X-API-Key': apiKey,
					'Content-Type': 'application/json',
				},
			}
		);

		const events = eventsResponse.data.data.events;

		if (!events || events.length === 0) {
			console.log('No Staking.EraPaid events found.');
			await api.disconnect();
			return;
		}

		console.log(`Found ${events.length} Staking.EraPaid events.`);
		console.log('');

		// Sort events by block number (ascending - oldest first)
		events.sort((a, b) => a.block_num - b.block_num);

		// Print header
		console.log('Era Index | Block #     | Timestamp                 | Time Diff (s) | Time Diff (h)');
		console.log('─'.repeat(95));

		let previousTimestamp: number | null = null;

		// Fetch details for each event to get era index and timestamp
		for (let i = 0; i < events.length; i++) {
			const event = events[i];

			// Add delay to respect rate limits
			if (i > 0) {
				await sleep(200); // 200ms delay between requests
			}

			try {
				// Fetch detailed event information to get era index
				const detailResponse = await axios.post<SubscanEventDetailResponse>(
					`${subscanBaseUrl}/api/scan/event`,
					{
						event_index: event.event_index,
					},
					{
						headers: {
							'X-API-Key': apiKey,
							'Content-Type': 'application/json',
						},
					}
				);

				const eventDetail = detailResponse.data.data;

				// Get block timestamp from chain RPC
				const blockTimestamp = event.block_timestamp;

				// Extract era index from params (first parameter is typically the era index)
				let eraIndex = 'N/A';
				if (eventDetail.params && eventDetail.params.length > 0) {
					const eraParam = eventDetail.params.find(p => p.name === 'era_index' || p.type_name === 'EraIndex');
					if (eraParam) {
						eraIndex = eraParam.value.toString();
					} else {
						// Fallback: use first parameter
						eraIndex = eventDetail.params[0].value.toString();
					}
				}

				// Calculate time difference from previous event
				let timeDiffSeconds = 'N/A';
				let timeDiffHours = 'N/A';
				if (previousTimestamp !== null && previousTimestamp > 0) {
					const diffMs = blockTimestamp * 1000 - previousTimestamp * 1000;
					const diffSeconds = diffMs / 1000;
					const diffHours = diffSeconds / 3600;
					timeDiffSeconds = diffSeconds.toFixed(2);
					timeDiffHours = diffHours.toFixed(2);
				}

				// Format timestamp as readable date
				const date = new Date(blockTimestamp * 1000);
				// Validate date before formatting
				if (isNaN(date.getTime())) {
					console.log(`Skipping event ${event.event_index} - invalid date conversion`);
					continue;
				}
				const formattedDate = date.toISOString().replace('T', ' ').substring(0, 19);

				// Format output
				const eraStr = eraIndex.padEnd(9);
				// @ts-ignore
				const blockStr = eventDetail.block_num.toString().padEnd(11);
				const dateStr = formattedDate.padEnd(25);
				const diffSecStr = timeDiffSeconds.toString().padStart(13);
				const diffHrStr = timeDiffHours.toString().padStart(13);

				console.log(`${eraStr} | ${blockStr} | ${dateStr} | ${diffSecStr} | ${diffHrStr}`);

				previousTimestamp = blockTimestamp;

			} catch (error) {
				if (axios.isAxiosError(error)) {
					console.error(`Error fetching event ${event.event_index}: ${error.message}`);
					if (error.response) {
						console.error(`Status: ${error.response.status}`);
						console.error(`Data:`, error.response.data);
					}
				} else {
					console.error(`Error processing event ${event.event_index}:`, error);
				}
			}
		}

		console.log('');
		console.log('Done!');

	} catch (error) {
		if (axios.isAxiosError(error)) {
			console.error('Error fetching events from Subscan API:', error.message);
			if (error.response) {
				console.error(`Status: ${error.response.status}`);
				console.error(`Data:`, error.response.data);
			}
			if (error.response?.status === 401) {
				console.error('');
				console.error('Authentication failed. Please check your API key.');
				console.error('You can get an API key from: https://pro.subscan.io/');
			}
		} else {
			console.error('Unexpected error:', error);
		}
		await api.disconnect();
		throw error;
	} finally {
		await api.disconnect();
	}
}

/**
 * Sleep helper function
 */
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
