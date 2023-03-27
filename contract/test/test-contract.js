// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

// @ts-ignore
import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import {
  makeNetworkProtocol,
  makeLoopbackProtocolHandler,
} from '@agoric/swingset-vat/src/vats/network/index.js';
import { makePromiseKit } from '@endo/promise-kit';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { makeICS20TransferPacket } from '@agoric/pegasus/src/ics20.js';
import { Nat } from '@agoric/nat';
import { setupPsm } from './setupPsm.js';
import { buildManualTimer } from '@agoric/swingset-vat/tools/manual-timer.js';

// @ts-ignore
const pathname = new URL(import.meta.url).pathname;
const dirname = path.dirname(pathname);

const contractPath = `${dirname}/../src/contract.js`;

test('zoe - forward to psm', async (t) => {
  const electorateTerms = { committeeName: 'EnBancPanel', committeeSize: 3 };
  // @ts-ignore
  const timer = buildManualTimer(t.log, 0n, { eventLoopIteration });

  const { knut, zoe, psm, committeeCreator, governor, installs } =
    // @ts-ignore
    await setupPsm(t, electorateTerms, timer);
  
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
          async onReceive(_c, packetBytes) {
            console.log(JSON.parse(packetBytes));
            return "AQ=="
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
      if (id === 'agoric1234567') {
        return localDepositFacet;
      }
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

  const minter = knut.mint

  /** @type {Purse} */
  const localPursePIst = await E(E(zoe).getFeeIssuer()).makeEmptyPurse();
  resolveLocalDepositFacet(E(localPursePIst).getDepositFacet());
  const localPursePKnut = await E(knut.issuer).makeEmptyPurse();

  const { publicFacet } = await E(zoe).startInstance(
    installation,
    {},
    { board: fakeBoard, namesByAddress: fakeNamesByAddress, network, istPurse: localPursePIst, remoteConnectionId: "connection-0", psm, minter },
  );

  const info = await E(publicFacet).channelInfo();

  const channel = await E(port2).connect(
    info.localAddress,
    Far('opener', {
      async onOpen(c, localAddr, remoteAddr, _connectionHandler) {
        t.is(localAddr, '/ibc-hop/connection-0/ibc-port/transfer/unordered/ics20-1/nonce/3');
        t.is(remoteAddr, '/ibc-port/transfer-psm/nonce/1/nonce/4');
        console.log("Connection opened: ", c);
      },
    }),
  );

  /** @type {Data} */
  const packet = JSON.stringify(await makeICS20TransferPacket({
    "value": Nat(1000000),
    "remoteDenom": "KNUT",
    "depositAddress": 'agoric1234567'
  }));
  // send a transfer packet
  const pingack = await channel.send(packet);
  t.is(pingack, '{"result":"AQ=="}', 'expected {"result":"AQ=="}');

  /** @type {Amount} */
  let amount = await E(localPursePIst).getCurrentAmount();
  t.deepEqual(amount.value, Nat(1000000))
});