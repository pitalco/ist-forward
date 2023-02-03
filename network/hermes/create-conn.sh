#!/bin/bash
set -e

# Load shell variables
. ./network/hermes/variables.sh

### Configure the clients and connection
echo "Initiating connection handshake..."
hermes --config ./network/hermes/config.toml create connection --a-chain agoriclocal --b-chain osmo-test-4

sleep 2
