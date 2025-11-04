import { ApiPromise } from '@polkadot/api';
import { Header } from '@polkadot/types/interfaces';

/**
 * A wrapper around subscribeFinalizedHeads that handles gap detection and backfilling.
 *
 * This function subscribes to finalized block headers and automatically detects gaps
 * in block numbers. When a gap is detected, it backfills the missing blocks by fetching
 * them and calling the callback for each missing block before processing the current block.
 *
 * @param api - The ApiPromise instance to use for subscription
 * @param callback - The callback function to call for each finalized block (including backfilled ones).
 *                   Receives (header, blockHash, isBackfill) where isBackfill is true for gap-filled blocks
 * @param onGapDetected - Optional callback when a gap is detected, receives (lastBlockNumber, currentBlockNumber, gap)
 * @param onBackfillError - Optional callback when an error occurs during backfilling, receives (blockNumber, error)
 * @returns Promise that resolves to an unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = await subscribeFinalizedHeadsWithGapDetection(
 *   api,
 *   async (header, blockHash, isBackfill) => {
 *     console.log(`Block #${header.number}: ${blockHash} (backfilled: ${isBackfill})`);
 *   },
 *   (lastBlock, currentBlock, gap) => {
 *     console.log(`Gap detected: ${gap} blocks between #${lastBlock} and #${currentBlock}`);
 *   }
 * );
 * ```
 */
export async function subscribeFinalizedHeadsWithGapDetection(
	api: ApiPromise,
	callback: (header: Header, blockHash: string, isBackfill: boolean) => Promise<void>,
	onGapDetected?: (lastBlockNumber: number, currentBlockNumber: number, gap: number) => void,
	onBackfillError?: (blockNumber: number, error: Error) => void
): Promise<() => void> {
	let lastBlockNumber: number | null = null;

	const unsubscribe = await api.rpc.chain.subscribeFinalizedHeads(async (header: Header) => {
		const blockNumber = header.number.toNumber();
		const blockHash = header.hash.toHex();

		// Check for gaps in block numbers
		if (lastBlockNumber !== null && blockNumber > lastBlockNumber + 1) {
			// Gap detected! Backfill missing blocks
			const gap = blockNumber - lastBlockNumber - 1;

			if (onGapDetected) {
				onGapDetected(lastBlockNumber, blockNumber, gap);
			}

			// Fetch and process missing blocks
			for (let missingBlockNum = lastBlockNumber + 1; missingBlockNum < blockNumber; missingBlockNum++) {
				try {
					const missingBlockHash = await api.rpc.chain.getBlockHash(missingBlockNum);

					// Create a synthetic header for the missing block
					const missingBlock = await api.rpc.chain.getBlock(missingBlockHash);
					const missingHeader = missingBlock.block.header;

					// Call the callback for the missing block (with isBackfill = true)
					await callback(missingHeader, missingBlockHash.toHex(), true);

					// Update tracking variable for each backfilled block
					lastBlockNumber = missingBlockNum;
				} catch (err) {
					if (onBackfillError) {
						const error = err instanceof Error ? err : new Error(String(err));
						onBackfillError(missingBlockNum, error);
					}
				}
			}
		}

		// Process current block (with isBackfill = false)
		await callback(header, blockHash, false);

		// Update tracking variable
		lastBlockNumber = blockNumber;
	});

	return unsubscribe;
}
