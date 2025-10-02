import '@polkadot/api-augment';
import { ApiPromise } from '@polkadot/api';
import { WsProvider } from '@polkadot/rpc-provider';
import { IEvent, IEventData } from '@polkadot/types/types';
import { Duration } from "luxon";
import * as blessed from 'blessed';
import { Option } from "@polkadot/types";
import { SpWeightsWeightV2Weight } from "@polkadot/types/lookup";
import { BlockNumber } from '@polkadot/types/interfaces';

interface EventEntry {
	chain: 'RC' | 'AH';
	blockNumber: number;
	blockHash: string;
	event: string;
}

// Network configurations
export const NETWORK_CONFIGS = {
	westend: {
		rcUri: 'wss://westend-rpc.polkadot.io',
		ahUri: 'wss://westend-asset-hub-rpc.polkadot.io'
	},
	paseo: {
		rcUri: 'wss://paseo.dotters.network',
		ahUri: 'wss://sys.ibp.network/asset-hub-paseo'
	},
	local: {
		rcUri: 'ws://localhost:9944',
		ahUri: 'ws://localhost:9946'
	}
};

function formatWeight(weight: any): string {
	if (weight && weight.refTime && weight.proofSize) {
		const refTime = weight.refTime.toString();
		const proofSize = weight.proofSize.toString();
		return `${refTime}/${proofSize}`;
	} else if (weight && weight.mandatory && weight.operational && weight.normal) {
		// Handle FrameSupportDispatchPerDispatchClassWeight
		const refTime = (weight.mandatory.refTime.toNumber() + weight.operational.refTime.toNumber() + weight.normal.refTime.toNumber()) / Math.pow(10, 9);
		const proofSize = (weight.mandatory.proofSize.toNumber() + weight.operational.proofSize.toNumber() + weight.normal.proofSize.toNumber()) / 1024;
		return `ref-time: ${refTime.toFixed(2)} ms, proof-size: ${proofSize.toFixed(2)} kB`;
	}
	return weight ? weight.toString() : 'unknown';
}

function formatArgs(args: any[]): string {
	return args.map(arg => {
		if (typeof arg === 'object' && arg !== null) {
			try {
				return JSON.stringify(arg, null, 0);
			} catch {
				return String(arg);
			}
		}
		return String(arg);
	}).join(' ');
}

