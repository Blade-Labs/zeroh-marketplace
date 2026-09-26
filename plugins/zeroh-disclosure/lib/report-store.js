// SPDX-License-Identifier: AGPL-3.0-only

// The local reports folder, <ZEROH_HOME>/reports: missed-value reports and
// proxy diagnostic reports, one private JSON file each, never sent anywhere.
// Each kind validates its own ids and rebuilds its own view of a file, so a
// hand-edited field is never echoed.
import { lstatSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { writePrivateJson } from './private-fs.js';
import { zerohHome } from './vault.js';

export function reportsDir(env = process.env) {
  return path.join(zerohHome(env), 'reports');
}

function reportFile(id, isId, env) {
  if (!isId(String(id))) throw new Error('invalid report id');
  return path.join(reportsDir(env), `${id}.json`);
}

export function writeReport(id, report, { isId, env = process.env }) {
  const file = reportFile(id, isId, env);
  writePrivateJson(file, report);
  return file;
}

// The parsed report, or null when it is missing or not a regular file.
export function readReport(id, { isId, env = process.env }) {
  const file = reportFile(id, isId, env);
  try {
    if (!lstatSync(file).isFile()) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Every readable report whose id passes `isId`, newest first.
export function listReports({ isId, env = process.env }) {
  let names;
  try {
    names = readdirSync(reportsDir(env));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json') && isId(name.slice(0, -5)))
    .map((name) => readReport(name.slice(0, -5), { isId, env }))
    .filter((report) => report && typeof report === 'object')
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export function deleteReport(id, { isId, env = process.env }) {
  const file = reportFile(id, isId, env);
  try {
    if (!lstatSync(file).isFile()) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
