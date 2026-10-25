/**
 * The words the site uses for its main places and actions, in one place, so every page says the
 * same thing (header, footer, buttons, empty states). Change a label here, not in a page.
 */
export const LABEL = {
  catalogue: 'Catalogue',
  shelf: 'My shelf',
  admin: 'Admin',
  contribute: 'Earn from notes',
  upload: 'Upload your notes',
  help: 'Help & suggestions',
  terms: 'Terms',
  privacy: 'Privacy',
  contact: 'Contact',
  signIn: 'Sign in',
} as const;

/** What contributors are promised. Shown on the Contribute page and in the Terms. */
export const PROMISE = {
  royaltyLasts:
    'Your royalty keeps coming for as long as your notes are the ones being sold. It ends only when we replace that course with newer notes.',
  yearlyBonus:
    'Each year, the contributor whose notes were bought the most gets a bonus equal to everything they earned that year, paid a second time.',
} as const;
