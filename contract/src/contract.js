// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import '@agoric/swingset-vat/src/vats/network';
import '@agoric/vats/exported.js';
import { Far } from '@endo/marshal/src/make-far';
import { E } from '@endo/eventual-send';
import { makeScalarMapStore } from '@agoric/store';
// @ts-ignore
import { parseICS20TransferPacket, makeICS20TransferPacketAck } from '@agoric/pegasus/src/ics20';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@agoric/nat';

/**
 * Make a IST Forwarder public API.
 *
 * @param {ZCF} zcf the Zoe Contract Facet
 * @param {ERef<BoardDepositFacet>} board where to find depositFacets by boardID
 * @param {ERef<NameHub>} namesByAddress where to find depositFacets by bech32
 * @param {ERef<Protocol>} network ibc network protocol
 * @param {String} localConnectionId connection id to create channel on
 * @param {String} remoteConnectionId connection id to create channel on
 * @param {Object} psm PSM instance to create channel for
 * @param {IssueKit} issueKit Issue kit for anchor asset for this psm
 *
 */
const makePSMForwarder = async (zcf, board, namesByAddress, network, localConnectionId, remoteConnectionId, psm, issueKit) => {

  let zoe = zcf.getZoeService();
  
  /** @type {MapStore<String,Object>} */
  let channel = makeScalarMapStore("channel");

  // bind our custom port for transfer forwarding to psm
  const port = await E(network).bind(`/ibc-port/transfer-psm`);

  // logic to define our port listener
  await E(port).addListener(
    Far('listener', {
      async onListen(_port, _handler) {
        return
      },
      async onAccept(_port, _localAddr, _remoteAddr) {
        return Far('handler', {
          async onOpen(c) {
            if (!channel.has("channel")) { channel.init("channel", c) };
          },
          async onReceive(_c, packetBytes) {
            const packet = JSON.parse(packetBytes);
            let parts = await parseICS20TransferPacket(packet);
            let { depositAddress, remoteDenom, value } = parts;

            const coins = await E(issueKit.mint).mintPayment(
              AmountMath.make(issueKit.brand, value),
            );

            // swap in the PSM for IST
            // @ts-ignore
            console.log(psm)
            const invitation  = await E(psm.publicFacet).makeWantMintedInvitation();  
            const giveAnchorAmount = AmountMath.make(issueKit.brand, value);
            // get the ist brand
            const istBrand = await E(E(zoe).getFeeIssuer()).getBrand();
            const wantMintedAmount = AmountMath.make(istBrand, value);
            /** @type {Proposal} */
            const proposal = {
              give: {In: giveAnchorAmount },
              want: {Out: wantMintedAmount }
            };
            const paymentRecord = { In: coins };
            const seat = await E(zoe).offer(
              invitation,
              harden(proposal),
              harden(paymentRecord)
            );

            const payout = await E(seat).getPayout('Out');

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
              .receive(payout)
              .catch(reason => {
                throw reason
              });

              res = await makeICS20TransferPacketAck(true, null)
            } catch (reason) {
              res = await makeICS20TransferPacketAck(true, reason)
              throw reason
            }

            return res;
          },
        });
      },
    }),
  );

  const remoteEndpoint = `/ibc-hop/${remoteConnectionId}/ibc-port/transfer/unordered/ics20-1`;
  let c = await E(port).connect(remoteEndpoint);
  if (!channel.has("channel")) { channel.init("channel", c) };

  return Far('forwarder', {
    /**
     * Unlock IST into IBC escrowed ERTP asset. Unescrow and then send to remote chain.
     *
     * @param {Number} amount IST amount to send to remote network
     */
    sendTransfer: async (amount) => {
      // get the ist brand
      const istBrand = await E(E(zoe).getFeeIssuer()).getBrand();

      // @ts-ignore
      const invitation  = await E(E(psm).publicFacet).makeGiveMintedInvitation();
      /** @type {IssuerKit} */
      const issuerKit = channel.get("issuer");
      const giveMintedAmount = AmountMath.make(issuerKit.brand, Nat(amount));
      const wantAnchorAmount = AmountMath.make(istBrand, Nat(amount));

      const proposal = { 
        give: {In: giveMintedAmount },
        want: {Out: wantAnchorAmount }
      };

      const coins = issuerKit.mint.mintPayment(
        AmountMath.make(issuerKit.brand, Nat(amount)),
      );

      const paymentRecord = { In: coins };
      const seat = await E(zoe).offer(
        invitation,
        harden(proposal),
        harden(paymentRecord)
      );

      const payouts = await E(seat).getPayouts();

      console.log(payouts);
    },
    /**
     * Query channel info.
     *
     */
    channelInfo: async () => {
      /** @type {Connection} */
      const connection = await E(channel).get("channel");
      return {
        "localAddress": await E(connection).getLocalAddress(),
        "remoteAddress": await E(connection).getRemoteAddress(),
      }
    }
  })
}

/**
 * @typedef {ReturnType<typeof makePSMForwarder>} Forwarder
 */
/**
 * @param {ZCF<{board: ERef<BoardDepositFacet>, namesByAddress: ERef<NameHub>, network: ERef<Protocol>, localConnectionId: String, remoteConnectionId: String, psm: Instance, issueKit: IssueKit}>} zcf
 */
const start = async (zcf) => {
  const { board, namesByAddress, network, localConnectionId, remoteConnectionId, psm, issueKit } = zcf.getTerms();

  return harden({
    publicFacet: await makePSMForwarder(zcf, board, namesByAddress, network, localConnectionId, remoteConnectionId, psm, issueKit),
  });
};

harden(start);
export { start };
