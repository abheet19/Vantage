/**
 * hash-api-key.spec.ts — the stored form of a key is its sha256 and nothing else.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { API_KEY_PREFIX, hashApiKey } from '../../src/domain/hash-api-key.js';

describe('hashApiKey', () => {
  it('is sha256 hex of the exact key', () => {
    expect(hashApiKey('vk_abc')).toBe(createHash('sha256').update('vk_abc').digest('hex'));
    expect(hashApiKey('vk_abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case- and whitespace-sensitive: a near-miss key does not match', () => {
    expect(hashApiKey('vk_abc')).not.toBe(hashApiKey('vk_abc '));
    expect(hashApiKey('vk_abc')).not.toBe(hashApiKey('VK_ABC'));
  });

  it('keys carry a recognisable prefix', () => {
    expect(API_KEY_PREFIX).toBe('vk_');
  });
});
