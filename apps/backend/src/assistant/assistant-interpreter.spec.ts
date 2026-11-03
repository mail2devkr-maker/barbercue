import { AssistantActionId } from '@barbercue/shared';
import {
  LocalModelInterpreter,
  RuleInterpreter,
  interpreterFromEnv,
  isPrivateModelUrl,
} from './assistant-interpreter';
import { ConfirmationLedger, fingerprint } from './assistant-confirmation';

const reply = (content: string, ok = true) =>
  jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) });

describe('assistant interpreter selection', () => {
  it('uses the deterministic rules unless a private local model is configured', () => {
    expect(interpreterFromEnv({}).name).toBe('rules');
    expect(interpreterFromEnv({ ASSISTANT_INTERPRETER: 'local' }).name).toBe('rules');
    expect(
      interpreterFromEnv({ ASSISTANT_INTERPRETER: 'local', ASSISTANT_LOCAL_MODEL_URL: 'https://generativelanguage.googleapis.com' }).name,
    ).toBe('rules');
    expect(interpreterFromEnv({ ASSISTANT_INTERPRETER: 'local', ASSISTANT_LOCAL_MODEL_URL: 'http://127.0.0.1:11434' }).name).toBe('local');
  });

  it.each([
    ['http://localhost:11434', true],
    ['http://10.0.0.5:8080', true],
    ['http://ollama.railway.internal:11434', true],
    ['https://api.openai.com', false],
    ['https://generativelanguage.googleapis.com', false],
    ['http://user:pass@127.0.0.1', false],
    ['file:///etc/passwd', false],
  ])('model URL %s private=%s', (url, ok) => {
    expect(isPrivateModelUrl(url)).toBe(ok);
  });

  it('accepts a valid local-model intent for natural Hinglish', async () => {
    const fetcher = reply('{"action":"services.setPrice","to":150,"from":200,"percent":null,"delta":null,"direction":null}');
    const i = new LocalModelInterpreter('http://127.0.0.1:11434', 'm', new RuleInterpreter(), fetcher as never);
    expect(await i.interpret('bhai haircut ka rate thoda kam karke 150 kar de, abhi 200 hai')).toMatchObject({
      action: AssistantActionId.SERVICE_SET_PRICE,
      to: 150,
      from: 200,
    });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain('haircut');
  });

  it('drops anything outside the allowlist and falls back to the rules', async () => {
    const injected = reply('{"action":"admin.grantRole","role":"PLATFORM_ADMIN","salonId":"other"}');
    const i = new LocalModelInterpreter('http://127.0.0.1:11434', 'm', new RuleInterpreter(), injected as never);
    expect(await i.interpret('staff dikhao')).toEqual({ action: AssistantActionId.STAFF_LIST });

    const extraKeys = reply('{"action":"staff.list","salonId":"someone-else","userId":"x"}');
    const j = new LocalModelInterpreter('http://127.0.0.1:11434', 'm', new RuleInterpreter(), extraKeys as never);
    expect(await j.interpret('staff')).toEqual({ action: AssistantActionId.STAFF_LIST });
  });

  it('falls back to the rules when the model is down, slow or talks prose', async () => {
    const down = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const prose = reply('Sure! I will show the queue.');
    const err = reply('{}', false);
    for (const f of [down, prose, err]) {
      const i = new LocalModelInterpreter('http://127.0.0.1:11434', 'm', new RuleInterpreter(), f as never);
      expect(await i.interpret('aaj ki queue dikhao')).toEqual({ action: AssistantActionId.QUEUE_STATUS });
    }
  });

  it('refuses to construct against a public host', () => {
    expect(() => new LocalModelInterpreter('https://api.openai.com', 'm')).toThrow(/private/);
  });
});

describe('assistant confirmation ledger', () => {
  const original = process.env.JWT_ACCESS_SECRET;
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'synthetic-test-secret-0123456789abcdef';
  });
  afterAll(() => {
    process.env.JWT_ACCESS_SECRET = original;
  });
  const base = { userId: 'u1', salonId: 's1', actionId: 'services.setPrice', payload: { price: 150 }, beforeFingerprint: fingerprint({ price: 200 }) };

  it('opens once for the same user, then refuses replays', () => {
    const ledger = new ConfirmationLedger();
    const { token } = ledger.seal(base);
    expect(ledger.open(token, 'u2')).toBe('WRONG_USER');
    expect(ledger.open(token, 'u1')).toMatchObject({ salonId: 's1', payload: { price: 150 } });
    expect(ledger.open(token, 'u1')).toBe('USED');
  });

  it('refuses tampered and expired tokens', () => {
    let now = 1_000_000;
    const ledger = new ConfirmationLedger(() => now);
    const { token } = ledger.seal(base);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), salonId: 's2' })).toString('base64url');
    expect(ledger.open(`${forged}.${sig}`, 'u1')).toBe('INVALID');
    now += 121_000;
    expect(ledger.open(token, 'u1')).toBe('EXPIRED');
  });
});
