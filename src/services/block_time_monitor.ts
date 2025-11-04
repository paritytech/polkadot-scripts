import '@polkadot/api-augment';
import { ApiPromise } from '@polkadot/api';
import { WsProvider } from '@polkadot/rpc-provider';
import { Header } from '@polkadot/types/interfaces';
import * as blessed from 'blessed';
import { subscribeFinalizedHeadsWithGapDetection } from '../helpers/subscription';

interface BlockInfo {
	number: number;
	hash: string;
	timestamp: number;
	author: string | null;
}

/**
 * Extract block information from a block
 */
async function extractBlockInfo(api: ApiPromise, blockHash: string, blockNumber: number): Promise<BlockInfo> {
	// Get the block with extrinsics
	const signedBlock = await api.rpc.chain.getBlock(blockHash);
	const header = signedBlock.block.header;

	// Extract timestamp from Timestamp.set extrinsic
	let timestamp: number | null = null;
	for (const extrinsic of signedBlock.block.extrinsics) {
		const { method: { section, method, args } } = extrinsic;

		if (section === 'timestamp' && method === 'set') {
			timestamp = (args[0] as any).toNumber();
			break;
		}
	}

	if (timestamp === null) {
		throw new Error('No timestamp found in block');
	}

	// Extract block author from digest
	let author: string | null = null;
	const digestLogs = header.digest.logs;

	// Try to get author from session module
	try {
		const sessionValidators = await api.query.session.validators();

		// Extract slot number from PreRuntime digest
		let slotNumber: number | null = null;
		for (const log of digestLogs) {
			if (log.isPreRuntime) {
				const [engine, data] = log.asPreRuntime;
				if (engine.toUtf8() === 'aura' || engine.toUtf8() === 'BABE') {
					const slot = api.createType('u64', data);
					slotNumber = slot.toNumber();
					break;
				}
			}
		}

		if (slotNumber !== null && sessionValidators.length > 0) {
			const validatorIndex = slotNumber % sessionValidators.length;
			author = sessionValidators[validatorIndex].toString();
		}
	} catch (e) {
		// If we can't decode, try alternative methods
		for (const log of digestLogs) {
			if (log.isPreRuntime) {
				try {
					const [engine] = log.asPreRuntime;
					author = `Consensus(${engine.toUtf8()})`;
				} catch (e) {
					// Ignore parsing errors
				}
			} else if (log.isConsensus) {
				try {
					const [engine] = log.asConsensus;
					author = `Consensus(${engine.toUtf8()})`;
				} catch (e) {
					// Ignore parsing errors
				}
			}
		}
	}

	return {
		number: blockNumber,
		hash: blockHash,
		timestamp,
		author: author || 'Unknown'
	};
}

/**
 * Get Subscan base URL for a chain
 */
function getSubscanBaseUrl(chainName: string): string {
	const chain = chainName.toLowerCase();

	// Map common chain names to Subscan endpoints
	if (chain.includes('polkadot') && chain.includes('asset')) {
		return 'https://assethub-polkadot.subscan.io';
	} else if (chain.includes('kusama') && chain.includes('asset')) {
		return 'https://assethub-kusama.subscan.io';
	} else if (chain.includes('westend') && chain.includes('asset')) {
		return 'https://assethub-westend.subscan.io';
	} else if (chain.includes('polkadot')) {
		return 'https://polkadot.subscan.io';
	} else if (chain.includes('kusama')) {
		return 'https://kusama.subscan.io';
	} else if (chain.includes('westend')) {
		return 'https://westend.subscan.io';
	} else if (chain.includes('paseo')) {
		return 'https://paseo.subscan.io';
	}

	// Default fallback
	return 'https://polkadot.subscan.io';
}

/**
 * Format a block entry as a string
 * Block numbers can be clicked in the terminal to open in browser
 */
function formatBlock(blockInfo: BlockInfo, timeDiff: number | null, subscanBaseUrl: string): string {
	const blockNumStr = `#${blockInfo.number}`.padEnd(12);
	const timestampStr = blockInfo.timestamp.toString().padEnd(20);
	const diffStr = timeDiff !== null ? `${timeDiff.toFixed(2)}s`.padEnd(9) : 'N/A'.padEnd(9);
	const authorStr = blockInfo.author;

	return `${blockNumStr} | ${timestampStr} | ${diffStr} | ${authorStr}`;
}

