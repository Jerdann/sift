import type { MailCategory } from '../../shared/contracts/analysis';

export const CLASSIFIER_VERSION = 'deterministic-1.2.0';

export const CATEGORY_PRESENTATION: Readonly<Record<MailCategory, { label: string; folder: string }>> = {
  personal: { label: 'Personal', folder: 'Personal' },
  security: { label: 'Security & access', folder: 'Important/Security' },
  accounts: { label: 'Accounts & memberships', folder: 'Important/Accounts' },
  transactions: { label: 'Receipts & transactions', folder: 'Money/Receipts' },
  finance: { label: 'Banking & finance', folder: 'Money/Finance' },
  shopping: { label: 'Shopping & deliveries', folder: 'Shopping/Orders' },
  travel: { label: 'Travel & reservations', folder: 'Travel' },
  games: { label: 'Games & gaming accounts', folder: 'Games' },
  subscriptions: { label: 'Newsletters & subscriptions', folder: 'Subscriptions' },
  promotions: { label: 'Promotions & deals', folder: 'Promotions' },
  social: { label: 'Social networks', folder: 'Social' },
  suspicious: { label: 'Suspicious review', folder: 'Review/Suspicious' },
  spam: { label: 'Likely spam', folder: 'Spam Review' },
  other: { label: 'Unsorted review', folder: 'Review/Unsorted' },
};

export interface ClassificationInput {
  subject: string | null;
  bodyText: string | null;
  senders: string[];
  recipients: string[];
  headers: Record<string, string>;
}

export interface ClassificationResult {
  category: MailCategory;
  confidence: number;
  evidence: string[];
  senderDomain: string;
  receivingAddresses: string[];
}

const has = (text: string, pattern: RegExp) => pattern.test(text);
const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const domainFor = (address: string | undefined): string => {
  const domain = address?.split('@').at(-1)?.toLowerCase().replace(/^www\./, '');
  return domain && /^[a-z0-9.-]+$/.test(domain) ? domain : 'unknown-sender';
};

export const classifyMessage = (input: ClassificationInput): ClassificationResult => {
  const subject = input.subject?.toLowerCase() ?? '';
  const body = input.bodyText?.toLowerCase().slice(0, 32_768) ?? '';
  const text = `${subject}\n${body}`;
  const headerText = Object.values(input.headers).join('\n').toLowerCase();
  const senderDomain = domainFor(input.senders[0]);
  const headerRecipients = [input.headers['delivered-to'], input.headers['x-original-to']]
    .flatMap((value) => value?.match(emailPattern) ?? [])
    .map((address) => address.toLowerCase());
  const receivingAddresses = [...new Set([...headerRecipients, ...input.recipients.map((value) => value.toLowerCase())])];
  const evidence: string[] = [];
  const result = (category: MailCategory, confidence: number, ...reasons: string[]): ClassificationResult => ({
    category,
    confidence,
    evidence: [...evidence, ...reasons],
    senderDomain,
    receivingAddresses,
  });

  const authFailed = has(headerText, /(?:spf|dkim|dmarc)=(?:fail|softfail|temperror|permerror)/);
  const listMail = Boolean(input.headers['list-id'] || input.headers['list-unsubscribe']);
  const obviousJunk = has(text, /\b(?:crypto giveaway|risk[- ]free investment|wire transfer urgently|you have won|claim your prize|adult dating|miracle cure)\b/);
  if (authFailed) evidence.push('sender authentication failed');
  if (obviousJunk && authFailed) return result('spam', 0.94, 'high-risk unsolicited language');
  if (obviousJunk || (authFailed && has(text, /\b(?:urgent|verify immediately|suspended|click here)\b/))) {
    return result('suspicious', authFailed ? 0.88 : 0.72, 'suspicious language requires review');
  }

  if (has(text, /\b(?:one[- ]time (?:code|password)|verification code|security alert|new (?:login|sign[- ]in)|password (?:reset|changed)|two[- ]factor|2fa|authenticate|unusual activity)\b/)) {
    return result('security', 0.94, 'security or access language');
  }
  if (has(senderDomain, /(?:bank|credit|paypal|venmo|cashapp|stripe|wise|coinbase|fidelity|schwab)/) || has(text, /\b(?:bank statement|credit score|account balance|monthly statement|tax document)\b/)) {
    return result('finance', 0.9, 'financial sender or statement language');
  }
  if (has(text, /\b(?:receipt|invoice|payment (?:received|confirmed)|order confirmation|your order|purchase confirmation|refund|charged)\b/)) {
    return result('transactions', 0.91, 'receipt or payment language');
  }
  if (has(text, /\b(?:shipped|out for delivery|tracking number|delivery update|package (?:arrived|delivered))\b/)) {
    return result('shopping', 0.91, 'shipping or delivery language');
  }
  if (has(text, /\b(?:flight|boarding pass|hotel|reservation|itinerary|check[- ]in|rental car|booking confirmation)\b/)) {
    return result('travel', 0.9, 'travel or reservation language');
  }
  if (has(senderDomain, /(?:steampowered|steamgames|xbox|playstation|nintendo|epicgames|riotgames|blizzard|ea\.com|ubisoft|twitch)/) || has(text, /\b(?:game account|wishlist game|gaming|steam|playstation|xbox|nintendo|battle\.net)\b/)) {
    return result('games', 0.88, 'gaming sender or account language');
  }
  if (has(senderDomain, /(?:facebook|instagram|linkedin|twitter|x\.com|reddit|tiktok|discord|snapchat)/) || has(text, /\b(?:friend request|mentioned you|new follower|direct message|connection request)\b/)) {
    return result('social', 0.86, 'social-network sender or notification');
  }
  if (has(text, /\b(?:welcome to|account (?:created|activated)|confirm your email|verify your email address|membership|complete your profile)\b/)) {
    return result('accounts', 0.88, 'account lifecycle language');
  }
  if (listMail && has(text, /\b(?:sale|save \d+%|\d+% off|discount|deal|offer|shop now|limited time|clearance|coupon|promo)\b/)) {
    return result('promotions', 0.91, 'mailing-list headers and promotional language');
  }
  if (listMail) return result('subscriptions', 0.87, 'mailing-list headers');
  if (has(text, /\b(?:sale|discount|deal|offer|shop now|limited time|clearance|coupon|promo)\b/)) {
    return result('promotions', 0.7, 'promotional language without mailing-list headers');
  }
  if (has(senderDomain, /(?:gmail|outlook|hotmail|icloud|protonmail|pm\.me|yahoo)\./) && input.senders.length === 1) {
    return result('personal', 0.68, 'individual mailbox sender');
  }
  return result(
    'other',
    input.bodyText ? 0.58 : 0.45,
    input.bodyText
      ? 'No category matched with enough certainty'
      : 'Only the sender, recipient, subject, and message headers were available',
  );
};
