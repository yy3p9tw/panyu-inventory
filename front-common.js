// 前台展示頁共用的小工具：純讀取、不需要登入。
import { db } from './firebase-config.js?v=34';
import { collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// 有些數量是加減多筆數字湊出來的（例如庫存+未核完調整），JS浮點數運算偶爾會冒出7.200000000000001
// 這種尾數雜訊，顯示前先四捨五入到小數點後2位清乾淨
export function formatQty(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
    badges.push(`<span class="badge badge-locked" title="${escapeHTML(title)}">鎖庫 ${formatQty(lockInfo.total)}</span>`);
  }
  if (expired) badges.push(`<span class="badge badge-expired">過期/報廢 ${escapeHTML(expired)}</span>`);
  if (isSplit) badges.push(`<span class="badge badge-split">散裝</span>`);
  const displayQty = formatQty(qty + (adjustment || 0));
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

// 歷史：跟後台「今天完成」存的快照是同一份 dailySnapshots collection，一個日期一種資料類型各自一份文件。
// 回傳那個類型的 records 陣列；沒存過快照就是 null（區分「有存但是空」跟「沒存過」）。
export async function loadDailySnapshotType(date, type) {
  const snap = await getDoc(doc(db, 'dailySnapshots', `${date}__${type}`));
  return snap.exists() ? (snap.data().records || []) : null;
}

// 跟後台app.js的HISTORY_VIEWS同一份定義，前台只需要用到其中幾種。
export const HISTORY_VIEWS = {
  stock: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'itemName', label: '品名' },
    { key: 'warehouse', label: '倉庫' }, { key: 'qty', label: '庫存' }
  ] },
  batchList: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'itemName', label: '品名' },
    { key: 'warehouse', label: '庫別' }, { key: 'batchNo', label: '批號' }, { key: 'qty', label: '包裝數量' }
  ] },
  consignment: { columns: [
    { key: 'customer', label: '客戶' }, { key: 'itemName', label: '品名' }, { key: 'qty', label: '寄庫數量' }
  ] },
  factoryMaterial: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'itemName', label: '品名' }, { key: 'qty', label: '數量' }
  ] },
  lockedStock: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'itemName', label: '品名' }, { key: 'warehouse', label: '倉庫' },
    { key: 'tag', label: '標籤' }, { key: 'lockedQty', label: '鎖庫數量' }, { key: 'remark', label: '備註' }
  ] }
};

// 共用的歷史查詢按鈕邏輯，dom = { dateInput, typeSelect, loadBtn, count, tableHead, tableBody }
export function wireHistoryQuery(dom) {
  dom.loadBtn.addEventListener('click', async () => {
    const date = dom.dateInput.value;
    const type = dom.typeSelect.value;
    if (!date) { alert('請先選日期'); return; }
    dom.loadBtn.disabled = true;
    dom.count.textContent = '查詢中...';
    dom.tableHead.innerHTML = '';
    dom.tableBody.innerHTML = '';
    try {
      const records = await loadDailySnapshotType(date, type);
      const view = HISTORY_VIEWS[type];
      dom.tableHead.innerHTML = `<tr>${view.columns.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
      if (records === null) {
        dom.count.textContent = `${date} 沒有存過「${dom.typeSelect.options[dom.typeSelect.selectedIndex].text}」的快照`;
        dom.tableBody.innerHTML = `<tr><td colspan="${view.columns.length}" style="text-align:center; color:#6b7280;">查無資料</td></tr>`;
        return;
      }
      dom.count.textContent = `${date} 共 ${records.length} 筆`;
      if (!records.length) {
        dom.tableBody.innerHTML = `<tr><td colspan="${view.columns.length}" style="text-align:center; color:#6b7280;">這份快照是空的</td></tr>`;
        return;
      }
      dom.tableBody.innerHTML = records.map(r => `
        <tr>${view.columns.map(c => `<td>${escapeHTML(r[c.key] ?? '')}</td>`).join('')}</tr>
      `).join('');
    } catch (err) {
      dom.count.textContent = '查詢失敗：' + err.message;
    } finally {
      dom.loadBtn.disabled = false;
    }
  });
}
