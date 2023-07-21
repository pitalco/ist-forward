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
 * @param {String} remoteConnectionId connection id to create channel on
 * @param {Object} psm PSM instance to create channel for
 * @param {MapStore<String,Object>} channel Channel storage object
 * @param {Port} port Port to create the channel on
 * @param {Issuer<AssetKind>} issuer Issuer for PSM for this channel
 *
 */
const makePSMForwarder = async (zcf, remoteConnectionId, psm, channel, port, issuer) => {

  const remoteEndpoint = `/ibc-hop/${remoteConnectionId}/ibc-port/transfer/unordered/ics20-1`;
  const connection = await E(port).connect(remoteEndpoint);
  console.log("Connection: ", connection);

  const makeSendTransferInvitation = () => {
    /** @type OfferHandler */
    const sendTransfer = async (zcfSeat, offerArgs) => {
      const {
        give: {
          IST: istAmount
        }
      } = zcfSeat.getProposal();

      const {
        remoteDenom, receiver, localAddr
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
        value: value.value, remoteDenom, depositAddress: receiver
      });
      /** @type {Connection} */
      const connection = channel.get(localAddr);
      const res = await E(connection).send(transferPacket);

      return harden({ message: 'Done', result: res });
    };

    return zcf.makeInvitation(sendTransfer, 'Send Transfer Invitation');
  };

/**
 * Transfer helper function to transfer an asset through transfer-psm port over IBC on this channel.
 *
 * @param {Payment} payment Assets to send
 * @param {Mint} minter Minter for anchor
 * @param {string} sender Sender bech32 address from Agoric
 * @param {string} receiver Receiver address on remote chain
 *
 */
  const transfer = async (payment, minter, sender, receiver) => {

    let issuer = await E(minter).getIssuer();
    let amount = await issuer.burn(payment);
    let value = await E(amount).value();
    /** @type {Brand} */
    let brand = await E(amount).brand();
    let denom = await E(brand).getAllegedName();


    /** @type {import('@agoric/pegasus/src/ics20').ICS20TransferPacket} */
    let icsTransfer = {
      amount: value,
      denom,
      sender,
      receiver,
      memo: ""
    }

    let packet = await makeICS20TransferPacket(icsTransfer);

    let ack = await E(connection).send(packet);

    return ack
  }

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
      return {
        "localAddress": await E(connection).getLocalAddress(),
        "remoteAddress": await E(connection).getRemoteAddress(),
        "channel": connection
      }
    },
    /**
     * Transfer helper function to transfer an asset through transfer-psm port over IBC on this channel.
     *
     */
    transfer
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

  let zoe = zcf.getZoeService();
  
  /** @type {MapStore<String,Object>} */
  let channel = makeScalarMapStore("channel");

  let minter = privateArgs.minter;

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

  console.log("Adding Listener to Port: ", await E(port).getLocalAddress());

  // logic to define our port listener
  await E(port).addListener(
    Far('listener', {
      async onListen(_port, _handler) {
        return
      },
      async onAccept(_port, localAddr, _remoteAddr) {
        return Far('handler', {
          async onOpen(c) {
            if (!channel.has(localAddr)) { channel.init(localAddr, c) };
          },
          async onReceive(_c, packetBytes) {
            let parts = await parseICS20TransferPacket(packetBytes);
            let { depositAddress, value } = parts;

            const coins = await E(minter).mintPayment(
              AmountMath.make(brand, Nat(Number(value))),
            );

            /** @type {String} */
            let res;
              
            try {
              // swap in the PSM for IST
              // @ts-ignore
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

  console.log("Added Listener to Port");

  return harden({
    publicFacet: await makePSMForwarder(zcf, remoteConnectionId, psm, channel, port, issuer),
  });
};

harden(start);
export { start };
