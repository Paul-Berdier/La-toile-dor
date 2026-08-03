import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashInviteToken,
  hashSessionToken,
  safeEqualHex,
  truncateIp,
  reduceUserAgent,
} from "./crypto";
import { rateLimit } from "./rate-limit";

describe("jetons", () => {
  it("256 bits d'entropie, base64url, uniques", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("le hash d'invitation dépend du pepper", () => {
    const token = generateToken();
    expect(hashInviteToken(token, "pepper-a")).not.toBe(hashInviteToken(token, "pepper-b"));
    expect(hashInviteToken(token, "pepper-a")).toBe(hashInviteToken(token, "pepper-a"));
  });

  it("le hash de session est stable et non réversible (64 hex)", () => {
    const token = generateToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("comparaison en temps constant", () => {
    const hash = hashSessionToken("x");
    expect(safeEqualHex(hash, hash)).toBe(true);
    expect(safeEqualHex(hash, hashSessionToken("y"))).toBe(false);
    expect(safeEqualHex(hash, "abcd")).toBe(false);
  });
});

describe("réduction des données personnelles", () => {
  it("tronque les IP (jamais l'adresse complète en base)", () => {
    expect(truncateIp("203.0.113.42")).toBe("203.0.113.0/24");
    expect(truncateIp("2001:db8:abcd:12:ffff::1")).toBe("2001:db8:abcd::/48");
    expect(truncateIp(undefined)).toBeNull();
  });

  it("réduit le user-agent à la famille navigateur/OS", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(reduceUserAgent(ua)).toBe("Chrome / Windows");
  });
});

describe("limitation de débit", () => {
  it("bloque après le quota et fournit un délai de reprise", () => {
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
