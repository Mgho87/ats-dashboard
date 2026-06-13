'use strict';
/**
 * Reads a Google Sheet tab via the public gviz endpoint (no OAuth, no key).
 * Works when the spreadsheet's General Access = "Anyone with the link: Viewer".
 *
 * Uses tqx=out:json (not csv) because gviz JSON carries true date values
 * as "Date(y,m,d)" tokens — unambiguous, unlike locale-formatted CSV dates.
 *
 * Returns { headers: string[], rows: any[][] } with date cells as JS Date.
 */

const ZERO_WIDTH = /[​-‍﻿]/g;

function buildUrl(spreadsheetId, sheetName) {
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId +
    '/gviz/tq?tqx=out:json&headers=1&sheet=' + encodeURIComponent(sheetName);
}

function parseGvizDate(v) {
  // "Date(2026,5,10)" -> JS Date(2026, 5, 10) ; month is already 0-indexed in gviz
  const m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/.exec(v);
  if (!m) return null;
  return new Date(
    +m[1], +m[2], +m[3],
    m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0
  );
}

function convertCell(cell) {
  if (cell == null) return null;
  const v = cell.v;
  if (v == null) return (cell.f != null ? cell.f : null);
  if (typeof v === 'string') {
    const d = parseGvizDate(v);
    if (d && !isNaN(d.getTime())) return d;
    return v;
  }
  return v; // number / boolean
}

async function fetchSheet(spreadsheetId, sheetName) {
  const url = buildUrl(spreadsheetId, sheetName);
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();

  // Private sheets / login walls return HTML, not the gviz wrapper.
  if (res.status !== 200 || /^\s*<(!doctype|html)/i.test(text)) {
    const err = new Error('SHEET_NOT_ACCESSIBLE');
    err.code = 'SHEET_NOT_ACCESSIBLE';
    err.httpStatus = res.status;
    err.sheetName = sheetName;
    throw err;
  }

  const start = text.indexOf('setResponse(');
  if (start === -1) {
    const err = new Error('UNEXPECTED_GVIZ_RESPONSE');
    err.code = 'UNEXPECTED_GVIZ_RESPONSE';
    err.sheetName = sheetName;
    throw err;
  }
  const jsonStr = text.slice(start + 'setResponse('.length).replace(/\);?\s*$/, '');
  const payload = JSON.parse(jsonStr);

  if (payload.status === 'error') {
    const reason = (payload.errors && payload.errors[0] && payload.errors[0].detailed_message) || 'gviz error';
    const err = new Error(reason);
    err.code = 'GVIZ_ERROR';
    err.sheetName = sheetName;
    throw err;
  }

  const table = payload.table || { cols: [], rows: [] };
  let headers = (table.cols || []).map(c => String((c && c.label) || '').replace(ZERO_WIDTH, '').trim());
  let rows = (table.rows || []).map(r => (r.c || []).map(convertCell));

  // If gviz did not detect a header row (labels empty), promote the first data row.
  const hasLabels = headers.some(h => h.length > 0);
  if (!hasLabels && rows.length) {
    headers = rows[0].map(v => String(v == null ? '' : v).trim());
    rows = rows.slice(1);
  }
  return { headers, rows };
}

/** Fetch a tab but return null instead of throwing if it simply does not exist. */
async function fetchSheetOptional(spreadsheetId, sheetName) {
  try {
    return await fetchSheet(spreadsheetId, sheetName);
  } catch (e) {
    if (e.code === 'GVIZ_ERROR') return null; // tab missing
    throw e; // access problems must still surface
  }
}

module.exports = { fetchSheet, fetchSheetOptional };
