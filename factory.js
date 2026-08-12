// 廠務前台：純唯讀展示頁，不用登入。廠務用料/可用原料(泰山)/鎖庫都是即時資料，
// 跟後台管理系統（index.html）共用同一批 Firestore collection，只是這裡完全不能編輯。
import { escapeHTML, renderBatchCell, buildBatchesByCode, subscribeCollection } from './front-common.js?v=31';

const factoryMaterialTableBody = document.getElementById('factoryMaterialTableBody');
const availableMaterialTableBody = document.getElementById('availableMaterialTableBody');
const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

let currentStock = [];
let currentBatchList = [];
let currentFactoryMaterial = [];
let currentItemReference = [];
let currentLockedStock = [];

// ---------- 廠務用料 ----------

function renderFactoryMaterialTable() {
  const withStock = currentFactoryMaterial.filter(r => r.qty !== 0);
  if (!withStock.length) {
    factoryMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = buildBatchesByCode(currentBatchList, '廠務');
  const sorted = [...withStock].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  factoryMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

// ---------- 可用原料(泰山) ----------

function renderAvailableMaterialTable() {
  const tagByCode = new Map(currentItemReference.map(r => [r.itemCode, r.tag]));
  const taishanStock = currentStock.filter(s => s.warehouse === '泰山' && s.qty !== 0 && tagByCode.get(s.itemCode));
  if (!taishanStock.length) {
    availableMaterialTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = buildBatchesByCode(currentBatchList, '泰山');
  const sorted = [...taishanStock].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  availableMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const tag = tagByCode.get(r.itemCode) || '';
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${renderBatchCell(batches)}</td>
      <td>${tag ? escapeHTML(tag) : '-'}</td>
    </tr>
  `;
  }).join('');
}

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

subscribeCollection('stock', rows => { currentStock = rows; renderAvailableMaterialTable(); });
subscribeCollection('batchList', rows => { currentBatchList = rows; renderFactoryMaterialTable(); renderAvailableMaterialTable(); });
subscribeCollection('factoryMaterial', rows => { currentFactoryMaterial = rows; renderFactoryMaterialTable(); });
subscribeCollection('itemReference', rows => { currentItemReference = rows; renderAvailableMaterialTable(); });
subscribeCollection('lockedStock', rows => { currentLockedStock = rows; renderLockedStockTable(); });
