/**
 * 口令摘要。独立成模块，避免种子脚本为了算一个 hash 去加载 next/headers。
 * 算法：scrypt(N=16384, r=8, p=1) + 16 字节随机盐，输出 64 字节。
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const calc = scryptSync(plain, salt, 64);
  const expect = Buffer.from(hash, "hex");
  return calc.length === expect.length && timingSafeEqual(calc, expect);
}
