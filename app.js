// 庫存管理系統：登入後才能使用，登入、匯入、查詢都在同一頁。
// 畫面上的分頁跟資料欄位，依登入者的角色顯示不同內容。
import { auth } from './firebase-config.js?v=3';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  subscribeToStock, replaceStockForWarehouses,
  subscribeToFactoryMaterial, replaceFactoryMaterial,
  subscribeToItemTags, setItemTag,
  subscribeToSummary, replaceSummary,
  subscribeToBatchList, replaceBatchList,
  subscribeToConsignment, replaceConsignment,
  subscribeToPendingAdjustments, replacePendingAdjustments,
  subscribeToRawImport, replaceRawImport
} from './inventory-service.js?v=3';
import { touchOwnProfile, subscribeToOwnProfile, subscribeToUsers, updateUserRoles } from './users-service.js?v=3';
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

const searchInput = document.getElementById('searchInput');
const stockTableHead = document.getElementById('stockTableHead');
const stockTableBody = document.getElementById('stockTableBody');
const stockSummary = document.getElementById('stockSummary');

const importDropZone = document.getElementById('importDropZone');
const importFileInput = document.getElementById('importFileInput');
const importMsg = document.getElementById('importMsg');
const importItemsList = document.getElementById('importItemsList');

const usersTableBody = document.getElementById('usersTableBody');

const factoryMaterialTableBody = document.getElementById('factoryMaterialTableBody');
const availableMaterialTableBody = document.getElementById('availableMaterialTableBody');

const summarySearchInput = document.getElementById('summarySearchInput');
const summaryTableBody = document.getElementById('summaryTableBody');
const summaryCount = document.getElementById('summaryCount');

const batchSearchInput = document.getElementById('batchSearchInput');
const batchTableBody = document.getElementById('batchTableBody');
const batchCount = document.getElementById('batchCount');

const consignmentSearchInput = document.getElementById('consignmentSearchInput');
const consignmentTableBody = document.getElementById('consignmentTableBody');
const consignmentCount = document.getElementById('consignmentCount');

