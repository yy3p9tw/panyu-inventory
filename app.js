// 庫存管理系統：登入後才能使用，登入、匯入、查詢都在同一頁。
// 畫面上的分頁跟資料欄位，依登入者的角色顯示不同內容。
import { auth } from './firebase-config.js?v=33';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  subscribeToStock, replaceStockForWarehouses,
  subscribeToFactoryMaterial, replaceFactoryMaterial,
  subscribeToItemReference, setItemReferenceField, importItemReferenceFromMaster,
  subscribeToSummary, replaceSummary,
  subscribeToBatchList, replaceBatchList,
  subscribeToConsignment, replaceConsignment,
  subscribeToConsignmentLedger, addConsignmentLedgerEntry, deleteConsignmentLedgerEntry, importConsignmentLedgerEntries,
  subscribeToPendingAdjustments, replacePendingAdjustments,
  subscribeToLockedStock, addLockedStock, updateLockedStock, deleteLockedStock,
  saveDailySnapshot, loadDailySnapshot, deleteOldSnapshots,
  clearDailyErpData
} from './inventory-service.js?v=35';
import { touchOwnProfile, subscribeToOwnProfile, subscribeToUsers, updateUserRoles } from './users-service.js?v=33';
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const loginBox = document.getElementById('loginBox');
const appContent = document.getElementById('appContent');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const userNav = document.getElementById('userNav');
const currentUserEmail = document.getElementById('currentUserEmail');
const logoutBtn = document.getElementById('logoutBtn');

const taishanSearchInput = document.getElementById('taishanSearchInput');
const taishanTableBody = document.getElementById('taishanTableBody');
const taishanSummary = document.getElementById('taishanSummary');

const taichungSearchInput = document.getElementById('taichungSearchInput');
const taichungTableBody = document.getElementById('taichungTableBody');
const taichungSummary = document.getElementById('taichungSummary');

const importDropZone = document.getElementById('importDropZone');
const importFileInput = document.getElementById('importFileInput');
const importMsg = document.getElementById('importMsg');
const importItemsList = document.getElementById('importItemsList');
const saveSnapshotBtn = document.getElementById('saveSnapshotBtn');
const saveSnapshotMsg = document.getElementById('saveSnapshotMsg');
const clearDailyBtn = document.getElementById('clearDailyBtn');
const clearDailyMsg = document.getElementById('clearDailyMsg');

const historyDateInput = document.getElementById('historyDateInput');
const historyTypeSelect = document.getElementById('historyTypeSelect');
const historyLoadBtn = document.getElementById('historyLoadBtn');
const historyCount = document.getElementById('historyCount');
const historyTableHead = document.getElementById('historyTableHead');
const historyTableBody = document.getElementById('historyTableBody');

const usersTableBody = document.getElementById('usersTableBody');

const factoryMaterialSearchInput = document.getElementById('factoryMaterialSearchInput');
const factoryMaterialTableBody = document.getElementById('factoryMaterialTableBody');
const availableMaterialSearchInput = document.getElementById('availableMaterialSearchInput');
const availableMaterialTableBody = document.getElementById('availableMaterialTableBody');

const referenceSearchInput = document.getElementById('referenceSearchInput');
const referenceTableBody = document.getElementById('referenceTableBody');
const referenceCount = document.getElementById('referenceCount');

const summarySearchInput = document.getElementById('summarySearchInput');
const summaryTableBody = document.getElementById('summaryTableBody');
const summaryCount = document.getElementById('summaryCount');

const batchSearchInput = document.getElementById('batchSearchInput');
const batchTableBody = document.getElementById('batchTableBody');
const batchCount = document.getElementById('batchCount');

const consignmentSearchInput = document.getElementById('consignmentSearchInput');
const consignmentTableBody = document.getElementById('consignmentTableBody');
const consignmentCount = document.getElementById('consignmentCount');

const consignLedgerModal = document.getElementById('consignLedgerModal');
const consignLedgerTitle = document.getElementById('consignLedgerTitle');
const consignLedgerCloseBtn = document.getElementById('consignLedgerCloseBtn');
const consignLedgerNewDate = document.getElementById('consignLedgerNewDate');
const consignLedgerNewQty = document.getElementById('consignLedgerNewQty');
const consignLedgerNewRemark = document.getElementById('consignLedgerNewRemark');
const consignLedgerAddBtn = document.getElementById('consignLedgerAddBtn');
const consignLedgerCount = document.getElementById('consignLedgerCount');
const consignLedgerTableBody = document.getElementById('consignLedgerTableBody');

const lockedStockNewCode = document.getElementById('lockedStockNewCode');
const lockedStockNewWarehouse = document.getElementById('lockedStockNewWarehouse');
const lockedStockNewTag = document.getElementById('lockedStockNewTag');
const lockedStockNewQty = document.getElementById('lockedStockNewQty');
const lockedStockNewRemark = document.getElementById('lockedStockNewRemark');
const lockedStockAddBtn = document.getElementById('lockedStockAddBtn');
const lockedStockSearchInput = document.getElementById('lockedStockSearchInput');
const lockedStockCount = document.getElementById('lockedStockCount');
const lockedStockTableBody = document.getElementById('lockedStockTableBody');

const WAREHOUSES = ['泰山', '台中'];
const ROLES = ['泰山倉管', '台中倉管', '廠務', '會計', '管理員'];

// 每個角色能看到哪些倉庫的庫存欄位（品項查詢/匯入都依這個判斷）
const WAREHOUSE_VISIBILITY = {
  '泰山倉管': ['泰山', '台中'],
  '台中倉管': ['台中'],
  '管理員': ['泰山', '台中']
};

let currentUid = null;
let currentRoles = [];
let visibleWarehouses = [];
let isAdmin = false;
let canSeeFactory = false;
let canSeeSummary = false;

let currentStock = [];
let currentUsers = [];
let currentFactoryMaterial = [];
let currentItemReference = [];
let currentSummary = [];
let currentBatchList = [];
let currentConsignment = [];
let currentPendingAdjustments = [];
let currentLockedStock = [];
let currentConsignmentLedger = [];
let unsubscribeStock = null;
let unsubscribeOwnProfile = null;
let unsubscribeUsers = null;
let unsubscribeFactoryMaterial = null;
let unsubscribeItemReference = null;
let unsubscribeSummary = null;
let unsubscribeBatchList = null;
let unsubscribeConsignment = null;
let unsubscribePendingAdjustments = null;
let unsubscribeLockedStock = null;
let unsubscribeConsignmentLedger = null;

// ---------- 登入 ----------

loginBtn.addEventListener('click', async () => {
  loginError.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
  } catch (err) {
    loginError.textContent = '登入失敗：' + describeAuthError(err);
  }
});

[emailInput, passwordInput].forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
  });
});

logoutBtn.addEventListener('click', () => signOut(auth));

function describeAuthError(err) {
  const map = {
    'auth/invalid-email': 'Email 格式不正確',
    'auth/invalid-credential': '帳號或密碼錯誤',
    'auth/wrong-password': '密碼錯誤',
    'auth/user-not-found': '找不到這個帳號',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試'
  };
  return map[err.code] || err.message;
}

onAuthStateChanged(auth, async user => {
  // 換帳號（不一定會先登出，例如上一個帳號的登入還留在瀏覽器裡）時，
  // 一定要先把舊帳號的訂閱全部關掉，不然畫面會殘留舊帳號的角色權限。
  if (unsubscribeOwnProfile) { unsubscribeOwnProfile(); unsubscribeOwnProfile = null; }
  if (unsubscribeStock) { unsubscribeStock(); unsubscribeStock = null; }
  if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  if (unsubscribeFactoryMaterial) { unsubscribeFactoryMaterial(); unsubscribeFactoryMaterial = null; }
  if (unsubscribeItemReference) { unsubscribeItemReference(); unsubscribeItemReference = null; }
  if (unsubscribeSummary) { unsubscribeSummary(); unsubscribeSummary = null; }
  if (unsubscribeBatchList) { unsubscribeBatchList(); unsubscribeBatchList = null; }
  if (unsubscribeConsignment) { unsubscribeConsignment(); unsubscribeConsignment = null; }
  if (unsubscribePendingAdjustments) { unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null; }
  if (unsubscribeLockedStock) { unsubscribeLockedStock(); unsubscribeLockedStock = null; }
  if (unsubscribeConsignmentLedger) { unsubscribeConsignmentLedger(); unsubscribeConsignmentLedger = null; }
  currentRoles = [];
  currentStock = [];
  currentUsers = [];
  currentFactoryMaterial = [];
  currentItemReference = [];
  currentSummary = [];
  currentBatchList = [];
  currentConsignment = [];
  currentPendingAdjustments = [];
  currentLockedStock = [];
  currentConsignmentLedger = [];
  applyRoleVisibility(); // 立刻把畫面收回「沒有任何角色」狀態，避免短暫殘留上一個帳號看到的東西

  if (user) {
    currentUid = user.uid;
    loginBox.style.display = 'none';
    appContent.style.display = 'block';
    userNav.style.display = 'flex';
    currentUserEmail.textContent = user.email;

    await touchOwnProfile(user.uid, user.email);

    unsubscribeOwnProfile = subscribeToOwnProfile(user.uid, profile => {
      currentRoles = profile.roles || [];
      applyRoleVisibility();
    });

    unsubscribeStock = subscribeToStock(
      stock => {
        currentStock = stock;
        renderTaishanTable();
        renderTaichungTable();
        renderAvailableMaterialTable();
      },
      err => {
        taishanSummary.style.color = 'var(--color-danger)';
        taishanSummary.textContent = '讀取庫存資料失敗：' + err.message;
        taichungSummary.style.color = 'var(--color-danger)';
        taichungSummary.textContent = '讀取庫存資料失敗：' + err.message;
      }
    );
  } else {
    currentUid = null;
    loginBox.style.display = 'block';
    appContent.style.display = 'none';
    userNav.style.display = 'none';
  }
});

