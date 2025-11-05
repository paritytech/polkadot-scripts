/* eslint-disable @typescript-eslint/ban-ts-comment */

import '@polkadot/api-augment';
import yargs from 'yargs';
import {
	rebagHandler,
	electionScoreHandler,
	playgroundHandler,
	reapStashHandler,
	nominatorThreshHandler,
	chillOtherHandler,
	stateTrieMigrationHandler,
	stakingStatsHandler,
	inFrontHandler,
	commandCenterHandler,
	blockTimeMonitorHandler,
	subscanEraMonitorHandler
} from './handlers';
import { NETWORK_CONFIGS } from './services';

// Export all of the services so this codebase can be used as a library as well.
export * from './services';

/**
 * Sample use of checking bags list but not sending a tx:
 * ```
 *  ts-node ./src/index.ts bags -w wss://kusama-rpc.polkadot.io
 * ```
 */
async function main() {
	await yargs
		.options({
			// global options that apply to each command
			ws: {
				alias: 'w',
				description: 'the wss endpoint. It must allow unsafe RPCs.',
				default: 'wss://polkadot.dotters.network',
				string: true,
				demandOption: false,
				global: true
			},
			seed: {
				alias: 's',
				type: 'string',
				description:
					'path to a raw text file that contains your raw or mnemonic seed, or its content. Can also be provided using SEED env variable',
				required: false,
				global: true
			}
		})
		.command(
			['in-front'],
			'find an account the target account can be put in front of',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					target: {
						alias: 't',
						description: 'The target account to be checked',
						demandOption: true
					}
				});
			},
			inFrontHandler
		)
		.command(
			['rebag'],
			'check the bags list for rebag operations',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					sendTx: {
						alias: 'T',
						description: 'Whether or not to send a rebag tx.',
						boolean: true,
						demandOption: false,
						default: false
					},
					target: {
						alias: 't',
						description:
							'Who to target. Accepted values are "all", a number, or a specific "ss58" account id',
						demandOption: false,
						default: 'all'
					}
				});
			},
			rebagHandler
		)
		.command(
			['chill-other'],
			'check and try to submit the chill-other transaction to reduce staking nominators',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					sendTx: {
						alias: 'T',
						description: 'Whether or not to send a chill other tx.',
						boolean: true,
						demandOption: false,
						default: false
					},
					count: {
						alias: 'c',
						description: 'Max amount of stakers to chill.',
						number: true,
						demandOption: false,
						default: -1
					},
					noDryRun: {
						boolean: true,
						description:
							'do not dry-run the command first. Advised not to set. Only set if you do not have access to local node with this RPC'
					}
				});
			},
			chillOtherHandler
		)
		.command(
			['noms-thresh'],
			'Get number of stashes below threshold (needs improvement)',
			{},
			// @ts-ignore
			nominatorThreshHandler
		)
		// @ts-ignore
		.command(
			['staking-stats'],
			'Basic statistics of the staking limits',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					at: {
						description: 'Block number at which to run the analysis',
						demandOption: false,
						default: false,
						string: true
					}
				});
			},
			stakingStatsHandler
		)
		.command(
			['election-score'],
			'Get stats on recent election scores',
			{},
			// @ts-ignore
			electionScoreHandler
		)
		// @ts-ignore
		.command(
			['reap-stash'],
			'examine how many accounts can go through a reap-stash',
			(yargs) => {
				return yargs.options({
					sendTx: {
						alias: 'T',
						description: 'Whether or not to send a rebag tx.',
						boolean: true,
						demandOption: false,
						default: false
					},
					count: {
						alias: 'c',
						description:
							'How many rebag transactions to send. Iteration will stop if provided. All bags are iterated if  otherwise.',
						number: true,
						demandOption: false,
						default: -1
					}
				});
			},
			reapStashHandler
		)
		// @ts-ignore
		.command(
			['state-trie-migration'],
			'Try and submit transactions to migrate the state trie version. See https://github.com/paritytech/substrate/pull/10073. This can only work against a node that supports dry-run RPC.',
			(yargs) => {
				return yargs.options({
					count: {
						description: 'Total number of transactions to send. Unlimited if not set.',
						number: true,
						demandOption: false
					},
					'item-limit': {
						description: 'Number of items to try and migrate in each round',
						number: true,
						demandOption: true
					},
					'size-limit': {
						description: 'size of items to try and migrate in each round',
						number: true,
						demandOption: true
					}
				});
			},
			stateTrieMigrationHandler
		)
		// @ts-ignore
		.command(
			['ahm-command-center'],
			'Monitor Polkadot Asset Hub and Relay Chain',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					'rc-uri': {
						description: 'Relay Chain WebSocket URI',
						type: 'string',
						demandOption: false
					},
					'ah-uri': {
						description: 'Asset Hub WebSocket URI',
						type: 'string',
						demandOption: false
					},
					network: {
						description: 'Network shorthand (westend or paseo)',
						type: 'string',
						choices: Object.keys(NETWORK_CONFIGS),
						demandOption: false
					}
				});
			},
			commandCenterHandler
		)
		// @ts-ignore
		.command(
			['playground'],
			'random stuff',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					target: {
						alias: 't',
						description: 'Pool ID to process',
						demandOption: true,
						type: 'string'
					}
				});
			},
			playgroundHandler
		)
		// @ts-ignore
		.command(
			['block-time'],
			'Monitor finalized blocks and track time differences',
			{},
			// @ts-ignore
			blockTimeMonitorHandler
		)
		// @ts-ignore
		.command(
			['subscan-era'],
			'Fetch Staking.EraPaid events from Kusama Asset Hub via Subscan and show timestamp differences',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					'api-key': {
						description: 'Subscan API key (or use SUBSCAN_API_KEY env var)',
						type: 'string',
						demandOption: false
					},
					count: {
						alias: 'c',
						description: 'Number of events to fetch',
						type: 'number',
						demandOption: false,
						default: 50
					}
				});
			},
			subscanEraMonitorHandler
		)
		.parse();
}

main()
	.then(() => {
		console.info('Exiting ...');
		process.exit(0);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
