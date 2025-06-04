import { SubmittableExtrinsic } from '@polkadot/api/submittable/types';
import { ISubmittableResult } from '@polkadot/types/types/';
import { KeyringPair } from '@polkadot/keyring/types';
import { EventRecord, ApplyExtrinsicResult } from '@polkadot/types/interfaces/';
import { CodecHash } from '@polkadot/types/interfaces/runtime';
import { ApiPromise } from '@polkadot/api';
import { GenericExtrinsic } from '@polkadot/types';

interface ISubmitResult {
	hash: CodecHash;
	success: boolean;
	included: EventRecord[];
	finalized: EventRecord[];
}

export async function dryRunMaybeSendAndFinalize(
	api: ApiPromise,
	tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
	signer: KeyringPair,
	sendTx: boolean
): Promise<ISubmitResult | undefined> {
	console.log((await tx.paymentInfo(signer)).toHuman());
	const [success, result] = await dryRun(api, signer, tx);
	console.log(`dry-run outcome is ${success} / ${result}`);
	if (success && sendTx) {
		return await sendAndFinalize(tx, signer);
	} else if (!success) {
		console.log(`warn: dy-run failed.`);
	} else {
		console.log('no rebag batch tx sent');
	}
	return undefined;
}

export async function sendAndFinalize(
	tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
	signer: KeyringPair
): Promise<ISubmitResult> {
	return new Promise((resolve) => {
		let success = false;
		let included: EventRecord[] = [];
		let finalized: EventRecord[] = [];
		tx.signAndSend(signer, ({ events = [], status, dispatchError }) => {
			if (status.isInBlock) {
				success = dispatchError ? false : true;
				console.log(
					`📀 Transaction ${tx.meta.name}(..) included at blockHash ${status.asInBlock} [success = ${success}]`
				);
				included = [...events];
			} else if (status.isBroadcast) {
				console.log(`🚀 Transaction broadcasted.`);
			} else if (status.isFinalized) {
				console.log(
					`💯 Transaction ${tx.meta.name}(..) Finalized at blockHash ${status.asFinalized}`
				);
				finalized = [...events];
				const hash = status.hash;
				resolve({ success, hash, included, finalized });
			} else if (status.isReady) {
				// let's not be too noisy..
			} else {
				console.log(`🤷 Other status ${status}`);
			}
		});
	});
}

export async function sendAndAwaitInBlock(
	tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
	signer: KeyringPair
): Promise<ISubmitResult> {
	return new Promise((resolve) => {
		let success = false;
		let included: EventRecord[] = [];
		tx.signAndSend(signer, ({ events = [], status, dispatchError }) => {
			if (status.isInBlock) {
				success = dispatchError ? false : true;
				console.log(
					`📀 Transaction ${tx.meta.name}(..) included at blockHash ${status.asInBlock} [success = ${success}]`
				);
				included = [...events];
				const hash = status.hash;
				resolve({ success, hash, included, finalized: [] });
			} else if (status.isBroadcast) {
				console.log(`🚀 Transaction broadcasted.`);
			} else if (status.isReady) {
				// let's not be too noisy..
			} else {
				console.log(`🤷 Other status ${status}`);
			}
		});
	});
}

export async function dryRun(
	api: ApiPromise,
	signer: KeyringPair,
	tx: SubmittableExtrinsic<'promise', ISubmittableResult>
): Promise<[boolean, ApplyExtrinsicResult]> {
	const signed = await tx.signAsync(signer);
	const dryRun = await api.rpc.system.dryRun(signed.toHex());
	return [dryRun.isOk && dryRun.asOk.isOk, dryRun];
}
