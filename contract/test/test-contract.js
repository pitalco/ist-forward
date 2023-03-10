// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

// @ts-ignore
import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { CONTRACT_ELECTORATE, ParamTypes } from '@agoric/governance';
import {
  makeNetworkProtocol,
  makeLoopbackProtocolHandler,
} from '@agoric/swingset-vat/src/vats/network/index.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import { makePromiseKit } from '@endo/promise-kit';
import { makeICS20TransferPacket } from '@agoric/pegasus/src/ics20.js';
import { Nat } from '@agoric/nat';
import { makeMockChainStorageRoot, setUpZoeForTest, withAmountUtils } from '@agoric/inter-protocol/test/supports.js';
import { makeIssuerKit } from '@agoric/ertp/src/issuerKit.js';
import { makeBoard } from '@agoric/vats/src/lib-board.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import committeeBundle from '@agoric/governance/bundles/bundle-committee.js';
import bundlePsm from '@agoric/inter-protocol/bundles/bundle-psm.js';
import centralSupplyBundle from '@agoric/vats/bundles/bundle-centralSupply.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';

// @ts-ignore
const pathname = new URL(import.meta.url).pathname;
const dirname = path.dirname(pathname);

const scale6 = x => BigInt(Math.round(x * 1_000_000));

const BASIS_POINTS = 10000n;
const WantMintedFeeBP = 1n;
const GiveMintedFeeBP = 3n;
const MINT_LIMIT = scale6(20_000_000);

const makeTestContext = async () => {
  const { zoe, feeMintAccessP } = await setUpZoeForTest();
  const feeMintAccess = await feeMintAccessP;

  const mintedIssuer = await E(zoe).getFeeIssuer();
  /** @type {IssuerKit<'nat'>} */
  // @ts-expect-error missing mint but it's not needed in the test
  const mintedKit = {
    issuer: mintedIssuer,
    brand: await E(mintedIssuer).getBrand(),
  };
  const minted = withAmountUtils(mintedKit);
  const anchor = withAmountUtils(makeIssuerKit('aUSD'));

  const committeeInstall = await E(zoe).install(committeeBundle);
  const psmInstall = await E(zoe).install(bundlePsm);
  const centralSupply = await E(zoe).install(centralSupplyBundle);

  const marshaller = makeBoard().getReadonlyMarshaller();

  const { creatorFacet: committeeCreator } = await E(zoe).startInstance(
    committeeInstall,
    harden({}),
    {
      committeeName: 'Demos',
      committeeSize: 1,
    },
    {
      storageNode: makeMockChainStorageRoot().makeChildNode('thisCommittee'),
      marshaller,
    },
  );

  const initialPoserInvitation = await E(committeeCreator).getPoserInvitation();
  const invitationAmount = await E(E(zoe).getInvitationIssuer()).getAmountOf(
    initialPoserInvitation,
  );

  return {
    bundles: { bundlePsm },
    zoe: await zoe,
    feeMintAccess,
    initialPoserInvitation,
    minted,
    anchor,
    installs: { committeeInstall, psmInstall, centralSupply },
    marshaller,
    terms: {
      anchorBrand: anchor.brand,
      anchorPerMinted: makeRatio(100n, anchor.brand, 100n, minted.brand),
      governedParams: {
        [CONTRACT_ELECTORATE]: {
          type: ParamTypes.INVITATION,
          value: invitationAmount,
        },
        GiveMintedFee: {
          type: ParamTypes.RATIO,
          value: makeRatio(GiveMintedFeeBP, minted.brand, BASIS_POINTS),
        },
        MintLimit: { type: ParamTypes.AMOUNT, value: minted.make(MINT_LIMIT) },
        WantMintedFee: {
          type: ParamTypes.RATIO,
          value: makeRatio(WantMintedFeeBP, minted.brand, BASIS_POINTS),
        },
      },
    },
  };
};

test.before(async t => {
  t.context = await makeTestContext();
});

