# Agoric IST & PSM Forwarder Contract

This contract takes IBC assets via IBC transfers, and on an IBC transfer to the port transfer-psm turns the asset received into IST utilizing PSM contract. Once the asset is IST it then forwards the IST to the address specified.

## Getting Started
You will need to have NodeJS, Agoric SDK and IBC Golang Relayer installed to get started.

## Installation & Setup
```bash
cd $HOME
git clone https://github.com/pitalco/ist-forward
cd ist-forward
# Install NPM packages
agoric install
```

## Run Agoric Node and Solo
```bash
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-setup
# Look for the bootstrap key mnemonic in the command output marked with **Important**. We need this for next commands
# Lets restore relayer keys
cd $HOME/axelar-transfer
rm -r $HOME/.relayer
cp -r ./network/.relayer $HOME/.relayer
rly keys restore agoriclocal agoric "<bootstrap key mnemonic from above>"
# Run the chain
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-chain
# Run the client in ANOTHER terminal
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-client
```

# Make PSM Minter for Testing
```bash
cd $HOME/ist-forward
make psm-mint
```

## IMPORTANT
WAIT TO SEE SOMETHING LIKE THE FOLLOWING IN AGORIC CHAIN LOGS BEFORE MOVING ON
```bash
2023-07-20T04:46:29.386Z SwingSet: vat: v1: *** EXECUTING_CORE_EVAL ***
2023-07-20T04:46:29.511Z SwingSet: vat: v1: { kits: [Generator] {}, anchorMinter: Object [Alleged: USDC_axl mint] {}, anchorMintHolderPF: Object [Alleged: PublicFacet] {}, anchorMintBundleId: 'board01235' }
2023-07-20T04:46:29.562Z SwingSet: vat: v1: *** CORE_EVAL_EXECUTED ***
```

## Deploying the Forward Contract
Now lets deploy the Forward contract
```bash
# Make sure you are in the forward contract directory
cd $HOME/ist-forward/contract
agoric deploy ./deploy.js
```

## Setup Hermes Relayer
```bash
# When prompted for mnemonic, use the mnemonic spit out in `make scenario2-setup` above
make start-rly
```

## Start Contract (In Ag-Solo Repl)
```javascript
home.ibcport
// Get the installation for Contract
installation = E(home.board).getValue(Installation_ID)
// Get IST
istIssuer = E(home.zoe).getFeeIssuer()
// Get anchor issuer
issuer = E(home.agoricNames).lookup("issuer", "USDC_axl")
// Get anchor mint
cf = E(home.scratch).get("anchor_mint")
minter = E(cf).getAnchorMint(history[3])

// Start the IST Forward instance
instance = E(home.zoe).startInstance(
    installation,
    {
        IST: istIssuer,
        Anchor: issuer,
    },
    { board: home.board, namesByAddress: home.namesByAddress, network: home.network, psm, remoteConnectionId: "connection-0", port: history[0][0] },
    { minter },
)
```

## Create A PSM Forwarder
```javascript
pmf = E(instance.publicFacet).makePSMForwarder(remoteChainConnectionId);
// Save in scratch
E(home.scratch).set("ist-forward", pmf)
```

## Send Fake PSM Anchor Assets To Axelar Through Port
This is only needed for testing purposes (FYI)!
```javascript
```

## Send The Received Assets Back Through Channel To Agoric To Be Turned Into IST
NOTE: This contract asssumes that there is a PSM for the asset being sent!
```bash
# Query the balance to see the IBC Hash denom created
rly query balance axelar
rly transact transfer axelar agoriclocal 1000000{ibc denom from balance query above} {agoric address from above} {channel-id from above} --path agoric-axelar
```

Check your IST balance in your ag-solo and see it increase!