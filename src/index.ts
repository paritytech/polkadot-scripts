import yargs from 'yargs';
import { bags, nominatorThresh, electionScore } from './handlers';


/**
 * Sample use of checking bags list but not sending a tx:
 * ```
 *  ts-node ./src/index.ts bags -w wss://kusama-rpc.polkadot.io
 * ```
 */
async function main() {
	await yargs
		.options({ // global options that apply to each command
			ws: {
				alias: 'w',
				description: 'the wss endpoint. It must allow unsafe RPCs.',
				default: "wss://rpc.polkadot.io",
				string: true,
				demandOption: false,
				global: true,
			},
		})
		.command(
			['bags'],
			'check the bags list',
			// @ts-ignore
			(yargs) => {
				return yargs.options({ // command specific options
					sendTx: {
						alias: 'T',
						description: 'Whether or not to send a rebag tx.',
						boolean: true,
						demandOption: false,
						default: false,
					},
				});
			},
			// @ts-ignore
			bags
		)
		// @ts-ignore
		.command(['noms-thresh'], 'Get number of stashes below threshold (needs improvement)', {}, nominatorThresh)
		.command(
			['election-score'],
			'Get stats on recent election scores',
			// @ts-ignore
			(yargs) => {
				return yargs.options({
					chain: {
						alias: 'c',
						description: 'Chain to check the election scores of',
						string: true,
						demandOption: false,
						default: 'polkadot',
						choices: ['polkadot', 'kusama']
					},
				});
			},
			// @ts-ignore
			electionScore
		)
		.parse();
}

main()
	.then(() => {
		console.info('Exiting ...');
		process.exit(0);
	})
	.catch(err => {
		console.error(err);
		process.exit(1);
	});
