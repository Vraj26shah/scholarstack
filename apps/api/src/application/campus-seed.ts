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
    note: 'Typed from the notice-board photo (week 1, from 12 Oct 2026, veg & non-veg). High tea and dinner times are our best guess until the notice gives them.',
    prices: '',
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
      { key: 'snacks', start: '16:30', end: '17:30', extras: 'Tea, coffee, milk' },
      {
        key: 'dinner',
        start: '19:30',
        end: '21:30',
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
              'Dal fry; Aloo gobi sukhi (dry); Mixed vegetable sambar; Beans peas stir fry; Tomato dhaniya shorba?; Curd; Kheer?',
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
              'Rajma masala; Tindora fry?; Mixed veg curry?; Stir-fried vegetables?; Ajwain rasam?; Butter milk',
            ),
            snacks: dishes('Punugulu + podi & allam (ginger) chutney?'),
            dinner: dishes('Veg pulao; Veg jalfrezi; Dal makhani; Mix vegetable salad; Rasam; Curd rice'),
          },
          wed: {
            breakfast: dishes(
              'Sabudana khichdi?; Set dosa & vada curry?; Coconut chutney; Mix fruits; 1 boiled egg (non-veg) / steamed green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Gujarati dal; Veg kofta curry (semi gravy); Drumstick sambar; Cabbage peas carrot sauté; Garlic pepper rasam; Curd; Kesari?',
            ),
            snacks: dishes('Pani puri with aloo, kala chana, onion'),
            dinner: dishes(
              'Paneer chatpata (veg) / chicken korma (non-veg); Moong masoor dal (North); Bengali salad?; Rasam; Curd rice',
            ),
          },
          thu: {
            breakfast: dishes(
              'Pav bhaji & fried chillies; Mix fruits; 2 boiled eggs (non-veg) / green gram sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Jeera rice (+ plain rice south); Cholar dal; Aloo posto; Butter beans curry?; Carrot & beans poriyal (Tamil Nadu); Chenna saag?; Chaas',
            ),
            snacks: dishes('Mini veg samosa, green & sweet chutney'),
            dinner: dishes(
              'Palak paneer (veg) / anda curry (non-veg); Mix vegetable salad; Rasam; Curd rice',
            ),
          },
          fri: {
            breakfast: dishes(
              'Vegetable poha; Jalebi?; Single fruit; Egg bhurji (non-veg) / paneer bhurji (veg)',
            ),
            lunch: dishes(
              'Rajasthani kadhi; Bhindi pachadi?; Mixed vegetable tooran?; Dal sambar; Seasonal mixed vegetable sabji; Chettinad rasam; Curd; Gulab jamun?',
            ),
            snacks: dishes('Cheese & vegetable sandwich?'),
            dinner: dishes(
              'Paneer tikka masala (veg) / chicken tikka masala (non-veg); Dal fry; Salad; Rasam; Curd rice',
            ),
          },
          sat: {
            breakfast: dishes(
              'Wheat poori; Channa masala; Chilli & lemon wedges; Banana; 1 boiled egg (non-veg) / green gram sprouts (veg)',
            ),
            lunch: dishes(
              'Lasooni dal; Jeera aloo dry; Tomato rice (Karnataka); Papad?; Bellulli saaru (garlic rasam); Butter milk',
            ),
            snacks: dishes('Dal kachori + green chutney'),
            dinner: dishes('Aloo fried (Indo-Chinese)?; Dal tadka; Mix vegetable salad; Rasam; Curd rice'),
          },
          sun: {
            breakfast: dishes(
              'Dosa, masala separately; Sambar; Tomato garlic chutney?; Banana; 1 boiled egg (non-veg) / mixed sprouts chaat (veg)',
            ),
            lunch: dishes(
              'Veg Hyderabadi dum biryani (veg) / chicken Hyderabadi dum biryani (non-veg); Dal Kolhapuri?; Chole paneer (Punjabi)?; Mix raita; Veg salan (long mirchi)?; Pineapple kesari?',
            ),
            snacks: dishes('Vada pav, green chutney'),
            dinner: dishes('Main dish not readable on the notice?; Dal Kolhapuri?; Salad; Rasam; Curd rice'),
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