const rawSheetSelect = document.getElementById('rawSheetSelect');
const rawTableBody = document.getElementById('rawTableBody');
const rawCount = document.getElementById('rawCount');

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
let currentItemTags = [];
let currentSummary = [];
let currentBatchList = [];
let currentConsignment = [];
let currentPendingAdjustments = [];
let currentRawImport = [];
let unsubscribeStock = null;
let unsubscribeOwnProfile = null;
let unsubscribeUsers = null;
let unsubscribeFactoryMaterial = null;
let unsubscribeItemTags = null;
let unsubscribeSummary = null;
let unsubscribeBatchList = null;
let unsubscribeConsignment = null;
let unsubscribePendingAdjustments = null;
let unsubscribeRawImport = null;

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
  if (unsubscribeItemTags) { unsubscribeItemTags(); unsubscribeItemTags = null; }
  if (unsubscribeSummary) { unsubscribeSummary(); unsubscribeSummary = null; }
  if (unsubscribeBatchList) { unsubscribeBatchList(); unsubscribeBatchList = null; }
  if (unsubscribeConsignment) { unsubscribeConsignment(); unsubscribeConsignment = null; }
  if (unsubscribePendingAdjustments) { unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null; }
  if (unsubscribeRawImport) { unsubscribeRawImport(); unsubscribeRawImport = null; }
  currentRoles = [];
  currentStock = [];
  currentUsers = [];
  currentFactoryMaterial = [];
  currentItemTags = [];
  currentSummary = [];
  currentRawImport = [];
  currentBatchList = [];
  currentConsignment = [];
  currentPendingAdjustments = [];
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
        renderStockTable();
        renderAvailableMaterialTable();
      },
      err => {
        stockSummary.style.color = 'var(--color-danger)';
        stockSummary.textContent = '讀取庫存資料失敗：' + err.message;
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

  const searchBtn = document.querySelector('.tab-btn[data-tab="search"]');
  const factoryBtn = document.querySelector('.tab-btn[data-tab="factory"]');
  const availableMaterialBtn = document.querySelector('.tab-btn[data-tab="availableMaterial"]');
  const summaryBtn = document.querySelector('.tab-btn[data-tab="summary"]');
  const batchBtn = document.querySelector('.tab-btn[data-tab="batch"]');
  const consignmentBtn = document.querySelector('.tab-btn[data-tab="consignment"]');
  const rawBtn = document.querySelector('.tab-btn[data-tab="raw"]');
  const importBtn = document.querySelector('.tab-btn[data-tab="import"]');
  const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');

  const canSeeStock = visibleWarehouses.length > 0;
  searchBtn.style.display = canSeeStock ? '' : 'none';
  factoryBtn.style.display = canSeeFactory ? '' : 'none';
  availableMaterialBtn.style.display = canSeeFactory ? '' : 'none';
  summaryBtn.style.display = canSeeSummary ? '' : 'none';
  batchBtn.style.display = canSeeStock ? '' : 'none';
  consignmentBtn.style.display = canSeeStock ? '' : 'none';
  rawBtn.style.display = isAdmin ? '' : 'none';
  importBtn.style.display = (canSeeStock || canSeeFactory || canSeeSummary || isAdmin) ? '' : 'none';
  usersBtn.style.display = isAdmin ? '' : 'none';

  // 如果目前開著的分頁被隱藏了，自動切到第一個看得到的分頁
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn && activeBtn.style.display === 'none') {
    const firstVisible = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.style.display !== 'none');
    if (firstVisible) firstVisible.click();
  }

  renderStockTableHead();
  renderStockTable();

  if (isAdmin && !unsubscribeUsers) {
    unsubscribeUsers = subscribeToUsers(users => {
      currentUsers = users;
      renderUsersTable();
    });
  } else if (!isAdmin && unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }

  if (isAdmin && !unsubscribeRawImport) {
    unsubscribeRawImport = subscribeToRawImport(rows => {
      currentRawImport = rows;
      renderRawSheetOptions();
      renderRawTable();
    });
  } else if (!isAdmin && unsubscribeRawImport) {
    unsubscribeRawImport();
    unsubscribeRawImport = null;
    currentRawImport = [];
  }

  if (canSeeFactory && !unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial = subscribeToFactoryMaterial(rows => {
      currentFactoryMaterial = rows;
      renderFactoryMaterialTable();
    });
    unsubscribeItemTags = subscribeToItemTags(rows => {
      currentItemTags = rows;
      renderAvailableMaterialTable();
    });
  } else if (!canSeeFactory && unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial(); unsubscribeFactoryMaterial = null;
    unsubscribeItemTags(); unsubscribeItemTags = null;
    currentFactoryMaterial = [];
    currentItemTags = [];
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
      renderStockTable();
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
      renderStockTable();
      renderConsignmentTable();
    });
  } else if (!canSeeStock && unsubscribeConsignment) {
    unsubscribeConsignment(); unsubscribeConsignment = null;
    unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null;
    currentConsignment = [];
    currentPendingAdjustments = [];
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

function formatExpiry(raw) {
  if (!raw) return '-';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

// 批號是 YYYYMMDD，字串排序就是時間排序。只顯示最短（最早到期）那個批號，
// 同品項其他批號收在「還有 N 筆」點開才看得到，不要一次全部列出來。
function renderBatchCell(batches) {
  if (!batches || !batches.length) return '-';
  const sorted = [...batches].sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || ''));
  const shortest = sorted[0];
  if (sorted.length === 1) return escapeHTML(shortest.batchNo);
  const restText = sorted.slice(1).map(b => b.batchNo).join('、');
  return `${escapeHTML(shortest.batchNo)} <details style="display:inline-block;"><summary style="display:inline; cursor:pointer; color:var(--color-primary);">還有 ${sorted.length - 1} 筆</summary>${escapeHTML(restText)}</details>`;
}