// ---------- 角色可視範圍 ----------

function applyRoleVisibility() {
  const whSet = new Set();
  currentRoles.forEach(r => (WAREHOUSE_VISIBILITY[r] || []).forEach(w => whSet.add(w)));
  visibleWarehouses = WAREHOUSES.filter(w => whSet.has(w));
  isAdmin = currentRoles.includes('管理員');
  canSeeFactory = currentRoles.includes('廠務') || isAdmin;
  canSeeSummary = currentRoles.includes('會計') || isAdmin;

  const taishanBtn = document.querySelector('.tab-btn[data-tab="taishan"]');
  const taichungBtn = document.querySelector('.tab-btn[data-tab="taichung"]');
  const factoryBtn = document.querySelector('.tab-btn[data-tab="factory"]');
  const availableMaterialBtn = document.querySelector('.tab-btn[data-tab="availableMaterial"]');
  const referenceBtn = document.querySelector('.tab-btn[data-tab="reference"]');
  const summaryBtn = document.querySelector('.tab-btn[data-tab="summary"]');
  const batchBtn = document.querySelector('.tab-btn[data-tab="batch"]');
  const consignmentBtn = document.querySelector('.tab-btn[data-tab="consignment"]');
  const lockedStockBtn = document.querySelector('.tab-btn[data-tab="lockedStock"]');
  const importBtn = document.querySelector('.tab-btn[data-tab="import"]');
  const historyBtn = document.querySelector('.tab-btn[data-tab="history"]');
  const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');

  const canSeeStock = visibleWarehouses.length > 0;
  taishanBtn.style.display = visibleWarehouses.includes('泰山') ? '' : 'none';
  taichungBtn.style.display = visibleWarehouses.includes('台中') ? '' : 'none';
  factoryBtn.style.display = canSeeFactory ? '' : 'none';
  availableMaterialBtn.style.display = canSeeFactory ? '' : 'none';
  referenceBtn.style.display = canSeeFactory ? '' : 'none';
  summaryBtn.style.display = canSeeSummary ? '' : 'none';
  batchBtn.style.display = canSeeStock ? '' : 'none';
  consignmentBtn.style.display = canSeeStock ? '' : 'none';
  lockedStockBtn.style.display = canSeeStock ? '' : 'none';
  importBtn.style.display = (canSeeStock || canSeeFactory || canSeeSummary || isAdmin) ? '' : 'none';
  historyBtn.style.display = (canSeeStock || canSeeFactory) ? '' : 'none';
  usersBtn.style.display = isAdmin ? '' : 'none';

  // 如果目前開著的分頁被隱藏了，自動切到第一個看得到的分頁
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn && activeBtn.style.display === 'none') {
    const firstVisible = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.style.display !== 'none');
    if (firstVisible) firstVisible.click();
  }

  renderTaishanTable();
  renderTaichungTable();

  if (isAdmin && !unsubscribeUsers) {
    unsubscribeUsers = subscribeToUsers(users => {
      currentUsers = users;
      renderUsersTable();
    });
  } else if (!isAdmin && unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }

  if (canSeeFactory && !unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial = subscribeToFactoryMaterial(rows => {
      currentFactoryMaterial = rows;
      renderFactoryMaterialTable();
    });
    unsubscribeItemReference = subscribeToItemReference(rows => {
      currentItemReference = rows;
      renderAvailableMaterialTable();
      renderItemReferenceTable();
    });
  } else if (!canSeeFactory && unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial(); unsubscribeFactoryMaterial = null;
    unsubscribeItemReference(); unsubscribeItemReference = null;
    currentFactoryMaterial = [];
    currentItemReference = [];
  }

  if (canSeeSummary && !unsubscribeSummary) {
    unsubscribeSummary = subscribeToSummary(rows => {
      currentSummary = rows;
      renderSummaryTable();
    });
  } else if (!canSeeSummary && unsubscribeSummary) {
    unsubscribeSummary();
    unsubscribeSummary = null;
    currentSummary = [];
  }

  // 批號資料廠務物料分頁也要用（廠務用料/可用原料(泰山)的批號、最短效期），
  // 純廠務角色（沒有泰山/台中/管理員）canSeeStock 會是 false，所以這裡要跟 canSeeFactory 一起判斷
  if ((canSeeStock || canSeeFactory) && !unsubscribeBatchList) {
    unsubscribeBatchList = subscribeToBatchList(rows => {
      currentBatchList = rows;
      renderBatchTable();
      renderTaishanTable();
      renderTaichungTable();
      renderFactoryMaterialTable();
      renderAvailableMaterialTable();
    });
  } else if (!canSeeStock && !canSeeFactory && unsubscribeBatchList) {
    unsubscribeBatchList(); unsubscribeBatchList = null;
    currentBatchList = [];
  }

  if (canSeeStock && !unsubscribeConsignment) {
    unsubscribeConsignment = subscribeToConsignment(rows => {
      currentConsignment = rows;
      renderConsignmentTable();
    });
    unsubscribePendingAdjustments = subscribeToPendingAdjustments(rows => {
      currentPendingAdjustments = rows;
      renderTaishanTable();
      renderTaichungTable();
      renderConsignmentTable();
      renderFactoryMaterialTable();
    });
    unsubscribeLockedStock = subscribeToLockedStock(rows => {
      currentLockedStock = rows;
      renderLockedStockTable();
      renderTaishanTable();
      renderTaichungTable();
    });
    unsubscribeConsignmentLedger = subscribeToConsignmentLedger(rows => {
      currentConsignmentLedger = rows;
      renderConsignmentTable();
      renderConsignLedgerPanel();
    });
  } else if (!canSeeStock && unsubscribeConsignment) {
    unsubscribeConsignment(); unsubscribeConsignment = null;
    unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null;
    unsubscribeLockedStock(); unsubscribeLockedStock = null;
    unsubscribeConsignmentLedger(); unsubscribeConsignmentLedger = null;
    currentConsignment = [];
    currentPendingAdjustments = [];
    currentLockedStock = [];
    currentConsignmentLedger = [];
  }
}

// ---------- 分頁切換 ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.style.display === 'none') return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).style.display = '';
  });
});

// ---------- 品項查詢 ----------

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// 有些數量是加減多筆數字湊出來的（例如庫存+未核完調整），JS浮點數運算偶爾會冒出7.200000000000001
// 這種尾數雜訊，顯示前先四捨五入到小數點後2位清乾淨
function formatQty(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 批號是 YYYYMMDD，字串排序就是時間排序。只顯示最短（最早到期）那個批號，
// 同品項其他批號收在「還有 N 筆」點開才看得到，不要一次全部列出來。
function renderBatchCell(batches) {
  if (!batches || !batches.length) return '-';
  const sorted = [...batches].sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || ''));
  const shortest = sorted[0];
  if (sorted.length === 1) return escapeHTML(shortest.batchNo);
  const restText = sorted.slice(1).map(b => b.batchNo).join('、');
  return `${escapeHTML(shortest.batchNo)} <details style="display:inline-block;"><summary style="display:inline; cursor:pointer; color:var(--color-primary);">共 ${sorted.length} 筆</summary>${escapeHTML(restText)}</details>`;
}

// lockInfo: { total, entries: [{tag, lockedQty, remark}] } | undefined —鎖庫純粹當資訊標籤顯示，
// 不會拿去扣庫存數字（組合檔自己的「結存數量」也不是即時算的，是鎖庫當下手動記的快照，見鎖庫分頁）。
// 批號另外用 renderBatchCell 顯示在「最短效期」欄位，這裡不重複顯示批號badge。
function renderQtyCell(s, adjustment, lockInfo) {
  const badges = [];
  if (lockInfo && lockInfo.total) {
    const title = lockInfo.entries.map(e => `${e.tag || '(無標籤)'} ${e.lockedQty}${e.remark ? '：' + e.remark : ''}`).join('\n');
    badges.push(`<span class="badge badge-locked" title="${escapeHTML(title)}">鎖庫 ${formatQty(lockInfo.total)}</span>`);
  }
  if (s.expired) badges.push(`<span class="badge badge-expired">過期/報廢 ${escapeHTML(s.expired)}</span>`);
  if (s.isSplit) badges.push(`<span class="badge badge-split">散裝</span>`);
  // 未核完調整還是照樣算進 displayQty（銷貨/異動/調撥裡還沒核准的單據，數字已經扣好/加好了），
  // 只是不再顯示「未核完」標籤——使用者反應看到這個標籤反而會懷疑數字是不是還沒扣，造成誤會。
  const displayQty = formatQty(s.qty + (adjustment || 0));
  return `${displayQty}${badges.length ? ' ' + badges.join(' ') : ''}`;
}

