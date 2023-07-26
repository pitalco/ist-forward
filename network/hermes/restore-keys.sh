#!/bin/bash
set -e

# Load shell variables
. ./network/hermes/variables.sh

echo "Please enter your mnemonic:"
read mnemonic

# Remove the mnemonic.txt file if it exists
if [ -f ./network/hermes/mnemonic.txt ]; then
    rm ./network/hermes/mnemonic.txt
fi

# Create a new mnemonic.txt file
touch ./network/hermes/mnemonic.txt

# Write the mnemonic to the file
echo $mnemonic > ./network/hermes/mnemonic.txt

### Sleep is needed otherwise the relayer crashes when trying to init
sleep 1s
### Restore Keys
hermes --config ./network/hermes/config.toml keys add --hd-path "m/44'/564'/0'/0/0" --chain agoriclocal --mnemonic-file ./network/hermes/mnemonic.txt --overwrite
sleep 5s

hermes --config ./network/hermes/config.toml keys add --chain devnet-wk --mnemonic-file ./network/hermes/mnemonic-axelar.txt --overwrite