function renderQtyCell(s, adjustment, batches) {
  const badges = [];
  if (s.lockedQty) badges.push(`<span class="badge badge-locked" title="鎖庫前結存：${s.qtyBeforeLock ?? '-'}">鎖庫 ${s.lockedQty}</span>`);
  if (s.expired) badges.push(`<span class="badge badge-expired">過期/報廢 ${escapeHTML(s.expired)}</span>`);
  if (s.isSplit) badges.push(`<span class="badge badge-split">散裝</span>`);
  if (batches && batches.length) {
    const sorted = [...batches].sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || ''));
    const shortest = sorted[0];
    const extra = sorted.length - 1;
    const title = sorted.map(b => b.batchNo).join('\n');
    badges.push(`<span class="badge badge-batch" title="${escapeHTML(title)}">批號 ${escapeHTML(shortest.batchNo)}${extra ? ` +${extra}` : ''}</span>`);
  }
  const displayQty = s.qty + (adjustment || 0);
  if (adjustment) {
    badges.push(`<span class="badge badge-pending" title="銷貨/異動/調撥裡還沒核完的部分">未核完 ${adjustment > 0 ? '+' : ''}${adjustment}</span>`);
  }
  return `${displayQty}${badges.length ? ' ' + badges.join(' ') : ''}`;
}

function renderStockTableHead() {
  stockTableHead.innerHTML = `
    <tr>
      <th>品號</th>
      <th>品名</th>
      ${visibleWarehouses.map(w => `<th>${w}庫存</th><th>${w}最短效期</th>`).join('')}
    </tr>
  `;
}

function renderStockTable() {
  if (visibleWarehouses.length === 0) return;
  const keyword = searchInput.value.trim().toLowerCase();

  // 純泰山倉管（沒有管理員身分）看不到「註記=隱藏」的品項，這是參照表帶過來的規則
  const applyTaishanHideRule = currentRoles.includes('泰山倉管') && !isAdmin;

  // 品號+倉庫 -> 未核完調整加總，套用到顯示的庫存數字上
  const adjustmentByKey = new Map();
  currentPendingAdjustments.forEach(a => {
    const key = `${a.itemCode}__${a.warehouse}`;
    adjustmentByKey.set(key, (adjustmentByKey.get(key) || 0) + (a.deltaQty || 0));
  });

  // 品號+倉庫 -> 批號清單，庫存數量本身跟批號現在是分開兩個檔案匯入的，畫面上即時對照
  const batchesByKey = new Map();
  currentBatchList.forEach(b => {
    const key = `${b.itemCode}__${b.warehouse}`;
    if (!batchesByKey.has(key)) batchesByKey.set(key, []);
    batchesByKey.get(key).push({ batchNo: b.batchNo, qty: b.qty });
  });

  // 依品號分組，把有權限看到的倉庫庫存併成同一列
  const byItem = new Map();
  currentStock.forEach(s => {
    if (!visibleWarehouses.includes(s.warehouse)) return;
    if (applyTaishanHideRule && s.warehouse === '泰山' && s.hiddenFromTaishanManager) return;
    if (!byItem.has(s.itemCode)) {
      byItem.set(s.itemCode, { itemCode: s.itemCode, itemName: s.itemName, warehouses: {} });
    }
    byItem.get(s.itemCode).warehouses[s.warehouse] = s;
  });

  let items = Array.from(byItem.values());
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  const colCount = 2 + visibleWarehouses.length * 2;

  stockSummary.style.color = '';
  stockSummary.textContent = byItem.size
    ? (keyword ? `共 ${byItem.size} 個品項，篩選後 ${items.length} 筆` : `共 ${byItem.size} 個品項`)
    : '目前沒有庫存資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    stockTableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  stockTableBody.innerHTML = items.map(it => {
    const cells = visibleWarehouses.map(w => {
      const s = it.warehouses[w];
      const adjustment = s ? adjustmentByKey.get(`${s.itemCode}__${w}`) : 0;
      const batches = s ? batchesByKey.get(`${s.itemCode}__${w}`) : null;
      return `<td>${s ? renderQtyCell(s, adjustment, batches) : '-'}</td><td>${s ? formatExpiry(s.nearestExpiry) : '-'}</td>`;
    }).join('');
    return `
    <tr>
      <td>${escapeHTML(it.itemCode)}</td>
      <td>${escapeHTML(it.itemName)}</td>
      ${cells}
    </tr>
  `;
  }).join('');
}

searchInput.addEventListener('input', renderStockTable);

// ---------- 廠務物料 ----------

