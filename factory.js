// 廠務前台：純唯讀展示頁，不用登入。跟後台管理系統（index.html）共用同一批 Firestore collection，
// 只是這裡完全不能編輯。資料每天匯入一次，開頁面讀一次就好，不用即時監聽（見 loadAllData）。
import { escapeHTML, renderBatchCell, buildBatchesByCode, fetchCollectionOnce, subscribeLastUpdate, wireHistoryQuery, formatQty, parseBatchExpiryDate } from './front-common.js?v=40';

const factoryMaterialSearchInput = document.getElementById('factoryMaterialSearchInput');
const factoryMaterialTableBody = document.getElementById('factoryMaterialTableBody');
const availableMaterialSearchInput = document.getElementById('availableMaterialSearchInput');
const availableMaterialTableBody = document.getElementById('availableMaterialTableBody');
const expiringSearchInput = document.getElementById('expiringSearchInput');
const expiringTableBody = document.getElementById('expiringTableBody');
const expiringCount = document.getElementById('expiringCount');
const lockedStockSearchInput = document.getElementById('lockedStockSearchInput');
const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

let currentStock = [];
let currentBatchList = [];
let currentFactoryMaterial = [];
let currentItemReference = [];
let currentLockedStock = [];
let currentPendingAdjustments = [];

// ---------- 廠務用料 ----------

// 廠務跟泰山/台中一樣，也會有未核完的轉撥（例如廠務轉泰山、泰山轉廠務）要加減到顯示數字上
function renderFactoryMaterialTable() {
  const keyword = factoryMaterialSearchInput.value.trim().toLowerCase();
  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== '廠務') return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });
  // 有些品項只存在未核完調整裡（例如組合單新增的成品，庫存.xlsx還沒出現過這個品號），
  // 把庫存跟未核完調整的品號做聯集才不會漏掉
  const factoryItemCodes = new Set(currentFactoryMaterial.map(r => r.itemCode));
  const adjustmentOnlyRows = [];
  adjustmentByCode.forEach((_, itemCode) => {
    if (factoryItemCodes.has(itemCode)) return;
    const itemName = currentPendingAdjustments.find(a => a.warehouse === '廠務' && a.itemCode === itemCode && a.itemName)?.itemName || '';
    adjustmentOnlyRows.push({ itemCode, itemName, qty: 0 });
  });
  const allFactoryRows = [...currentFactoryMaterial, ...adjustmentOnlyRows];

  let withStock = allFactoryRows.filter(r => formatQty(r.qty + (adjustmentByCode.get(r.itemCode) || 0)) !== 0);
  if (keyword) withStock = withStock.filter(r => (r.itemName || '').toLowerCase().includes(keyword));
  if (!withStock.length) {
    factoryMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = buildBatchesByCode(currentBatchList, '廠務');
  const sorted = [...withStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  factoryMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const displayQty = formatQty(r.qty + (adjustmentByCode.get(r.itemCode) || 0));
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td class="qty-cell">${displayQty}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

// ---------- 快到期 ----------

// 批號本身就是到期日，跟後台同一套邏輯：只看廠務的批次，一年內到期、還有庫存才列出來
function renderExpiringTable() {
  const keyword = expiringSearchInput.value.trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  let items = currentBatchList
    .filter(r => r.warehouse === '廠務' && formatQty(r.qty) !== 0)
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
    expiringTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  expiringTableBody.innerHTML = items.map(r => {
    const daysLeft = Math.round((r.expiryDate - today) / 86400000);
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.batchNo || '-'}</td>
      <td>${daysLeft} 天</td>
      <td class="qty-cell">${formatQty(r.qty)}</td>
    </tr>
  `;
  }).join('');
}
expiringSearchInput.addEventListener('input', renderExpiringTable);

// ---------- 可用原料(泰山) ----------

function renderAvailableMaterialTable() {
  const keyword = availableMaterialSearchInput.value.trim().toLowerCase();
  const tagByCode = new Map(currentItemReference.map(r => [r.itemCode, r.tag]));

  // 跟泰山分頁一樣，要把未核完調整加進顯示數字，不能只看庫存.xlsx的原始數字
  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== '泰山') return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });

  let taishanStock = currentStock.filter(s =>
    s.warehouse === '泰山' &&
    tagByCode.get(s.itemCode) &&
    formatQty(s.qty + (adjustmentByCode.get(s.itemCode) || 0)) !== 0
  );
  if (keyword) taishanStock = taishanStock.filter(s => (s.itemName || '').toLowerCase().includes(keyword));
  if (!taishanStock.length) {
    availableMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = buildBatchesByCode(currentBatchList, '泰山');
  const sorted = [...taishanStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  availableMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const displayQty = formatQty(r.qty + (adjustmentByCode.get(r.itemCode) || 0));
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td class="qty-cell">${displayQty}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

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
factoryMaterialSearchInput.addEventListener('input', renderFactoryMaterialTable);
availableMaterialSearchInput.addEventListener('input', renderAvailableMaterialTable);
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

// ---------- 載入資料 ----------
// 資料是每天匯入一次，前台不用即時監聽，開頁面讀一次就好，要看最新的按「重新整理」

const refreshBtn = document.getElementById('refreshBtn');
const refreshStatus = document.getElementById('refreshStatus');

async function loadAllData() {
  refreshBtn.disabled = true;
  refreshStatus.textContent = '讀取中...';
  try {
    [currentStock, currentBatchList, currentFactoryMaterial, currentItemReference, currentLockedStock, currentPendingAdjustments] = await Promise.all([
      fetchCollectionOnce('stock'),
      fetchCollectionOnce('batchList'),
      fetchCollectionOnce('factoryMaterial'),
      fetchCollectionOnce('itemReference'),
      fetchCollectionOnce('lockedStock'),
      fetchCollectionOnce('pendingAdjustments')
    ]);
    renderFactoryMaterialTable();
    renderAvailableMaterialTable();
    renderExpiringTable();
    renderLockedStockTable();
    refreshStatus.textContent = `最後更新：${new Date().toLocaleTimeString('zh-TW')}`;
  } catch (err) {
    refreshStatus.textContent = '讀取失敗：' + err.message;
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', loadAllData);
loadAllData();

// 後台更新完資料會touch meta/lastUpdate，這裡自動偵測到就重新讀一次，
// 不用廠務自己記得按「重新整理」
subscribeLastUpdate(() => loadAllData());
