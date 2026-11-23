import type { MessDish, MessInput } from '@ss/contracts';

/** "Idly; Sambar; Jalebi?" → dishes; a trailing "?" marks one that was hard to read. */
export const dishes = (text: string): MessDish[] =>
  text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.endsWith('?') ? { name: s.slice(0, -1).trim(), unsure: true } : { name: s, unsure: false },
    );

/**
 * The first menus, for testing before launch (both start unpublished: only admins see them).
 * The same rows are inserted by migration 20261123000100_mess_menus_and_reminders.
 */
export const SEED_MESSES: MessInput[] = [
  {
    slug: 'safal-hostel-mess',
    name: 'Safal hostel mess',
    kind: 'hostel',
    place: 'VIT Bhopal hostels',
    source: 'notice',
    note: 'Typed from the notice-board photos: week 1 from 12 Oct 2026, week 2 from 19 Oct, then they alternate (veg & non-veg).',
    prices: '',
    phone: '',
    orderNote: '',
    order: [],
    ownerEmails: [],
    ordersOpen: false,
    cycleStart: '2026-10-12',
    published: false,
    meals: [
      { key: 'breakfast', start: '07:30', end: '09:30', extras: 'Bread, butter, jam · Tea, coffee, milk' },
      {
        key: 'lunch',
        start: '12:15',
        end: '14:30',
        extras: 'Roti (plain & butter) · Plain rice (north & south) · Pickle',
      },
      { key: 'snacks', start: '17:00', end: '18:30', extras: 'Tea, coffee, milk' },
      {
        key: 'dinner',
        start: '19:15',
        end: '21:15',
        extras: 'Roti (plain & butter) · Plain rice (north & south) · Pickle',
      },
    ],
    weeks: [
      {
        label: 'Week 1',
        days: {
          mon: {
            breakfast: dishes(
              'Idly & masala vada; Moong dal sambar; Peanut chutney; Mix fruits; 1 boiled egg (non-veg) / steamed sprouts salad (veg)',
            ),
            lunch: dishes(
              'Dal fry; Aloo gobi sukhi sabzi; Mixed vegetable sambar; Beans peas stir fry; Tomato dhaniya shorba; Curd; Kheer',
            ),
            snacks: dishes('Kala chana sundal'),
            dinner: dishes(
              'Methi mutter malai paneer curry (veg) / egg curry (non-veg); Yellow dal; Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          tue: {
            breakfast: dishes(
              'Aloo paratha; Curd & pickle; Banana; 1 boiled egg (non-veg) / mixed vegetables & sprouts salad (veg)',
            ),
            lunch: dishes(
              'Rajma masala; Tindli fry; Mixed veg imli tikha curry; Stir-fry mix vegetables; Ajwain rasam; Butter milk',
            ),
            snacks: dishes('Punugulu + podi & allam (ginger) chutney'),
            dinner: dishes('Veg pulao; Veg jalfrezi; Dal makhani; Mix vegetable salad; Rasam; Curd rice'),
          },
          wed: {
            breakfast: dishes(
              'Sabudana khichdi; Set dosa & vada curry; Coconut chutney; Mix fruits; 1 boiled egg (non-veg) / steamed green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Gujarati dal; Veg kofta curry (semi gravy); Drumstick sambar; Cabbage peas carrot sauté; Garlic pepper rasam; Curd; Kesari',
            ),
            snacks: dishes('Pani puri with aloo, kala chana, onion filling'),
            dinner: dishes(
              'Paneer chatpata (veg) / chicken kosha (non-veg); Moong masoor dal (North); Bengali salad; Rasam; Curd rice',
            ),
          },
          thu: {
            breakfast: dishes(
              'Pav bhaji & fried chillies; Mix fruits; 1 boiled egg (non-veg) / peas & green gram sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Jeera rice & plain rice (south); Cholar dal; Aloo posto; Carrot & beans / mutter poriyal (Tamil Nadu); Chenna saag?; Chaas',
            ),
            snacks: dishes('Mix veg samosa, green chutney / imli sweet chutney'),
            dinner: dishes(
              'Palak paneer (veg) / anda curry (non-veg); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          fri: {
            breakfast: dishes(
              'Vegetable poha; Jalebi; Single fruit; Egg bhurji (non-veg) / paneer bhurji (veg)',
            ),
            lunch: dishes(
              'Rajasthani kadhi; Baingan bharta; Mixed vegetable toor / masoor dal sambar; Seasonal mixed vegetables sauté; Chettinad rasam; Curd; Gulab jamun',
            ),
            snacks: dishes('Chana & vegetable sandwich'),
            dinner: dishes(
              'Paneer tikka masala (veg) / chicken tikka masala (non-veg); Dal fry; Bengali salad; Rasam; Curd rice',
            ),
          },
          sat: {
            breakfast: dishes(
              'Wheat poori; Chana masala; Chilli & lemon wedges; Banana; 1 boiled egg (non-veg) / steamed green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Lasooni dal; Jeera aloo dry; Tomato rice (Karnataka); Papad; Bellulli saaru (garlic rasam); Butter milk',
            ),
            snacks: dishes('Dal kachori + green chutney'),
            dinner: dishes(
              'Aloo chilli dry (Indo-Chinese); Dal tadka; Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          sun: {
            breakfast: dishes(
              'Dosa, masala served separately; Sambar; Tomato garlic relish; Banana; 1 boiled egg (non-veg) / mixed sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Veg Hyderabadi dum biryani (veg) / chicken Hyderabadi dum biryani (non-veg); Dal Kolhapuri; Chole paneer (Punjabi); Mix raita; Veg salan (long mirchi / baingan); Pineapple halwa',
            ),
            snacks: dishes('Vada pav, green chutney'),
            dinner: dishes('Soya chunk masala (pan-India); Dal Kolhapuri; Bengali salad; Rasam; Curd rice'),
          },
        },
      },
      {
        label: 'Week 2',
        days: {
          mon: {
            breakfast: dishes(
              'Vegetable idli & ulundu vada; Sambar; Tomato onion mint chutney; Mix fruits; 1 boiled egg (non-veg) / steamed sprouts salad (veg)',
            ),
            lunch: dishes(
              'Palak dal; Aloo bhujia?; Bisibelebath & boondi; Beans, carrot / peas stir fry; Pepper rasam; Curd; Fruit kesari',
            ),
            snacks: dishes('Sprouts chaat'),
            dinner: dishes(
              'Toor dal; Veg Kolhapuri (veg) / egg Kolhapuri (non-veg); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          tue: {
            breakfast: dishes(
              'Poha, sev, jeeravan; Jalebi; Banana; 1 boiled egg (non-veg) / mixed vegetables & sprouts salad (veg)',
            ),
            lunch: dishes(
              'Kashmiri rajma; Matki usal; Drumstick imli tikha curry; Cabbage peas sauté; Lemon rasam; Butter milk',
            ),
            snacks: dishes('Vegetable cutlet with chutney'),
            dinner: dishes(
              'Jeera rice & plain rice; Dal fry; Banana bhindi dry?; Cucumber salad; Rasam; Curd rice',
            ),
          },
          wed: {
            breakfast: dishes(
              'Misal pav; Mix fruits; 1 boiled egg (non-veg) / steamed green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Veg dalma; Aloo kosa?; Lauki sambar; Beetroot grated sauté; Pineapple rasam; Curd; Kheer',
            ),
            snacks: dishes('Dahi vada with vegetable / boondi toppings'),
            dinner: dishes(
              'Dal tadka; Paneer lababdar (veg) / pepper chicken (non-veg); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          thu: {
            breakfast: dishes(
              'Methi paratha; Dahi; Pickle; Banana; 1 boiled egg (non-veg) / peas & green gram sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Panchmel dal; Mixed vegetable kadai dry; Brinjal imli tikha curry; Aloo gobi dry sabzi; Tomato dhaniya shorba; Chaas',
            ),
            snacks: dishes('Bhel puri'),
            dinner: dishes(
              'Bhaja muger dal?; Chole masala (veg) / egg chick masala (non-veg)?; Bengali salad; Rasam; Curd rice',
            ),
          },
          fri: {
            breakfast: dishes(
              'Podi uttapam; Sambar; Lasuni chutney; Single fruit; Egg bhurji (non-veg) / paneer bhurji (veg)',
            ),
            lunch: dishes(
              'Amritsari chole masala; Papad / fryums; Pappu (thick dal); Mix vegetable fry; Chettinad rasam; Curd; Gulab jamun',
            ),
            snacks: dishes('Mirchi bhaji with coconut chutney?'),
            dinner: dishes(
              'Dal tadka (North India); Mutter paneer masala (veg) / chicken makhani (non-veg); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          sat: {
            breakfast: dishes(
              'Bhatura?; Chole masala; Lemon & chilli; Mix fruits; 1 boiled egg (non-veg) / steamed green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Soya chunk chukka masala?; Amti dal; Garlic potato roast; Pudina rice; Garlic rasam; Butter milk',
            ),
            snacks: dishes('Corn club sandwich, green chutney (Indo-Western)'),
            dinner: dishes(
              'Veg fried rice & plain rice; Veg Manchurian (semi-gravy); Dal fry (North India); Bengali salad; Rasam; Curd rice',
            ),
          },
          sun: {
            breakfast: dishes(
              'Dosa, masala served separately; Sambar; Coconut chutney; Banana; 1 boiled egg (non-veg) / mixed sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Veg Lucknowi biryani (veg) / chicken Lucknowi biryani (non-veg); Paneer pasanda (Lucknowi)?; Masala dal; Onion / cucumber raita; Veg salan (long mirchi / baingan); Double ka meetha',
            ),
            snacks: dishes('Chinese veg noodles (Indo-Chinese)'),
            dinner: dishes(
              'Ghee rice & plain rice; Mix dal; Aloo shimla mirch (North India); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
        },
      },
    ],
  },
  {
    slug: 'radha-rani-ka-dhaba',
    name: 'Radha Rani Ka · Vrindavan Dhaba',
    kind: 'restaurant',
    place: 'VIT Chauraha, Kothri',
    source: 'owner',
    note: 'Pure vegetarian dhaba and family restaurant. Free home delivery; parcels available. Serving hours are not on the menu card, so the times here are approximate.',
    prices: 'Mess thali ₹80 · Tiffin ₹3,600 a month',
    // The number printed on the owner's menu card.
    phone: '+91 85179 03810',
    orderNote: 'Free home delivery · Parcel available',
    order: [
      {
        title: 'Thali & tiffin',
        items: [
          { name: 'Mess thali', price: 80, note: "today's lunch or dinner menu" },
          { name: 'Monthly tiffin', price: 3600, note: 'a month' },
        ],
      },
    ],
    ownerEmails: [],
    ordersOpen: false,
    cycleStart: '2026-11-23',
    published: false,
    meals: [
      { key: 'lunch', start: '12:00', end: '15:00', extras: '' },
      { key: 'dinner', start: '19:00', end: '22:00', extras: '' },
    ],
    weeks: [
      {
        label: '',
        days: {
          mon: {
            lunch: dishes('Aloo paratha; Matar pulao; Salad'),
            dinner: dishes('Chhole masala; Dal; Rice; Roti; Salad'),
          },
          tue: {
            lunch: dishes('Mix veg; Dal; Rice; Roti; Salad'),
            dinner: dishes('Aloo / drumstick; Dal; Rice; Roti'),
          },
          wed: {
            lunch: dishes('Sev tamatar; Dal; Rice; Roti; Salad'),
            dinner: dishes('Matar paneer; Dal; Rice; Roti; Papad; Salad'),
          },
          thu: {
            lunch: dishes('Bhindi masala; Dal; Rice; Roti'),
            dinner: dishes('Chhole bhature; Matar pulao'),
          },
          fri: {
            lunch: dishes('Aloo chole; Dal; Rice; Roti; Salad'),
            dinner: dishes('Kadhi pakoda; Dal; Picadi?; Rice; Salad'),
          },
          sat: {
            lunch: dishes('Punjabi aloo; Dal; Rice; Roti'),
            dinner: dishes('Hakka noodles; Matar paneer; Paratha; Papad'),
          },
          sun: {
            lunch: dishes('Mushroom matar; Dal; Rice; Roti; Papad; Salad'),
            dinner: dishes('Paneer masala; Methi paratha; Veg fried rice'),
          },
        },
      },
    ],
  },
];

/**
 * Demo site only: a sample à la carte list for the dhaba, so ordering can be tried end to end.
 * These are made-up dishes and prices, never seeded into the live database; the owner's real
 * card replaces them in Admin › Campus.
 */
export const DEMO_DHABA_EXTRAS: MessInput['order'] = [
  {
    title: 'Main course',
    items: [
      { name: 'Paneer butter masala', price: 160, note: 'full' },
      { name: 'Kadai paneer', price: 170, note: 'full' },
      { name: 'Mix veg', price: 120, note: '' },
      { name: 'Dal fry', price: 90, note: '' },
      { name: 'Dal makhani', price: 130, note: '' },
      { name: 'Chhole masala', price: 110, note: '' },
    ],
  },
  {
    title: 'Breads & rice',
    items: [
      { name: 'Tawa roti', price: 8, note: 'each' },
      { name: 'Butter roti', price: 12, note: 'each' },
      { name: 'Aloo paratha', price: 40, note: 'with curd' },
      { name: 'Jeera rice', price: 80, note: '' },
      { name: 'Veg fried rice', price: 100, note: '' },
    ],
  },
  {
    title: 'Snacks & drinks',
    items: [
      { name: 'Hakka noodles', price: 90, note: '' },
      { name: 'Masala chai', price: 15, note: '' },
      { name: 'Sweet lassi', price: 40, note: '' },
    ],
  },
];
