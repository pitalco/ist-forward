# IST Forwarder Core Eval
## Context
There are multiple PSM instances where users can mint IST against a set of chosen stable coins in 1-to-1 ratio. The 
`ist-forwarder` contract uses PSM to acquire IST so it can forward to the destination address. 

Cosmos tokens brought to Agoric blockchain over IBC are pegged to an ERTP asset. Meaning every time a new `ics20` packet
is received we mint the corresponding ERTP asset and we burn the ERTP asset when we want to send the cosmos token
over IBC to another blockchain. It is obvious that we need the ERTP asset's `mint` object in order to perform these tasks.

The purpose of this `core-eval` operation is to acquire the `mint` object of the ERTP asset that is used as the anchor
token in a given PSM instance. For this demo we chose `USDC_axl` as a random choice but it is easy to change it if 
required/wanted.

## How it works?
### Prerequisites
In order for this code to work you must setup your environment using below commands:

Open a terminal
```shell
## Terminal One
cd agoric-sdk/packages/cosmic-swingset
make scenario2-setup scenario2-run-chain
```

Open another terminal
```shell
## Terminal One
cd agoric-sdk/packages/cosmic-swingset
make scenario2-run-client
```

> `agoric-sdk/` version is mainnet-1b!

### For your environment
Be sure to update the below line in [the Makefile](../../Makefile) to the path of your own `agoric-sdk/` directory.

```
## Replace with your own sdk path
SDK_ROOT = $(shell cd ../agoric-master >/dev/null && pwd)
```


### Executing the core-eval
Run below command to execute the `core-eval`:

```shell
cd ist-forward/
make psm-mint
```

> If you want to run above command multiple times, do not forget to add `VOTE_PROPOSAL={proposal_number}` which 
> increases gradually. So to run above command for a second time you would do `make psm-mint VOTE_PROPOSAL=2`

The voting duration should be 45 seconds, so open chain logs and wait until you see the below logs in this order:

```shell
...
*** EXECUTING_CORE_EVAL ***
...
*** CORE_EVAL_EXECUTED ***
...
```

> A `core-eval` means that you're asking some network-wide powerful capabilities in order to perform your own task so
> the BLDer DAO votes on whether you should have those powers.

### Get The Mint
`make psm-mint` command deploys a contract to hold on to the `mint` object in a secure way. Security is achieved by
putting the `publicFacet` to the board and the `creatorFacet` to the scratch. The key to the creatorFacet is `anchor_mint`.
This holder contract is called `anchorMintHolder` and it can found [under `core-eval/` directory](./anchorMintHolder.js).

See the below screenshot to understand how to get the mint object:

<br/><img width="80%" src="./img.png">

The board id of the `publicFacet` is saved to a generated file called `dappConstants.json` which is under the `core-eval/`
directory.

## What's next
The deploy script that deploys `ist-forwarder` contract follow below steps:

* Fetch anchor asset's mint object from the `home.scratch`
* Build/gather contract terms
* Put the mint object to the `privateArgs`
* Install/start contract

> Important!!!: The mint object is stored in the `scratch` object of the ag-solo that runs in the port 8000!