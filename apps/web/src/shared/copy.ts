/**
 * The words the site uses for its main places and actions, in one place, so every page says the
 * same thing (header, footer, buttons, empty states). Change a label here, not in a page.
 */
export const LABEL = {
  catalogue: 'Catalogue',
  shelf: 'My shelf',
  admin: 'Admin',
  contribute: 'Contribute & earn',
  upload: 'Upload your notes',
  help: 'Help & suggestions',
  terms: 'Terms',
  privacy: 'Privacy',
  contact: 'Contact',
  signIn: 'Sign in',
} as const;

/** What contributors are promised. Shown on the Contribute page and in the Terms. */
export const PROMISE = {
  royaltyLasts: 'You earn royalties while your notes are on sale. If we replace them, your royalty ends.',
  royaltyBasis:
    'We calculate your share after the payment fee (about 2.4%). For bundles, it is based on your course’s share of the bundle price.',
  yearlyBonus: 'Each year, the top seller gets a bonus worth 25% of their earnings, up to ₹10,000.',
} as const;
