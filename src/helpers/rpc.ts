import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { ISubmittableResult } from "@polkadot/types/types/"
import { KeyringPair } from "@polkadot/keyring/types";
import { EventRecord, } from "@polkadot/types/interfaces/";
import { CodecHash } from "@polkadot/types/interfaces/runtime"
import { ApiPromise } from "@polkadot/api";

interface ISubmitResult {
	hash: CodecHash,
	success: boolean,
	included: EventRecord[],
	finalized: EventRecord[],
}

export async function sendAndFinalize(tx: SubmittableExtrinsic<"promise", ISubmittableResult>, account: KeyringPair): Promise<ISubmitResult> {
	return new Promise(async resolve => {
		let success = false;
		let included: EventRecord[] = []
		let finalized: EventRecord[] = []
		const unsubscribe = await tx.signAndSend(account, ({ events = [], status, dispatchError }) => {
			if (status.isInBlock) {
				success = dispatchError ? false : true;
				console.log(`📀 Transaction ${tx.meta.name}(..) included at blockHash ${status.asInBlock} [success = ${success}]`);
				included = [...events]
			} else if (status.isBroadcast) {
				console.log(`🚀 Transaction broadcasted.`);
			} else if (status.isFinalized) {
				console.log(`💯 Transaction ${tx.meta.name}(..) Finalized at blockHash ${status.asFinalized}`);
				finalized = [...events]
				const hash = status.hash;
				unsubscribe();
				resolve({ success, hash, included, finalized })
			} else if (status.isReady) {
				// let's not be too noisy..
			} else {
				console.log(`🤷 Other status ${status}`)
			}
		})
	})
}

export async function dryRun(api: ApiPromise, account: KeyringPair, batch: SubmittableExtrinsic<"promise", ISubmittableResult>): Promise<boolean> {
	const signed = await batch.signAsync(account);
	const dryRun = await api.rpc.system.dryRun(signed.toHex());
	console.log(`dry run of transaction => `, dryRun.toHuman())
	return dryRun.isOk && dryRun.asOk.isOk
}