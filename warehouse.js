// 倉管前台：純唯讀展示頁，不用登入。泰山/台中/寄庫/鎖庫都是每天從ERP拉的即時資料，
// 跟後台管理系統（index.html）共用同一批 Firestore collection，只是這裡完全不能編輯。
import {
  escapeHTML, renderBatchCell, renderQtyCell, buildLockByCode, buildBatchesByCode, subscribeCollection, wireHistoryQuery, formatQty
} from './front-common.js?v=36';

const taishanSearchInput = document.getElementById('taishanSearchInput');
const taishanTableBody = document.getElementById('taishanTableBody');
const taishanSummary = document.getElementById('taishanSummary');

const taichungSearchInput = document.getElementById('taichungSearchInput');
const taichungTableBody = document.getElementById('taichungTableBody');
const taichungSummary = document.getElementById('taichungSummary');

const consignmentSearchInput = document.getElementById('consignmentSearchInput');
const consignmentTableBody = document.getElementById('consignmentTableBody');
const consignmentCount = document.getElementById('consignmentCount');

const lockedStockSearchInput = document.getElementById('lockedStockSearchInput');
const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

let currentStock = [];
let currentBatchList = [];
let currentConsignment = [];
let currentConsignmentLedger = [];
let currentLockedStock = [];
let currentPendingAdjustments = [];
let currentItemReference = [];

// ---------- 泰山 / 台中 ----------

// 參照的「註記」欄位是「隱」或「隱藏」的品項，前台不顯示（後台管理系統還是看得到）
function hiddenItemCodeSet() {
  return new Set(
    currentItemReference.filter(r => r.note === '隱' || r.note === '隱藏').map(r => r.itemCode)
  );
}

function renderWarehouseTable(warehouse, tableBody, searchInputEl, summaryEl) {
  const keyword = searchInputEl.value.trim().toLowerCase();

  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== warehouse) return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });
  const batchesByCode = buildBatchesByCode(currentBatchList, warehouse);
  const lockByCode = buildLockByCode(currentLockedStock, warehouse);
  const hiddenCodes = hiddenItemCodeSet();

  let items = currentStock.filter(s => s.warehouse === warehouse && !hiddenCodes.has(s.itemCode) && formatQty(s.qty + (adjustmentByCode.get(s.itemCode) || 0)) !== 0);
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
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  tableBody.innerHTML = items.map(s => {
    const adjustment = adjustmentByCode.get(s.itemCode);
    const batches = batchesByCode.get(s.itemCode);
    const lockInfo = lockByCode.get(s.itemCode);
    return `
    <tr>
      <td>${escapeHTML(s.itemName)}</td>
      <td class="qty-cell">${renderQtyCell(s.qty, adjustment, lockInfo, s.expired, s.isSplit)}</td>
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
  return formatQty(entries.reduce((sum, e) => sum + (Number(e.deltaQty) || 0), 0));
}

// 客戶+品號（不分倉庫）的進出紀錄總和，有紀錄就用這個當「寄庫數量」，比ERP原始數字更即時
function consignmentLedgerGrandTotal(customer, itemCode) {
  const entries = currentConsignmentLedger.filter(l => l.customer === customer && l.itemCode === itemCode);
  if (!entries.length) return null;
  return entries.reduce((sum, e) => sum + (Number(e.deltaQty) || 0), 0);
}

function renderConsignmentTable() {
  const keyword = consignmentSearchInput.value.trim().toLowerCase();

  const adjustmentByKey = new Map();
  currentPendingAdjustments.forEach(a => {
    const key = `${a.itemCode}__${a.warehouse}`;
    adjustmentByKey.set(key, (adjustmentByKey.get(key) || 0) + (a.deltaQty || 0));
  });

  const displayQtyFor = r => {
    const ledgerTotal = consignmentLedgerGrandTotal(r.customer, r.itemCode);
    if (ledgerTotal !== null) return formatQty(ledgerTotal);
    return formatQty(r.qty + (adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0));
  };

  let items = currentConsignment.filter(r => displayQtyFor(r) !== 0);
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

  // 鎖庫的「標籤」欄位有時候填的其實是客戶名字（代表這筆鎖庫其實是幫這個客戶鎖的寄庫貨），
  // 寄庫列表這邊用品號+標籤對出來，標紅提示這筆同時也被鎖庫了
  const lockedCustomerItemSet = new Set(
    currentLockedStock.filter(l => l.tag).map(l => `${l.itemCode}__${l.tag}`)
  );

  consignmentTableBody.innerHTML = items.map(r => {
    const displayQty = displayQtyFor(r);
    const isLocked = lockedCustomerItemSet.has(`${r.itemCode}__${r.customer}`);
    return `
    <tr>
      <td>${escapeHTML(r.customer)}${isLocked ? ' <span class="badge badge-consign-locked" title="這個客戶的這個品項同時也被鎖庫了">鎖庫</span>' : ''}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td class="qty-cell">${displayQty}</td>
      <td class="qty-cell">${consignmentLedgerTotal(r.customer, r.itemCode, '泰山')}</td>
      <td class="qty-cell">${consignmentLedgerTotal(r.customer, r.itemCode, '台中')}</td>
    </tr>
  `;
  }).join('');
}
consignmentSearchInput.addEventListener('input', renderConsignmentTable);

// ---------- 鎖庫 ----------

function renderLockedStockTable() {
  const keyword = lockedStockSearchInput.value.trim().toLowerCase();
  let items = [...currentLockedStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  if (keyword) {
    items = items.filter(r =>
      (r.itemCode || '').toLowerCase().includes(keyword) ||
      (r.itemName || '').toLowerCase().includes(keyword)
    );
  }
  lockedStockCount.textContent = currentLockedStock.length
    ? (keyword ? `共 ${currentLockedStock.length} 筆，篩選後 ${items.length} 筆` : `共 ${currentLockedStock.length} 筆`)
    : '目前沒有鎖庫中的品項';
  if (items.length === 0) {
    lockedStockTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  lockedStockTableBody.innerHTML = items.map(r => `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${escapeHTML(r.warehouse)}</td>
      <td>${r.tag ? escapeHTML(r.tag) : ''}</td>
      <td class="qty-cell">${r.lockedQty}</td>
      <td>${r.remark ? escapeHTML(r.remark) : ''}</td>
    </tr>
  `).join('');
}
lockedStockSearchInput.addEventListener('input', renderLockedStockTable);

// ---------- 歷史 ----------

wireHistoryQuery({
  dateInput: document.getElementById('historyDateInput'),
  typeSelect: document.getElementById('historyTypeSelect'),
  loadBtn: document.getElementById('historyLoadBtn'),
  count: document.getElementById('historyCount'),
  tableHead: document.getElementById('historyTableHead'),
  tableBody: document.getElementById('historyTableBody')
});

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
subscribeCollection('itemReference', rows => {
  currentItemReference = rows;
  renderTaishanTable();
  renderTaichungTable();
});