/**
 *
 * @param {import('ava').ExecutionContext<Awaited<ReturnType<makeTestContext>>>} t
 * @param {{}} [customTerms]
 */
async function makePsmDriver(t, customTerms) {
  const {
    zoe,
    feeMintAccess,
    initialPoserInvitation,
    terms,
    installs: { psmInstall },
    anchor,
  } = t.context;

  // Each driver needs its own to avoid state pollution between tests
  const mockChainStorage = makeMockChainStorageRoot();

  /** @type {Awaited<ReturnType<import('@agoric/inter-protocol/src/psm/psm.js').start>>} */
  const psm = await E(zoe).startInstance(
    psmInstall,
    harden({ AUSD: anchor.issuer }),
    { ...terms, ...customTerms },
    harden({
      feeMintAccess,
      initialPoserInvitation,
      storageNode: mockChainStorage.makeChildNode('thisPsm'),
      marshaller: makeBoard().getReadonlyMarshaller(),
    }),
  );

  /**
   * @param {Amount<'nat'>} giveAnchor
   * @param {Amount<'nat'>} [wantMinted]
   */
  const swapAnchorForMintedSeat = async (giveAnchor, wantMinted) => {
    const seat = E(zoe).offer(
      E(psm.publicFacet).makeWantMintedInvitation(),
      harden({
        give: { In: giveAnchor },
        ...(wantMinted ? { want: { Out: wantMinted } } : {}),
      }),
      harden({ In: anchor.mint.mintPayment(giveAnchor) }),
    );
    await eventLoopIteration();
    return seat;
  };

  /**
   * @param {Amount<'nat'>} giveRun
   * @param {Payment<'nat'>} runPayment
   * @param {Amount<'nat'>} [wantAnchor]
   */
  const swapMintedForAnchorSeat = async (giveRun, runPayment, wantAnchor) => {
    const seat = E(zoe).offer(
      E(psm.publicFacet).makeGiveMintedInvitation(),
      harden({
        give: { In: giveRun },
        ...(wantAnchor ? { want: { Out: wantAnchor } } : {}),
      }),
      harden({ In: runPayment }),
    );
    await eventLoopIteration();
    return seat;
  };

  return {
    mockChainStorage,
    psm,

    /** @param {Amount<'nat'>} expected */
    async assertPoolBalance(expected) {
      const balance = await E(psm.publicFacet).getPoolBalance();
      t.deepEqual(balance, expected);
    },

    /** @type {(subpath: string) => object} */
    getStorageChildBody(subpath) {
      return mockChainStorage.getBody(
        `mockChainStorageRoot.thisPsm.${subpath}`,
      );
    },

    async getFeePayout() {
      const limitedCreatorFacet = E(psm.creatorFacet).getLimitedCreatorFacet();
      const collectFeesSeat = await E(zoe).offer(
        E(limitedCreatorFacet).makeCollectFeesInvitation(),
      );
      await E(collectFeesSeat).getOfferResult();
      const feePayoutAmount = await E.get(
        E(collectFeesSeat).getFinalAllocation(),
      ).Fee;
      return feePayoutAmount;
    },

    /**
     * @param {Amount<'nat'>} giveAnchor
     * @param {Amount<'nat'>} [wantMinted]
     */
    async swapAnchorForMinted(giveAnchor, wantMinted) {
      const seat = swapAnchorForMintedSeat(giveAnchor, wantMinted);
      return E(seat).getPayouts();
    },
    swapAnchorForMintedSeat,

    /**
     * @param {Amount<'nat'>} giveAnchor
     * @param {Amount<'nat'>} [wantMinted]
     */
    async swapAnchorForMintedErrors(giveAnchor, wantMinted) {
      const seat = swapAnchorForMintedSeat(giveAnchor, wantMinted);
      return seat;
    },

    /**
     * @param {Amount<'nat'>} giveRun
     * @param {Payment<'nat'>} runPayment
     * @param {Amount<'nat'>} [wantAnchor]
     */
    async swapMintedForAnchor(giveRun, runPayment, wantAnchor) {
      const seat = swapMintedForAnchorSeat(giveRun, runPayment, wantAnchor);
      return E(seat).getPayouts();
    },
    swapMintedForAnchorSeat,
  };
}