// 廠務用料：品名/數量是庫存.xlsx 裡庫別=廠務的部分（匯入時存進 factoryMaterial），
// 最短效期＝批號本身（最早的那個），畫面上跟批號.xlsx 的「廠務」庫別即時對出來，不是匯入時算好存起來的
// （每個資料類型都對應各自一份 ERP 匯出檔，不靠組合檔的公式）。renderBatchCell 只顯示最短那個，
// 同品項其他批號收在「還有 N 筆」點開才看得到。
function renderFactoryMaterialTable() {
  if (!currentFactoryMaterial.length) {
    factoryMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const batchesByCode = new Map();
  currentBatchList.forEach(b => {
    if (b.warehouse !== '廠務') return;
    if (!batchesByCode.has(b.itemCode)) batchesByCode.set(b.itemCode, []);
    batchesByCode.get(b.itemCode).push(b);
  });

  const sorted = [...currentFactoryMaterial].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
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

// 可用原料(泰山) = 泰山的庫存(庫存.xlsx) + 泰山的批號(批號.xlsx)，畫面上即時組出來，不是自己單獨一份匯入資料。
// 標記欄位 ERP 沒有對應資料（人工維護），改成可以直接在畫面上編輯，存到 itemTags collection。
// 過期/報廢沒有可靠來源（原始資料裡一直是空的），不顯示。
function renderAvailableMaterialTable() {
  const taishanStock = currentStock.filter(s => s.warehouse === '泰山');
  if (!taishanStock.length) {
    availableMaterialTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#6b7280;">目前沒有資料，請先到「匯入資料」上傳庫存.xlsx</td></tr>`;
    return;
  }

  const batchesByCode = new Map();
  currentBatchList.forEach(b => {
    if (b.warehouse !== '泰山') return;
    if (!batchesByCode.has(b.itemCode)) batchesByCode.set(b.itemCode, []);
    batchesByCode.get(b.itemCode).push(b);
  });
  const tagByCode = new Map(currentItemTags.map(r => [r.itemCode, r.tag]));

  const sorted = [...taishanStock].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  availableMaterialTableBody.innerHTML = sorted.map(r => {
    const batches = (batchesByCode.get(r.itemCode) || []).filter(b => b.batchNo);
    const tag = tagByCode.get(r.itemCode) || '';
    return `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${renderBatchCell(batches)}</td>
      <td><input type="text" class="tag-input" data-item-code="${escapeHTML(r.itemCode)}" value="${escapeHTML(tag)}" placeholder="原料/成品/半成品..." style="width:110px; padding:4px 6px;" /></td>
    </tr>
  `;
  }).join('');
}

// 標記是人工維護欄位，直接在表格裡編輯，失焦時存檔（不是整批匯入）
availableMaterialTableBody.addEventListener('change', async e => {
  if (!e.target.classList.contains('tag-input')) return;
  const itemCode = e.target.dataset.itemCode;
  const tag = e.target.value.trim();
  try {
    await setItemTag(itemCode, tag);
  } catch (err) {
    alert('儲存標記失敗：' + err.message);
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
      <td>${r.taishanQty}</td>
      <td>${r.taichungQty}</td>
      <td>${r.totalQty}</td>
      <td>${r.unitWeight}</td>
      <td>${r.totalWeight}</td>
      <td>${escapeHTML(r.purchaseType)}</td>
      <td>${escapeHTML(r.category)}</td>
      <td>${escapeHTML(r.majorCategory)}</td>
      <td>${escapeHTML(r.origin)}</td>
      <td>${(r.vendors || []).map(v => `${escapeHTML(v.label)} ${v.qty}`).join('，')}</td>
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
      <td>${r.qty}</td>
    </tr>
  `).join('');
}

batchSearchInput.addEventListener('input', renderBatchTable);

// ---------- 寄庫 ----------

function renderConsignmentTable() {
  const keyword = consignmentSearchInput.value.trim().toLowerCase();
  let items = currentConsignment;
  if (keyword) {
    items = items.filter(it =>
      (it.customer || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items = [...items].sort((a, b) => (a.customer || '').localeCompare(b.customer || ''));

  consignmentCount.textContent = currentConsignment.length
    ? (keyword ? `共 ${currentConsignment.length} 筆，篩選後 ${items.length} 筆` : `共 ${currentConsignment.length} 筆`)
    : '目前沒有寄庫資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    consignmentTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  // 品號+客戶 -> 未核完調整加總（來自異動分頁，庫別欄位對不到泰山/台中時代表在動客戶的寄庫帳）
  const adjustmentByKey = new Map();
  currentPendingAdjustments.forEach(a => {
    const key = `${a.itemCode}__${a.warehouse}`;
    adjustmentByKey.set(key, (adjustmentByKey.get(key) || 0) + (a.deltaQty || 0));
  });

  consignmentTableBody.innerHTML = items.map(r => {
    const adjustment = adjustmentByKey.get(`${r.itemCode}__${r.customer}`) || 0;
    const displayQty = r.qty + adjustment;
    const badge = adjustment
      ? ` <span class="badge badge-pending" title="異動裡還沒核完的寄庫變動">未核完 ${adjustment > 0 ? '+' : ''}${adjustment}</span>`
      : '';
    return `
    <tr>
      <td>${escapeHTML(r.customer)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${displayQty}${badge}</td>
    </tr>
  `;
  }).join('');
}

consignmentSearchInput.addEventListener('input', renderConsignmentTable);

// ---------- 原始資料（整份組合檔一比一塞進來的，不解讀欄位意義，管理員專用） ----------

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function renderRawSheetOptions() {
  const sheets = new Map(); // sheet name -> sheetOrder
  currentRawImport.forEach(r => {
    if (!sheets.has(r.sheet)) sheets.set(r.sheet, r.sheetOrder ?? 0);
  });
  const names = Array.from(sheets.keys()).sort((a, b) => sheets.get(a) - sheets.get(b));
  const current = rawSheetSelect.value;
  rawSheetSelect.innerHTML = names.map(n => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('');
  if (names.includes(current)) rawSheetSelect.value = current;
}

function renderRawTable() {
  if (!currentRawImport.length) {
    rawCount.textContent = '目前沒有原始資料，請先到「匯入資料」上傳整份組合檔';
    rawTableBody.innerHTML = '';
    return;
  }
  const sheetName = rawSheetSelect.value;
  const rows = currentRawImport
    .filter(r => r.sheet === sheetName)
    .sort((a, b) => a.rowIndex - b.rowIndex);

  rawCount.textContent = `「${sheetName}」共 ${rows.length} 列`;

  if (!rows.length) {
    rawTableBody.innerHTML = `<tr><td style="text-align:center; color:#6b7280;">這個分頁沒有資料</td></tr>`;
    return;
  }

  const maxCols = Math.max(...rows.map(r => (r.cells || []).length));
  const headerRow = `<tr><th>#</th>${Array.from({ length: maxCols }, (_, i) => `<th>${colLetter(i)}</th>`).join('')}</tr>`;
  const bodyRows = rows.map(r => {
    const cells = r.cells || [];
    const tds = Array.from({ length: maxCols }, (_, i) => `<td>${escapeHTML(cells[i] ?? '')}</td>`).join('');
    return `<tr><td>${r.rowIndex + 1}</td>${tds}</tr>`;
  }).join('');
  rawTableBody.innerHTML = headerRow + bodyRows;
}

rawSheetSelect.addEventListener('change', renderRawTable);

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
  const idxQty = findColumnIndex(header, ['庫存數量']);
  if (idxCode === -1 || idxWh === -1 || idxQty === -1) {
    throw new Error('找不到「品號」「庫別名稱」或「庫存數量」欄位，格式可能跟預期不同');
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
  const idxQty = findColumnIndex(header, ['庫存數量']);
  if (idxCode === -1 || idxCustomer === -1 || idxQty === -1) {
    throw new Error('找不到「品號」「庫別名稱」或「庫存數量」欄位，格式可能跟預期不同');
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
function parseMovementAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxIn = findColumnIndex(header, ['入庫異動數量']);
  const idxOut = findColumnIndex(header, ['出庫異動數量']);
  const idxWh = findColumnIndex(header, ['庫別']);
  if (idxCode === -1 || idxWh === -1) {
    throw new Error('找不到「品號」或「庫別」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const whRaw = (row[idxWh] || '').toString().trim();
    if (!whRaw) continue;
    const warehouse = normalizeWarehouse(whRaw) || whRaw; // 對不到泰山/台中就當客戶名字（寄庫用）
    const inQty = idxIn !== -1 ? Number(row[idxIn]) || 0 : 0;
    const outQty = idxOut !== -1 ? Number(row[idxOut]) || 0 : 0;
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
  const idxQty = findColumnIndex(header, ['轉撥數量']);
  const idxOutWh = findColumnIndex(header, ['轉出庫別']);
  const idxInWh = findColumnIndex(header, ['轉入庫別']);
  if (idxCode === -1 || idxQty === -1 || idxOutWh === -1 || idxInWh === -1) {
    throw new Error('找不到「品號」「轉撥數量」「轉出庫別」或「轉入庫別」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const qty = Number(row[idxQty]) || 0;
    if (!qty) continue;
    const outWh = normalizeWarehouse(row[idxOutWh]);
    const inWh = normalizeWarehouse(row[idxInWh]);
    if (outWh) records.push({ itemCode: code, warehouse: outWh, deltaQty: -qty, source: '轉撥' });
    if (inWh) records.push({ itemCode: code, warehouse: inWh, deltaQty: qty, source: '轉撥' });
  }
  return records;
}

// 銷貨.xlsx：品號欄位標題實際是「品    號」（字中間有全形空白）
function parseSalesAdjustments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品    號', '品號']);
  const idxQty = findColumnIndex(header, ['銷貨數量']);
  const idxWh = findColumnIndex(header, ['庫別名稱']);
  if (idxCode === -1 || idxQty === -1 || idxWh === -1) {
    throw new Error('找不到「品號」「銷貨數量」或「庫別名稱」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[idxCode] || '').toString().trim();
    if (!isRealItemCode(code)) continue;
    const warehouse = normalizeWarehouse(row[idxWh]);
    if (!warehouse) continue;
    const qty = Number(row[idxQty]) || 0;
    if (!qty) continue;
    records.push({ itemCode: code, warehouse, deltaQty: -qty, source: '銷貨' });
  }
  return records;
}

// 整份組合檔（1150805庫存YU.xlsx 這種）原封不動塞進來：不管欄位意義、不篩選，
// 每個分頁的每一列都存成一筆資料，之後在「原始資料」分頁一起慢慢看、慢慢決定要留什麼。
function parseWholeWorkbookRaw(wb) {
  const records = [];
  wb.SheetNames.forEach((sheetName, sheetOrder) => {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    rows.forEach((row, rowIndex) => {
      const hasContent = row.some(cell => cell !== '' && cell !== null && cell !== undefined);
      if (!hasContent) return;
      records.push({
        sheet: sheetName,
        sheetOrder,
        rowIndex,
        cells: row.map(c => (c === null || c === undefined) ? '' : c)
      });
    });
  });
  return records;
}

// 目前有 6 種確認過真實 ERP 匯出格式（進貨已經有真實檔案但還沒接；退貨/組合/鎖庫還沒有真實檔案樣本，
// 拿到之後再依樣加進這個清單）。matchesFilename 拿掉副檔名後直接比對檔名字串。
// 同一個檔名可能對到不只一個項目，所以是列出所有符合的候選，不是只挑第一個。
const IMPORT_ITEMS = [
  {
    key: 'rawAll',
    label: '整份組合檔（原始匯入，不篩選）',
    matchesFilename: name => name.includes('庫存YU'),
    prepare: wb => parseWholeWorkbookRaw(wb),
    describe: records => {
      const sheetCount = new Set(records.map(r => r.sheet)).size;
      return `${sheetCount} 個分頁，共 ${records.length} 列（每個分頁每一列都會存，不篩選欄位）`;
    },
    run: async records => {
      const result = await replaceRawImport(records);
      return `已更新原始資料 ${result.written} 筆，到「原始資料」分頁可以選分頁瀏覽`;
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
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上`,
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
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上`,
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
    describe: records => `共 ${records.length} 筆未核完調整，會加減到泰山/台中庫存數字上`,
    run: async records => {
      const result = await replacePendingAdjustments(records, ['銷貨']);
      return `已更新銷貨的未核完調整 ${result.written} 筆`;
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
    importMsg.textContent = `看不懂檔名「${file.name}」，目前支援的檔名：庫存、寄庫、批號、異動、轉撥、銷貨，或含「庫存YU」的整份組合檔（副檔名 .xlsx）`;
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
