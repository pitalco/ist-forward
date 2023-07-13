import mintHolderBundle from '@agoric/vats/bundles/bundle-mintHolder.js';
import { E } from '@endo/far';

const deployAnchorAsset = async homeP => {
  const { zoe, scratch, board } = E.get(homeP);

  const anchorTerms = {
    keyword: 'USDC_sample',
    assetKind: 'nat',
    displayInfo: { decimalPlaces: 6 }
  };

  const installation = await E(zoe).install(mintHolderBundle);
  console.log({installation})

  const {
    creatorFacet: anchorMint,
    publicFacet: anchorIssuer,
  } = await E(zoe).startInstance(installation, undefined, anchorTerms);

  const [anchorIssuerBoardId, mintKey] = await Promise.all([
    E(board).getId(anchorIssuer),
    E(scratch).set('anchor_mint', anchorMint),
  ]);

  console.log(`Done with the keys: ${anchorIssuerBoardId},${mintKey}`);
};

export default deployAnchorAsset;