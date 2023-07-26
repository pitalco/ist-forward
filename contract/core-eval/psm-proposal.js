// @ts-nocheck

const main = async (
  {
    consume: {
      contractKits,
      agoricNames,
      board
    },
  },
) => {
  console.log('*** EXECUTING_CORE_EVAL ***');
  const anchorMintBundleId = "board05970"; // Needs to be empty string("") when starting
  let anchorMinter;

  const [usdcAxlIssuer, kits, anchorMintHolderPF] = await Promise.all([
    E(agoricNames).lookup('issuer', 'USDC_axl'),
    E(contractKits).values(),
    E(board).getValue(anchorMintBundleId),
  ]);

  for (const kit of kits) {
    if (kit.publicFacet === usdcAxlIssuer) {
      ({ creatorFacet: anchorMinter } = kit)
    }
  }

  console.log({ kits, anchorMinter, anchorMintHolderPF, anchorMintBundleId });

  await E(anchorMintHolderPF).setAnchorMint(usdcAxlIssuer, anchorMinter);

  console.log('*** CORE_EVAL_EXECUTED ***');
};

harden(main)

main;