// 泰山跟台中各自獨立一個分頁（原本合併在同一張「品項查詢」表，欄位會隨看得到的倉庫動態增減，
// 使用者覺得雜，改成跟批號/寄庫一樣各自獨立）。共用同一套渲染邏輯，只是各自對應到自己的倉庫、
// 自己的搜尋框、自己的表格。
function renderWarehouseTable(warehouse, tableBody, searchInputEl, summaryEl) {
  if (!visibleWarehouses.includes(warehouse)) return;
  const keyword = searchInputEl.value.trim().toLowerCase();

  // 純泰山倉管（沒有管理員身分）看不到「註記=隱藏」的品項，這是參照表帶過來的規則
  const applyTaishanHideRule = warehouse === '泰山' && currentRoles.includes('泰山倉管') && !isAdmin;

  // 品號 -> 未核完調整加總，套用到顯示的庫存數字上
  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== warehouse) return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });

  // 品號 -> 批號清單，庫存數量本身跟批號現在是分開兩個檔案匯入的，畫面上即時對照
  const batchesByCode = new Map();
  currentBatchList.forEach(b => {
    if (b.warehouse !== warehouse) return;
    if (!batchesByCode.has(b.itemCode)) batchesByCode.set(b.itemCode, []);
    batchesByCode.get(b.itemCode).push({ batchNo: b.batchNo, qty: b.qty });
  });

  // 品號 -> 鎖庫加總（同一品項可能有好幾筆鎖庫紀錄，分別鎖給不同客戶/廠務）
  const lockByCode = new Map();
  currentLockedStock.forEach(l => {
    if (l.warehouse !== warehouse) return;
    if (!lockByCode.has(l.itemCode)) lockByCode.set(l.itemCode, { total: 0, entries: [] });
    const info = lockByCode.get(l.itemCode);
    info.total += Number(l.lockedQty) || 0;
    info.entries.push({ tag: l.tag, lockedQty: l.lockedQty, remark: l.remark });
  });

  // 庫存(含未核完調整)是0的品項不用顯示，列表太多沒意義的0很雜
  let items = currentStock.filter(s => {
    if (s.warehouse !== warehouse) return false;
    if (applyTaishanHideRule && s.hiddenFromTaishanManager) return false;
    if (formatQty(s.qty + (adjustmentByCode.get(s.itemCode) || 0)) === 0) return false;
    return true;
  });
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  const totalCount = currentStock.filter(s =>
    s.warehouse === warehouse &&
    !(applyTaishanHideRule && s.hiddenFromTaishanManager) &&
    formatQty(s.qty + (adjustmentByCode.get(s.itemCode) || 0)) !== 0
  ).length;
  summaryEl.style.color = '';
  summaryEl.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 個品項，篩選後 ${items.length} 筆` : `共 ${totalCount} 個品項`)
    : '目前沒有庫存資料，請先到「匯入資料」上傳 ERP 檔案';

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
      <td>${renderQtyCell(s, adjustment, lockInfo)}</td>
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

// ---------- 廠務物料 ----------

// 廠務用料：品名/數量是庫存.xlsx 裡庫別=廠務的部分（匯入時存進 factoryMaterial），
// 最短效期＝批號本身（最早的那個），畫面上跟批號.xlsx 的「廠務」庫別即時對出來，不是匯入時算好存起來的
// （每個資料類型都對應各自一份 ERP 匯出檔，不靠組合檔的公式）。renderBatchCell 只顯示最短那個，
// 同品項其他批號收在「還有 N 筆」點開才看得到。
function renderFactoryMaterialTable() {
  const keyword = factoryMaterialSearchInput.value.trim().toLowerCase();
  // 廠務跟泰山/台中一樣，也會有未核完的轉撥（例如廠務轉泰山、泰山轉廠務）要加減到顯示數字上
  const adjustmentByCode = new Map();
  currentPendingAdjustments.forEach(a => {
    if (a.warehouse !== '廠務') return;
    adjustmentByCode.set(a.itemCode, (adjustmentByCode.get(a.itemCode) || 0) + (a.deltaQty || 0));
  });
  // 數量(含未核完調整)是0的品項不用顯示
  let withStock = currentFactoryMaterial.filter(r => formatQty(r.qty + (adjustmentByCode.get(r.itemCode) || 0)) !== 0);
  if (keyword) withStock = withStock.filter(r => (r.itemName || '').toLowerCase().includes(keyword));
  if (!withStock.length) {
    factoryMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = new Map();
  currentBatchList.forEach(b => {
    if (b.warehouse !== '廠務') return;
    if (!batchesByCode.has(b.itemCode)) batchesByCode.set(b.itemCode, []);
    batchesByCode.get(b.itemCode).push(b);
  });

  const sorted = [...withStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  factoryMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const displayQty = formatQty(r.qty + (adjustmentByCode.get(r.itemCode) || 0));
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${displayQty}</td>
      <td>${renderBatchCell(batches)}</td>
    </tr>
  `;
  }).join('');
}

