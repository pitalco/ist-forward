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
import { makeICS20TransferPacket } from '@agoric/pegasus/src/ics20';
import { offerTo } from '@agoric/zoe/src/contractSupport/zoeHelpers.js';

/**
 * Make a IST Forwarder public API.
 *
 * @param {ZCF} zcf the Zoe Contract Facet
 * @param {ERef<BoardDepositFacet>} board where to find depositFacets by boardID
 * @param {ERef<NameHub>} namesByAddress where to find depositFacets by bech32
 * @param {ERef<Protocol>} network ibc network protocol
 * @param {String} remoteConnectionId connection id to create channel on
 * @param {Object} psm PSM instance to create channel for
 * @param {Mint} minter Minter for anchor asset for this psm
 *
 */
const makePSMForwarder = async (zcf, board, namesByAddress, network, remoteConnectionId, psm, minter) => {

  let zoe = zcf.getZoeService();
  
  /** @type {MapStore<String,Object>} */
  let channel = makeScalarMapStore("channel");

  const issuerP = E(minter).getIssuer();
  const brandP = E(issuerP).getBrand();

  const [
    port,
    issuer,
    brand,
  ] = await Promise.all([
    E(network).bind(`/ibc-port/transfer-psm`),
    issuerP,
    brandP,
  ])

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
            let parts = await parseICS20TransferPacket(packetBytes);
            let { depositAddress, remoteDenom, value } = parts;

            const coins = await E(minter).mintPayment(
              AmountMath.make(brand, Nat(Number(value))),
            );

            if (!channel.has(remoteDenom)) { channel.init(remoteDenom, brand) };

            /** @type {String} */
            let res;
              
            try {
              // swap in the PSM for IST
              const invitation  = await E(psm.psmPublicFacet).makeWantMintedInvitation();  
              const giveAnchorAmount = AmountMath.make(brand, Nat(Number(value)));

              /** @type {Proposal} */
              const proposal = {
                give: {In: giveAnchorAmount }
              };
              const paymentRecord = { In: coins };
              const seat = E(zoe).offer(
                invitation,
                harden(proposal),
                harden(paymentRecord)
              );

              const payout = await E(seat).getPayout("Out");

              try {
                // send the IST to the depositAddress
                // Look up the deposit facet for this board address, if there is one.
                /** @type {DepositFacet} */
                const depositFacet = await E(board)
                  .getValue(depositAddress)
                  .catch(async _ => await E(namesByAddress).lookup(depositAddress, 'depositFacet'));

                await E(depositFacet)
                .receive(payout)
                .catch(reason => {
                  throw reason
                });

                res = await makeICS20TransferPacketAck(true, null)
              } catch (reason) {
                res = await makeICS20TransferPacketAck(true, reason)
                throw reason
              }
            } catch (reason) {
              // burn escrowed coins if error occurs
              await E(issuer).burn(
                coins
              );
              // return error ack
              res = await makeICS20TransferPacketAck(true, reason)
            }
            return res
          },
        });
      },
    }),
  );

  const remoteEndpoint = `/ibc-hop/${remoteConnectionId}/ibc-port/transfer/unordered/ics20-1`;
  let c = await E(port).connect(remoteEndpoint);
  if (!channel.has("channel")) { channel.init("channel", c) }

  const makeSendTransferInvitation = () => {
    /** @type OfferHandler */
    const sendTransfer = async (zcfSeat, offerArgs) => {
      const {
        give: {
          IST: istAmount
        }
      } = zcfSeat.getProposal();

      const {
        remoteDenom, receiver,
      } = offerArgs;

      const invitation  = E(psm.psmPublicFacet).makeGiveMintedInvitation();
      const { zcfSeat: tempSeat, userSeat: tempUserSeatP } = zcf.makeEmptySeatKit();

      const { deposited } = await offerTo(
        zcf,
        invitation,
        harden({
          IST: 'In',
          Anchor: 'Out'
        }),
        harden({
          give: { In: istAmount }
        }),
        zcfSeat,
        tempSeat
      );

      const amounts = await deposited;
      console.log({
        amounts
      })
      tempSeat.exit();

      const anchorPayout = await E(tempUserSeatP).getPayout('Anchor');
      let value = await E(issuer).getAmountOf(anchorPayout);

      // burn escrowed coins returned from PSM
      // How about if we burn the tokens only when the IBC transfer is successful?
      await E(issuer).burn(
        anchorPayout
      );

      // send the transfer packet
      let transferPacket = await makeICS20TransferPacket({
        value: value.value, remoteDenom, depositAddress: receiver, memo: "IST Forward Burn"
      });
      /** @type {Connection} */
      const connection = channel.get("channel");
      const res = await E(connection).send(transferPacket);

      return harden({ message: 'Done', result: res });
    };

    return zcf.makeInvitation(sendTransfer, 'Send Transfer Invitation');
  };

  return Far('forwarder', {
    /**
     * Swap IST into IBC ERTP asset. Then burn this ERTP asset and send to remote chain.
     */
    makeSendTransferInvitation,
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
 * @param {ZCF<{board: ERef<BoardDepositFacet>, namesByAddress: ERef<NameHub>, network: ERef<Protocol>, remoteConnectionId: String, psm: Instance}>} zcf
 * @param {{minter: Mint}} privateArgs
 */
const start = async (zcf, privateArgs) => {
  const { board, namesByAddress, network, remoteConnectionId, psm } = zcf.getTerms();

  return harden({
    publicFacet: await makePSMForwarder(zcf, board, namesByAddress, network, remoteConnectionId, psm, privateArgs.minter),
  });
};

harden(start);
export { start };
