// @ts-check
// eslint-disable-next-line spaced-comment

/**
 * @typedef {object} BoardDepositFacet a registry for depositAddresses
 * @property {(id: string) => any} getValue return the corresponding DepositFacet
 */

/**
 * @typedef {Object} IssueKit Issuer kit info for anchor asset
 * @property {Brand} brand Anchor brand for anchor
 * @property {Issuer} issuer Issuer brand for anchor
 * @property {Mint} mint Minter brand for anchor
 */