// 可用原料(泰山) = 泰山的庫存(庫存.xlsx) + 泰山的批號(批號.xlsx)，畫面上即時組出來，不是自己單獨一份匯入資料。
// 標記欄位讀 itemReference collection 的 tag 欄位，唯讀顯示——要改標記到「參照」分頁改，不要在這裡重複編輯。
// 過期/報廢沒有可靠來源（原始資料裡一直是空的），不顯示。
function renderAvailableMaterialTable() {
  const keyword = availableMaterialSearchInput.value.trim().toLowerCase();
  const tagByCode = new Map(currentItemReference.map(r => [r.itemCode, r.tag]));

  // 庫存0的品項、沒有標記的品項都不用顯示
  let taishanStock = currentStock.filter(s => s.warehouse === '泰山' && s.qty !== 0 && tagByCode.get(s.itemCode));
  if (keyword) taishanStock = taishanStock.filter(s => (s.itemName || '').toLowerCase().includes(keyword));
  if (!taishanStock.length) {
    availableMaterialTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }

  const batchesByCode = new Map();
  currentBatchList.forEach(b => {
    if (b.warehouse !== '泰山') return;
    if (!batchesByCode.has(b.itemCode)) batchesByCode.set(b.itemCode, []);
    batchesByCode.get(b.itemCode).push(b);
  });

  const sorted = [...taishanStock].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  availableMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const tag = tagByCode.get(r.itemCode) || '';
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${formatQty(r.qty)}</td>
      <td>${renderBatchCell(batches)}</td>
      <td>${tag ? escapeHTML(tag) : '-'}</td>
    </tr>
  `;
  }).join('');
}

factoryMaterialSearchInput.addEventListener('input', renderFactoryMaterialTable);
availableMaterialSearchInput.addEventListener('input', renderAvailableMaterialTable);

// ---------- 參照（品項主檔，人工維護，逐欄位可編輯） ----------

const REFERENCE_FIELDS = [
  { key: 'itemName', label: '品名' },
  { key: 'origin', label: '產地' },
  { key: 'unit', label: '單位' },
  { key: 'purchaseType', label: '採購' },
  { key: 'category', label: '類別' },
  { key: 'majorCategory', label: '大類' },
  { key: 'netWeight', label: '淨重' },
  { key: 'grossWeight', label: '毛重' },
  { key: 'companyType', label: '公司別' },
  { key: 'tag', label: '標記(廠務)' },
  { key: 'isSplit', label: '散裝' },
  { key: 'note', label: '註記' }
];

// 主表只顯示品號/品名/標記，其他 9 個欄位平常收起來，點一列才展開成可編輯的詳細區塊——
// 13 欄全部攤開會很雜，展開式一次只看/改一個品項比較清楚。
const expandedReferenceItems = new Set();

function renderItemReferenceTable() {
  const keyword = referenceSearchInput.value.trim().toLowerCase();
  let items = currentItemReference;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  referenceCount.textContent = currentItemReference.length
    ? (keyword ? `共 ${currentItemReference.length} 筆，篩選後 ${items.length} 筆` : `共 ${currentItemReference.length} 筆`)
    : '目前沒有資料，請先到「匯入資料」上傳組合檔（1150805庫存YU.xlsx 這種）';

  if (items.length === 0) {
    referenceTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  referenceTableBody.innerHTML = items.map(r => {
    const expanded = expandedReferenceItems.has(r.itemCode);
    const summaryRow = `
      <tr class="ref-row" data-item-code="${escapeHTML(r.itemCode)}" style="cursor:pointer;">
        <td>${expanded ? '▼' : '▶'} ${escapeHTML(r.itemCode)}</td>
        <td>${r.itemName ? escapeHTML(r.itemName) : '-'}</td>
        <td>${r.tag ? escapeHTML(r.tag) : '-'}</td>
      </tr>
    `;
    if (!expanded) return summaryRow;
    const detailRow = `
      <tr class="ref-detail-row">
        <td colspan="3" style="background:var(--color-bg-subtle, #f9fafb); padding:12px;">
          <div style="display:flex; flex-wrap:wrap; gap:12px;">
            ${REFERENCE_FIELDS.map(f => `
              <label style="display:flex; flex-direction:column; font-size:12px; color:#6b7280; gap:2px;">
                ${f.label}
                <input type="text" class="ref-field-input" data-item-code="${escapeHTML(r.itemCode)}" data-field="${f.key}" value="${escapeHTML(r[f.key] || '')}" style="padding:5px 7px; width:110px;" />
              </label>
            `).join('')}
          </div>
        </td>
      </tr>
    `;
    return summaryRow + detailRow;
  }).join('');
}

referenceSearchInput.addEventListener('input', renderItemReferenceTable);

referenceTableBody.addEventListener('click', e => {
  const row = e.target.closest('.ref-row');
  if (!row) return;
  const itemCode = row.dataset.itemCode;
  if (expandedReferenceItems.has(itemCode)) expandedReferenceItems.delete(itemCode);
  else expandedReferenceItems.add(itemCode);
  renderItemReferenceTable();
});

// 展開後的欄位是人工維護，直接編輯，失焦時只存那一欄（不是整批匯入）。
// 可用原料(泰山)的標記欄位是唯讀顯示，不重複提供編輯入口——要改標記統一到這個分頁改。
referenceTableBody.addEventListener('change', async e => {
  if (!e.target.classList.contains('ref-field-input')) return;
  const itemCode = e.target.dataset.itemCode;
  const field = e.target.dataset.field;
  const value = e.target.value.trim();
  try {
    await setItemReferenceField(itemCode, field, value);
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

// ---------- 彙總 ----------

function renderSummaryTable() {
  const keyword = summarySearchInput.value.trim().toLowerCase();
  let items = currentSummary;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  summaryCount.textContent = currentSummary.length
    ? (keyword ? `共 ${currentSummary.length} 個品項，篩選後 ${items.length} 筆` : `共 ${currentSummary.length} 個品項`)
    : '目前沒有彙總資料（這個功能還在等一份真實 ERP 匯出的彙總檔確認格式）';

  if (items.length === 0) {
    summaryTableBody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  summaryTableBody.innerHTML = items.map(r => `
    <tr>
      <td>${escapeHTML(r.itemCode)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${formatQty(r.taishanQty)}</td>
      <td>${formatQty(r.taichungQty)}</td>
      <td>${formatQty(r.totalQty)}</td>
      <td>${formatQty(r.unitWeight)}</td>
      <td>${formatQty(r.totalWeight)}</td>
      <td>${escapeHTML(r.purchaseType)}</td>
      <td>${escapeHTML(r.category)}</td>
      <td>${escapeHTML(r.majorCategory)}</td>
      <td>${escapeHTML(r.origin)}</td>
      <td>${(r.vendors || []).map(v => `${escapeHTML(v.label)} ${formatQty(v.qty)}`).join('，')}</td>
    </tr>
  `).join('');
}

summarySearchInput.addEventListener('input', renderSummaryTable);

// ---------- 批號 ----------

function renderBatchTable() {
  const keyword = batchSearchInput.value.trim().toLowerCase();
  let items = currentBatchList;
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || '') || (a.batchNo || '').localeCompare(b.batchNo || ''));

  batchCount.textContent = currentBatchList.length
    ? (keyword ? `共 ${currentBatchList.length} 筆，篩選後 ${items.length} 筆` : `共 ${currentBatchList.length} 筆`)
    : '目前沒有批號資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    batchTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  batchTableBody.innerHTML = items.map(r => `
    <tr>
      <td>${escapeHTML(r.itemCode)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${escapeHTML(r.warehouse)}</td>
      <td>${r.batchNo || '-'}</td>
      <td>${formatQty(r.qty)}</td>
    </tr>
  `).join('');
}

batchSearchInput.addEventListener('input', renderBatchTable);

// ---------- 寄庫 ----------

// 客戶+品號+倉庫 -> { total, latestDate }，從逐筆帶日期的進出紀錄加總算出來的
// （對照過0805庫存YU的「寄庫」分頁：一欄一天記錄進出，目前數量=全部加總，寄庫日期=最近一筆的日期）
function consignmentLedgerSummary(customer, itemCode, warehouse) {
  const entries = currentConsignmentLedger.filter(l =>
    l.customer === customer && l.itemCode === itemCode && l.warehouse === warehouse
  );
  if (!entries.length) return null;
  const total = entries.reduce((sum, e) => sum + (Number(e.deltaQty) || 0), 0);
  const latestDate = entries.reduce((max, e) => (e.date > max ? e.date : max), entries[0].date);
  return { total, latestDate };
}

function renderConsignmentTable() {
  const keyword = consignmentSearchInput.value.trim().toLowerCase();

  // 品號+客戶 -> 未核完調整加總（來自異動分頁，庫別欄位對不到泰山/台中時代表在動客戶的寄庫帳）
  const adjustmentByKey = new Map();
  currentPendingAdjustments.forEach(a => {
    const key = `${a.itemCode}__${a.warehouse}`;
    adjustmentByKey.set(key, (adjustmentByKey.get(key) || 0) + (a.deltaQty || 0));
  });

  // 寄庫數量0的品項不用顯示（寄庫數量=泰山+台中，0代表這筆已經沒有寄庫中的貨了）
  let items = currentConsignment.filter(r => formatQty(r.qty + (adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0)) !== 0);
  if (keyword) {
    items = items.filter(it =>
      (it.customer || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.customer || '').localeCompare(b.customer || ''));

  const totalCount = currentConsignment.filter(r => formatQty(r.qty + (adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0)) !== 0).length;
  consignmentCount.textContent = totalCount
    ? (keyword ? `共 ${totalCount} 筆，篩選後 ${items.length} 筆` : `共 ${totalCount} 筆`)
    : '目前沒有寄庫資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    consignmentTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  const ledgerCell = (customer, itemCode, itemName, warehouse) => {
    const summary = consignmentLedgerSummary(customer, itemCode, warehouse);
    const text = summary ? String(formatQty(summary.total)) : '0';
    return `<button type="button" class="secondary consign-ledger-open-btn" data-customer="${escapeHTML(customer)}" data-item-code="${escapeHTML(itemCode)}" data-item-name="${escapeHTML(itemName)}" data-warehouse="${warehouse}" style="font-size:13px; padding:4px 8px;">${escapeHTML(text)}</button>`;
  };

  // 未核完調整照樣算進 displayQty，只是不顯示標籤了（跟泰山/台中同樣的理由，見 renderQtyCell）
  consignmentTableBody.innerHTML = items.map(r => {
    const adjustment = adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0;
    const displayQty = formatQty(r.qty + adjustment);
    return `
    <tr>
      <td>${escapeHTML(r.customer)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${displayQty}</td>
      <td>${ledgerCell(r.customer, r.itemCode, r.itemName, '泰山')}</td>
      <td>${ledgerCell(r.customer, r.itemCode, r.itemName, '台中')}</td>
    </tr>
  `;
  }).join('');
}

consignmentSearchInput.addEventListener('input', renderConsignmentTable);

// ---------- 寄庫進出明細面板：點泰山/台中的數字按鈕打開，逐筆新增/刪除帶日期的紀錄 ----------

let consignLedgerSelection = null; // { customer, itemCode, itemName, warehouse }

function renderConsignLedgerPanel() {
  if (!consignLedgerSelection) return;
  const { customer, itemCode, itemName, warehouse } = consignLedgerSelection;
  consignLedgerTitle.textContent = `${itemName}（${customer}／${warehouse}）`;

  const entries = [...currentConsignmentLedger]
    .filter(l => l.customer === customer && l.itemCode === itemCode && l.warehouse === warehouse)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const total = entries.reduce((sum, e) => sum + (Number(e.deltaQty) || 0), 0);
  consignLedgerCount.textContent = entries.length ? `共 ${entries.length} 筆，目前加總 ${total}` : '目前沒有紀錄';

  if (!entries.length) {
    consignLedgerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">目前沒有紀錄</td></tr>`;
    return;
  }

  consignLedgerTableBody.innerHTML = entries.map(e => `
    <tr data-id="${escapeHTML(e.id)}">
      <td>${escapeHTML(e.date || '')}</td>
      <td>${e.deltaQty > 0 ? '+' : ''}${e.deltaQty}</td>
      <td>${e.remark ? escapeHTML(e.remark) : ''}</td>
      <td><button type="button" class="secondary consign-ledger-delete-btn">刪除</button></td>
    </tr>
  `).join('');
}

consignmentTableBody.addEventListener('click', e => {
  const btn = e.target.closest('.consign-ledger-open-btn');
  if (!btn) return;
  consignLedgerSelection = {
    customer: btn.dataset.customer,
    itemCode: btn.dataset.itemCode,
    itemName: btn.dataset.itemName,
    warehouse: btn.dataset.warehouse
  };
  consignLedgerNewDate.value = todayDateString();
  consignLedgerNewQty.value = '';
  consignLedgerNewRemark.value = '';
  consignLedgerModal.style.display = 'flex';
  renderConsignLedgerPanel();
});

function closeConsignLedgerModal() {
  consignLedgerSelection = null;
  consignLedgerModal.style.display = 'none';
}

consignLedgerCloseBtn.addEventListener('click', closeConsignLedgerModal);

// 點彈窗外面的半透明背景也可以關閉
consignLedgerModal.addEventListener('click', e => {
  if (e.target === consignLedgerModal) closeConsignLedgerModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && consignLedgerModal.style.display !== 'none') closeConsignLedgerModal();
});

consignLedgerAddBtn.addEventListener('click', async () => {
  if (!consignLedgerSelection) return;
  const date = consignLedgerNewDate.value;
  const deltaQty = Number(consignLedgerNewQty.value.trim());
  const remark = consignLedgerNewRemark.value.trim();
  if (!date || !deltaQty) {
    alert('請輸入日期跟數量（寄入填正數，出庫填負數）');
    return;
  }
  try {
    await addConsignmentLedgerEntry({ ...consignLedgerSelection, date, deltaQty, remark });
    consignLedgerNewQty.value = '';
    consignLedgerNewRemark.value = '';
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

consignLedgerTableBody.addEventListener('click', async e => {
  if (!e.target.classList.contains('consign-ledger-delete-btn')) return;
  const row = e.target.closest('tr');
  const id = row.dataset.id;
  if (!confirm('確定要刪除這筆紀錄嗎？')) return;
  try {
    await deleteConsignmentLedgerEntry(id);
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
});

// ---------- 鎖庫（ERP 沒有這份資料，人工維護，逐筆新增/編輯/刪除） ----------

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
    lockedStockTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }

  lockedStockTableBody.innerHTML = items.map(r => `
    <tr data-id="${escapeHTML(r.id)}">
      <td><input type="text" class="lock-field-input" data-field="itemCode" value="${escapeHTML(r.itemCode || '')}" style="width:110px; padding:4px 6px;" /></td>
      <td><input type="text" class="lock-field-input" data-field="itemName" value="${escapeHTML(r.itemName || '')}" style="width:140px; padding:4px 6px;" /></td>
      <td>
        <select class="lock-field-input" data-field="warehouse" style="padding:4px 6px;">
          <option value="泰山"${r.warehouse === '泰山' ? ' selected' : ''}>泰山</option>
          <option value="台中"${r.warehouse === '台中' ? ' selected' : ''}>台中</option>
        </select>
      </td>
      <td><input type="text" class="lock-field-input" data-field="tag" value="${escapeHTML(r.tag || '')}" style="width:100px; padding:4px 6px;" /></td>
      <td><input type="text" class="lock-field-input" data-field="lockedQty" value="${escapeHTML(String(r.lockedQty ?? ''))}" style="width:70px; padding:4px 6px;" /></td>
      <td><input type="text" class="lock-field-input" data-field="remark" value="${escapeHTML(r.remark || '')}" style="width:120px; padding:4px 6px;" /></td>
      <td><button type="button" class="secondary lock-delete-btn">刪除</button></td>
    </tr>
  `).join('');
}

// 每一欄失焦時只存那一欄，不用整批儲存
lockedStockTableBody.addEventListener('change', async e => {
  if (!e.target.classList.contains('lock-field-input')) return;
  const row = e.target.closest('tr');
  const id = row.dataset.id;
  const field = e.target.dataset.field;
  let value = e.target.value.trim();
  if (field === 'lockedQty') value = Number(value) || 0;
  try {
    await updateLockedStock(id, { [field]: value });
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

lockedStockTableBody.addEventListener('click', async e => {
  if (!e.target.classList.contains('lock-delete-btn')) return;
  const row = e.target.closest('tr');
  const id = row.dataset.id;
  if (!confirm('確定要刪除這筆鎖庫紀錄嗎？')) return;
  try {
    await deleteLockedStock(id);
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
});

lockedStockSearchInput.addEventListener('input', renderLockedStockTable);

lockedStockAddBtn.addEventListener('click', async () => {
  const itemCode = lockedStockNewCode.value.trim();
  const warehouse = lockedStockNewWarehouse.value;
  const tag = lockedStockNewTag.value.trim();
  const lockedQty = Number(lockedStockNewQty.value) || 0;
  const remark = lockedStockNewRemark.value.trim();
  if (!itemCode || !lockedQty) {
    alert('請輸入品號跟鎖庫數量');
    return;
  }
  // 品名自動從目前的庫存資料找，找不到就留空，之後可以再手動補
  const matched = currentStock.find(s => s.itemCode === itemCode && s.warehouse === warehouse);
  const itemName = matched ? matched.itemName : '';

  try {
    await addLockedStock({ itemCode, itemName, warehouse, tag, lockedQty, remark });
    lockedStockNewCode.value = '';
    lockedStockNewTag.value = '';
    lockedStockNewQty.value = '';
    lockedStockNewRemark.value = '';
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

// ---------- 使用者管理 ----------

function renderUsersTable() {
  if (!currentUsers.length) {
    usersTableBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#6b7280;">還沒有人登入過</td></tr>`;
    return;
  }
  const sorted = [...currentUsers].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  usersTableBody.innerHTML = sorted.map(u => `
    <tr>
      <td>${escapeHTML(u.email)}</td>
      <td>
        <div class="role-checkboxes">
          ${ROLES.map(role => `
            <label class="role-checkbox">
              <input type="checkbox" data-uid="${u.id}" data-role="${escapeHTML(role)}" ${((u.roles || []).includes(role)) ? 'checked' : ''} />
              ${escapeHTML(role)}
            </label>
          `).join('')}
        </div>
      </td>
    </tr>
  `).join('');

  usersTableBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const uid = cb.dataset.uid;
      const user = currentUsers.find(u => u.id === uid);
      const roles = new Set(user.roles || []);
      if (cb.checked) roles.add(cb.dataset.role);
      else roles.delete(cb.dataset.role);
      cb.disabled = true;
      try {
        await updateUserRoles(uid, Array.from(roles));
      } catch (err) {
        alert('更新角色失敗：' + err.message);
      } finally {
        cb.disabled = false;
      }
    });
  });
}

// ---------- 匯入資料 ----------
//
// 每種 ERP 匯出檔一次只會有一份、只有一個分頁，分頁名稱是 ERP 自動產生的亂碼
//（例如 INVR182026080400006820260804000），不能拿來判斷資料種類，只能靠「檔名」判斷
//（庫存.xlsx、批號.xlsx、寄庫.xlsx、異動.xlsx、轉撥.xlsx、銷貨.xlsx...）。
// 上傳只會解析檔案、不會馬上寫入，按下「確認匯入」才會真的動到資料庫。

function findColumnIndex(headerRow, names) {
  for (const name of names) {
    const idx = headerRow.findIndex(h => (h || '').toString().trim() === name);
    if (idx !== -1) return idx;
  }
  return -1;
}

// 有些匯出檔同一個欄名左右各出現一次（例如組合.xlsx的「包裝數量」成品/元件各一欄），
// 用範圍限定只找某個區段內的那一個
function findColumnIndexInRange(headerRow, names, fromIndex, toIndex) {
  const end = toIndex === undefined ? headerRow.length : toIndex;
  for (const name of names) {
    for (let i = fromIndex; i < end; i++) {
      if ((headerRow[i] || '').toString().trim() === name) return i;
    }
  }
  return -1;
}

function isRealItemCode(code) {
  return /^[A-Za-z0-9]+$/.test(code || '');
}

// ERP 匯出檔裡的庫別欄位寫法（泰山廠區/台中庫）跟本系統統一用的「泰山」「台中」不一樣，要正規化
function normalizeWarehouse(raw) {
  const s = (raw || '').toString();
  if (s.includes('泰山')) return '泰山';
  if (s.includes('台中')) return '台中';
  return null;
}

function firstSheet(wb) {
  return wb.Sheets[wb.SheetNames[0]];
}

// 庫存.xlsx：品號/品名/庫別名稱/庫存數量/庫存金額/單位成本/庫存包裝數量
// 庫別名稱可能是「泰山廠區」「台中庫」（實體倉庫）或「廠務」；有些列是合併儲存格延續列，品號會是空的，
// 檔案最後還有「類別:」「會計科目:」這種小計列，品號欄位不是空的但也不是真正的品號，兩種都要排除。
function parseStockSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return { taishan: [], taichung: [], factory: [] };
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxWh = findColumnIndex(header, ['庫別名稱']);
  // 跟批號.xlsx/寄庫.xlsx一樣，日常用的是包裝數量（例如一箱12入），不是散裝的庫存數量——
  // 對照過0805庫存YU的「泰山」分頁，同一列庫存數量=84048、鎖庫前結存=7004，剛好是12入裝的比例（84048/12=7004）。
  const idxQty = findColumnIndex(header, ['庫存包裝數量', '庫存數量']);
  if (idxCode === -1 || idxWh === -1 || idxQty === -1) {
    throw new Error('找不到「品號」「庫別名稱」或「庫存包裝數量/庫存數量」欄位，格式可能跟預期不同');
  }

  const result = { taishan: [], taichung: [], factory: [] };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(itemCode)) continue;
    const itemName = idxName !== -1 ? (row[idxName] || '').toString().trim() : '';
    const whRaw = (row[idxWh] || '').toString().trim();
    const qty = Number(row[idxQty]) || 0;
    const warehouse = normalizeWarehouse(whRaw);
    if (warehouse === '泰山') result.taishan.push({ itemCode, itemName, warehouse: '泰山', qty });
    else if (warehouse === '台中') result.taichung.push({ itemCode, itemName, warehouse: '台中', qty });
    else if (whRaw === '廠務') result.factory.push({ itemCode, itemName, qty });
  }
  return result;
}

// 寄庫.xlsx：跟庫存.xlsx 同一種格式，只是「庫別名稱」欄位放的是客戶名字，不是實體倉庫
function parseConsignmentSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxCustomer = findColumnIndex(header, ['庫別名稱']);
  // 跟批號.xlsx一樣，日常用的是包裝數量（例如一箱12入），不是散裝的庫存數量——
  // 對照過0805庫存YU的「寄庫表」分頁，同一列庫存數量=504、庫存包裝數量=42（12入裝），差12倍。
  const idxQty = findColumnIndex(header, ['庫存包裝數量', '庫存數量']);
  if (idxCode === -1 || idxCustomer === -1 || idxQty === -1) {
    throw new Error('找不到「品號」「庫別名稱」或「庫存包裝數量/庫存數量」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(itemCode)) continue;
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      customer: (row[idxCustomer] || '').toString().trim(),
      qty: Number(row[idxQty]) || 0
    });
  }
  return records;
}

// 批號.xlsx：品號/品名/規格/單位/包裝單位/批號/庫別/期初庫存/.../期末包裝庫存
function parseBatchListSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxBatch = findColumnIndex(header, ['批號']);
  const idxWh = findColumnIndex(header, ['庫別']);
  const idxQty = findColumnIndex(header, ['期末包裝庫存']);
  if (idxCode === -1 || idxWh === -1) {
    throw new Error('找不到「品號」或「庫別」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(itemCode)) continue;
    const whRaw = (row[idxWh] || '').toString().trim();
    // 批號.xlsx 自己就有獨立的「廠務」庫別資料，不是要去對泰山廠區——廠務有自己的批號，不用正規化成泰山/台中
    const warehouse = normalizeWarehouse(whRaw) || (whRaw === '廠務' ? '廠務' : null);
    if (!warehouse) continue;
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      warehouse,
      batchNo: idxBatch !== -1 ? (row[idxBatch] || '').toString().trim() : '',
      qty: idxQty !== -1 ? Number(row[idxQty]) || 0 : 0
    });
  }
  return records;
}

