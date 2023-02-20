import { makeNameHubKit } from '@agoric/vats/src/nameHub.js';
import { Far } from '@endo/marshal';

export const makeFakeMyAddressNameAdmin = async () => {
  const { nameHub, nameAdmin: rawMyAddressNameAdmin } = makeNameHubKit();
  return Far('fakeMyAddressNameAdmin', {
    ...nameHub,
    ...rawMyAddressNameAdmin,
    getMyAddress() {
      return 'agoric1test1';
    },
  });
};