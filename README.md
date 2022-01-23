# polkadot-scripts

Scripts that I use to diagnose Polkadot/Kusama.

```
Commands:
  bags            check the bags list
  chill-other     check and try to submit the chill-other transaction
                           to reduce staking nominators
  noms-thresh     Get number of stashes below threshold (needs
                           improvement)
  election-score  Get stats on recent election scores
  reap-stash      examine how many accounts can go through a reap-stash
  playground      random stuff

Options:
      --help     Show help                                             [boolean]
      --version  Show version number                                   [boolean]
  -w, --ws       the wss endpoint. It must allow unsafe RPCs.
                                     [string] [default: "wss://rpc.polkadot.io"]
  -s, --seed     path to a raw text file that contains your raw or mnemonic
                 seed, or its content. Can also be provided using SEED env
                 variable                                               [string]
```