// 異動.xlsx / 轉撥.xlsx / 銷貨.xlsx：泰山/台中庫存數字只反映「已核完」的單據；
// 還沒核完的單據，資料還留在這些分頁裡（核完之後那一列就會清空），有品號就代表還沒核完。
// 庫別欄位正規化得到「泰山」或「台中」就是調整實體倉庫庫存；正規化不到（值是客戶名字，例如
// 「陳俊男-Y」「瓦城T」）就代表這筆其實是在動客戶的寄庫帳——用同一個 warehouse 欄位存客戶名字，
// 畫面上寄庫那邊會照這個客戶名字對出來加減寄庫數量（跟泰山/台中庫存共用同一套「未核完調整」機制）。
// 這三份都跟庫存.xlsx一樣有散裝/包裝兩種數量欄位，庫存本身是用包裝數量記的，統一都要優先讀包裝數量。
function parseMovementAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxInPackaged = findColumnIndex(header, ['入庫包裝數量']);
  const idxInRaw = findColumnIndex(header, ['入庫異動數量']);
  const idxOutPackaged = findColumnIndex(header, ['出庫包裝數量']);
  const idxOutRaw = findColumnIndex(header, ['出庫異動數量']);
  const idxWh = findColumnIndex(header, ['庫別']);
  if (idxCode === -1 || idxWh === -1) {
    throw new Error('找不到「品號」或「庫別」欄位，格式可能跟預期不同');
  }

  // 優先用包裝數量，但有些不滿一個包裝單位的零頭調整（例如0.45KG）包裝數量會四捨五入成0，
  // 這種時候改用散裝的異動數量，不要整筆憑空消失
  const pickQty = (row, idxPackaged, idxRaw) => {
    const packaged = idxPackaged !== -1 ? Number(row[idxPackaged]) || 0 : 0;
    if (packaged) return packaged;
    return idxRaw !== -1 ? Number(row[idxRaw]) || 0 : 0;
  };

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const whRaw = (row[idxWh] || '').toString().trim();
    if (!whRaw) continue;
    const warehouse = normalizeWarehouse(whRaw) || whRaw; // 對不到泰山/台中就當客戶名字（寄庫用）
    const inQty = pickQty(row, idxInPackaged, idxInRaw);
    const outQty = pickQty(row, idxOutPackaged, idxOutRaw);
    if (inQty) records.push({ itemCode: code, warehouse, deltaQty: inQty, source: '異動' });
    if (outQty) records.push({ itemCode: code, warehouse, deltaQty: -outQty, source: '異動' });
  }
  return records;
}