// @ts-ignore
const filename = new URL(import.meta.url).pathname;

const contractPath = `${dirname}/../src/contract.js`;

test('zoe - forward to psm', async (t) => {
  const { zoe, feeMintAccessP } = await setUpZoeForTest();
  
  // pack the contract
  const bundle = await bundleSource(contractPath);

  // install the contract
  const installation = E(zoe).install(bundle);

  // Create a network protocol to be used for testing
  const network = makeNetworkProtocol(makeLoopbackProtocolHandler());

    /**
   * Create the listener for the test port
   *
   * @type {ListenHandler}
   */
    const listener = Far('listener', {
      async onAccept(_p, _localAddr, _remoteAddr, _listenHandler) {
        return harden({
          async onOpen(c) {
            console.log(c);
          },
        });
      },
    });

  // Create and send packet to our ist forward port from new port
  const port2 = await E(network).bind('/ibc-hop/connection-0/ibc-port/transfer/unordered/ics20-1');
  await port2.addListener(listener)

  // create transfer port on connection-0
  /**
   * @type {PromiseRecord<DepositFacet>}
   */
  const { promise: localDepositFacet, resolve: resolveLocalDepositFacet } =
    makePromiseKit();
  const fakeBoard = Far('fakeBoard', {
    getValue(id) {
      if (id === '0x1234') {
        return localDepositFacet;
      }
      t.is(id, 'agoric1234567', 'tried bech32 first in board');
      throw Error(`unrecognized board id ${id}`);
    },
  });
  const fakeNamesByAddress = Far('fakeNamesByAddress', {
    lookup(...keys) {
      t.is(keys[0], 'agoric1234567', 'unrecognized fakeNamesByAddress');
      t.is(keys[1], 'depositFacet', 'lookup not for the depositFacet');
      t.is(keys.length, 2);
      return localDepositFacet;
    },
  });

  // @ts-ignore
  const { anchor } = t.context;
  // @ts-ignore
  const driver = await makePsmDriver(t);
  const psm = driver.psm

  /** @type {IssueKit} */
  const issueKit = {
    brand: anchor.brand,
    issuer: anchor.issuer,
    mint: anchor.mint
  }

  const localPursePIst = await E(E(zoe).getFeeIssuer()).makeEmptyPurse();
  resolveLocalDepositFacet(E(localPursePIst).getDepositFacet());

  const { publicFacet } = await E(zoe).startInstance(
    installation,
    {},
    { board: fakeBoard, namesByAddress: fakeNamesByAddress, network, localConnectionId: "connection-0", remoteConnectionId: "connection-0", psm, issueKit },
  );

  const info = await E(publicFacet).channelInfo();

  await E(port2).connect(
    info.localAddress,
    Far('opener', {
      async onOpen(c, localAddr, remoteAddr, _connectionHandler) {
        t.is(localAddr, '/ibc-hop/connection-0/ibc-port/transfer/unordered/ics20-1/nonce/3');
        t.is(remoteAddr, '/ibc-port/transfer-psm/nonce/1/nonce/4');
        /** @type {Data} */
        const packet = JSON.stringify(await makeICS20TransferPacket({
          "value": Nat(10),
          "remoteDenom": "aUSD",
          "depositAddress": '0x1234'
        }));
        // send a transfer packet
        const pingack = await c.send(packet);
        t.is(pingack, 'pingack', 'expected pingack');
      },
    }),
  );

  /** @type {Amount} */
  let amount = await E(localPursePIst).getCurrentAmount();
  t.deepEqual(amount.value, Nat(1))
});