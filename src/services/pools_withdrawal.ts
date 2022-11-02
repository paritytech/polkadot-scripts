import { ApiPromise } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';

import { AccountId, Balance } from '@polkadot/types/interfaces/runtime';
import { dryRun, dryRunMaybeSendAndFinalize, sendAndFinalize } from '../helpers';

interface ReadySubPool {
  account: AccountId,
  balance: Balance,
}

// TODO(gpestana)
// There are two situations when the bot can call to withdrawn unbonded funds
// 1. When the funds in subpools are more than bonding period oldl
// 2. When the pool is in 'destroying phase'
// in both cases, ensure that the chunks are released


export async function doPoolsWithdrawalAll(
	api: ApiPromise,
	signer: KeyringPair,
	sendTx: boolean,
	count: number
): Promise<void> {

   let poolID = 6;
   let subPoolAfter = await api.query.nominationPools.subPoolsStorage(poolID);
    if (subPoolAfter.isSome) {
      console.log(poolID);
      console.log(subPoolAfter.toHuman());
    }

    let num_slashing_spans = 1;
    let tx = api.tx.nominationPools.poolWithdrawUnbonded(poolID, num_slashing_spans);
    console.log("--- Transaction ---");
    console.log(tx.toHuman());

	const maybeSubmit = await dryRunMaybeSendAndFinalize(api, tx, signer, sendTx);
  if (maybeSubmit) {
	  const { success, included } = maybeSubmit;
		console.log(`ℹ️  success = ${success}. Included =`);
		for (const inc of included) {
		  process.stdout.write(`${inc.event.section}::${inc.event.method}`);
    }
  } else {
    console.log("Submission failed.")
  }

   let subPoolAfter2 = await api.query.nominationPools.subPoolsStorage(poolID);
    if (subPoolAfter2.isSome) {
      console.log(poolID);
      console.log(subPoolAfter2.toHuman());
    }

  /*
    let subPoolID = 30;
    let num_slashing_spans = 1;
    
  let subPool = await api.query.nominationPools.subPoolsStorage(subPoolID);
    if (subPool.isSome) {
      console.log(subPoolID);
      console.log(subPool.toHuman());
    }
 
   let tx = await api.tx.nominationPools.poolWithdrawUnbonded(subPoolID, num_slashing_spans);
    
    console.log("built tx: ---");
    console.log(tx.toHuman());

		const success = await sendAndFinalize(tx, signer);
    console.log(`sendAndFinalize res: ${success}`);

  let subPoolAfter = await api.query.nominationPools.subPoolsStorage(subPoolID);
    if (subPoolAfter.isSome) {
      console.log(subPoolID);
      console.log(subPoolAfter.toHuman());
    }
*/
  console.log("Done.");
}

/*
pub struct SubPools<T: Config> {
	/// A general, era agnostic pool of funds that have fully unbonded. The pools
	/// of `Self::with_era` will lazily be merged into into this pool if they are
	/// older then `current_era - TotalUnbondingPools`.
	no_era: UnbondPool<T>,

	/// Map of era in which a pool becomes unbonded in => unbond pools.
	with_era: UnbondingPoolsWithEra<T>,
}
*/
