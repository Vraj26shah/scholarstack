import { describe, expect, it } from 'vitest';
import { OwnerMessBody, upiPayLink } from './campus';

describe('pay-first orders', () => {
  it('builds a UPI app link with the amount and order code', () => {
    expect(upiPayLink('radha.rani@okaxis', 'Radha Rani Ka Dhaba', 180, 'Order K7Q2')).toBe(
      'upi://pay?pa=radha.rani%40okaxis&pn=Radha%20Rani%20Ka%20Dhaba&am=180.00&cu=INR&tn=Order%20K7Q2',
    );
  });

  it('accepts real UPI IDs (or none) and refuses anything else', () => {
    const upi = OwnerMessBody.innerType().innerType().shape.upiId;
    for (const ok of ['', 'shop@okaxis', '9876543210@ybl', 'radha.rani-1@oksbi'])
      expect(upi.safeParse(ok).success).toBe(true);
    for (const bad of ['shop', '@okaxis', 'shop@', 'javascript:alert(1)', 'a b@ok'])
      expect(upi.safeParse(bad).success).toBe(false);
  });
});
