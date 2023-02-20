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
 * @param {String} connectionId connection id to create channel on
 *
 */
const makePSMForwarder = async (zcf, board, namesByAddress, network, connectionId) => {

  let zoe = zcf.getZoeService();
  
  const psm = await E(namesByAddress).lookup('psm');

  /** @type {MapStore<String,Object>} */
  let channel = makeScalarMapStore("channel");

  // bind our custom port for transfer forwarding to psm
  const port = await E(network).bind('/ibc-port/transfer-psm');

  // logic to define our port listener
  await E(port).addListener(
    Far('acceptor', {
      async onAccept(_p, _localAddr, _remoteAddr) {
        return Far('handler', {
          async onOpen(c) {
            if (!channel.get("connection")) { channel.init("connection", c) };
          },
          async onReceive(_c, packetBytes) {
            const packet = JSON.parse(packetBytes);
            let parts = await parseICS20TransferPacket(packet);
            let { depositAddress, remoteDenom, value } = parts;
            /** @type {IssuerKit} */
            let issuerKit;

            // escrow the asset
            if (channel.get("issuer")) {
              issuerKit = channel.get("issuer");
            } else {
              issuerKit = makeIssuerKit(remoteDenom);
              // store the issuer kit
              channel.init("issuer", issuerKit);
              // store our escrow purse for this channel
              channel.init("purse", issuerKit.issuer.makeEmptyPurse());
            }
            const coins = issuerKit.mint.mintPayment(
              AmountMath.make(remoteDenom, value),
            );

            // swap in the PSM for IST
            const invitation  = await E(psm.publicFacet).makeWantMintedInvitation();  
            const giveAnchorAmount = AmountMath.make(remoteDenom, value);
            /** @type {Proposal} */
            const proposal = {
              give: { In: giveAnchorAmount },
            };
            const paymentRecord = { In: coins };
            const seat = await E(zoe).offer(
              invitation,
              harden(proposal),
              harden(paymentRecord)
            );

            /** @type {String} */
            let res;

            try {
              // send the IST to the depositAddress
              // Look up the deposit facet for this board address, if there is one.
              /** @type {DepositFacet} */
              const depositFacet = await E(board)
                .getValue(depositAddress)
                .catch(_ => E(namesByAddress).lookup(depositAddress, 'depositFacet'));

              E(depositFacet)
              .receive(await E(value).getPayout('Want'))
              .catch(_ => {});

              res = await makeICS20TransferPacketAck(true, null)
            } catch (reason) {
              res = await makeICS20TransferPacketAck(true, reason)
              console.error(reason);
            }

            return res;
          },
        });
      },
    }),
  );

  const remoteEndpoint = `/ibc-hop/${connectionId}/ibc-port/transfer/ordered/ics20-1`;
  let c = await E(port).connect(remoteEndpoint);
  if (!channel.get("connection")) { channel.init("connection", c) };

  return {
    tx: {
      sendTransfer: () => {}
    },
    query: {
      channelInfo: () => {}
    }
  }
}

/**
 * @typedef {ReturnType<typeof makePSMForwarder>} Forwarder
 */
/**
 * @param {ZCF<{board: ERef<BoardDepositFacet>, namesByAddress: ERef<import('@agoric/vats/src/nameHub').NameHub>, network: ERef<Protocol>, connectionId: String}>} zcf
 */
const start = async (zcf) => {
  const { board, namesByAddress, network, connectionId } = zcf.getTerms();

  return harden({
    publicFacet: await makePSMForwarder(zcf, board, namesByAddress, network, connectionId),
  });
};

harden(start);
export { start };