/**
 * Monitor finalized blocks and track block time differences
 * This service subscribes to finalized blocks and extracts:
 * - Block timestamp from the Timestamp.set extrinsic
 * - Block author from the consensus digest
 * - Time difference between consecutive blocks
 *
 * If gaps are detected in finalized blocks, it backfills the missing blocks.
 *
 * Displays results in a two-panel TUI:
 * - Left panel: All blocks with time differences
 * - Right panel: Collators with slow blocks (> 7 seconds)
 */
export async function runBlockTimeMonitor(wsUri: string): Promise<void> {
	const earlyLogs: string[] = [];
	earlyLogs.push(`Connecting to ${wsUri}...`);

	const api = await ApiPromise.create({ provider: new WsProvider(wsUri) });
	const chain = await api.rpc.system.chain();
	const chainName = chain.toString();

	earlyLogs.push(`Connected to ${chainName}`);

	// Get Subscan base URL for this chain
	const subscanBaseUrl = getSubscanBaseUrl(chainName);

	// Create the blessed screen
	const screen = blessed.screen({
		smartCSR: true,
		title: 'Block Time Monitor',
		sendFocus: true,
		useBCE: true,
		mouse: true
	});

	// Main container
	const container = blessed.box({
		parent: screen,
		top: 0,
		left: 0,
		width: '100%',
		height: '100%',
	});

	// Block list box (left side, top)
	const blockListBox = blessed.list({
		parent: container,
		label: `Blocks - ${chain}`,
		border: { type: 'line' },
		top: 0,
		left: 0,
		width: '60%',
		height: '70%',
		scrollable: true,
		tags: true,
		keys: true,
		mouse: true,
		alwaysScroll: true,
		interactive: true,
		scrollbar: {
			ch: ' ',
			track: {
				bg: 'cyan'
			},
			style: {
				inverse: true
			}
		},
		style: {
			border: { fg: 'cyan' },
			selected: {
				bg: 'blue',
				fg: 'white'
			}
		}
	});

	// Slow collators box (right side, top)
	const slowCollatorsBox = blessed.box({
		parent: container,
		label: 'Slow Collators (> 7s)',
		border: { type: 'line' },
		top: 0,
		left: '60%',
		width: '40%',
		height: '70%',
		scrollable: true,
		tags: true,
		keys: true,
		mouse: true,
		alwaysScroll: true,
		scrollbar: {
			ch: ' ',
			track: {
				bg: 'magenta'
			},
			style: {
				inverse: true
			}
		},
		style: {
			border: { fg: 'magenta' }
		}
	});

	// Console output box (bottom)
	const consoleBox = blessed.box({
		parent: container,
		label: 'Console Output',
		border: { type: 'line' },
		top: '70%',
		left: 0,
		width: '100%',
		height: '30%-1',
		scrollable: true,
		keys: true,
		input: true,
		mouse: true,
		alwaysScroll: true,
		wrap: false,
		tags: true,
		scrollbar: {
			ch: ' ',
			track: {
				bg: 'yellow'
			},
			style: {
				inverse: true
			}
		},
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
		content: ' Press q to quit | Tab to switch panels | ↑↓ to scroll | Enter/Click to open block in Subscan ',
		style: {
			fg: 'black',
			bg: 'white'
		}
	});

	// Set initial focus
	blockListBox.focus();

	// Console logs storage
	const consoleLogs: string[] = [];

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

	// Add early logs to console
	earlyLogs.forEach(log => logToConsole(log));

	// Focus styling
	function updateFocusStyles() {
		blockListBox.style.border = { fg: 'cyan' };
		slowCollatorsBox.style.border = { fg: 'magenta' };
		consoleBox.style.border = { fg: 'yellow' };

		const focused = screen.focused;
		if (focused) {
			focused.style.border = { fg: 'white' };
		}
		screen.render();
	}

	// Key bindings
	screen.key(['q', 'C-c'], () => {
		api.disconnect();
		return process.exit(0);
	});

	screen.key(['tab'], () => {
		if (screen.focused === blockListBox) {
			slowCollatorsBox.focus();
		} else if (screen.focused === slowCollatorsBox) {
			consoleBox.focus();
		} else {
			blockListBox.focus();
		}
		updateFocusStyles();
	});

	// Update focus styles on focus change
	screen.on('element focus', updateFocusStyles);

	// Mouse click and keyboard handlers for block list
	blockListBox.on('select', (_item, index) => {
		// Skip header rows (0 = header, 1 = separator)
		if (index < 2) return;

		const entryIndex = index - 2;
		if (entryIndex >= 0 && entryIndex < blockEntries.length) {
			const blockNumber = blockEntries[entryIndex].blockNumber;
			const url = `${subscanBaseUrl}/block/${blockNumber}`;

			// Open URL in default browser
			const openCommand = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
			const { exec } = require('child_process');
			exec(`${openCommand} "${url}"`, (error: any) => {
				if (error) {
					logToConsole(`Failed to open browser: ${error.message}`);
				} else {
					logToConsole(`Opened Subscan: ${url}`);
				}
			});
		}
	});

	blockListBox.on('click', () => {
		blockListBox.focus();
		updateFocusStyles();
	});

	slowCollatorsBox.on('click', () => {
		slowCollatorsBox.focus();
		updateFocusStyles();
	});

	consoleBox.on('click', () => {
		consoleBox.focus();
		updateFocusStyles();
	});

	// Storage for block entries and slow collators
	const blockEntries: Array<{ text: string; blockNumber: number }> = [];
	const slowCollatorMap = new Map<string, { count: number; totalTime: number; blocks: number[] }>();

	// Update display function
	function updateDisplay() {
		// Build blocks display with header at top
		const blockHeader = 'Block #      | Timestamp (ms)       | Diff (s) | Author';
		const blockSeparator = '─'.repeat(80);
		const items = [blockHeader, blockSeparator, ...blockEntries.map(e => e.text)];
		blockListBox.setItems(items);

		// Update slow collators display
		const slowCollatorEntries: string[] = [];
		slowCollatorEntries.push('Author                                                | Count | Avg');
		slowCollatorEntries.push('─'.repeat(70));

		const sortedCollators = Array.from(slowCollatorMap.entries())
			.map(([author, data]) => ({
				author,
				count: data.count,
				avgTime: data.totalTime / data.count,
				blocks: data.blocks
			}))
			.sort((a, b) => b.count - a.count);

		sortedCollators.forEach(({ author, count, avgTime }) => {
			const authorStr = author.padEnd(53);
			const countStr = count.toString().padStart(5);
			const avgStr = avgTime.toFixed(2) + 's';
			slowCollatorEntries.push(`${authorStr} | ${countStr} | ${avgStr}`);
		});

		slowCollatorsBox.setContent(slowCollatorEntries.join('\n'));
		screen.render();
	}

	let lastBlockNumber: number | null = null;
	let lastBlockInfo: BlockInfo | null = null;

	// Subscribe to finalized block headers with automatic gap detection and backfilling
	await subscribeFinalizedHeadsWithGapDetection(
		api,
		async (header: Header, blockHash: string, isBackfill: boolean) => {
			try {
				const blockNumber = header.number.toNumber();

				// Extract block info
				const blockInfo = await extractBlockInfo(api, blockHash, blockNumber);

				// Calculate time diff from previous block
				const timeDiff = lastBlockInfo !== null
					? (blockInfo.timestamp - lastBlockInfo.timestamp) / 1000
					: null;

				const blockEntry = formatBlock(blockInfo, timeDiff, subscanBaseUrl);
				blockEntries.unshift({ text: blockEntry, blockNumber: blockNumber });

				// Limit stored blocks to prevent memory issues
				if (blockEntries.length > 1000) {
					blockEntries.pop();
				}

				// Track slow collators
				if (timeDiff !== null && timeDiff > 7) {
					const author = blockInfo.author || 'Unknown';
					const existing = slowCollatorMap.get(author) || { count: 0, totalTime: 0, blocks: [] };
					existing.count++;
					existing.totalTime += timeDiff;
					existing.blocks.push(blockNumber);
					slowCollatorMap.set(author, existing);

					// Log slow block to console (only for current blocks, not backfilled)
					if (!isBackfill) {
						logToConsole(`Slow block detected: #${blockNumber} (${timeDiff.toFixed(2)}s) by ${author}`);
					}
				}

				// Update tracking variables
				lastBlockInfo = blockInfo;
				lastBlockNumber = blockNumber;

				// Update display
				updateDisplay();

			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				logToConsole(`Error processing block #${header.number}: ${errorMsg}`);
				updateDisplay();
			}
		},
		// onGapDetected callback
		(lastBlock, currentBlock, gap) => {
			logToConsole(`Gap detected: ${gap} block(s) between #${lastBlock} and #${currentBlock}. Backfilling...`);
		},
		// onBackfillError callback
		(blockNumber, error) => {
			logToConsole(`Error backfilling block #${blockNumber}: ${error.message}`);
		}
	);

	// Initial render
	updateDisplay();

	// Keep the process running
	return new Promise<void>((resolve) => {
		process.on('exit', () => {
			api.disconnect();
		});
	});
}
