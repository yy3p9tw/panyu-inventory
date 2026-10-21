// 倉管前台：純唯讀展示頁，不用登入。跟後台管理系統（index.html）共用同一批 Firestore collection，
// 只是這裡完全不能編輯。資料每天匯入一次，開頁面讀一次就好，不用即時監聽（見 loadAllData）。
import {
  escapeHTML, renderBatchCell, renderQtyCell, buildLockByCode, buildBatchesByCode, fetchCollectionOnce, subscribeLastUpdate, wireHistoryQuery, formatQty, parseBatchExpiryDate
} from './front-common.js?v=41';
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const taishanSearchInput = document.getElementById('taishanSearchInput');
const taishanTableBody = document.getElementById('taishanTableBody');
const taishanSummary = document.getElementById('taishanSummary');

const taichungSearchInput = document.getElementById('taichungSearchInput');
const taichungTableBody = document.getElementById('taichungTableBody');
const taichungSummary = document.getElementById('taichungSummary');

const expiringSearchInput = document.getElementById('expiringSearchInput');
const expiringTableBody = document.getElementById('expiringTableBody');
const expiringCount = document.getElementById('expiringCount');

const consignmentSearchInput = document.getElementById('consignmentSearchInput');
const consignmentTableBody = document.getElementById('consignmentTableBody');
const consignmentCount = document.getElementById('consignmentCount');

const lockedStockSearchInput = document.getElementById('lockedStockSearchInput');
const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

const stocktakeSessionSelect = document.getElementById('stocktakeSessionSelect');
const stocktakePrintBtn = document.getElementById('stocktakePrintBtn');
const stocktakeExcelBtn = document.getElementById('stocktakeExcelBtn');
const stocktakeCount = document.getElementById('stocktakeCount');
const stocktakeTableBody = document.getElementById('stocktakeTableBody');
const stocktakePrintTitle = document.getElementById('stocktakePrintTitle');
const stocktakePrintTableBody = document.getElementById('stocktakePrintTableBody');

let currentStock = [];
let currentBatchList = [];
let currentConsignment = [];
let currentConsignmentLedger = [];
let currentLockedStock = [];
let currentPendingAdjustments = [];
let currentItemReference = [];
let currentStocktakeSessions = [];
let currentStocktakeItems = [];
let selectedStocktakeSessionId = null;

// ---------- 泰山 / 台中 ----------

// 參照的「註記」欄位是「隱」或「隱藏」的品項，前台不顯示（後台管理系統還是看得到）
function hiddenItemCodeSet() {
  return new Set(
    currentItemReference.filter(r => r.note === '隱' || r.note === '隱藏').map(r => r.itemCode)
  );
}

function renderWarehouseTable(warehouse, tableBody, searchInputEl, summaryEl, showQtySum) {
  const keyword = searchInputEl.value.trim().toLowerCase();

  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== warehouse) return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });
  const batchesByCode = buildBatchesByCode(currentBatchList, warehouse);
  const lockByCode = buildLockByCode(currentLockedStock, warehouse);
  const hiddenCodes = hiddenItemCodeSet();

  // 業務看前台不想自己心算「數量-鎖庫」，直接把鎖庫扣掉顯示淨庫存（後台還是數量+鎖庫badge分開顯示）
  const netQty = s => formatQty(s.qty + (adjustmentByCode.get(s.itemCode) || 0) - (lockByCode.get(s.itemCode)?.total || 0));

  // 有些品項只存在未核完調整裡（例如組合單新增的成品，庫存.xlsx還沒出現過這個品號），
  // 把庫存跟未核完調整的品號做聯集才不會漏掉
  const stockItemCodes = new Set(
    currentStock.filter(s => s.warehouse === warehouse).map(s => s.itemCode)
  );
  const adjustmentOnlyRows = [];
  adjustmentByCode.forEach((_, itemCode) => {
    if (stockItemCodes.has(itemCode)) return;
    const itemName = currentPendingAdjustments.find(a => a.warehouse === warehouse && a.itemCode === itemCode && a.itemName)?.itemName || '';
    adjustmentOnlyRows.push({ itemCode, itemName, warehouse, qty: 0, expired: '', isSplit: false });
  });
  const allStockRows = [...currentStock.filter(s => s.warehouse === warehouse), ...adjustmentOnlyRows];

  let items = allStockRows.filter(s => !hiddenCodes.has(s.itemCode) && netQty(s) !== 0);
  const totalCount = items.length;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  const qtySumText = showQtySum
    ? `，庫存加總 ${formatQty(items.reduce((sum, s) => sum + netQty(s), 0))}`
    : '';
  summaryEl.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 個品項，篩選後 ${items.length} 筆${qtySumText}` : `共 ${totalCount} 個品項${qtySumText}`)
    : '目前沒有資料';

  if (items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  tableBody.innerHTML = items.map(s => {
    const batches = batchesByCode.get(s.itemCode);
    // 業務看前台不想自己心算「數量-鎖庫」，數字直接是扣掉鎖庫後的淨庫存，不另外顯示鎖庫badge
    return `
    <tr>
      <td>${escapeHTML(s.itemName)}</td>
      <td class="qty-cell">${renderQtyCell(netQty(s), 0, null, s.expired, s.isSplit)}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

