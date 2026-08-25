import { describe, expect, it } from 'vitest';
import { subscriptionPriorityScore } from '../../src/core/pruning/subscription-ranking';
import { rankStaleStreams } from '../../src/core/pruning/stale-stream-ranking';
import type { SenderStream } from '../../src/shared/contracts/analysis';

describe('provider-neutral pruning ranking', () => {
  it('ranks frequent ignored subscriptions above equally recent low-volume mail', () => {
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const noisy = subscriptionPriorityScore(100, '2026-08-20T00:00:00.000Z', ['promotions'], 20, 0.05, now);
    const quiet = subscriptionPriorityScore(5, '2026-08-20T00:00:00.000Z', ['subscriptions'], 1, 1, now);
    expect(noisy).toBeGreaterThan(quiet);
  });

  it('protects critical classifications while preserving alias scope for stale domains', () => {
    const streams: SenderStream[] = [
      { senderDomain: 'mixed.example', category: 'promotions', receivingAddress: 'home@example.test', messageCount: 40, latestAt: '2025-01-01T00:00:00.000Z', confidence: 0.95, evidence: [] },
      { senderDomain: 'mixed.example', category: 'security', receivingAddress: 'accounts@example.test', messageCount: 3, latestAt: '2025-01-02T00:00:00.000Z', confidence: 0.95, evidence: [] },
      { senderDomain: 'recent.example', category: 'subscriptions', receivingAddress: 'home@example.test', messageCount: 100, latestAt: '2026-08-20T00:00:00.000Z', confidence: 0.95, evidence: [] },
    ];
    expect(rankStaleStreams(streams, 180, Date.parse('2026-08-25T00:00:00.000Z'))).toEqual([expect.objectContaining({
      domain: 'mixed.example', messages: 40, protected: 3, addresses: ['accounts@example.test', 'home@example.test'],
    })]);
  });
});