// 轉撥.xlsx：一列裡同時有轉出庫別跟轉入庫別，一列可能產生兩筆調整（一減一加）
function parseTransferAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxQtyPackaged = findColumnIndex(header, ['包裝數量']);
  const idxQtyRaw = findColumnIndex(header, ['轉撥數量']);
  const idxOutWh = findColumnIndex(header, ['轉出庫別']);
  const idxInWh = findColumnIndex(header, ['轉入庫別']);
  if (idxCode === -1 || (idxQtyPackaged === -1 && idxQtyRaw === -1) || idxOutWh === -1 || idxInWh === -1) {
    throw new Error('找不到「品號」「包裝數量/轉撥數量」「轉出庫別」或「轉入庫別」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    // 優先用包裝數量，不滿一個包裝單位四捨五入成0的零頭調整改用散裝的轉撥數量，不要整筆消失
    const packagedQty = idxQtyPackaged !== -1 ? Number(row[idxQtyPackaged]) || 0 : 0;
    const qty = packagedQty || (idxQtyRaw !== -1 ? Number(row[idxQtyRaw]) || 0 : 0);
    if (!qty) continue;
    // 轉出/轉入庫別除了泰山/台中，也可能是「廠務」（例如廠務轉泰山、泰山轉廠務）——
    // 正規化不到泰山/台中時，只要原始文字剛好是「廠務」就當廠務本身處理，不要整筆丟掉
    const outWh = normalizeWarehouse(row[idxOutWh]) || ((row[idxOutWh] || '').toString().trim() === '廠務' ? '廠務' : null);
    const inWh = normalizeWarehouse(row[idxInWh]) || ((row[idxInWh] || '').toString().trim() === '廠務' ? '廠務' : null);
    if (outWh) records.push({ itemCode: code, warehouse: outWh, deltaQty: -qty, source: '轉撥' });
    if (inWh) records.push({ itemCode: code, warehouse: inWh, deltaQty: qty, source: '轉撥' });
  }
  return records;
}

// 銷貨.xlsx：品號欄位標題實際是「品    號」（字中間有全形空白）
// 跟庫存.xlsx/批號.xlsx一樣，庫存數字是用包裝數量記的（例如一箱12入），銷貨數量是散裝數字（30件=360KG這種），
// 要扣就要扣包裝數量，扣散裝的銷貨數量會扣超多、把庫存扣成一大坨負數（真實比對過0901銷貨.xlsx抓到這個問題）。
function parseSalesAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品    號', '品號']);
  const idxQtyPackaged = findColumnIndex(header, ['包裝數量']);
  const idxQtyRaw = findColumnIndex(header, ['銷貨數量']);
  const idxWh = findColumnIndex(header, ['庫別名稱']);
  if (idxCode === -1 || (idxQtyPackaged === -1 && idxQtyRaw === -1) || idxWh === -1) {
    throw new Error('找不到「品號」「包裝數量/銷貨數量」或「庫別名稱」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const warehouse = normalizeWarehouse(row[idxWh]);
    if (!warehouse) continue;
    // 優先用包裝數量，不滿一個包裝單位四捨五入成0的零頭銷貨改用散裝的銷貨數量，不要整筆消失
    const packagedQty = idxQtyPackaged !== -1 ? Number(row[idxQtyPackaged]) || 0 : 0;
    const qty = packagedQty || (idxQtyRaw !== -1 ? Number(row[idxQtyRaw]) || 0 : 0);
    if (!qty) continue;
    records.push({ itemCode: code, warehouse, deltaQty: -qty, source: '銷貨' });
  }
  return records;
}

// 進貨.xlsx：品號/品名欄位標題實際是「品    號」「品    名」（字中間有全形空白）
// 一樣優先讀包裝數量（進貨包裝數量），不要讀散裝的進貨數量。庫別除了泰山/台中，理論上也可能是廠務，
// 跟轉撥.xlsx一樣保留「原始文字剛好是廠務就當廠務本身」的備援，不要整筆丟掉。
function parsePurchaseAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品    號', '品號']);
  const idxQtyPackaged = findColumnIndex(header, ['進貨包裝數量']);
  const idxQtyRaw = findColumnIndex(header, ['進貨數量']);
  const idxWh = findColumnIndex(header, ['庫別']);
  if (idxCode === -1 || (idxQtyPackaged === -1 && idxQtyRaw === -1) || idxWh === -1) {
    throw new Error('找不到「品號」「進貨包裝數量/進貨數量」或「庫別」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const whRaw = (row[idxWh] || '').toString().trim();
    const warehouse = normalizeWarehouse(whRaw) || (whRaw === '廠務' ? '廠務' : null);
    if (!warehouse) continue;
    // 優先用包裝數量，不滿一個包裝單位四捨五入成0的零頭進貨改用散裝的進貨數量，不要整筆消失
    const packagedQty = idxQtyPackaged !== -1 ? Number(row[idxQtyPackaged]) || 0 : 0;
    const qty = packagedQty || (idxQtyRaw !== -1 ? Number(row[idxQtyRaw]) || 0 : 0);
    if (!qty) continue;
    records.push({ itemCode: code, warehouse, deltaQty: qty, source: '進貨' });
  }
  return records;
}

// 組合.xlsx：一列代表一筆「用元件組成成品」的組合單，成品欄位跟元件欄位左右並排在同一列——
// 「包裝數量」「批號」「單位」這幾個欄名成品/元件各出現一次，用「元件品號」欄位的位置切左右半邊來分辨。
// 跟其他未核完調整一樣：核完的單據那一列會從匯出檔清空，還留著品號就代表還沒核完。
// 方向：元件出庫（扣元件所在倉庫的庫存）、成品入庫（加成品所在倉庫的庫存）。
function parseAssemblyAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxFinishedCode = findColumnIndex(header, ['成品品號']);
  const idxFinishedWh = findColumnIndex(header, ['入庫庫別']);
  const idxComponentCode = findColumnIndex(header, ['元件品號']);
  const idxComponentWh = findColumnIndex(header, ['出庫庫別']);
  if (idxFinishedCode === -1 || idxFinishedWh === -1 || idxComponentCode === -1 || idxComponentWh === -1) {
    throw new Error('找不到「成品品號」「入庫庫別」「元件品號」或「出庫庫別」欄位，格式可能跟預期不同');
  }
  const idxFinishedQty = findColumnIndexInRange(header, ['包裝數量'], 0, idxComponentCode);
  const idxComponentQty = findColumnIndexInRange(header, ['包裝數量'], idxComponentCode);

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const finishedCode = (row[idxFinishedCode] || '').toString().trim();
    if (isRealItemCode(finishedCode)) {
      const warehouse = normalizeWarehouse(row[idxFinishedWh]);
      const qty = idxFinishedQty !== -1 ? Number(row[idxFinishedQty]) || 0 : 0;
      if (warehouse && qty) records.push({ itemCode: finishedCode, warehouse, deltaQty: qty, source: '組合' });
    }
    const componentCode = (row[idxComponentCode] || '').toString().trim();
    if (isRealItemCode(componentCode)) {
      const warehouse = normalizeWarehouse(row[idxComponentWh]);
      const qty = idxComponentQty !== -1 ? Number(row[idxComponentQty]) || 0 : 0;
      if (warehouse && qty) records.push({ itemCode: componentCode, warehouse, deltaQty: -qty, source: '組合' });
    }
  }
  return records;
}