function renderTaishanTable() {
  renderWarehouseTable('泰山', taishanTableBody, taishanSearchInput, taishanSummary);
}
function renderTaichungTable() {
  renderWarehouseTable('台中', taichungTableBody, taichungSearchInput, taichungSummary, true);
}
taishanSearchInput.addEventListener('input', renderTaishanTable);
taichungSearchInput.addEventListener('input', renderTaichungTable);

// ---------- 快到期 ----------

// 批號本身就是到期日，跟後台同一套邏輯：只看泰山/台中的批次，一年內到期、還有庫存才列出來
function renderExpiringTable() {
  const keyword = expiringSearchInput.value.trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  let items = currentBatchList
    .filter(r => (r.warehouse === '泰山' || r.warehouse === '台中') && formatQty(r.qty) !== 0)
    .map(r => ({ ...r, expiryDate: parseBatchExpiryDate(r.batchNo) }))
    .filter(r => r.expiryDate && r.expiryDate >= today && r.expiryDate <= oneYearLater);

  const totalCount = items.length;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || ''));

  expiringCount.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 筆，篩選後 ${items.length} 筆` : `共 ${totalCount} 筆`)
    : '目前沒有一年內到期的批次';

  if (items.length === 0) {
    expiringTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  expiringTableBody.innerHTML = items.map(r => {
    const daysLeft = Math.round((r.expiryDate - today) / 86400000);
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${escapeHTML(r.warehouse)}</td>
      <td>${r.batchNo || '-'}</td>
      <td>${daysLeft} 天</td>
      <td class="qty-cell">${formatQty(r.qty)}</td>
    </tr>
  `;
  }).join('');
}
expiringSearchInput.addEventListener('input', renderExpiringTable);

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

  // 有些客戶+品項只存在進出紀錄裡，ERP的寄庫.xlsx自己還沒出現過這筆（例如全新客戶）——
  // 這種也要能顯示，把兩邊的客戶+品號做聯集
  const consignmentKeys = new Set(currentConsignment.map(r => `${r.itemCode}__${r.customer}`));
  const ledgerOnlyRows = [];
  const seenLedgerOnly = new Set();
  currentConsignmentLedger.forEach(l => {
    const key = `${l.itemCode}__${l.customer}`;
    if (consignmentKeys.has(key) || seenLedgerOnly.has(key)) return;
    seenLedgerOnly.add(key);
    ledgerOnlyRows.push({ itemCode: l.itemCode, itemName: l.itemName, customer: l.customer, qty: 0 });
  });
  const allRows = [...currentConsignment, ...ledgerOnlyRows];

  let items = allRows.filter(r => displayQtyFor(r) !== 0);
  const totalCount = items.length;
  if (keyword) {
    items = items.filter(it =>
      (it.customer || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.customer || '').localeCompare(b.customer || ''));

  const taichungSumText = items.length
    ? `，台中加總 ${formatQty(items.reduce((sum, r) => sum + consignmentLedgerTotal(r.customer, r.itemCode, '台中'), 0))}`
    : '';
  consignmentCount.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 筆，篩選後 ${items.length} 筆${taichungSumText}` : `共 ${totalCount} 筆${taichungSumText}`)
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

// ---------- 盤點 ----------
// 前台只能看/列印後台已經產生好的空白盤點表（品號/品名/客戶，不顯示系統數量），
// 不能建立/刪除盤點、也不能輸入盤點數量——那些都是後台才能做的事。

function renderStocktakeSessionSelect() {
  const sorted = [...currentStocktakeSessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!sorted.length) {
    stocktakeSessionSelect.innerHTML = '<option value="">目前沒有盤點紀錄</option>';
    selectedStocktakeSessionId = null;
    renderStocktakeTable();
    return;
  }
  const keepSelected = sorted.some(s => s.id === selectedStocktakeSessionId);
  stocktakeSessionSelect.innerHTML = sorted.map(s =>
    `<option value="${s.id}">${escapeHTML(s.warehouse)} - ${new Date(s.createdAt).toLocaleString('zh-TW')}（${s.itemCount}筆）</option>`
  ).join('');
  selectedStocktakeSessionId = keepSelected ? selectedStocktakeSessionId : sorted[0].id;
  stocktakeSessionSelect.value = selectedStocktakeSessionId;
  renderStocktakeTable();
}

function stocktakeItemsForSelectedSession() {
  return currentStocktakeItems
    .filter(it => it.sessionId === selectedStocktakeSessionId)
    .sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
}

function renderStocktakeTable() {
  const items = stocktakeItemsForSelectedSession();
  stocktakeCount.textContent = selectedStocktakeSessionId
    ? `共 ${items.length} 筆`
    : '目前沒有盤點表可以看';

  if (!items.length) {
    stocktakeTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">沒有資料</td></tr>`;
    return;
  }
  stocktakeTableBody.innerHTML = items.map(it => `
    <tr>
      <td>${escapeHTML(it.itemCode)}</td>
      <td>${escapeHTML(it.itemName)}</td>
      <td>${it.customer ? escapeHTML(it.customer) : ''}</td>
      <td></td>
    </tr>
  `).join('');
}