export async function runCommandCenter(rcUri: string, ahUri: string): Promise<void> {
	// Get APIs
	const rcApi = await ApiPromise.create({ provider: new WsProvider(rcUri) });
	const ahApi = await ApiPromise.create({ provider: new WsProvider(ahUri) });

	const rcChain = await rcApi.rpc.system.chain();
	const ahChain = await ahApi.rpc.system.chain();

	// Store early console logs before setting up TUI
	const earlyLogs: string[] = [];
	const originalConsole = {
		log: console.log,
		error: console.error,
		warn: console.warn,
		info: console.info
	};

	// Override console methods to capture early API logs
	console.log = (...args) => {
		const message = formatArgs(args);
		if (!message.includes('\x1b') && !message.includes('7[')) {
			earlyLogs.push(`[LOG] ${message}`);
		}
	};

	console.error = (...args) => {
		earlyLogs.push(`[ERROR] ${formatArgs(args)}`);
	};

	console.warn = (...args) => {
		earlyLogs.push(`[WARN] ${formatArgs(args)}`);
	};

	console.info = (...args) => {
		earlyLogs.push(`[INFO] ${formatArgs(args)}`);
	};

	// Create the blessed screen
	const screen = blessed.screen({
		smartCSR: true,
		title: 'Polkadot Command Center'
	});

	// Main container
	const container = blessed.box({
		parent: screen,
		top: 0,
		left: 0,
		width: '100%',
		height: '100%',
		mouse: true,
	});

	// RC status box (top left)
	const rcBox = blessed.box({
		parent: container,
		label: `Relay: ${rcChain}`,
		border: { type: 'line' },
		top: 0,
		left: 0,
		width: '50%',
		height: '33%',
		scrollable: true,
		tags: true,
		style: {
			border: { fg: 'cyan' }
		}
	});

	// AH status box (top right)
	const ahBox = blessed.box({
		parent: container,
		label: `AH: ${ahChain}`,
		border: { type: 'line' },
		top: 0,
		left: '50%',
		width: '50%',
		height: '33%',
		scrollable: true,
		tags: true,
		style: {
			border: { fg: 'magenta' }
		}
	});

	// RC Events box (middle left)
	const rcEventsBox = blessed.box({
		parent: container,
		label: 'RC Events',
		border: { type: 'line' },
		top: '33%',
		left: 0,
		width: '50%',
		height: '34%',
		scrollable: true,
		tags: true,
		keys: true,
		vi: true,
		style: {
			border: { fg: 'cyan' }
		}
	});

	// AH Events box (middle right)
	const ahEventsBox = blessed.box({
		parent: container,
		label: 'AH Events',
		border: { type: 'line' },
		top: '33%',
		left: '50%',
		width: '50%',
		height: '34%',
		scrollable: true,
		tags: true,
		keys: true,
		vi: true,
		style: {
			border: { fg: 'magenta' }
		}
	});

	// Console output box (bottom)
	const consoleBox = blessed.box({
		parent: container,
		label: 'Console Output',
		border: { type: 'line' },
		top: '67%',
		left: 0,
		width: '100%',
		height: '30%',
		scrollable: true,
		tags: true,
		keys: true,
		vi: true,
		style: {
			border: { fg: 'yellow' }
		}
	});

	// Status bar
	const statusBar = blessed.box({
		parent: container,
		bottom: 0,
		left: 0,
		width: '100%',
		height: 1,
		content: ' Press q to quit | ↑↓ to scroll | Tab to switch panels | h: load 600 blocks | H: load 14400 blocks ',
		style: {
			fg: 'black',
			bg: 'white'
		}
	});

	// Store events separately for each chain
	const rcEvents: EventEntry[] = [];
	const ahEvents: EventEntry[] = [];
	let isLoadingHistory = false;
	let rcLowestBlock: number | null = null;
	let ahLowestBlock: number | null = null;

	// Console logs storage
	const consoleLogs: string[] = [];

	// Add early logs to console logs
	consoleLogs.push(...earlyLogs.reverse());

	// Custom logging function
	function logToConsole(message: string) {
		const timestamp = new Date().toLocaleTimeString();
		consoleLogs.unshift(`[${timestamp}] ${message}`);
		if (consoleLogs.length > 100) {
			consoleLogs.pop();
		}
		consoleBox.setContent(consoleLogs.join('\n'));
		screen.render();
	}

	// Update console methods to use the TUI console box
	console.log = (...args) => {
		const message = formatArgs(args);
		// Skip blessed internal logs
		if (!message.includes('\x1b') && !message.includes('7[')) {
			logToConsole(message);
		}
	};

	console.error = (...args) => {
		logToConsole('ERROR: ' + formatArgs(args));
	};

	console.warn = (...args) => {
		logToConsole('WARN: ' + formatArgs(args));
	};

	console.info = (...args) => {
		logToConsole('INFO: ' + formatArgs(args));
	};

	// Helper to add events and sort them
	function addEvents(events: EventEntry[]) {
		events.forEach(event => {
			if (event.chain === 'RC') {
				rcEvents.push(event);
				if (rcEvents.length > 5000) rcEvents.shift(); // Remove oldest events
			} else if (event.chain === 'AH') {
				ahEvents.push(event);
				if (ahEvents.length > 5000) ahEvents.shift(); // Remove oldest events
			}
		});

		updateEventDisplay();
	}

	// Update the event display with sorting
	function updateEventDisplay() {
		// Sort events by block number (newest first)
		rcEvents.sort((a, b) => b.blockNumber - a.blockNumber);
		ahEvents.sort((a, b) => b.blockNumber - a.blockNumber);

		// Update displays
		rcEventsBox.setContent(rcEvents.map(e => e.event).join('\n'));
		ahEventsBox.setContent(ahEvents.map(e => e.event).join('\n'));
		screen.render();
	}

	// Shared progress state for parallel loading
	let rcProgress: string | null = null;
	let ahProgress: string | null = null;

	function updateProgressStatus() {
		const parts: string[] = [];
		if (rcProgress) parts.push(rcProgress);
		if (ahProgress) parts.push(ahProgress);

		if (parts.length === 0) {
			statusBar.setContent(' Press q to quit | ↑↓ to scroll | Tab to switch panels | h: load 600 blocks | H: load 14400 blocks ');
		} else {
			statusBar.setContent(` ${parts.join(' | ')} | Press q to quit `);
		}
		screen.render();
	}

	// Function to load historical events
	async function loadHistoricalEvents(blocksToLoad: number) {
		if (isLoadingHistory) return;
		isLoadingHistory = true;

		rcProgress = 'Loading RC Historical Events...';
		ahProgress = 'Loading AH Historical Events...';
		updateProgressStatus();

		try {
			// Load RC and AH historical events in parallel
			const [rcResult, ahResult] = await Promise.all([
				loadRCHistoricalEvents(blocksToLoad),
				loadAHHistoricalEvents(blocksToLoad)
			]);

			// Clear progress indicators
			rcProgress = null;
			ahProgress = null;

			// Add all events
			if (rcResult.events.length > 0) {
				addEvents(rcResult.events);
			}
			if (ahResult.events.length > 0) {
				addEvents(ahResult.events);
			}

			// Ensure final sorting and display update after all historical events are loaded
			updateEventDisplay();

			updateProgressStatus();

			const rcStatus = rcResult.reachedGenesis ? ' (reached genesis)' : '';
			const ahStatus = ahResult.reachedGenesis ? ' (reached genesis)' : '';
			logToConsole(`Historical events loaded. RC: ${rcResult.events.length} events${rcStatus}, AH: ${ahResult.events.length} events${ahStatus}`);

		} catch (err) {
			rcProgress = null;
			ahProgress = null;
			updateProgressStatus();
			logToConsole(`Error loading history: ${err}`);
			screen.render();
		} finally {
			isLoadingHistory = false;
		}
	}

	// Load RC historical events
	async function loadRCHistoricalEvents(blocksToLoad: number) {
		const rcHistoricalEvents: EventEntry[] = [];
		let reachedGenesis = false;

		if (rcLowestBlock === null || rcLowestBlock > 0) {
			let rcBlockHash = rcLowestBlock === null
				? await rcApi.rpc.chain.getFinalizedHead()
				: await rcApi.rpc.chain.getBlockHash(rcLowestBlock);
			let blocksProcessed = 0;

			while (blocksProcessed < blocksToLoad) {
				try {
					const block = await rcApi.rpc.chain.getBlock(rcBlockHash);
					const blockNumber = block.block.header.number.toNumber();

					if (blockNumber === 0) {
						rcLowestBlock = 0;
						reachedGenesis = true;
						break;
					}

					// Update progress
					const remainingBlocks = blocksToLoad - blocksProcessed;
					rcProgress = `Loading RC Block #${blockNumber} (${remainingBlocks} left)`;
					updateProgressStatus();

					const events = await rcApi.query.system.events.at(rcBlockHash);
					const relevantEvents = events
						.map((e) => e.event)
						.filter((e) => {
							const ahClientEvents = (e: IEventData) => e.section == 'stakingAhClient';
							const sessionEvents = (e: IEventData) => e.section == 'session' || e.section == 'historical';
							return ahClientEvents(e.data) || sessionEvents(e.data);
						});

					relevantEvents.forEach(e => {
						rcHistoricalEvents.push({
							chain: 'RC',
							blockNumber,
							blockHash: rcBlockHash.toString(),
							event: `[RC #${blockNumber}] ${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`
						});
					});

					rcLowestBlock = blockNumber - 1;
					rcBlockHash = block.block.header.parentHash;
					blocksProcessed++;
				} catch (blockError: any) {
					// Stop on any error during historical loading
					console.error(`RC: Error at block ${rcBlockHash}, stopping historical load:`, blockError.toString());
					break;
				}
			}
		}

		// Clear RC progress when done
		rcProgress = null;
		updateProgressStatus();

		return { events: rcHistoricalEvents, reachedGenesis };
	}

	// Load AH historical events
	async function loadAHHistoricalEvents(blocksToLoad: number) {
		const ahHistoricalEvents: EventEntry[] = [];
		let reachedGenesis = false;

		if (ahLowestBlock === null || ahLowestBlock > 0) {
			let ahBlockHash = ahLowestBlock === null
				? await ahApi.rpc.chain.getFinalizedHead()
				: await ahApi.rpc.chain.getBlockHash(ahLowestBlock);
			let blocksProcessed = 0;

			while (blocksProcessed < blocksToLoad) {
				try {
					const block = await ahApi.rpc.chain.getBlock(ahBlockHash);
					const blockNumber = block.block.header.number.toNumber();

					if (blockNumber === 0) {
						ahLowestBlock = 0;
						reachedGenesis = true;
						break;
					}

					// Update progress
					const remainingBlocks = blocksToLoad - blocksProcessed;
					ahProgress = `Loading AH Block #${blockNumber} (${remainingBlocks} left)`;
					updateProgressStatus();

					const events = await ahApi.query.system.events.at(ahBlockHash);
					const weight = await ahApi.query.system.blockWeight.at(ahBlockHash);
					const relevantEvents = events
						.map((e) => e.event)
						.filter((e) => {
							const election = (e: IEventData) => e.section == 'multiBlockElection' || e.section == 'multiBlockElectionVerifier' || e.section == 'multiBlockElectionSigned' || e.section == 'multiBlockElectionUnsigned';
							const rcClient = (e: IEventData) => e.section == 'stakingRcClient';
							const staking = (e: IEventData) => e.section == 'staking' && (e.method == 'EraPaid' || e.method == 'SessionRotated' || e.method == 'PagedElectionProceeded');
							return election(e.data) || rcClient(e.data) || staking(e.data);
						});

					relevantEvents.forEach(e => {
						ahHistoricalEvents.push({
							chain: 'AH',
							blockNumber,
							blockHash: ahBlockHash.toString(),
							event: `[AH #${blockNumber}][${formatWeight(weight)}] ${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`
						});
					});

					ahLowestBlock = blockNumber - 1;
					ahBlockHash = block.block.header.parentHash;
					blocksProcessed++;
				} catch (blockError: any) {
					// Stop on any error during historical loading
					console.error(`AH: Error at block ${ahBlockHash}, stopping historical load:`, blockError.toString());
					break;
				}
			}
		}

		// Clear AH progress when done
		ahProgress = null;
		updateProgressStatus();

		return { events: ahHistoricalEvents, reachedGenesis };
	}

	// Set initial focus and styling
	rcBox.focus();

	// Focus styling
	function updateFocusStyles() {
		// Reset all borders
		rcBox.style.border = { fg: 'cyan' };
		ahBox.style.border = { fg: 'magenta' };
		rcEventsBox.style.border = { fg: 'cyan' };
		ahEventsBox.style.border = { fg: 'magenta' };
		consoleBox.style.border = { fg: 'yellow' };

		// Set focused style
		const focused = screen.focused;
		if (focused) {
			focused.style.border = { fg: 'white' };
			if (focused === rcBox) {
				focused.style.label = { bg: 'cyan', fg: 'black' };
			} else if (focused === ahBox) {
				focused.style.label = { bg: 'magenta', fg: 'black' };
			} else if (focused === rcEventsBox) {
				focused.style.label = { bg: 'cyan', fg: 'black' };
			} else if (focused === ahEventsBox) {
				focused.style.label = { bg: 'magenta', fg: 'black' };
			} else if (focused === consoleBox) {
				focused.style.label = { bg: 'yellow', fg: 'black' };
			}
		}
		screen.render();
	}

	// Key bindings
	screen.key(['q', 'C-c'], () => {
		return process.exit(0);
	});

	screen.key(['h'], () => {
		loadHistoricalEvents(600);
	});

	screen.key(['H'], () => {
		loadHistoricalEvents(14400);
	});

	screen.key(['tab'], () => {
		if (screen.focused === rcBox) {
			ahBox.focus();
		} else if (screen.focused === ahBox) {
			rcEventsBox.focus();
		} else if (screen.focused === rcEventsBox) {
			ahEventsBox.focus();
		} else if (screen.focused === ahEventsBox) {
			consoleBox.focus();
		} else {
			rcBox.focus();
		}
		updateFocusStyles();
	});

	// Update focus styles on focus change
	screen.on('element focus', updateFocusStyles);

	// Subscribe to RC updates
	rcApi.rpc.chain.subscribeFinalizedHeads(async (header) => {
		try {
			const index = await rcApi.query.session.currentIndex();
			// whether there is a validator set queued in ah-client. for this we need to display only the id and the length of the set.
			// @ts-ignore
			const hasQueuedInClientTemp = await rcApi.query.stakingAhClient.validatorSet() as Option<[u32, Vec<AccountId>]>;
			let hasQueuedInClient = 'none'
			if (hasQueuedInClientTemp.isSome) {
				let [id, validators] = hasQueuedInClientTemp.unwrap();
				hasQueuedInClient = `id=${id}, len=${validators.length}`
			}
			// the range of historical session data that we have in the RC.
			const historicalRange = await rcApi.query.historical.storedRange();

			// whether we have already passed a new validator set to session, and therefore in the next session rotation we want to pass this id to AH.
			// whether we have already passed a new validator set to session, and therefore in the next session rotation we want to pass this id to AH.
			const hasNextActiveId = await rcApi.query.stakingAhClient.nextSessionChangesValidators();
			// Operating mode of the client.
			const mode = await rcApi.query.stakingAhClient.mode();
			// pending validator points
			const validatorPoints = (await rcApi.query.stakingAhClient.validatorPoints.keys()).length

			// Events
			const events = await rcApi.query.system.events();
			const eventsOfInterest = events
				.map((e) => e.event)
				.filter((e) => {
					const ahClientEvents = (e: IEventData) => e.section == 'stakingAhClient';
					const sessionEvents = (e: IEventData) => e.section == 'session' || e.section == 'historical';
					return ahClientEvents(e.data) || sessionEvents(e.data);
				});

			// Add events to the events panel
			eventsOfInterest.forEach(e => {
				const eventEntry: EventEntry = {
					chain: 'RC',
					blockNumber: header.number.toNumber(),
					blockHash: header.hash.toString(),
					event: `[RC #${header.number}] ${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`
				};
				addEvents([eventEntry]);
			});

			// Update RC box
			const rcContent = [
				`{bold}{cyan-fg}Finalized Block:{/} #${header.number}`,
				'',
				'{bold}{yellow-fg}Session Info:{/}',
				`  Current Index: ${index}`,
				`  Queued in Session: ${hasQueuedInClient}`,
				`  Historical Range: ${historicalRange}`,
				'',
				'{bold}{yellow-fg}Staking AH Client:{/}',
				`  Queued in Client: ${hasQueuedInClient}`,
				`  Next Active ID: ${hasNextActiveId}`,
				`  Mode: ${mode}`,
				`  Validator Points: ${validatorPoints}`,
				'',
			];

			rcBox.setContent(rcContent.join('\n'));
			screen.render();
		} catch (err) {
			rcBox.setContent(`Error: ${err}`);
			screen.render();
		}
	});

	// Subscribe to AH updates
	ahApi.rpc.chain.subscribeFinalizedHeads(async (header) => {
		try {
			const weight = await ahApi.query.system.blockWeight();
			// the current planned era
			const currentEra = (await ahApi.query.staking.currentEra()).unwrap();
			// the active era
			const activeEra = (await ahApi.query.staking.activeEra()).unwrap();
			const activeEraDuration = Duration.fromMillis(new Date().getTime() - (activeEra.start.unwrap().toNumber())).toFormat("hh:mm:ss");
			// the starting index of the active era
			const bondedEras = await ahApi.query.staking.bondedEras();
			const activeEraStartSessionIndex = bondedEras.find(([e, i]) => e.eq(activeEra.index))?.[1].toNumber() || 0;
			// counter for stakers
			const validatorCandidates = await ahApi.query.staking.counterForValidators();
			const nominatorCandidates = await ahApi.query.staking.counterForNominators();
			const maxValidatorsCount = await ahApi.query.staking.maxValidatorsCount();
			const maxNominatorsCount = await ahApi.query.staking.maxNominatorsCount();
			const validatorCount = await ahApi.query.staking.validatorCount();

			// Eras that have not been pruned yet
			const unprunedEras = ahApi.query.staking.eraPruningState ? (await ahApi.query.staking.eraPruningState.entries()).map(([k, v]) => k.args[0]).sort() : 'unimplemented!';

			// stake limits for stakers
			const minNominatorBond = await ahApi.query.staking.minNominatorBond();
			const minValidatorBond = await ahApi.query.staking.minNominatorBond();
			const minNominatorActiveStake = await ahApi.query.staking.minimumActiveStake();

			const forcing = await await ahApi.query.staking.forceEra();

			// the basic state of the election provider
			const phase = await ahApi.query.multiBlockElection.currentPhase();
			const round = await ahApi.query.multiBlockElection.round();
			const snapshotRange = (await ahApi.query.multiBlockElection.pagedVoterSnapshotHash.entries()).map(([k, v]) => k.args[1]).sort();
			const queuedScore = await ahApi.query.multiBlockElectionVerifier.queuedSolutionScore(round);
			const signedSubmissions = await ahApi.query.multiBlockElectionSigned.sortedScores(round);

			// The client
			const lastSessionReportEndIndex = await ahApi.query.stakingRcClient.lastSessionReportEndingIndex() as Option<BlockNumber>;

			// Events
			const events = await ahApi.query.system.events();
			const eventsOfInterest = events
				.map((e) => e.event)
				.filter((e) => {
					const election = (e: IEventData) => e.section == 'multiBlockElection' || e.section == 'multiBlockElectionVerifier' || e.section == 'multiBlockElectionSigned' || e.section == 'multiBlockElectionUnsigned';
					const rcClient = (e: IEventData) => e.section == 'stakingRcClient';
					const staking = (e: IEventData) => e.section == 'staking' && (e.method == 'EraPaid' || e.method == 'SessionRotated' || e.method == 'PagedElectionProceeded');
					return election(e.data) || rcClient(e.data) || staking(e.data);
				});

			// Add events to the events panel
			eventsOfInterest.forEach(e => {
				const eventEntry: EventEntry = {
					chain: 'AH',
					blockNumber: header.number.toNumber(),
					blockHash: header.hash.toString(),
					event: `[AH #${header.number}][${formatWeight(weight)}] ${e.section.toString()}::${e.method.toString()}(${e.data.toString()})`
				};
				addEvents([eventEntry]);
			});

			// Update AH box
			const ahContent = [
				`{bold}{magenta-fg}Finalized Block:{/} #${header.number}`,
				'',
				'{bold}{yellow-fg}Staking:{/}',
				`  Current Era: ${currentEra}`,
				`  Active Era: ${activeEra} (duration: ${activeEraDuration})`,
				`  Unpruned Eras: ${unprunedEras}`,
				`  Forcing: ${forcing}`,
				'',
				'{bold}{yellow-fg}Validators/Nominators:{/}',
				`  Wanted Validators: ${validatorCount}`,
				`  Validator Candidates: ${validatorCandidates} (max: ${maxValidatorsCount})`,
				`  Nominator Candidates: ${nominatorCandidates} (max: ${maxNominatorsCount})`,
				'',
				'{bold}{yellow-fg}Election:{/}',
				`  Phase: ${phase}`,
				`  Round: ${round}`,
				`  Snapshot Range: ${snapshotRange}`,
				`  Queued Score: ${queuedScore.toString()}`,
				`  Signed Submissions: ${signedSubmissions.toString()}`,
				'',
				'{bold}{yellow-fg}RC Client:{/}',
				`  Last Session Report End Index: ${lastSessionReportEndIndex.toString()}`,
				'',
			];

			ahBox.setContent(ahContent.join('\n'));
			screen.render();
		} catch (err) {
			ahBox.setContent(`Error: ${err}`);
			screen.render();
		}
	});

	// Initial render
	screen.render();

	// Display early logs in console box
	consoleBox.setContent(consoleLogs.join('\n'));

	// Add initial console message
	logToConsole('AHM Command Center started. Logs will appear here.');

	// Load initial 600 blocks of history
	setTimeout(() => {
		logToConsole('Loading initial 600 blocks of historical events...');
		loadHistoricalEvents(600);
	}, 100);

	// Prevent the function from returning by creating a promise that never resolves
	return new Promise<void>((resolve) => {
		// Restore console methods on exit
		process.on('exit', () => {
			console.log = originalConsole.log;
			console.error = originalConsole.error;
			console.warn = originalConsole.warn;
			console.info = originalConsole.info;
		});
	});
}
