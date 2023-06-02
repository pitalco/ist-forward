// @ts-check

import { Far, makeLoopback } from '@endo/captp';
import { E } from '@endo/eventual-send';

import {
  makeAgoricNamesAccess,
  makePromiseSpace,
} from '@agoric/vats/src/core/utils.js';
import { makeBoard } from '@agoric/vats/src/lib-board.js';
import { makeScalarMapStore } from '@agoric/vat-data';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeMockChainStorageRoot } from '@agoric/vats/tools/storage-test-utils.js';
import { makeIssuerKit } from '@agoric/ertp';

import {
  installGovernance,
  withAmountUtils,
} from '@agoric/inter-protocol/test/supports.js';
import { startEconomicCommittee } from '@agoric/inter-protocol/src/proposals/startEconCommittee.js';
import { startPSM, startPSMCharter } from '@agoric/inter-protocol/src/proposals/startPSM.js';
import bundlePsm from '@agoric/inter-protocol/bundles/bundle-psm.js';
import charterBundle from '@agoric/inter-protocol/bundles/bundle-psmCharter.js';
import { allValues } from '@agoric/inter-protocol/src/collect.js';
import { setUpZoeForTest } from '@agoric/inter-protocol/test/supports.js';

/**
 * @param {TimerService} timer
 * @param {import('@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup').FarZoeKit} [farZoeKit]
 */
export const setupPsmBootstrap = async (
  timer = buildManualTimer(console.log),
  farZoeKit,
) => {
  if (!farZoeKit) {
    farZoeKit = await setUpZoeForTest();
  }
  const { zoe } = farZoeKit;

  const space = /** @type {any} */ (makePromiseSpace());
  const { produce, consume } =
    /** @type { import('@agoric/inter-protocol/src/proposals/econ-behaviors.js').EconomyBootstrapPowers } */ (
      space
    );

  produce.chainTimerService.resolve(timer);
  produce.zoe.resolve(zoe);

  const { agoricNames, agoricNamesAdmin, spaces } = makeAgoricNamesAccess();
  produce.agoricNames.resolve(agoricNames);
  produce.agoricNamesAdmin.resolve(agoricNamesAdmin);

  installGovernance(zoe, spaces.installation.produce);
  const mockChainStorage = makeMockChainStorageRoot();
  produce.chainStorage.resolve(mockChainStorage);
  produce.board.resolve(makeBoard());

  return { produce, consume, ...spaces, mockChainStorage };
};

/**
 * @param {*} t
 * @param {{ committeeName: string, committeeSize: number}} electorateTerms
 * @param {ManualTimer | undefined=} timer
 * @param {import('@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup').FarZoeKit} [farZoeKit]
 */
export const setupPsm = async (
  t,
  electorateTerms = { committeeName: 'The Cabal', committeeSize: 1 },
  timer = buildManualTimer(t.log),
  farZoeKit,
) => {
  if (!farZoeKit) {
    farZoeKit = await setUpZoeForTest();
  }

  const knut = withAmountUtils(makeIssuerKit('KNUT'));

  const { feeMintAccess, zoe } = farZoeKit;
  const space = await setupPsmBootstrap(timer, farZoeKit);
  space.produce.zoe.resolve(farZoeKit.zoe);
  space.produce.feeMintAccess.resolve(feeMintAccess);
  const { consume, brand, issuer, installation, instance } = space;
  installation.produce.psm.resolve(E(zoe).install(bundlePsm));
  installation.produce.psmCharter.resolve(E(zoe).install(charterBundle));

  brand.produce.AUSD.resolve(knut.brand);
  issuer.produce.AUSD.resolve(knut.issuer);

  space.produce.psmFacets.resolve(makeScalarMapStore());
  const istIssuer = await E(zoe).getFeeIssuer();
  const istBrand = await E(istIssuer).getBrand();

  brand.produce.IST.resolve(istBrand);
  issuer.produce.IST.resolve(istIssuer);

  space.produce.provisionPoolStartResult.resolve({
    creatorFacet: Far('dummy', {
      initPSM: () => {
        t.log('dummy provisionPool.initPSM');
      },
    }),
  });

  await Promise.all([
    startEconomicCommittee(space, {
      options: { econCommitteeOptions: electorateTerms },
    }),
    startPSMCharter(space),
    startPSM(space, {
      options: {
        anchorOptions: {
          denom: 'AUSD',
          decimalPlaces: 6,
          keyword: 'AUSD',
          proposedName: 'AUSD',
        },
      },
    }),
  ]);

  const installs = await allValues({
    psm: installation.consume.psm,
    psmCharter: installation.consume.psmCharter,
    governor: installation.consume.contractGovernor,
    electorate: installation.consume.committee,
    counter: installation.consume.binaryVoteCounter,
  });

  const allPsms = await consume.psmFacets;
  const psmFacets = allPsms.get(knut.brand);
  const governorCreatorFacet = psmFacets.psmGovernorCreatorFacet;
  const governorInstance = psmFacets.psmGovernor;
  const governorPublicFacet = await E(zoe).getPublicFacet(governorInstance);
  const g = {
    governorInstance,
    governorPublicFacet,
    governorCreatorFacet,
  };
  const governedInstance = E(governorPublicFacet).getGovernedContract();

  /** @type { GovernedPublicFacet<PsmPublicFacet> } */
  const psmPublicFacet = await E(governorCreatorFacet).getPublicFacet();
  const psm = {
    psmCreatorFacet: psmFacets.psmCreatorFacet,
    psmPublicFacet,
    instance: governedInstance,
  };

  const committeeCreator = await consume.economicCommitteeCreatorFacet;
  const electorateInstance = await instance.consume.economicCommittee;
  const psmCharterCreatorFacet = await consume.psmCharterCreatorFacet;

  const poserInvitationP = E(committeeCreator).getPoserInvitation();
  const poserInvitationAmount = await E(
    E(zoe).getInvitationIssuer(),
  ).getAmountOf(poserInvitationP);

  return {
    zoe,
    installs,
    electorate: installs.electorate,
    committeeCreator,
    electorateInstance,
    governor: g,
    psm,
    psmCharterCreatorFacet,
    invitationAmount: poserInvitationAmount,
    mockChainStorage: space.mockChainStorage,
    space,
    knut,
  };
};
harden(setupPsm);
