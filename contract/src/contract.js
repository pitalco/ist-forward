// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import '@agoric/swingset-vat/src/vats/network';
import { Far } from '@endo/marshal/src/make-far';
import { E } from '@endo/eventual-send';
import { makeScalarMapStore } from '@agoric/store';
// @ts-ignore
import { parseICS20TransferPacket, makeICS20TransferPacketAck, assertICS20TransferPacketAck } from '@agoric/pegasus/src/ics20';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';

/**
 * Make a IST Forwarder public API.
 *
 * @param {ZCF} zcf the Zoe Contract Facet
 * @param {ERef<BoardDepositFacet>} board where to find depositFacets by boardID
 * @param {ERef<import('@agoric/vats/src/nameHub').NameHub>} namesByAddress where to find depositFacets by bech32
 * @param {ERef<Protocol>} network ibc network protocol
 *
 */
const makePSMForwarder = async (zcf, board, namesByAddress, network) => {

  let zoe = zcf.getZoeService();
  zcf.getTerms()
  
  // grab the PSM installation from name hub
  /** @type {Installation} */
  const psmInstall = await E(namesByAddress).lookup('psm');
  const instancePSM = await E(zoe).startInstance(psmInstall);
  const psm = harden(instancePSM);

  /** @type {MapStore<String,Object>} */
  let channel = makeScalarMapStore("channel");

  // bind our custom port for transfer forwarding to psm
  const port = await E(network).bind('/ibc-port/transfer-psm')

  // logic to define our port listener
  port.addListener(
    Far('acceptor', {
      async onAccept(_p, _localAddr, _remoteAddr) {
        return Far('handler', {
          async onOpen(c) {
            channel.init("connection", c);
          },
          async onReceive(_c, packetBytes) {
            const packet = JSON.parse(packetBytes);
            let parts = await parseICS20TransferPacket(packet);
            let { depositAddress, remoteDenom, value } = parts;
            /** @type {IssuerKit} */
            let denom;

            // escrow the asset

            if (channel.get("denom")) {
              denom = channel.get("denom");
            } else {
              denom = makeIssuerKit(remoteDenom);
              channel.init("denom", denom);
            }
            const coins = denom.mint.mintPayment(
              AmountMath.make(remoteDenom, value),
            );

            // swap in the PSM for IST
            const invitation  = E(psm.publicFacet).makeWantMintedInvitation();  
            const giveAnchorAmount = AmountMath.make(remoteDenom, value);
            /** @type {Proposal} */
            const proposal = {
              give: { In: giveAnchorAmount },
            };
            const paymentRecord = { In: coins };
            const seat = E(zoe).offer(
              invitation,
              harden(proposal),
              harden(paymentRecord)
            );

            seat.then(
              // On fullfilled
              async (value) => {
                // send the IST to the depositAddress
                // Look up the deposit facet for this board address, if there is one.
                /** @type {DepositFacet} */
                const depositFacet = await E(board)
                  .getValue(depositAddress)
                  .catch(_ => E(namesByAddress).lookup(depositAddress, 'depositFacet'));

                E(depositFacet)
                .receive(await E(value).getPayout('Want'))
                .catch(_ => {});
              },
              // On rejected
              async (reason) => {
                console.error(reason);
              }
            )

            return JSON.stringify({ result: 'AQ==' });
          },
        });
      },
    }),
  )

  const createChannel = async (
    /** @type {String} */ connectionId,
  ) => {
    const remoteEndpoint = `/ibc-hop/${connectionId}/ibc-port/transfer/ordered/ics20-1`;
    let c = port.connect(remoteEndpoint);
    channel.init("connection", c);

    return c;
  }

  return {
    createChannel,
    sendTransfer: () => {}
  }
}

/**
 * @typedef {ReturnType<typeof makePSMForwarder>} Forwarder
 */
/**
 * @param {ZCF<{board: ERef<BoardDepositFacet>, namesByAddress: ERef<import('@agoric/vats/src/nameHub').NameHub>, network: ERef<Protocol>}>} zcf
 */
const start = async (zcf) => {
  const { board, namesByAddress, network } = zcf.getTerms();

  return harden({
    publicFacet: await makePSMForwarder(zcf, board, namesByAddress, network),
  });
};

harden(start);
export { start };
