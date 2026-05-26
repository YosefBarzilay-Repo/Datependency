const test = require('node:test');
const assert = require('node:assert/strict');
const { recalculateMilestones, enrichRelease } = require('./dependencyEngine');

function chain() {
  return [
    { id: 'code', name: 'Code Freeze', date: '2026-09-01', baselineDate: '2026-09-01', notes: '' },
    { id: 'bug', name: 'Bug Freeze', date: '2026-09-04', baselineDate: '2026-09-04', notes: '' },
    { id: 'rc', name: 'Release Candidate', date: '2026-09-11', baselineDate: '2026-09-11', notes: '' },
    { id: 'ga', name: 'GA', date: '2026-09-18', baselineDate: '2026-09-18', notes: '' },
  ];
}

test('sequential milestones never stay before the previous milestone', () => {
  const milestones = chain();
  milestones[0].date = '2026-10-01';

  const result = recalculateMilestones(milestones);

  assert.equal(result.milestones[1].date, '2026-10-01');
  assert.equal(result.milestones[2].date, '2026-10-01');
  assert.equal(result.milestones[3].date, '2026-10-01');
});

test('later dated milestone follows the last scheduled upstream milestone even through empty dates', () => {
  const milestones = chain();
  milestones[0].date = '2026-10-01';
  milestones[1].date = '';
  milestones[2].date = '';

  const result = recalculateMilestones(milestones);

  assert.equal(result.milestones[3].date, '2026-10-01');
});

test('milestone status marks overdue milestones as delayed', () => {
  const milestones = chain();
  milestones.forEach((milestone) => {
    milestone.date = '2026-05-20';
  });

  const result = recalculateMilestones(milestones);

  assert.equal(result.milestones[2].status, 'Delayed');
  assert.equal(result.milestones[3].status, 'Delayed');
});

test('milestone without a date is clearly marked', () => {
  const milestones = chain();
  milestones[1].date = '';

  const release = enrichRelease({
    id: 'release',
    name: '15.0.0.0',
    releasedAt: null,
    milestones,
  });

  assert.equal(release.milestones[1].status, 'No Date Specified');
  assert.equal(release.status, 'No Date Specified');
});

test('released versions report released status', () => {
  const release = enrichRelease({
    id: 'release',
    name: '15.0.0.0',
    releasedAt: '2026-03-20T00:00:00.000Z',
    milestones: chain(),
  });

  assert.equal(release.status, 'Released');
});