// 組合檔（1150805庫存YU.xlsx）的「參照 (新)」分頁是人工維護的品項主檔，不是每天變動的 ERP 資料，
// 可以整批匯入當初始值，之後有需要再到「參照」分頁手動改。只 set/merge、不整批覆蓋，不會洗掉手動改過的其他品項。
function parseItemReferenceFromMaster(wb) {
  const sheet = wb.Sheets['參照 (新)'];
  if (!sheet) throw new Error('這份檔案裡找不到「參照 (新)」分頁');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxOrigin = findColumnIndex(header, ['產地']);
  const idxUnit = findColumnIndex(header, ['單位']);
  const idxPurchaseType = findColumnIndex(header, ['採購']);
  const idxCategory = findColumnIndex(header, ['類別']);
  const idxMajorCategory = findColumnIndex(header, ['大類']);
  const idxNetWeight = findColumnIndex(header, ['淨重']);
  const idxGrossWeight = findColumnIndex(header, ['毛重']);
  const idxCompanyType = findColumnIndex(header, ['公司別']);
  const idxTag = findColumnIndex(header, ['廠務']);
  const idxSplit = findColumnIndex(header, ['備註']);
  const idxNote = findColumnIndex(header, ['註記']);
  if (idxCode === -1) {
    throw new Error('「參照 (新)」分頁找不到「品號」欄位，格式可能跟預期不同');
  }

  const cell = (row, idx) => idx !== -1 ? (row[idx] || '').toString().trim() : '';
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = cell(row, idxCode);
    if (!isRealItemCode(itemCode)) continue;
    records.push({
      itemCode,
      itemName: cell(row, idxName),
      origin: cell(row, idxOrigin),
      unit: cell(row, idxUnit),
      purchaseType: cell(row, idxPurchaseType),
      category: cell(row, idxCategory),
      majorCategory: cell(row, idxMajorCategory),
      netWeight: cell(row, idxNetWeight),
      grossWeight: cell(row, idxGrossWeight),
      companyType: cell(row, idxCompanyType),
      tag: cell(row, idxTag),
      isSplit: cell(row, idxSplit),
      note: cell(row, idxNote)
    });
  }
  return records;
}

// 組合檔「寄庫」分頁是一欄一天記錄進出（正數=當天寄入、負數=當天出庫），日期欄位有兩種格式混在一起：
// 前段是 Excel 序列數字（儲存格式是日期，raw:true 讀出來是數字），後段是「7月1日」這種純文字
// （沒有年份）。文字欄位的年份用前面數字欄位換算出來的年份當基準，如果換算後比前一欄還早
// （代表跨年了）就自動+1年。
function excelSerialToISODate(serial) {
  const ms = (serial - 25569) * 86400 * 1000; // 25569 = Excel(1899-12-30) 到 Unix epoch(1970-01-01) 的天數
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoDateMinusOneDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 掃過標頭列，找出所有日期欄位，回傳 [{ index, date('YYYY-MM-DD') }, ...]（依欄位順序，即時間順序）
function parseConsignmentDateColumns(header, startIdx, endIdx) {
  const cols = [];
  let anchorYear = null;
  let prevDate = null;
  for (let i = startIdx; i < endIdx; i++) {
    const raw = header[i];
    if (raw === '' || raw === null || raw === undefined) continue;
    let dateStr = null;
    if (typeof raw === 'number') {
      dateStr = excelSerialToISODate(raw);
      anchorYear = Number(dateStr.slice(0, 4));
    } else {
      const m = String(raw).trim().match(/^(\d{1,2})月(\d{1,2})日$/);
      if (m && anchorYear) {
        const mm = String(m[1]).padStart(2, '0');
        const dd = String(m[2]).padStart(2, '0');
        let candidate = `${anchorYear}-${mm}-${dd}`;
        if (prevDate && candidate < prevDate) candidate = `${anchorYear + 1}-${mm}-${dd}`;
        dateStr = candidate;
      }
    }
    if (dateStr) {
      cols.push({ index: i, date: dateStr });
      prevDate = dateStr;
    }
  }
  return cols;
}

// 組合檔「寄庫」分頁沒有品號欄位，只有客戶+品名+庫別，用目前已經匯入的 consignment（寄庫.xlsx 的資料）
// 依「客戶+品名」反查品號——查不到的就跳過（沒辦法對應到現在的寄庫總數，強行匯入也沒有意義），
// 用 skipped 計數回報給使用者。庫別欄位是空的那種列是自動產生的小計列，不是真正的資料列，也跳過。
function parseConsignmentLedgerFromMaster(wb) {
  const sheet = wb.Sheets['寄庫'];
  if (!sheet) throw new Error('這份檔案裡找不到「寄庫」分頁');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return { records: [], skipped: 0 };
  const header = rows[0];
  const idxCustomer = findColumnIndex(header, ['客戶']);
  const idxItemName = findColumnIndex(header, ['品名']);
  const idxWarehouse = findColumnIndex(header, ['庫別']);
  const idxLastMonth = findColumnIndex(header, ['上月數量']);
  const idxToday = findColumnIndex(header, ['本日數量']);
  if (idxCustomer === -1 || idxItemName === -1 || idxWarehouse === -1) {
    throw new Error('「寄庫」分頁找不到「客戶」「品名」或「庫別」欄位，格式可能跟預期不同');
  }

  const dateStartIdx = idxLastMonth !== -1 ? idxLastMonth + 1 : idxWarehouse + 1;
  const dateEndIdx = idxToday !== -1 ? idxToday : header.length;
  const dateColumns = parseConsignmentDateColumns(header, dateStartIdx, dateEndIdx);
  const firstEntryDate = dateColumns.length ? dateColumns[0].date : todayDateString();

  // 客戶+品名 -> 品號，從目前的寄庫總數（ERP匯入的 consignment）反查
  const codeByCustomerName = new Map();
  currentConsignment.forEach(c => codeByCustomerName.set(`${c.customer}__${c.itemName}`, c.itemCode));

  const records = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const customer = (row[idxCustomer] || '').toString().trim();
    const itemName = (row[idxItemName] || '').toString().trim();
    const whRaw = (row[idxWarehouse] || '').toString().trim();
    if (!customer || !itemName || !whRaw) continue; // 庫別是空的是自動小計列，不是真正資料
    const warehouse = normalizeWarehouse(whRaw);
    if (!warehouse) continue; // 庫別不是泰山/台中的略過

    const itemCode = codeByCustomerName.get(`${customer}__${itemName}`);
    if (!itemCode) { skipped++; continue; }

    const lastMonthQty = idxLastMonth !== -1 ? Number(row[idxLastMonth]) || 0 : 0;
    if (lastMonthQty) {
      records.push({ customer, itemCode, itemName, warehouse, date: isoDateMinusOneDay(firstEntryDate), deltaQty: lastMonthQty, remark: '上月結轉' });
    }
    dateColumns.forEach(({ index, date }) => {
      const val = Number(row[index]);
      if (!val) return;
      records.push({ customer, itemCode, itemName, warehouse, date, deltaQty: val, remark: '' });
    });
  }
  return { records, skipped };
}

