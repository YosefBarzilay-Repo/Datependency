const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { enrichRelease } = require('./logic/dependencyEngine');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const AUDIT_FILE = path.join(__dirname, 'audit.log');
const CLIENT_DIR = path.join(__dirname, '..', 'client');

let writeQueue = Promise.resolve();

app.use(express.json());
app.use(express.static(CLIENT_DIR));

const fallbackTemplate = [
  { id: 'tmpl_code_freeze', name: 'Code Freeze' },
  { id: 'tmpl_bug_freeze', name: 'Bug Freeze' },
  { id: 'tmpl_release_candidate', name: 'Release Candidate' },
  { id: 'tmpl_ga', name: 'GA' },
];

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function validateDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ releases: [], template: fallbackTemplate }, null, 2));
  }
  try {
    await fs.access(AUDIT_FILE);
  } catch {
    await fs.writeFile(AUDIT_FILE, '');
  }
}

function migrateRelease(release) {
  const milestones = (release.milestones || []).map((milestone, index) => ({
    id: milestone.id || id('milestone'),
    name: milestone.name || 'Milestone',
    date: milestone.date || '',
    baselineDate: milestone.baselineDate || milestone.date || '',
    notes: milestone.notes || '',
    completed: Boolean(milestone.completed),
    type: 'AUTO',
    dependsOn: index > 0 ? release.milestones[index - 1].id : null,
    offsetDays: 0,
  }));

  return enrichRelease({
    ...release,
    name: release.name || 'Untitled Version',
    releasedAt: release.releasedAt || null,
    milestones,
  });
}

async function readData() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw || '{}');
  return {
    releases: Array.isArray(data.releases) ? data.releases.map(migrateRelease) : [],
    template: Array.isArray(data.template) && data.template.length ? data.template : fallbackTemplate,
  };
}

async function writeData(data) {
  writeQueue = writeQueue.then(() => fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2)));
  await writeQueue;
}

async function audit(action, details = {}) {
  const entry = {
    id: id('audit'),
    action,
    details,
    createdAt: new Date().toISOString(),
  };
  await fs.appendFile(AUDIT_FILE, `${JSON.stringify(entry)}\n`);
}

function versionParts(name) {
  const match = String(name).match(/\d+(?:\.\d+)*/);
  return match ? match[0].split('.').map((part) => Number(part)) : [];
}

function compareVersions(a, b) {
  const left = versionParts(a.name);
  const right = versionParts(b.name);
  const max = Math.max(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }

  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function sortReleases(releases, sort = 'number') {
  return releases
    .map(migrateRelease)
    .sort((a, b) => {
      if (a.releasedAt && !b.releasedAt) return 1;
      if (!a.releasedAt && b.releasedAt) return -1;
      if (sort === 'date') {
        if (!a.targetGaDate && !b.targetGaDate) return compareVersions(a, b);
        if (!a.targetGaDate) return 1;
        if (!b.targetGaDate) return -1;
        return a.targetGaDate.localeCompare(b.targetGaDate);
      }
      return compareVersions(a, b);
    });
}

function createMilestones(template, gaDate) {
  return template.map((item, index) => ({
    id: id('milestone'),
    name: item.name,
    date: item.name.toLowerCase() === 'ga' || index === template.length - 1 ? gaDate : '',
    baselineDate: item.name.toLowerCase() === 'ga' || index === template.length - 1 ? gaDate : '',
    notes: '',
    completed: false,
    type: 'AUTO',
    dependsOn: null,
    offsetDays: 0,
  }));
}

function notFound(res) {
  return res.status(404).json({ error: 'Version not found' });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/releases', async (req, res, next) => {
  try {
    const data = await readData();
    const releases = req.query.includeReleased === 'true'
      ? data.releases
      : data.releases.filter((release) => !release.releasedAt);
    res.json(sortReleases(releases, req.query.sort));
  } catch (error) {
    next(error);
  }
});

app.post('/releases', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const gaDate = req.body.gaDate || req.body.baseDate;

    if (!name) return res.status(400).json({ error: 'Version name is required' });
    if (!validateDate(gaDate)) return res.status(400).json({ error: 'GA date is required' });

    const now = new Date().toISOString();
    const data = await readData();
    const release = migrateRelease({
      id: id('release'),
      name,
      createdAt: now,
      updatedAt: now,
      baselineGaDate: gaDate,
      releasedAt: null,
      milestones: createMilestones(data.template, gaDate),
    });

    data.releases.push(release);
    await writeData(data);
    await audit('version.created', { versionId: release.id, versionName: release.name, gaDate });
    res.status(201).json(release);
  } catch (error) {
    next(error);
  }
});

app.get('/releases/:id', async (req, res, next) => {
  try {
    const data = await readData();
    const release = data.releases.find((item) => item.id === req.params.id);
    if (!release) return notFound(res);
    res.json(migrateRelease(release));
  } catch (error) {
    next(error);
  }
});

