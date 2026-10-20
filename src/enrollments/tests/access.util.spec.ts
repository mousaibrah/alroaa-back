import { isCoursePaid, lessonAccess } from '../utils/access.util.js';

describe('access rules', () => {
  it('free courses count as paid', () => {
    expect(isCoursePaid('0.00', null)).toBe(true);
    expect(isCoursePaid(0, null)).toBe(true);
  });

  it('paid courses need a paid payment', () => {
    expect(isCoursePaid('49.99', null)).toBe(false);
    expect(isCoursePaid('49.99', 'pending')).toBe(false);
    expect(isCoursePaid('49.99', 'failed')).toBe(false);
    expect(isCoursePaid('49.99', 'refunded')).toBe(false);
    expect(isCoursePaid('49.99', 'paid')).toBe(true);
  });

  it('free lessons never need payment', () => {
    expect(lessonAccess(true, false)).toBe('ok');
    expect(lessonAccess(false, false)).toBe('payment_required');
    expect(lessonAccess(false, true)).toBe('ok');
  });
});
