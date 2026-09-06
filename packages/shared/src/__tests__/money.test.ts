import {
  InvalidMoneyValueError,
  computeMaxRedeemableCreditsPaise,
  decimalStringToPaise,
  numberToPaise,
  paiseToDecimalString,
  paiseToRupees,
} from '../money';

describe('decimalStringToPaise / paiseToDecimalString round-trip', () => {
  // [input decimal string, expected paise, expected canonical decimal string back out]
  const cases: Array<[string, number, string]> = [
    ['0.01', 1, '0.01'],
    ['0.10', 10, '0.10'],
    ['1.10', 110, '1.10'],
    ['1.99', 199, '1.99'],
    ['10.01', 1001, '10.01'],
    ['10.99', 1099, '10.99'],
    ['49.99', 4999, '49.99'],
    ['50.00', 5000, '50.00'],
    ['50.01', 5001, '50.01'],
    ['75.99', 7599, '75.99'],
    ['99.99', 9999, '99.99'],
    ['100.00', 10000, '100.00'],
    ['100.01', 10001, '100.01'],
    ['999.99', 99999, '999.99'],
    ['0', 0, '0.00'],
    ['50', 5000, '50.00'],
    ['-10.01', -1001, '-10.01'],
  ];

  it.each(cases)('%s -> %i paise -> %s, exactly', (decimal, paise, canonical) => {
    expect(decimalStringToPaise(decimal)).toBe(paise);
    expect(paiseToDecimalString(paise)).toBe(canonical);
  });

  it('rejects more than 2 fractional digits instead of silently rounding', () => {
    expect(() => decimalStringToPaise('10.001')).toThrow(InvalidMoneyValueError);
    expect(() => decimalStringToPaise('10.999')).toThrow(InvalidMoneyValueError);
  });

  it('rejects non-numeric garbage', () => {
    expect(() => decimalStringToPaise('abc')).toThrow(InvalidMoneyValueError);
    expect(() => decimalStringToPaise('')).toThrow(InvalidMoneyValueError);
    expect(() => decimalStringToPaise('1.2.3')).toThrow(InvalidMoneyValueError);
  });
});

describe('numberToPaise', () => {
  it.each([
    [0.01, 1],
    [0.1, 10],
    [1.1, 110],
    [1.99, 199],
    [10.01, 1001],
    [49.99, 4999],
    [50, 5000],
    [50.01, 5001],
    [75.99, 7599],
    [99.99, 9999],
    [100, 10000],
    [100.01, 10001],
    [999.99, 99999],
    [15.03, 1503],
    [20.02, 2002],
    [65.99, 6599],
  ])('%f -> %i paise, exactly', (n, paise) => {
    expect(numberToPaise(n)).toBe(paise);
  });

  it('rejects a value with more than 2 real fractional digits (defensive second check)', () => {
    expect(() => numberToPaise(10.001)).toThrow(InvalidMoneyValueError);
    expect(() => numberToPaise(10.999)).toThrow(InvalidMoneyValueError);
  });
});

describe('paiseToRupees', () => {
  it.each([
    [1, 0.01],
    [1001, 10.01],
    [9999, 99.99],
    [10000, 100],
    [99999, 999.99],
  ])('%i paise -> %f rupees', (paise, rupees) => {
    expect(paiseToRupees(paise)).toBe(rupees);
  });

  it('rejects a non-integer paise value', () => {
    expect(() => paiseToRupees(10.5)).toThrow(InvalidMoneyValueError);
  });
});

describe('computeMaxRedeemableCreditsPaise — the frozen slab formula, paise-exact', () => {
  it.each([
    [49, 0],
    [50, 10],
    [75, 10],
    [99, 10],
    [100, 20],
    [150, 30],
    [200, 40],
    [250, 50],
    [500, 100],
    [1000, 200],
  ])('service Rs.%i -> max Rs.%i', (rupees, expectedMaxRupees) => {
    expect(computeMaxRedeemableCreditsPaise(rupees * 100)).toBe(expectedMaxRupees * 100);
  });

  // Part 11 completion — the exact fractional-price boundary cases the audit specifically called
  // out, proven in paise (not float division of the rupee value).
  it.each([
    ['50.01', 1000],
    ['99.99', 1000],
    ['100.00', 2000],
    ['100.01', 2000],
    ['75.99', 1000],
  ])('service Rs.%s -> max %i paise', (priceDecimal, expectedMaxPaise) => {
    expect(computeMaxRedeemableCreditsPaise(decimalStringToPaise(priceDecimal))).toBe(
      expectedMaxPaise,
    );
  });

  it('rejects a negative paise amount', () => {
    expect(() => computeMaxRedeemableCreditsPaise(-100)).toThrow(InvalidMoneyValueError);
  });
});

describe('exact lot consumption (no float drift across a multi-lot redemption)', () => {
  it('Lot A Rs.10.01 + Lot B Rs.20.02, redeem Rs.15.03 -> A empty, B left with exactly Rs.15.00', () => {
    let lotA = decimalStringToPaise('10.01');
    let lotB = decimalStringToPaise('20.02');
    let remaining = decimalStringToPaise('15.03');

    const takeA = Math.min(lotA, remaining);
    lotA -= takeA;
    remaining -= takeA;

    const takeB = Math.min(lotB, remaining);
    lotB -= takeB;
    remaining -= takeB;

    expect(paiseToDecimalString(lotA)).toBe('0.00');
    expect(paiseToDecimalString(lotB)).toBe('15.00');
    expect(remaining).toBe(0);
  });
});

describe('payable invariant (service Rs.75.99, redeem the max Rs.10.00 cap)', () => {
  it('serviceSubtotal = customerPayable + creditsRedeemed, exactly', () => {
    const servicePaise = decimalStringToPaise('75.99');
    const maxPaise = computeMaxRedeemableCreditsPaise(servicePaise);
    expect(maxPaise).toBe(1000); // Rs.10.00
    const payablePaise = servicePaise - maxPaise;
    expect(paiseToDecimalString(payablePaise)).toBe('65.99');
    expect(payablePaise + maxPaise).toBe(servicePaise);
  });
});
