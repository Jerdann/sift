import type { UnsubscribeProgress } from '../../shared/contracts/unsubscribe';
import type { JobRepository } from '../jobs/job-repository';
import type { SubscriptionRepository } from './subscription-repository';
import { lookup } from 'node:dns/promises';

export type HttpFetchPort = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'headers'>>;
export type ResolveHostPort = (hostname: string) => Promise<readonly string[]>;

const privateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const ipv4 = normalized.replace(/^::ffff:/, '').split('.').map(Number);
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 0 ||
    (ipv4[0] === 169 && ipv4[1] === 254) ||
    (ipv4[0] === 172 && (ipv4[1] ?? 0) >= 16 && (ipv4[1] ?? 0) <= 31) ||
    (ipv4[0] === 192 && ipv4[1] === 168);
};

const resolvePublicHost: ResolveHostPort = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

export const postOneClickUnsubscribe = async (
  endpoint: string,
  fetchPort: HttpFetchPort = fetch,
  resolveHost: ResolveHostPort = resolvePublicHost,
): Promise<boolean> => {
  let url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe_unsubscribe_endpoint');
  const originalHost = url.hostname.toLowerCase();
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const addresses = await resolveHost(url.hostname);
    if (!addresses.length || addresses.some(privateAddress)) throw new Error('unsafe_unsubscribe_host');
    const response = await fetchPort(url.toString(), {
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Sift/0.1 one-click-unsubscribe',
      },
      body: 'List-Unsubscribe=One-Click',
    });
    if (response.status >= 200 && response.status < 300) return true;
    if (response.status < 300 || response.status >= 400) return false;
    const location = response.headers.get('location');
    if (!location || redirects === 3) return false;
    const next = new URL(location, url);
    if (
      next.protocol !== 'https:' || next.username || next.password ||
      next.hostname.toLowerCase() !== originalHost
    ) throw new Error('unsafe_unsubscribe_redirect');
    url = next;
  }
  return false;
};

export class UnsubscribeRunner {
  readonly #jobs: JobRepository;
  readonly #subscriptions: SubscriptionRepository;
  readonly #post: (endpoint: string) => Promise<boolean>;
  readonly #listeners = new Set<(progress: UnsubscribeProgress) => void>();

  constructor(
    jobs: JobRepository,
    subscriptions: SubscriptionRepository,
    post: (endpoint: string) => Promise<boolean> = postOneClickUnsubscribe,
  ) {
    this.#jobs = jobs;
    this.#subscriptions = subscriptions;
    this.#post = post;
  }

  subscribe(listener: (progress: UnsubscribeProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async run(jobId: string): Promise<UnsubscribeProgress> {
    const scanId = this.#subscriptions.scanIdForJob(jobId);
    for (;;) {
      const item = this.#jobs.claimNextPending(jobId);
      if (!item) break;
      try {
        const action = this.#subscriptions.action(item.itemKey);
        const ok = await this.#post(action.endpoint);
        if (!ok) throw new Error('unsubscribe_request_failed');
        this.#subscriptions.mark(action.id, 'unsubscribed');
        this.#jobs.transitionItem(item.id, 'succeeded', {
          result: { operation: 'unsubscribe-one-click', verified: true },
        });
      } catch {
        this.#subscriptions.mark(item.itemKey, 'failed');
        this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'unsubscribe_request_failed' });
      }
      this.#emit(scanId);
    }
    return this.progress(scanId);
  }

  progress(scanId: string): UnsubscribeProgress {
    return { profileId: this.#subscriptions.profileId, dashboard: this.#subscriptions.getByScan(scanId) };
  }

  #emit(scanId: string) {
    const progress = this.progress(scanId);
    for (const listener of this.#listeners) listener(progress);
  }
}