app.put('/releases/:id', async (req, res, next) => {
  try {
    const data = await readData();
    const index = data.releases.findIndex((item) => item.id === req.params.id);
    if (index === -1) return notFound(res);

    const existing = data.releases[index];
    const nextRelease = {
      ...existing,
      milestones: existing.milestones.map((milestone) => ({ ...milestone })),
      updatedAt: new Date().toISOString(),
    };
    const auditEvents = [];

    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ error: 'Version name cannot be empty' });
      if (name !== nextRelease.name) {
        auditEvents.push(['version.renamed', { versionId: existing.id, from: nextRelease.name, to: name }]);
      }
      nextRelease.name = name;
    }

    if (typeof req.body.released === 'boolean') {
      nextRelease.releasedAt = req.body.released ? existing.releasedAt || new Date().toISOString() : null;
      auditEvents.push([req.body.released ? 'version.released' : 'version.unreleased', {
        versionId: existing.id,
        versionName: existing.name,
      }]);
    }

    if (req.body.milestone && req.body.milestone.id) {
      const patch = req.body.milestone;
      const target = nextRelease.milestones.find((milestone) => milestone.id === patch.id);
      if (existing.releasedAt && target && (validateDate(patch.date) || patch.date === '') && patch.date !== target.date) {
        return res.status(400).json({ error: 'Released version dates cannot be changed' });
      }
      if (
        target?.completed &&
        patch.completed !== false &&
        (validateDate(patch.date) || patch.date === '') &&
        patch.date !== target.date
      ) {
        return res.status(400).json({ error: 'Completed milestone dates cannot be changed' });
      }

      nextRelease.milestones = nextRelease.milestones.map((milestone) => {
        if (milestone.id !== patch.id) return milestone;

        const updated = { ...milestone };
        if (typeof patch.name === 'string' && patch.name.trim() && patch.name.trim() !== milestone.name) {
          auditEvents.push(['milestone.renamed', {
            versionId: existing.id,
            milestoneId: milestone.id,
            from: milestone.name,
            to: patch.name.trim(),
          }]);
          updated.name = patch.name.trim();
        }

        if (!existing.releasedAt && (validateDate(patch.date) || patch.date === '') && patch.date !== milestone.date) {
          auditEvents.push(['milestone.date_assigned', {
            versionId: existing.id,
            milestoneId: milestone.id,
            milestoneName: milestone.name,
            from: milestone.date,
            to: patch.date,
          }]);
          updated.date = patch.date;
          updated.baselineDate = patch.date;
        }

        if (typeof patch.completed === 'boolean' && patch.completed !== milestone.completed) {
          auditEvents.push([patch.completed ? 'milestone.completed' : 'milestone.reopened', {
            versionId: existing.id,
            milestoneId: milestone.id,
            milestoneName: milestone.name,
          }]);
          updated.completed = patch.completed;
        }

        if (typeof patch.notes === 'string' && patch.notes !== milestone.notes) {
          auditEvents.push(['milestone.notes_changed', {
            versionId: existing.id,
            milestoneId: milestone.id,
            milestoneName: milestone.name,
          }]);
          updated.notes = patch.notes;
        }

        return updated;
      });
    }

    const saved = migrateRelease(nextRelease);
    data.releases[index] = saved;
    await writeData(data);
    await Promise.all(auditEvents.map(([action, details]) => audit(action, details)));
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

app.post('/releases/:id/milestones', async (req, res, next) => {
  try {
    const data = await readData();
    const index = data.releases.findIndex((item) => item.id === req.params.id);
    if (index === -1) return notFound(res);

    const release = data.releases[index];
    if (release.releasedAt) return res.status(400).json({ error: 'Released version dates cannot be changed' });

    const lastMilestone = release.milestones[release.milestones.length - 1] || null;
    const date = validateDate(req.body.date) ? req.body.date : '';
    const milestone = {
      id: id('milestone'),
      name: String(req.body.name || 'New Milestone').trim() || 'New Milestone',
      date,
      baselineDate: date,
      notes: '',
      completed: false,
      type: 'AUTO',
      dependsOn: null,
      offsetDays: 0,
    };

    const saved = migrateRelease({
      ...release,
      updatedAt: new Date().toISOString(),
      milestones: [...release.milestones, milestone],
    });

    data.releases[index] = saved;
    await writeData(data);
    await audit('milestone.created', { versionId: release.id, milestoneId: milestone.id, milestoneName: milestone.name });
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.delete('/releases/:id/milestones/:milestoneId', async (req, res, next) => {
  try {
    const data = await readData();
    const index = data.releases.findIndex((item) => item.id === req.params.id);
    if (index === -1) return notFound(res);

    const release = data.releases[index];
    if (release.releasedAt) return res.status(400).json({ error: 'Released version milestones cannot be deleted' });
    if (release.milestones.length <= 1) return res.status(400).json({ error: 'A version must have at least one milestone' });

    const removed = release.milestones.find((milestone) => milestone.id === req.params.milestoneId);
    if (!removed) return res.status(404).json({ error: 'Milestone not found' });

    const saved = migrateRelease({
      ...release,
      updatedAt: new Date().toISOString(),
      milestones: release.milestones.filter((milestone) => milestone.id !== removed.id),
    });

    data.releases[index] = saved;
    await writeData(data);
    await audit('milestone.deleted', { versionId: release.id, milestoneId: removed.id, milestoneName: removed.name });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

app.delete('/releases/:id', async (req, res, next) => {
  try {
    const data = await readData();
    const removed = data.releases.find((item) => item.id === req.params.id);
    const nextReleases = data.releases.filter((item) => item.id !== req.params.id);
    if (nextReleases.length === data.releases.length) return notFound(res);
    data.releases = nextReleases;
    await writeData(data);
    await audit('version.deleted', { versionId: removed.id, versionName: removed.name });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/template', async (req, res, next) => {
  try {
    const data = await readData();
    res.json(data.template);
  } catch (error) {
    next(error);
  }
});

app.put('/template', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.template) || req.body.template.length === 0) {
      return res.status(400).json({ error: 'At least one milestone is required' });
    }

    const template = req.body.template.map((item) => ({
      id: item.id || id('tmpl'),
      name: String(item.name || '').trim() || 'Milestone',
    }));

    const data = await readData();
    data.template = template;
    await writeData(data);
    await audit('template.changed', { milestones: template.map((item) => item.name) });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

app.get('/release/:id', (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

ensureDataFile().then(() => {
  app.listen(PORT, () => {
    console.log(`Datependency running at http://localhost:${PORT}`);
  });
});
