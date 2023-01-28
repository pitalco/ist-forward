// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';

/**
 *
 * @type {ContractStartFn}
 */
const start = async (zcf) => {
  const zcfMint = await zcf.makeZCFMint('Tokens');
 
  const { issuer, brand } = zcfMint.getIssuerRecord();

  /** @type {OfferHandler} */
  const mintPayment = (seat) => {
    const amount = AmountMath.make(brand, 1000n);
    zcfMint.mintGains(harden({ Token: amount }), seat);
    seat.exit();
    return 'Offer completed. You should receive a payment from Zoe';
  };

  const creatorFacet = Far('creatorFacet', {
    makeInvitation: () => zcf.makeInvitation(mintPayment, 'mint a payment'),
    getTokenIssuer: () => issuer,
  });

  const publicFacet = Far('publicFacet', {
    getTokenIssuer: () => issuer,
  });

  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
