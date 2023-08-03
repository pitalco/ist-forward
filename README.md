# Agoric IST & PSM Forwarder Contract

This contract takes IBC assets via IBC transfers, and on an IBC transfer to the port transfer-psm turns the asset received into IST utilizing PSM contract. Once the asset is IST it then forwards the IST to the address specified.

## Getting Started
You will need to have NodeJS, Agoric SDK and IBC Golang Relayer installed to get started.

## NOTE
You have to use a patched SDK here https://github.com/pitalco/agoric-sdk/tree/fix-vibc. These patches will be applied to Mainnet-b in next upgrade.

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
# Look for the bootstrap key mnemonic in the command output marked with **Important**. We need this for relayer commands below
# Run the chain
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-chain
# Run the client in ANOTHER terminal
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-client
```

## Setup & Start Relayer
```bash
# Input the mnemonic from above when prompted to
cd $HOME/ist-forward
make start-rly
hermes --config ./network/hermes/config.toml start
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

// Get PSM
instance = E(home.agoricNames).lookup('instance', 'psm-IST-USDC_axl')
psm = E(home.zoe).getPublicFacet(instance)

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

## Send Fake PSM Anchor Assets To Axelar Through Port
This is only needed for testing purposes (FYI)!
```javascript
// Send ERTP assets through IBC via Pegasus
purse = E(home.wallet).getPurse("USD Coin");
brand = E(issuer).getBrand();
payment = E(purse).withdraw(
    {
        brand,
        value: 10_000_000n
    }
);
E(instance.publicFacet).transfer(payment, minter, 'axelar1p4802fzkna9874d4try3qqchf84hmnq9ea8qnc', purse);
// Get agoric bech32 address for hermes later
E(home.myAddressNameAdmin).getMyAddress()
```

## Send The Received Assets Back Through Channel To Agoric To Be Turned Into IST
NOTE: This contract asssumes that there is a PSM for the asset being sent!
```bash
# Query the balance to see the IBC Hash denom created
axelard query bank balances axelar1p4802fzkna9874d4try3qqchf84hmnq9ea8qnc --node https://axelartest-rpc.quantnode.tech:443

# Send assets back to agoric to be minted into IST
hermes --config ./network/hermes/config.toml tx ft-transfer --dst-chain agoriclocal --src-chain axelar-testnet-lisbon-3 --src-port transfer --src-channel {channel on axelar} --amount 10000000 --denom {denom from above query} --timeout-height-offset 1000 --receiver {your agoric address from above}
```

Check your IST balance in your ag-solo and see it increase!