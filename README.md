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
# Run the chain with economy
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-chain-economy
# Run the client in ANOTHER terminal
cd $HOME/agoric-sdk/packages/cosmic-swingset
make scenario2-run-client
```

## Deploying the Axelar Contract
Now lets deploy the Axelar contract
```bash
# Make sure you are in the axelar contract directory
cd $HOME/ist-forward/contract
agoric deploy ./deploy.js
```

## Start Contract
```javascript
// Get the installation for Contract
installation = E(home.board).getValue(Installation_ID)
// Start the IST Forward instance
instance = E(home.zoe).startInstance(installation)
// Save in scratch
E(home.scratch).set("ist-forward", instance)
```

## Create An IBC Channel with transfer-psm Port
```bash
# Once all chains are running create a transfer channel
rly transact link agoric-axelar --override --src-port transfer --dst-port transfer-psm
# You can check the channels using
rly query channels agoriclocal
rly query channels axelar
```

## Send USDC To transfer-psm Port to Turn Into IST
```bash
rly transact transfer axelar agoriclocal 1000000uausdc {agoric address from above} {channel-id from above} --path agoric-axelar
```

## Turn It Back into USDC on Axelar
```bash
agoric deploy ./scripts/send-back.js
```