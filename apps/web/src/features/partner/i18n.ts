import { useCallback, useSyncExternalStore } from 'react';

/**
 * The Partner app speaks Hindi first (restaurant owners near campus), with a one-tap switch to
 * English. Every line the owner sees lives here, in both languages.
 */
export type Lang = 'hi' | 'en';

const T = {
  appName: { hi: 'Scholars Stack पार्टनर', en: 'Scholars Stack Partner' },
  // Sign-in
  signInTitle: { hi: 'अपने रेस्टोरेंट में लॉग इन करें', en: 'Sign in to your restaurant' },
  mobile: { hi: 'मोबाइल नंबर', en: 'Mobile number' },
  pin: { hi: '4 अंकों का PIN', en: '4-digit PIN' },
  signIn: { hi: 'लॉग इन', en: 'Sign in' },
  firstTime: { hi: 'पहली बार? सेटअप कोड डालें', en: 'First time? Use your setup code' },
  haveCode: { hi: 'PIN है? लॉग इन करें', en: 'Have a PIN? Sign in' },
  setupCode: { hi: '6 अंकों का सेटअप कोड', en: '6-digit setup code' },
  setupHelp: {
    hi: 'सेटअप कोड Scholars Stack से मिलेगा। फिर अपना नया 4 अंकों का PIN चुनें।',
    en: 'Scholars Stack gives you the setup code. Then choose your new 4-digit PIN.',
  },
  newPin: { hi: 'नया PIN चुनें', en: 'Choose a new PIN' },
  savePin: { hi: 'PIN सेव करें और लॉग इन करें', en: 'Save PIN and sign in' },
  continue: { hi: 'आगे बढ़ें', en: 'Continue' },
  welcomeBack: { hi: 'अपना PIN डालें', en: 'Enter your PIN' },
  changeNumber: { hi: 'नंबर बदलें', en: 'Change number' },
  enterSetupCode: { hi: 'सेटअप कोड डालें', en: 'Enter your setup code' },
  newPinHelp: {
    hi: 'अब 4 अंकों का PIN चुनें। अगली बार सिर्फ़ यही PIN डालना होगा।',
    en: 'Now choose a 4-digit PIN. Next time you only type this PIN.',
  },
  confirmPin: { hi: 'PIN दोबारा डालें', en: 'Enter the PIN again' },
  confirmPinHelp: { hi: 'पक्का करने के लिए वही PIN फिर से डालें।', en: 'Type the same PIN again to confirm.' },
  pinsDiffer: { hi: 'दोनों PIN अलग हैं। फिर से चुनें।', en: 'The two PINs were different. Choose again.' },
  notRegistered: {
    hi: 'यह नंबर जुड़ा नहीं है। Scholars Stack से बात करें।',
    en: 'This number isn’t registered. Talk to Scholars Stack.',
  },
  forgotPinCode: { hi: 'PIN भूल गए? सेटअप कोड डालें', en: 'Forgot your PIN? Use a setup code' },
  forgot: { hi: 'मदद चाहिए? Scholars Stack को कॉल करें', en: 'Need help? Call Scholars Stack' },
  pleaseWait: { hi: 'रुकिए…', en: 'Please wait…' },
  otherAccount: {
    hi: 'यह ऐप सिर्फ़ रेस्टोरेंट मालिकों के लिए है। अपने रेस्टोरेंट के नंबर और PIN से लॉग इन करें। अभी लॉग इन:',
    en: 'This app is for restaurant owners only. Sign in with your restaurant’s number and PIN. Signed in now as',
  },
  notOwner: {
    hi: 'यह खाता किसी रेस्टोरेंट से जुड़ा नहीं है। Scholars Stack से बात करें।',
    en: 'This account isn’t linked to a restaurant. Talk to Scholars Stack.',
  },
  // Shop switch
  open: { hi: 'दुकान खुली है', en: 'Shop is open' },
  closed: { hi: 'दुकान बंद है', en: 'Shop is closed' },
  openShort: { hi: 'खुली', en: 'Open' },
  closedShort: { hi: 'बंद', en: 'Closed' },
  openHint: { hi: 'छात्र अभी ऑर्डर कर सकते हैं', en: 'Students can order now' },
  closedHint: { hi: 'अभी कोई ऑर्डर नहीं आएगा', en: 'No orders will come in' },
  // Tabs
  tabOrders: { hi: 'ऑर्डर', en: 'Orders' },
  tabSales: { hi: 'हिसाब', en: 'Sales' },
  tabMenu: { hi: 'मेनू', en: 'Menu' },
  tabMore: { hi: 'और', en: 'More' },
  // Orders
  newOrders: { hi: 'नए ऑर्डर', en: 'New orders' },
  inKitchen: { hi: 'बन रहे हैं', en: 'Being made' },
  readyList: { hi: 'तैयार', en: 'Ready' },
  noOrdersTitle: { hi: 'सब तैयार है', en: 'All set' },
  noOrders: {
    hi: 'अभी कोई ऑर्डर नहीं। नया ऑर्डर आते ही घंटी बजेगी।',
    en: 'No orders right now. A bell rings when one comes in.',
  },
  accept: { hi: 'स्वीकार करें', en: 'Accept' },
  payDue: { hi: 'पहले UPI से पैसे आएँगे, फिर बनाना है', en: 'Paid first by UPI: waiting for the money' },
  payClaimed: {
    hi: 'छात्र कहता है पैसे भेज दिए। अपना UPI ऐप देखें।',
    en: 'The student says they paid. Check your UPI app.',
  },
  payReceived: { hi: 'पैसे मिल गए', en: 'Payment received' },
  paidDone: { hi: 'UPI से पैसे मिल गए ✓', en: 'Paid by UPI ✓' },
  payNoScreenshot: {
    hi: 'सिर्फ़ अपने UPI ऐप या बैंक SMS में देखकर दबाएँ, स्क्रीनशॉट पर भरोसा न करें।',
    en: 'Only tap after seeing it in your own UPI app or bank SMS, never from a screenshot.',
  },
  newCustomer: { hi: 'नया ग्राहक', en: 'New customer' },
  pastOrders: { hi: 'ऑर्डर लिए', en: 'orders' },
  notCollected: { hi: 'बार लेने नहीं आए', en: 'not collected' },
  noShow: { hi: 'ग्राहक लेने नहीं आया', en: "Didn't collect" },
  noShowSure: {
    hi: 'पक्का? यह छात्र के रिकॉर्ड में गिना जाएगा। 2 बार पर उसे पहले पैसे देने होंगे।',
    en: "Sure? It counts on the student's record. After 2, they must pay first.",
  },
  noShowYes: { hi: 'हाँ, नहीं आया', en: 'Yes, mark it' },
  refundPaid: {
    hi: 'पैसे मिल चुके हैं: रद्द करें तो छात्र को UPI से लौटाएँ।',
    en: 'Already paid: if you cancel, return the money by UPI.',
  },
  reject: { hi: 'मना करें', en: 'Reject' },
  markReady: { hi: 'तैयार है', en: 'Ready' },
  markDone: { hi: 'दे दिया', en: 'Handed over' },
  call: { hi: 'कॉल', en: 'Call' },
  chat: { hi: 'चैट', en: 'Chat' },
  delivery: { hi: 'डिलीवरी', en: 'Delivery' },
  pickup: { hi: 'खुद लेने आएंगे', en: 'Pickup' },
  minsAgo: { hi: 'मिनट पहले', en: 'min ago' },
  justNow: { hi: 'अभी', en: 'just now' },
  rejectWhy: { hi: 'मना क्यों कर रहे हैं?', en: 'Why are you rejecting it?' },
  reasonSoldOut: { hi: 'सामान खत्म', en: 'Sold out' },
  reasonBusy: { hi: 'बहुत ऑर्डर हैं', en: 'Too busy' },
  reasonClosed: { hi: 'दुकान बंद हो रही है', en: 'Closing now' },
  reasonFar: { hi: 'डिलीवरी नहीं हो पाएगी', en: 'Can’t deliver there' },
  cancel: { hi: 'रहने दें', en: 'Cancel' },
  autoCancel: {
    hi: '10 मिनट में जवाब न देने पर ऑर्डर रद्द हो जाएगा',
    en: 'Cancels by itself after 10 minutes without an answer',
  },
  tapToHear: { hi: 'घंटी चालू करने के लिए एक बार टैप करें', en: 'Tap once to switch the order bell on' },
  // Sales
  today: { hi: 'आज', en: 'Today' },
  week: { hi: 'इस हफ़्ते', en: 'This week' },
  month: { hi: 'इस महीने', en: 'This month' },
  year: { hi: 'इस साल', en: 'This year' },
  // Customers
  searchCustomers: { hi: 'नाम या नंबर से खोजें', en: 'Search by name or number' },
  customersHint: { hi: 'पिछले 90 दिनों में ऑर्डर करने वाले छात्र', en: 'Students who ordered in the last 90 days' },
  noCustomers: { hi: 'अभी कोई ग्राहक नहीं।', en: 'No customers yet.' },
  ordersCount: { hi: 'ऑर्डर', en: 'orders' },
  lastOrder: { hi: 'आख़िरी ऑर्डर', en: 'Last order' },
  firstOrder: { hi: 'पहला ऑर्डर', en: 'First order' },
  spentTotal: { hi: 'कुल ख़र्च', en: 'Spent' },
  avgOrder: { hi: 'औसत ऑर्डर', en: 'Average order' },
  visits: { hi: 'मेनू देखने आए', en: 'Visited your menu' },
  days: { hi: 'दिन', en: 'days' },
  completedOrders: { hi: 'पूरे हुए', en: 'Completed' },
  cancelledByThem: { hi: 'छात्र ने रद्द किए', en: 'They cancelled' },
  declinedByYou: { hi: 'आपने मना किए', en: 'You declined' },
  unanswered: { hi: 'जवाब नहीं दिया', en: 'Not answered' },
  notCollectedHere: { hi: 'लेने नहीं आए', en: 'Not collected' },
  everywhere: { hi: 'सब रेस्टोरेंट में (60 दिन)', en: 'all restaurants (60 days)' },
  favourites: { hi: 'सबसे पसंदीदा', en: 'Favourites' },
  usualTime: { hi: 'आमतौर पर ऑर्डर का समय', en: 'Usually orders at' },
  orderHistory: { hi: 'सारे ऑर्डर', en: 'Every order' },
  monthly: { hi: 'हर महीने का ख़र्च', en: 'Spending by month' },
  blockedTag: { hi: 'ब्लॉक', en: 'Blocked' },
  tiffinTag: { hi: 'टिफ़िन', en: 'Tiffin' },
  record12: { hi: 'पिछले 12 महीनों का पूरा हिसाब', en: 'Their full record, last 12 months' },
  statusPlaced: { hi: 'नया', en: 'New' },
  statusAccepted: { hi: 'बन रहा', en: 'Being made' },
  statusReady: { hi: 'तैयार', en: 'Ready' },
  statusDone: { hi: 'दे दिया', en: 'Delivered' },
  statusRejected: { hi: 'मना किया', en: 'Declined' },
  statusCancelled: { hi: 'रद्द', en: 'Cancelled' },
  earned: { hi: 'कमाई', en: 'Earned' },
  orders: { hi: 'ऑर्डर', en: 'Orders' },
  visitors: { hi: 'लोगों ने मेनू देखा', en: 'People saw your menu' },
  vsBefore: { hi: 'पिछली बार से', en: 'vs before' },
  best: { hi: 'सबसे ज़्यादा बिकने वाला', en: 'Best seller' },
  dishes: { hi: 'हर चीज़ की बिक्री', en: 'Sales by dish' },
  slow: { hi: 'कम बिकने वाली चीज़ें', en: 'Slow dishes' },
  slowHint: {
    hi: 'ये मेनू में हैं पर इस बार बहुत कम बिकीं। दाम या फ़ोटो बदलकर देखें।',
    en: 'On your menu but barely sold this time. Try a new price or photo.',
  },
  busiest: { hi: 'सबसे व्यस्त समय', en: 'Busiest time' },
  busiestDay: { hi: 'सबसे व्यस्त दिन', en: 'Busiest day' },
  sold: { hi: 'बिके', en: 'sold' },
  noSales: { hi: 'इस समय में अभी कोई बिक्री नहीं।', en: 'No sales in this period yet.' },
  up: { hi: 'बढ़ा', en: 'up' },
  down: { hi: 'घटा', en: 'down' },
  // Menu
  menuHint: {
    hi: 'जो चीज़ खत्म हो जाए उसे "खत्म" कर दें। छात्र उसे ऑर्डर नहीं कर पाएंगे।',
    en: 'Switch a dish to "Sold out" when it runs out. Students can’t order it then.',
  },
  available: { hi: 'मिल रहा है', en: 'Available' },
  soldOut: { hi: 'खत्म', en: 'Sold out' },
  price: { hi: 'दाम ₹', en: 'Price ₹' },
  save: { hi: 'बदलाव सेव करें', en: 'Save changes' },
  saved: { hi: 'सेव हो गया', en: 'Saved' },
  unsaved: { hi: 'बदलाव सेव नहीं हुए', en: 'Changes not saved' },
  // More
  fullDashboard: { hi: 'पूरा डैशबोर्ड', en: 'Full dashboard' },
  moreTiffin: { hi: 'टिफ़िन', en: 'Tiffin' },
  moreCustomers: { hi: 'ग्राहक', en: 'Customers' },
  moreOffers: { hi: 'ऑफ़र', en: 'Offers' },
  moreWeek: { hi: 'हफ़्ते का मेनू', en: 'Weekly menu' },
  moreDetails: { hi: 'दुकान की जानकारी और समय', en: 'Details & timings' },
  morePhotos: { hi: 'मेनू और फ़ोटो बदलें', en: 'Edit menu & photos' },
  moreBlocked: { hi: 'ब्लॉक किए गए', en: 'Blocked' },
  moreAlerts: { hi: 'ऑर्डर की घंटी', en: 'Order alerts' },
  hintAlerts: { hi: 'फ़ोन बंद हो तब भी नए ऑर्डर की सूचना', en: 'Hear new orders even with the app closed' },
  hintPhotos: { hi: 'चीज़ें जोड़ें, दाम और फ़ोटो बदलें', en: 'Add dishes, change prices and photos' },
  hintOffers: { hi: 'कोड, डील और कॉम्बो', en: 'Codes, deals and combos' },
  hintTiffin: { hi: 'आज किसे टिफ़िन देना है', en: 'Who gets a tiffin today' },
  hintCustomers: { hi: 'जिन्होंने पिछले 90 दिन में ऑर्डर किया', en: 'Everyone who ordered in the last 90 days' },
  hintWeek: { hi: 'हर दिन का नाश्ता, खाना और रात का खाना', en: 'Each day’s breakfast, lunch and dinner' },
  hintDetails: {
    hi: 'नाम, पता, फ़ोन, समय, रोज़ के ऑर्डर की सीमा',
    en: 'Name, place, phone, timings, daily limit',
  },
  hintBlocked: { hi: 'जिन छात्रों को आपने रोका है', en: 'Students you stopped from ordering' },
  editMenu: { hi: 'मेनू, दाम और फ़ोटो बदलें', en: 'Edit menu, prices & photos' },
  groupToday: { hi: 'रोज़ का काम', en: 'Every day' },
  groupMenu: { hi: 'मेनू', en: 'Your menu' },
  groupShop: { hi: 'दुकान', en: 'Your shop' },
  setupTitle: { hi: 'फ़ोन सेटअप: घंटी कभी न छूटे', en: 'Phone setup: never miss the ring' },
  setupLead: {
    hi: 'कुछ फ़ोन बैटरी बचाने के लिए ऐप बंद कर देते हैं। नीचे सब ✓ कर दें, फिर फ़ोन लॉक होने पर भी नए ऑर्डर की घंटी बजेगी।',
    en: 'Some phones stop apps to save battery. Make everything below ✓ and the new-order ring works even with the phone locked.',
  },
  setupNotifications: { hi: 'सूचनाएं चालू', en: 'Notifications on' },
  setupNotificationsHint: { hi: 'नए ऑर्डर और मैसेज दिखें', en: 'Show new orders and messages' },
  setupBattery: { hi: 'बैटरी बचत से बाहर', en: 'Not limited by battery saver' },
  setupBatteryHint: { hi: 'ताकि फ़ोन ऐप को बंद न करे', en: 'So the phone never stops the app' },
  setupAutostart: { hi: 'अपने-आप चालू (Autostart)', en: 'Autostart' },
  setupAutostartHint: { hi: 'इस फ़ोन पर इसे भी चालू करें', en: 'Turn this on too, on this phone' },
  setupOpen: { hi: 'खोलें', en: 'Open' },
  setupAllow: { hi: 'चालू करें', en: 'Allow' },
  language: { hi: 'भाषा', en: 'Language' },
  support: { hi: 'Scholars Stack को कॉल करें', en: 'Call Scholars Stack' },
  logout: { hi: 'लॉग आउट', en: 'Sign out' },
  logoutSure: { hi: 'लॉग आउट करें? नए ऑर्डर की घंटी बंद हो जाएगी।', en: 'Sign out? The new-order bell stops.' },
  retry: { hi: 'फिर से कोशिश करें', en: 'Try again' },
  offline: { hi: 'इंटरनेट नहीं है', en: 'No internet' },
} satisfies Record<string, Record<Lang, string>>;

export type TextKey = keyof typeof T;

const KEY = 'ss_partner_lang';
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'hi';
  } catch {
    return 'hi';
  }
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // storage blocked: the switch still works until reload
  }
  current = lang;
  for (const l of listeners) l();
}

let current: Lang | null = null;
const snapshot = (): Lang => {
  if (current === null) current = readLang();
  return current;
};

/** The owner's language and a translator for it. */
export function useT() {
  const lang = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot,
    () => 'hi' as Lang,
  );
  const t = useCallback((k: TextKey) => T[k][lang], [lang]);
  return { lang, t };
}
