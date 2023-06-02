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

            const issuer = await E(minter).getIssuer();
            const brand = await E(issuer).getBrand();
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
  if (!channel.has("channel")) { channel.init("channel", c) };

  return Far('forwarder', {
    /**
     * Swap IST into IBC ERTP asset. Then burn this ERTP asset and send to remote chain.
     *
     * @param {Payment} tokenIn IST amount in
     * @param {String} remoteDenom the remote denom to send back over channel
     * @param {String} receiver remote address receiver
     */
    sendTransfer: async (tokenIn, remoteDenom, receiver) => {
      
      const istIssuer = await E(zoe).getFeeIssuer();
      const issuer = await E(minter).getIssuer();
      // must be ist in
      assert.equal(await E(tokenIn).getAllegedBrand(), await E(istIssuer).getBrand());

      // @ts-ignore
      const invitation  = await E(psm.psmPublicFacet).makeGiveMintedInvitation();
      const giveAnchorAmount = AmountMath.make(tokenIn.getAllegedBrand(), (await E(istIssuer).getAmountOf(tokenIn)).value);

      const proposal = {
        give: {In: giveAnchorAmount },
      };

      const paymentRecord = { In: tokenIn };
      const seat = await E(zoe).offer(
        invitation,
        harden(proposal),
        harden(paymentRecord)
      );

      const payout = await E(seat).getPayout("Out");
      let value = await E(issuer).getAmountOf(payout);

      // burn escrowed coins returned from PSM
      await E(issuer).burn(
        payout
      );

      // send the transfer packet
      let transferPacket = await makeICS20TransferPacket({
        value: value.value, remoteDenom, receiver, memo: "IST Forward Burn"
      });
      /** @type {Connection} */
      const connection = channel.get("channel");
      const res = await E(connection).send(JSON.stringify(transferPacket));

      return res
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
