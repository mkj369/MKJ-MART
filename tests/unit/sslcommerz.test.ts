import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkValidation, initiateSession, redact, SslcommerzError, validatePayment } from '@/server/payments/sslcommerz';

const config = { storeId: 'teststore', storePassword: 'secret', mode: 'sandbox' as const, baseUrl: 'https://sandbox.sslcommerz.com' };
const params = {
  tranId: 'MKJ-261028-ABCDE-XYZ123',
  amount: 218_000,
  orderNumber: 'MKJ-261028-ABCDE',
  callbackBaseUrl: 'https://shop.example.com/',
  customer: { name: 'Rahim', email: 'r@example.com', phone: '01712345678', addressLine: 'House 1', area: 'Tongi', district: 'Gazipur', division: 'Dhaka', postalCode: null },
  productSummary: 'Heavyweight Cotton Tee',
  itemCount: 2,
};

afterEach(() => vi.unstubAllGlobals());

describe('SSLCommerz session initiation', () => {
  it('posts the correct form fields and returns the gateway URL', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as URLSearchParams);
      expect(body.get('total_amount')).toBe('2180.00');
      expect(body.get('currency')).toBe('BDT');
      expect(body.get('tran_id')).toBe(params.tranId);
      expect(body.get('success_url')).toBe('https://shop.example.com/api/payments/sslcommerz/success');
      expect(body.get('ipn_url')).toBe('https://shop.example.com/api/payments/sslcommerz/ipn');
      expect(body.get('store_passwd')).toBe('secret');
      return new Response(JSON.stringify({ status: 'SUCCESS', sessionkey: 'SESSION1', GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/1', store_passwd: 'secret' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await initiateSession(config, params);
    expect(fetchMock).toHaveBeenCalledWith('https://sandbox.sslcommerz.com/gwprocess/v4/api.php', expect.anything());
    expect(result.gatewayUrl).toBe('https://sandbox.sslcommerz.com/gw/1');
    expect(result.sessionKey).toBe('SESSION1');
    expect(result.raw.store_passwd).toBe('[redacted]');
  });

  it('throws a SslcommerzError when the gateway refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', failedreason: 'Store Credential Error' }))));
    await expect(initiateSession(config, params)).rejects.toThrow(SslcommerzError);
    await expect(initiateSession(config, params)).rejects.toThrow('Store Credential Error');
  });

  it('throws when the gateway is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(initiateSession(config, params)).rejects.toThrow(/unreachable/);
  });
});

describe('SSLCommerz validation', () => {
  it('calls the validation API with credentials', async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.toString()).toContain('/validator/api/validationserverAPI.php');
      expect(url.searchParams.get('val_id')).toBe('VAL123');
      expect(url.searchParams.get('format')).toBe('json');
      return new Response(JSON.stringify({ status: 'VALID', tran_id: params.tranId, amount: '2180.00', currency_type: 'BDT', currency_amount: '2180.00' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const v = await validatePayment(config, 'VAL123');
    expect(v.status).toBe('VALID');
  });

  const valid = { status: 'VALID', tran_id: params.tranId, amount: '2180.00', currency: 'BDT', currency_type: 'BDT', currency_amount: '2180.00', risk_level: '0' };
  it('accepts a matching VALID response', () => {
    expect(checkValidation(valid, { tranId: params.tranId, amount: 218_000 })).toEqual({ ok: true, riskLevel: 0, riskTitle: null });
    expect(checkValidation({ ...valid, status: 'VALIDATED' }, { tranId: params.tranId, amount: 218_000 }).ok).toBe(true);
  });
  it.each([
    [{ status: 'INVALID_TRANSACTION' }, /status/],
    [{ tran_id: 'someone-else' }, /Transaction id/],
    [{ currency_type: 'USD' }, /currency/],
    [{ currency_amount: '10.00', amount: '10.00' }, /Amount mismatch/],
  ])('rejects tampered or failed responses (%#)', (patch, reason) => {
    const result = checkValidation({ ...valid, ...patch }, { tranId: params.tranId, amount: 218_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
  it('surfaces the gateway risk flag', () => {
    expect(checkValidation({ ...valid, risk_level: '1', risk_title: 'Risky' }, { tranId: params.tranId, amount: 218_000 })).toEqual({ ok: true, riskLevel: 1, riskTitle: 'Risky' });
  });
  it('redacts credentials before persistence', () => {
    expect(redact({ verify_sign: 'abc', store_passwd: 'x', ok: 1 })).toEqual({ verify_sign: '[redacted]', store_passwd: '[redacted]', ok: 1 });
  });
});
