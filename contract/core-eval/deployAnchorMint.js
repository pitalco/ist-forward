import { E } from '@endo/far';
import { makeHelpers } from '@agoric/deploy-script-support';
import fs from 'fs/promises';

const deployAnchorMint = async (homeP, endowments) => {
  const { scratch, board, zoe } = E.get(homeP);

  const { install } = await makeHelpers(homeP, endowments);
  const { installation } = await install(
    './anchorMintHolder.js',
    'AnchorMintHolder'
  );

  const { creatorFacet, publicFacet } = await E(zoe).startInstance(installation);

  const [anchorScratchId, publicFacetBoardId] = await Promise.all([
    E(scratch).set('anchor_mint', creatorFacet),
    E(board).getId(publicFacet)
  ]);

  const dappConstants = {
    ANCHOR_SCRATCH_ID: anchorScratchId,
    ANCHOR_HOLDER_PUBLIC_FACET_BOARD_ID: publicFacetBoardId,
  };

  const constantsFile = endowments.pathResolve(
    `./dappConstants.json`,
  );
  console.log('writing', constantsFile);
  const defaultsContents = `\
${JSON.stringify(dappConstants, undefined, 2)}
`;
  await fs.writeFile(constantsFile, defaultsContents);
};

export default deployAnchorMint;