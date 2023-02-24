// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

// @ts-ignore
import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { makeFakeMyAddressNameAdmin } from '../src/utils.js';
import { Far } from '@endo/marshal';
import {
  makeNetworkProtocol,
  makeLoopbackProtocolHandler,
} from '@agoric/swingset-vat/src/vats/network/index.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import { makePromiseKit } from '@endo/promise-kit';
import { setupPsm } from '@agoric/inter-protocol/test/psm/setupPsm.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeICS20TransferPacket } from '@agoric/pegasus/src/ics20.js';
import { Nat } from '@agoric/nat';

// @ts-ignore
const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/contract.js`;

test.before(async t => {
  const bundleCache = await unsafeMakeBundleCache('bundles/');
  t.context = { bundleCache };
});

test('zoe - forward to psm', async (t) => {
  // setup the psm
  const electorateTerms = { committeeName: 'EnBancPanel', committeeSize: 3 };
  const timer = buildManualTimer(t.log, 0n, { eventLoopIteration });
  const { knut, zoe, psm, committeeCreator, governor, installs } =
    await setupPsm(t, electorateTerms, timer);

  // pack the contract
  const bundle = await bundleSource(contractPath);

  // install the contract
  const installation = E(zoe).install(bundle);

  // Create a network protocol to be used for testing
  const network = makeNetworkProtocol(makeLoopbackProtocolHandler());

  // create transfer port on connection-0
  await E(network).bind('/ibc-hop/connection-0/ibc-port/transfer/ordered/ics20-1')

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

  const myAddressNameAdmin = makeFakeMyAddressNameAdmin();
  const address = await E(myAddressNameAdmin).getMyAddress();

  const { publicFacet } = await E(zoe).startInstance(
    installation,
    {},
    { board: fakeBoard, namesByAddress: myAddressNameAdmin, network, connectionId: "connection-0", psm },
  );

  const info = await E(publicFacet).channelInfo();

  // Create and send packet to our ist forward port from new port
  const port2 = await network.bind('/loopback/bar');
  await port2.connect(
    info.localAddress,
    Far('opener', {
      async onOpen(c, localAddr, remoteAddr, _connectionHandler) {
        t.is(localAddr, '/loopback/bar/nonce/3');
        t.is(remoteAddr, '/ibc-port/transfer-psm/nonce/2/nonce/4');
        /** @type {Data} */
        const packet = JSON.stringify(await makeICS20TransferPacket({
          "value": Nat(10_000_000),
          "remoteDenom": "USDC_axl",
          "depositAddress": address
        }));
        // send a transfer packet
        const pingack = await c.send(packet);
        t.is(pingack, 'pingack', 'expected pingack');
      },
    }),
  );
});