// 目前有 8 種確認過真實 ERP 匯出格式（退貨/鎖庫還沒有真實檔案樣本，
// 拿到之後再依樣加進這個清單）。matchesFilename 拿掉副檔名後直接比對檔名字串。
// 同一個檔名可能對到不只一個項目，所以是列出所有符合的候選，不是只挑第一個。
const IMPORT_ITEMS = [
  {
    key: 'itemReferenceFromMaster',
    label: '參照（品項主檔，當初始值，不覆蓋手動改過的）',
    matchesFilename: name => name.includes('庫存YU'),
    prepare: wb => parseItemReferenceFromMaster(wb),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await importItemReferenceFromMaster(records);
      return `已更新參照 ${result.written} 筆`;
    }
  },
  {
    key: 'consignmentLedgerFromMaster',
    label: '寄庫進出紀錄（寄庫分頁，匯入歷史記錄，用日期當ID可重複匯入不會重複）',
    matchesFilename: name => name.includes('庫存YU'),
    prepare: wb => parseConsignmentLedgerFromMaster(wb),
    describe: result => `共 ${result.records.length} 筆進出紀錄${result.skipped ? `，另有 ${result.skipped} 筆因為找不到對應的寄庫品號（客戶+品名在目前的寄庫總數裡查不到）被略過` : ''}`,
    run: async result => {
      const written = await importConsignmentLedgerEntries(result.records);
      return `已匯入寄庫進出紀錄 ${written.written} 筆`;
    }
  },
  {
    key: 'stock',
    label: '庫存',
    matchesFilename: name => name === '庫存',
    prepare: wb => parseStockSheet(firstSheet(wb)),
    describe: data => `泰山 ${data.taishan.length} 筆、台中 ${data.taichung.length} 筆、廠務 ${data.factory.length} 筆`,
    run: async data => {
      const stockResult = await replaceStockForWarehouses([...data.taishan, ...data.taichung], WAREHOUSES);
      const factoryResult = await replaceFactoryMaterial(data.factory);
      return `已更新泰山/台中庫存 ${stockResult.written} 筆、廠務用料 ${factoryResult.written} 筆`;
    }
  },
  {
    key: 'consignment',
    label: '寄庫',
    matchesFilename: name => name === '寄庫',
    prepare: wb => parseConsignmentSheet(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceConsignment(records);
      return `已更新寄庫 ${result.written} 筆`;
    }
  },
  {
    key: 'batchList',
    label: '批號',
    matchesFilename: name => name === '批號',
    prepare: wb => parseBatchListSheet(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceBatchList(records);
      return `已更新批號 ${result.written} 筆`;
    }
  },
  {
    key: 'movement',
    label: '異動（未核完調整）',
    matchesFilename: name => name === '異動',
    prepare: wb => parseMovementAdjustments(firstSheet(wb)),
    // 就算今天是0筆也要按確認匯入——不按的話，昨天匯入的舊未核完資料不會被清掉，
    // 會一直留著繼續影響庫存數字（每種未核完調整只有真的按下確認匯入才會清舊資料）
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上${records.length === 0 ? '（就算是0筆也要按下面「確認匯入」，才會清掉昨天留下的舊資料）' : ''}`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['異動']);
      return `已更新異動的未核完調整 ${result.written} 筆`;
    }
  },
  {
    key: 'transfer',
    label: '轉撥（未核完調整）',
    matchesFilename: name => name === '轉撥',
    prepare: wb => parseTransferAdjustments(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上${records.length === 0 ? '（就算是0筆也要按下面「確認匯入」，才會清掉昨天留下的舊資料）' : ''}`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['轉撥']);
      return `已更新轉撥的未核完調整 ${result.written} 筆`;
    }
  },
  {
    key: 'sales',
    label: '銷貨（未核完調整）',
    matchesFilename: name => name === '銷貨',
    prepare: wb => parseSalesAdjustments(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上${records.length === 0 ? '（就算是0筆也要按下面「確認匯入」，才會清掉昨天留下的舊資料）' : ''}`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['銷貨']);
      return `已更新銷貨的未核完調整 ${result.written} 筆`;
    }
  },
  {
    key: 'assembly',
    label: '組合（未核完調整）',
    matchesFilename: name => name === '組合',
    prepare: wb => parseAssemblyAdjustments(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上${records.length === 0 ? '（就算是0筆也要按下面「確認匯入」，才會清掉昨天留下的舊資料）' : ''}`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['組合']);
      return `已更新組合的未核完調整 ${result.written} 筆`;
    }
  },
  {
    key: 'purchase',
    label: '進貨（未核完調整）',
    matchesFilename: name => name === '進貨',
    prepare: wb => parsePurchaseAdjustments(firstSheet(wb)),
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上${records.length === 0 ? '（就算是0筆也要按下面「確認匯入」，才會清掉昨天留下的舊資料）' : ''}`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['進貨']);
      return `已更新進貨的未核完調整 ${result.written} 筆`;
    }
  }
];

let pendingWorkbook = null;
let pendingImportData = {}; // key -> prepared data

async function handleFileSelected(file) {
  importMsg.style.color = 'var(--color-text-muted)';
  importMsg.textContent = '讀取檔案中...';
  importItemsList.innerHTML = '';
  pendingWorkbook = null;
  pendingImportData = {};

  const filenameNoExt = file.name.replace(/\.[^.]+$/, '').trim();
  const matched = IMPORT_ITEMS.filter(item => item.matchesFilename(filenameNoExt));

  if (!matched.length) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = `看不懂檔名「${file.name}」，目前支援的檔名：庫存、寄庫、批號、異動、轉撥、銷貨、組合、進貨，或含「庫存YU」的整份組合檔（副檔名 .xlsx）`;
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    pendingWorkbook = XLSX.read(buffer, { type: 'array' });
    renderImportItems(matched);
    importMsg.style.color = '';
    importMsg.textContent = '檔案讀取完成，選擇要匯入的項目：';
  } catch (err) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = '讀取檔案失敗：' + err.message;
  }
}

function renderImportItems(matched) {
  importItemsList.innerHTML = matched.map(item => {
    let desc = '';
    let error = '';
    try {
      const prepared = item.prepare(pendingWorkbook);
      pendingImportData[item.key] = prepared;
      desc = item.describe(prepared);
    } catch (err) {
      error = err.message;
    }
    return `
      <div class="import-item">
        <div class="import-item-info">
          <strong>${escapeHTML(item.label)}</strong>
          <span class="hint-text">${error ? escapeHTML(error) : escapeHTML(desc)}</span>
        </div>
        <button type="button" class="secondary" data-import-key="${item.key}" ${error ? 'disabled' : ''}>確認匯入</button>
      </div>
    `;
  }).join('');

  importItemsList.querySelectorAll('button[data-import-key]').forEach(btn => {
    btn.addEventListener('click', () => runImportItem(matched.find(i => i.key === btn.dataset.importKey)));
  });
}

async function runImportItem(item) {
  const data = pendingImportData[item.key];
  if (!item || data === undefined) return;
  const btn = importItemsList.querySelector(`button[data-import-key="${item.key}"]`);
  btn.disabled = true;
  btn.textContent = '匯入中...';
  try {
    const message = await item.run(data);
    importMsg.style.color = 'var(--color-success)';
    importMsg.textContent = message;
    btn.textContent = '已匯入 ✓';
  } catch (err) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = `「${item.label}」匯入失敗：` + err.message;
    btn.disabled = false;
    btn.textContent = '確認匯入';
  }
}

importDropZone.addEventListener('click', () => importFileInput.click());

importDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  importDropZone.classList.add('dragover');
});

importDropZone.addEventListener('dragleave', () => {
  importDropZone.classList.remove('dragover');
});

importDropZone.addEventListener('drop', e => {
  e.preventDefault();
  importDropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files[0];
  if (file) handleFileSelected(file);
  importFileInput.value = '';
});

// ---------- 今日快照：手動存檔「今天完成」的最終版本 ----------

function todayDateString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 快照只留一年，超過的自動清掉——沒有後端排程，藉著使用者按「今天完成」的時機順便清理
function dateStringMinusOneYear(dateStr) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() - 1);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

saveSnapshotBtn.addEventListener('click', async () => {
  const date = todayDateString();
  if (!confirm(`確定要把今天（${date}）目前畫面上的庫存/批號/寄庫/廠務用料/未核完調整/鎖庫存成快照嗎？如果今天已經存過，會被最新的這次覆蓋。`)) return;
  saveSnapshotBtn.disabled = true;
  saveSnapshotMsg.textContent = '存檔中...';
  try {
    await saveDailySnapshot(date, {
      stock: currentStock,
      batchList: currentBatchList,
      consignment: currentConsignment,
      factoryMaterial: currentFactoryMaterial,
      pendingAdjustments: currentPendingAdjustments,
      lockedStock: currentLockedStock
    });
    const cleanup = await deleteOldSnapshots(dateStringMinusOneYear(date));
    saveSnapshotMsg.textContent = `已存檔 ${date} 的快照，可以到「歷史」分頁查詢。`
      + (cleanup.deleted ? `（順便清掉了 ${cleanup.deleted} 筆超過一年的舊快照）` : '');
  } catch (err) {
    saveSnapshotMsg.textContent = '存檔失敗：' + err.message;
  } finally {
    saveSnapshotBtn.disabled = false;
  }
});

// 泰山/台中庫存、廠務用料、批號都是每天從ERP重新拉的，開始新的一天可以先一鍵清空，
// 不用等匯入新檔案才自然覆蓋掉舊資料。這是刪除動作，要求再打一次「清空」確認，避免手滑。
clearDailyBtn.addEventListener('click', async () => {
  if (!confirm('確定要清空泰山/台中庫存、廠務用料、批號嗎？這個動作會直接刪除資料庫裡的資料，沒辦法復原。')) return;
  if (prompt('請再輸入「清空」兩個字確認：') !== '清空') {
    alert('沒有輸入正確，已取消');
    return;
  }
  clearDailyBtn.disabled = true;
  clearDailyMsg.textContent = '清空中...';
  try {
    const result = await clearDailyErpData();
    clearDailyMsg.textContent = `已清空：庫存 ${result.stock} 筆、廠務用料 ${result.factoryMaterial} 筆、批號 ${result.batchList} 筆。`;
  } catch (err) {
    clearDailyMsg.textContent = '清空失敗：' + err.message;
  } finally {
    clearDailyBtn.disabled = false;
  }
});

// ---------- 歷史：按日期查詢快照，唯讀 ----------

const HISTORY_VIEWS = {
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
  pendingAdjustments: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'warehouse', label: '倉庫' },
    { key: 'deltaQty', label: '調整量' }, { key: 'source', label: '來源' }
  ] },
  lockedStock: { columns: [
    { key: 'itemCode', label: '品號' }, { key: 'itemName', label: '品名' }, { key: 'warehouse', label: '倉庫' },
    { key: 'tag', label: '標籤' }, { key: 'lockedQty', label: '鎖庫數量' }, { key: 'remark', label: '備註' }
  ] }
};

historyLoadBtn.addEventListener('click', async () => {
  const date = historyDateInput.value;
  const type = historyTypeSelect.value;
  if (!date) {
    alert('請先選日期');
    return;
  }
  historyLoadBtn.disabled = true;
  historyCount.textContent = '查詢中...';
  historyTableHead.innerHTML = '';
  historyTableBody.innerHTML = '';
  try {
    const snapshot = await loadDailySnapshot(date);
    const records = snapshot[type];
    const view = HISTORY_VIEWS[type];
    historyTableHead.innerHTML = `<tr>${view.columns.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
    if (records === null) {
      historyCount.textContent = `${date} 沒有存過「${historyTypeSelect.options[historyTypeSelect.selectedIndex].text}」的快照`;
      historyTableBody.innerHTML = `<tr><td colspan="${view.columns.length}" style="text-align:center; color:#6b7280;">查無資料</td></tr>`;
      return;
    }
    historyCount.textContent = `${date} 共 ${records.length} 筆`;
    if (!records.length) {
      historyTableBody.innerHTML = `<tr><td colspan="${view.columns.length}" style="text-align:center; color:#6b7280;">這份快照是空的</td></tr>`;
      return;
    }
    historyTableBody.innerHTML = records.map(r => `
      <tr>${view.columns.map(c => `<td>${escapeHTML(r[c.key] ?? '')}</td>`).join('')}</tr>
    `).join('');
  } catch (err) {
    historyCount.textContent = '查詢失敗：' + err.message;
  } finally {
    historyLoadBtn.disabled = false;
  }
});
