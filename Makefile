## Replace with your own sdk path
SDK_ROOT = $(shell cd ../agoric-sdk >/dev/null && pwd)
IST_FORWARDER_ROOT = $(shell pwd)

AGORIC = "$(SDK_ROOT)/packages/agoric-cli/bin/agoric"
AGCH = "$(SDK_ROOT)/bin/agd"

GAS_ADJUSTMENT = 1.2
CHAIN_ID = agoriclocal

EVAL_PERMIT = $(IST_FORWARDER_ROOT)/contract/core-eval/psm-permit.json
EVAL_CODE = $(IST_FORWARDER_ROOT)/contract/core-eval/psm-proposal.js
EVAL_DEPOSIT = 1000000ubld
VOTE_PROPOSAL = 1
VOTE_OPTION = yes

ANCHOR_HOLDER_BOARD_ID="dummy"

start-rly:
	@echo "Initializing relayer..." 
	./network/hermes/restore-keys.sh
	./network/hermes/rly-setup.sh
	./network/hermes/create-conn.sh
	@echo "Starting relayer..." 
	./network/hermes/start.sh

deploy-anchor-mint:
	$(AGORIC) deploy contract/core-eval/deployAnchorMint.js && sleep 3

board-id:
	$(eval ANCHOR_HOLDER_BOARD_ID := $(shell jq '.ANCHOR_HOLDER_PUBLIC_FACET_BOARD_ID' $(IST_FORWARDER_ROOT)/contract/core-eval/dappConstants.json))

update-eval:
	sed -i 's|const anchorMintBundleId = "";|const anchorMintBundleId = "'"$(ANCHOR_HOLDER_BOARD_ID)"'";|' $(HOME)/ist-forward/contract/core-eval/psm-proposal.js

psm-core-eval:
	$(AGCH) --home=$(SDK_ROOT)/packages/cosmic-swingset/t1/8000/ag-cosmos-helper-statedir tx gov submit-proposal swingset-core-eval \
    		$(EVAL_PERMIT) $(EVAL_CODE) \
    		--title="Swingset core eval" --description="Evaluate $(EVAL_CODE)" --deposit=$(EVAL_DEPOSIT) \
    		--gas=auto --gas-adjustment=$(GAS_ADJUSTMENT) \
    		--yes --chain-id=$(CHAIN_ID) --keyring-backend=test --from=ag-solo -b block

vote:
	$(AGCH) --home=$(SDK_ROOT)/packages/cosmic-swingset/t1/bootstrap tx gov vote $(VOTE_PROPOSAL) $(VOTE_OPTION) \
		--gas=auto --gas-adjustment=$(GAS_ADJUSTMENT) \
		--yes --chain-id=$(CHAIN_ID) --keyring-backend=test --from=bootstrap -b block

psm-mint: deploy-anchor-mint board-id update-eval psm-core-eval vote