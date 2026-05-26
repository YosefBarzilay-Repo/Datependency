const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_DAYS = 7;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return 0;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.ceil((date.getTime() - today.getTime()) / DAY_MS);
}

function getGaMilestone(milestones) {
  return milestones.find((milestone) => milestone.name.toLowerCase() === 'ga') || milestones[milestones.length - 1] || null;
}

function milestoneStatus(milestone) {
  if (milestone.completed) {
    return { status: 'Completed', reason: 'Completed' };
  }
  if (!milestone.date) {
    return { status: 'No Date Specified', reason: 'No date assigned' };
  }

  const dueIn = daysUntil(milestone.date);
  if (dueIn < 0) {
    return { status: 'Delayed', reason: 'Past due and not completed' };
  }
  if (dueIn <= DUE_SOON_WINDOW_DAYS) {
    return { status: 'Due Soon', reason: `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}` };
  }

  return { status: 'On Track', reason: 'On schedule' };
}

function recalculateMilestones(milestones) {
  const next = milestones.map((milestone, index) => ({
    ...milestone,
    type: 'AUTO',
    offsetDays: 0,
    dependsOn: index > 0 ? milestones[index - 1].id : null,
    warning: null,
  }));

  const warnings = [];

  let lastScheduledDate = parseDate(next[0]?.date);

  for (let index = 1; index < next.length; index += 1) {
    const current = next[index];
    const currentDate = parseDate(current.date);
    if (lastScheduledDate && currentDate && currentDate.getTime() < lastScheduledDate.getTime()) {
      current.date = lastScheduledDate.toISOString().slice(0, 10);
    }
    if (current.date) {
      lastScheduledDate = parseDate(current.date);
    }
  }

  return {
    milestones: next.map((milestone) => ({
      ...milestone,
      ...milestoneStatus(milestone),
    })),
    warnings,
  };
}

function computeStatus(release) {
  if (release.releasedAt) return 'Released';

  const statuses = (release.milestones || []).map((milestone) => milestone.status || milestoneStatus(milestone).status);
  if (statuses.includes('Delayed')) return 'Delayed';
  if (statuses.includes('No Date Specified')) return 'No Date Specified';
  if (statuses.includes('Due Soon')) return 'Due Soon';
  if (statuses.length && statuses.every((status) => status === 'Completed')) return 'Completed';
  return 'On Track';
}

function enrichRelease(release) {
  const recalculated = recalculateMilestones(release.milestones || []);
  const next = {
    ...release,
    milestones: recalculated.milestones,
  };
  const ga = getGaMilestone(next.milestones);
  return {
    ...next,
    targetGaDate: ga ? ga.date : null,
    status: computeStatus(next),
    warnings: recalculated.warnings,
  };
}

module.exports = {
  computeStatus,
  enrichRelease,
  getGaMilestone,
  recalculateMilestones,
};