stocktakeSessionSelect.addEventListener('change', () => {
  selectedStocktakeSessionId = stocktakeSessionSelect.value || null;
  renderStocktakeTable();
});

stocktakePrintBtn.addEventListener('click', () => {
  if (!selectedStocktakeSessionId) { alert('請先選一份盤點'); return; }
  const session = currentStocktakeSessions.find(s => s.id === selectedStocktakeSessionId);
  const items = stocktakeItemsForSelectedSession();
  stocktakePrintTitle.textContent = session
    ? `${session.warehouse} 盤點表（${new Date(session.createdAt).toLocaleDateString('zh-TW')}）`
    : '盤點表';
  stocktakePrintTableBody.innerHTML = items.map(it => `
    <tr>
      <td>${escapeHTML(it.itemCode)}</td>
      <td>${escapeHTML(it.itemName)}</td>
      <td>${it.customer ? escapeHTML(it.customer) : ''}</td>
      <td></td>
    </tr>
  `).join('');
  window.print();
});

stocktakeExcelBtn.addEventListener('click', () => {
  if (!selectedStocktakeSessionId) { alert('請先選一份盤點'); return; }
  const session = currentStocktakeSessions.find(s => s.id === selectedStocktakeSessionId);
  const items = stocktakeItemsForSelectedSession();
  const rows = [
    ['品號', '品名', '客戶', '盤點數量'],
    ...items.map(it => [it.itemCode, it.itemName, it.customer || '', ''])
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '盤點表');
  const dateLabel = session ? new Date(session.createdAt).toLocaleDateString('zh-TW').replace(/\//g, '-') : '';
  const filename = session ? `${session.warehouse}盤點表_${dateLabel}.xlsx` : '盤點表.xlsx';
  XLSX.writeFile(workbook, filename);
});

// ---------- 歷史 ----------

wireHistoryQuery({
  dateInput: document.getElementById('historyDateInput'),
  typeSelect: document.getElementById('historyTypeSelect'),
  loadBtn: document.getElementById('historyLoadBtn'),
  count: document.getElementById('historyCount'),
  tableHead: document.getElementById('historyTableHead'),
  tableBody: document.getElementById('historyTableBody')
});

// ---------- 載入資料（點到那個分頁才讀，沒點過的分頁不會產生讀取） ----------
// 大部分人只是快速看一下某個分頁就離開，一開頁面就把所有分頁的collection全部讀完太浪費，
// 改成每個分頁各自聲明自己要哪些collection，切過去才讀、讀過了就不重讀（除非手動整理/偵測到更新）

const TAB_DEPENDENCIES = {
  taishan: ['stock', 'batchList', 'lockedStock', 'pendingAdjustments', 'itemReference'],
  taichung: ['stock', 'batchList', 'lockedStock', 'pendingAdjustments', 'itemReference'],
  expiring: ['batchList'],
  consignment: ['consignment', 'consignmentLedger', 'pendingAdjustments', 'lockedStock'],
  lockedStock: ['lockedStock'],
  stocktake: ['stocktakeSessions', 'stocktakeItems'],
  history: [] // 歷史是按「查詢」當下才讀 dailySnapshots 的單一文件，跟這套機制無關
};

function applyCollection(name, rows) {
  if (name === 'stock') currentStock = rows;
  else if (name === 'batchList') currentBatchList = rows;
  else if (name === 'consignment') currentConsignment = rows;
  else if (name === 'consignmentLedger') currentConsignmentLedger = rows;
  else if (name === 'lockedStock') currentLockedStock = rows;
  else if (name === 'pendingAdjustments') currentPendingAdjustments = rows;
  else if (name === 'itemReference') currentItemReference = rows;
  else if (name === 'stocktakeSessions') currentStocktakeSessions = rows;
  else if (name === 'stocktakeItems') currentStocktakeItems = rows;
}

function renderAll() {
  renderTaishanTable();
  renderTaichungTable();
  renderExpiringTable();
  renderConsignmentTable();
  renderLockedStockTable();
  renderStocktakeSessionSelect();
}

const refreshBtn = document.getElementById('refreshBtn');
const refreshStatus = document.getElementById('refreshStatus');
const loadedCollections = new Set();

// 切到某個分頁：把那個分頁需要、但還沒讀過的collection讀回來（已經讀過的不重讀）
async function loadTabData(tabKey) {
  const deps = TAB_DEPENDENCIES[tabKey] || [];
  const toFetch = deps.filter(n => !loadedCollections.has(n));
  if (!toFetch.length) return;
  refreshStatus.textContent = '讀取中...';
  try {
    const results = await Promise.all(toFetch.map(fetchCollectionOnce));
    toFetch.forEach((name, i) => { loadedCollections.add(name); applyCollection(name, results[i]); });
    renderAll();
    refreshStatus.textContent = `最後更新：${new Date().toLocaleTimeString('zh-TW')}`;
  } catch (err) {
    refreshStatus.textContent = '讀取失敗：' + err.message;
  }
}

// 手動「重新整理」或偵測到後台有更新：只重讀「已經讀過」的collection，沒點過的分頁本來就
// 還沒有資料、不需要理它
async function refreshLoadedData() {
  const names = [...loadedCollections];
  if (!names.length) return;
  refreshBtn.disabled = true;
  refreshStatus.textContent = '讀取中...';
  try {
    const results = await Promise.all(names.map(fetchCollectionOnce));
    names.forEach((name, i) => applyCollection(name, results[i]));
    renderAll();
    refreshStatus.textContent = `最後更新：${new Date().toLocaleTimeString('zh-TW')}`;
  } catch (err) {
    refreshStatus.textContent = '讀取失敗：' + err.message;
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', refreshLoadedData);

// 後台更新完資料會touch meta/lastUpdate，這裡自動偵測到就重新讀一次，
// 不用倉管自己記得按「重新整理」
subscribeLastUpdate(() => refreshLoadedData());

// ---------- 分頁切換 ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).style.display = '';
    loadTabData(btn.dataset.tab);
  });
});

loadTabData('taishan'); // 預設顯示的分頁，一開頁面就讀
