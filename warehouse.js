// 倉管前台：純唯讀展示頁，不用登入。泰山/台中/寄庫/鎖庫都是每天從ERP拉的即時資料，
// 跟後台管理系統（index.html）共用同一批 Firestore collection，只是這裡完全不能編輯。
import {
  escapeHTML, renderBatchCell, renderQtyCell, buildLockByCode, buildBatchesByCode, subscribeCollection
} from './front-common.js?v=32';

const taishanSearchInput = document.getElementById('taishanSearchInput');
const taishanTableBody = document.getElementById('taishanTableBody');
const taishanSummary = document.getElementById('taishanSummary');

const taichungSearchInput = document.getElementById('taichungSearchInput');
const taichungTableBody = document.getElementById('taichungTableBody');
const taichungSummary = document.getElementById('taichungSummary');

const consignmentSearchInput = document.getElementById('consignmentSearchInput');
const consignmentTableBody = document.getElementById('consignmentTableBody');
const consignmentCount = document.getElementById('consignmentCount');

const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

let currentStock = [];
let currentBatchList = [];
let currentConsignment = [];
let currentConsignmentLedger = [];
let currentLockedStock = [];
let currentPendingAdjustments = [];

// ---------- 泰山 / 台中 ----------

function renderWarehouseTable(warehouse, tableBody, searchInputEl, summaryEl) {
  const keyword = searchInputEl.value.trim().toLowerCase();

  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== warehouse) return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });
  const batchesByCode = buildBatchesByCode(currentBatchList, warehouse);
  const lockByCode = buildLockByCode(currentLockedStock, warehouse);

  let items = currentStock.filter(s => s.warehouse === warehouse && s.qty + (adjustmentByCode.get(s.itemCode) || 0) !== 0);
  const totalCount = items.length;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  summaryEl.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 個品項，篩選後 ${items.length} 筆` : `共 ${totalCount} 個品項`)
    : '目前沒有資料';

  if (items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  tableBody.innerHTML = items.map(s => {
    const adjustment = adjustmentByCode.get(s.itemCode);
    const batches = batchesByCode.get(s.itemCode);
    const lockInfo = lockByCode.get(s.itemCode);
    return `
    <tr>
      <td>${escapeHTML(s.itemCode)}</td>
      <td>${escapeHTML(s.itemName)}</td>
      <td>${renderQtyCell(s.qty, adjustment, lockInfo, s.expired, s.isSplit)}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

function renderTaishanTable() {
  renderWarehouseTable('泰山', taishanTableBody, taishanSearchInput, taishanSummary);
}
function renderTaichungTable() {
  renderWarehouseTable('台中', taichungTableBody, taichungSearchInput, taichungSummary);
}
taishanSearchInput.addEventListener('input', renderTaishanTable);
taichungSearchInput.addEventListener('input', renderTaichungTable);

// ---------- 寄庫 ----------

function consignmentLedgerTotal(customer, itemCode, warehouse) {
  const entries = currentConsignmentLedger.filter(l =>
    l.customer === customer && l.itemCode === itemCode && l.warehouse === warehouse
  );
  return entries.reduce((sum, e) => sum + (Number(e.deltaQty) || 0), 0);
}

function renderConsignmentTable() {
  const keyword = consignmentSearchInput.value.trim().toLowerCase();

  const adjustmentByKey = new Map();
  currentPendingAdjustments.forEach(a => {
    const key = `${a.itemCode}__${a.warehouse}`;
    adjustmentByKey.set(key, (adjustmentByKey.get(key) || 0) + (a.deltaQty || 0));
  });

  let items = currentConsignment.filter(r => r.qty + (adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0) !== 0);
  const totalCount = items.length;
  if (keyword) {
    items = items.filter(it =>
      (it.customer || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.customer || '').localeCompare(b.customer || ''));

  consignmentCount.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 筆，篩選後 ${items.length} 筆` : `共 ${totalCount} 筆`)
    : '目前沒有寄庫資料';

  if (items.length === 0) {
    consignmentTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  consignmentTableBody.innerHTML = items.map(r => {
    const adjustment = adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0;
    const displayQty = r.qty + adjustment;
    return `
    <tr>
      <td>${escapeHTML(r.customer)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${displayQty}</td>
      <td>${consignmentLedgerTotal(r.customer, r.itemCode, '泰山')}</td>
      <td>${consignmentLedgerTotal(r.customer, r.itemCode, '台中')}</td>
    </tr>
  `;
  }).join('');
}
consignmentSearchInput.addEventListener('input', renderConsignmentTable);

// ---------- 鎖庫 ----------

function renderLockedStockTable() {
  const items = [...currentLockedStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  lockedStockCount.textContent = items.length ? `共 ${items.length} 筆` : '目前沒有鎖庫中的品項';
  if (items.length === 0) {
    lockedStockTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  lockedStockTableBody.innerHTML = items.map(r => `
    <tr>
      <td>${escapeHTML(r.itemCode)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${escapeHTML(r.warehouse)}</td>
      <td>${r.tag ? escapeHTML(r.tag) : ''}</td>
      <td>${r.lockedQty}</td>
      <td>${r.remark ? escapeHTML(r.remark) : ''}</td>
    </tr>
  `).join('');
}

// ---------- 分頁切換 ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).style.display = '';
  });
});

// ---------- 訂閱即時資料 ----------

subscribeCollection('stock', rows => { currentStock = rows; renderTaishanTable(); renderTaichungTable(); });
subscribeCollection('batchList', rows => { currentBatchList = rows; renderTaishanTable(); renderTaichungTable(); });
subscribeCollection('consignment', rows => { currentConsignment = rows; renderConsignmentTable(); });
subscribeCollection('consignmentLedger', rows => { currentConsignmentLedger = rows; renderConsignmentTable(); });
subscribeCollection('lockedStock', rows => {
  currentLockedStock = rows;
  renderTaishanTable();
  renderTaichungTable();
  renderLockedStockTable();
});
subscribeCollection('pendingAdjustments', rows => {
  currentPendingAdjustments = rows;
  renderTaishanTable();
  renderTaichungTable();
  renderConsignmentTable();
});
