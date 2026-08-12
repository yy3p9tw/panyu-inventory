// 前台展示頁共用的小工具：純讀取、不需要登入。
import { db } from './firebase-config.js?v=32';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// 批號是 YYYYMMDD，字串排序就是時間順序。只顯示最短（最早到期）那個批號，
// 同品項其他批號收在「共 N 筆」點開才看得到。
export function renderBatchCell(batches) {
  if (!batches || !batches.length) return '-';
  const sorted = [...batches].sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || ''));
  const shortest = sorted[0];
  if (sorted.length === 1) return escapeHTML(shortest.batchNo);
  const restText = sorted.slice(1).map(b => b.batchNo).join('、');
  return `${escapeHTML(shortest.batchNo)} <details style="display:inline-block;"><summary style="display:inline; cursor:pointer; color:var(--color-primary);">共 ${sorted.length} 筆</summary>${escapeHTML(restText)}</details>`;
}

// lockInfo: { total, entries: [{tag, lockedQty, remark}] } | undefined
export function renderQtyCell(qty, adjustment, lockInfo, expired, isSplit) {
  const badges = [];
  if (lockInfo && lockInfo.total) {
    const title = lockInfo.entries.map(e => `${e.tag || '(無標籤)'} ${e.lockedQty}${e.remark ? '：' + e.remark : ''}`).join('\n');
    badges.push(`<span class="badge badge-locked" title="${escapeHTML(title)}">鎖庫 ${lockInfo.total}</span>`);
  }
  if (expired) badges.push(`<span class="badge badge-expired">過期/報廢 ${escapeHTML(expired)}</span>`);
  if (isSplit) badges.push(`<span class="badge badge-split">散裝</span>`);
  const displayQty = qty + (adjustment || 0);
  return `${displayQty}${badges.length ? ' ' + badges.join(' ') : ''}`;
}

// 品號 -> 鎖庫加總（同一品項可能有好幾筆鎖庫紀錄，分別鎖給不同客戶/廠務）
export function buildLockByCode(lockedStock, warehouse) {
  const map = new Map();
  lockedStock.forEach(l => {
    if (l.warehouse !== warehouse) return;
    if (!map.has(l.itemCode)) map.set(l.itemCode, { total: 0, entries: [] });
    const info = map.get(l.itemCode);
    info.total += Number(l.lockedQty) || 0;
    info.entries.push({ tag: l.tag, lockedQty: l.lockedQty, remark: l.remark });
  });
  return map;
}

export function buildBatchesByCode(batchList, warehouse) {
  const map = new Map();
  batchList.forEach(b => {
    if (b.warehouse !== warehouse) return;
    if (!map.has(b.itemCode)) map.set(b.itemCode, []);
    map.get(b.itemCode).push(b);
  });
  return map;
}

export function subscribeCollection(name, callback) {
  return onSnapshot(
    collection(db, name),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error(`讀取 ${name} 失敗`, err)
  );
}
