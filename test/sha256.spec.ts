import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex, utf8ToBytes } from '../src/request-manager/sha256';

describe('sha256Hex', () => {

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('matches NIST golden vectors', () => {
        expect(sha256Hex('')).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        );
        expect(sha256Hex('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
        expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
            '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
        );
    });

    test('matches Node crypto for representative identity material', () => {
        const samples = [
            '1:get:/jobs:',
            '1:get:/jobs:{"a":1,"b":2}',
            '2:post:/v1/topics/active?page=1:{"includeArchived":false}',
            'a'.repeat(1000),
            'unicode-café-日本語'
        ];
        for (const sample of samples) {
            const expected = createHash('sha256').update(sample, 'utf8').digest('hex');
            expect(sha256Hex(sample)).toBe(expected);
        }
    });

    test('encodes UTF-8 without TextEncoder via fallback path', () => {
        vi.stubGlobal('TextEncoder', undefined);
        const message = 'café';
        const bytes = utf8ToBytes(message);
        expect(Array.from(bytes)).toEqual([ 0x63, 0x61, 0x66, 0xc3, 0xa9 ]);
        const expected = createHash('sha256').update(message, 'utf8').digest('hex');
        expect(sha256Hex(message)).toBe(expected);
    });
});
