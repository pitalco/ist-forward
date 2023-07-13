import { makeScalarBigMapStore } from '@agoric/vat-data';
import { Far } from '@endo/marshal';

const start = zcf => {
  const mintMap = makeScalarBigMapStore('Mints');

  const publicFacet = Far('PublicFacet', {
    setAnchorMint: (issuer, mint) => {
      if (!mintMap.has(issuer)) {
        mintMap.init(issuer, mint);
      }
    },
    getInstance: () => zcf.getInstance(),
  });

  const creatorFacet = Far('CreatorFacet', {
    getAnchorMint: issuer => {
      return mintMap.get(issuer);
    },
    getInstance: () => zcf.getInstance(),
  });

  return { publicFacet, creatorFacet };
};

harden(start);
export { start };