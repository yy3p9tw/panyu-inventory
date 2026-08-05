// 庫存管理系統：登入後才能使用，登入、匯入、查詢都在同一頁。
// 畫面上的分頁跟資料欄位，依登入者的角色顯示不同內容。
import { auth } from './firebase-config.js?v=1';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  subscribeToStock, replaceStockForWarehouses,
  subscribeToFactoryMaterial, replaceFactoryMaterial,
  subscribeToAvailableMaterial, replaceAvailableMaterial,
  subscribeToSummary, replaceSummary,
  subscribeToBatchList, replaceBatchList,
  subscribeToConsignment, replaceConsignment,
  subscribeToPendingAdjustments, replacePendingAdjustments
} from './inventory-service.js?v=1';
import { touchOwnProfile, subscribeToOwnProfile, subscribeToUsers, updateUserRoles } from './users-service.js?v=1';
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
let currentAvailableMaterial = [];
let currentSummary = [];
let currentBatchList = [];
let currentConsignment = [];
let currentPendingAdjustments = [];
let unsubscribeStock = null;
let unsubscribeOwnProfile = null;
let unsubscribeUsers = null;
let unsubscribeFactoryMaterial = null;
let unsubscribeAvailableMaterial = null;
let unsubscribeSummary = null;
let unsubscribeBatchList = null;
let unsubscribeConsignment = null;
let unsubscribePendingAdjustments = null;

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
  if (unsubscribeAvailableMaterial) { unsubscribeAvailableMaterial(); unsubscribeAvailableMaterial = null; }
  if (unsubscribeSummary) { unsubscribeSummary(); unsubscribeSummary = null; }
  if (unsubscribeBatchList) { unsubscribeBatchList(); unsubscribeBatchList = null; }
  if (unsubscribeConsignment) { unsubscribeConsignment(); unsubscribeConsignment = null; }
  if (unsubscribePendingAdjustments) { unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null; }
  currentRoles = [];
  currentStock = [];
  currentUsers = [];
  currentFactoryMaterial = [];
  currentAvailableMaterial = [];
  currentSummary = [];
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
  const summaryBtn = document.querySelector('.tab-btn[data-tab="summary"]');
  const batchBtn = document.querySelector('.tab-btn[data-tab="batch"]');
  const consignmentBtn = document.querySelector('.tab-btn[data-tab="consignment"]');
  const importBtn = document.querySelector('.tab-btn[data-tab="import"]');
  const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');

  const canSeeStock = visibleWarehouses.length > 0;
  searchBtn.style.display = canSeeStock ? '' : 'none';
  factoryBtn.style.display = canSeeFactory ? '' : 'none';
  summaryBtn.style.display = canSeeSummary ? '' : 'none';
  batchBtn.style.display = canSeeStock ? '' : 'none';
  consignmentBtn.style.display = canSeeStock ? '' : 'none';
  importBtn.style.display = (canSeeStock || canSeeFactory || canSeeSummary) ? '' : 'none';
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

  if (canSeeFactory && !unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial = subscribeToFactoryMaterial(rows => {
      currentFactoryMaterial = rows;
      renderFactoryMaterialTable();
    });
    unsubscribeAvailableMaterial = subscribeToAvailableMaterial(rows => {
      currentAvailableMaterial = rows;
      renderAvailableMaterialTable();
    });
  } else if (!canSeeFactory && unsubscribeFactoryMaterial) {
    unsubscribeFactoryMaterial(); unsubscribeFactoryMaterial = null;
    unsubscribeAvailableMaterial(); unsubscribeAvailableMaterial = null;
    currentFactoryMaterial = [];
    currentAvailableMaterial = [];
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

  if (canSeeStock && !unsubscribeBatchList) {
    unsubscribeBatchList = subscribeToBatchList(rows => {
      currentBatchList = rows;
      renderBatchTable();
    });
    unsubscribeConsignment = subscribeToConsignment(rows => {
      currentConsignment = rows;
      renderConsignmentTable();
    });
    unsubscribePendingAdjustments = subscribeToPendingAdjustments(rows => {
      currentPendingAdjustments = rows;
      renderStockTable();
    });
  } else if (!canSeeStock && unsubscribeBatchList) {
    unsubscribeBatchList(); unsubscribeBatchList = null;
    unsubscribeConsignment(); unsubscribeConsignment = null;
    unsubscribePendingAdjustments(); unsubscribePendingAdjustments = null;
    currentBatchList = [];
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

function renderQtyCell(s, adjustment) {
  const badges = [];
  if (s.lockedQty) badges.push(`<span class="badge badge-locked" title="鎖庫前結存：${s.qtyBeforeLock ?? '-'}">鎖庫 ${s.lockedQty}</span>`);
  if (s.expired) badges.push(`<span class="badge badge-expired">過期/報廢 ${escapeHTML(s.expired)}</span>`);
  if (s.isSplit) badges.push(`<span class="badge badge-split">散裝</span>`);
  if (s.batches && s.batches.length) {
    const title = s.batches.map(b => `${formatExpiry(b.batchNo)}：${b.qty}`).join('\n');
    badges.push(`<span class="badge badge-batch" title="${escapeHTML(title)}">批號 ${s.batches.length} 筆</span>`);
  }
  const displayQty = s.qty + (adjustment || 0);
  if (adjustment) {
    badges.push(`<span class="badge badge-pending" title="銷貨/銷退/進貨/退貨/組合/異動/調撥裡還沒核完的部分">未核完 ${adjustment > 0 ? '+' : ''}${adjustment}</span>`);
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
      return `<td>${s ? renderQtyCell(s, adjustment) : '-'}</td><td>${s ? formatExpiry(s.nearestExpiry) : '-'}</td>`;
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

function renderFactoryMaterialTable() {
  if (!currentFactoryMaterial.length) {
    factoryMaterialTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const sorted = [...currentFactoryMaterial].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  factoryMaterialTableBody.innerHTML = sorted.map(r => `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${r.batchNo ? formatExpiry(r.batchNo) : '-'}</td>
    </tr>
  `).join('');
}

function renderAvailableMaterialTable() {
  if (!currentAvailableMaterial.length) {
    availableMaterialTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">目前沒有資料</td></tr>`;
    return;
  }
  const sorted = [...currentAvailableMaterial].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  availableMaterialTableBody.innerHTML = sorted.map(r => `
    <tr>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${r.batchNo ? formatExpiry(r.batchNo) : '-'}</td>
      <td>${escapeHTML(r.expired)}</td>
      <td>${r.tag ? escapeHTML(r.tag) : ''}</td>
    </tr>
  `).join('');
}

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
    : '目前沒有彙總資料，請先到「匯入資料」上傳 ERP 檔案';

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
      <td>${r.batchNo ? formatExpiry(r.batchNo) : '-'}</td>
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
    consignmentTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  consignmentTableBody.innerHTML = items.map(r => `
    <tr>
      <td>${escapeHTML(r.customer)}</td>
      <td>${escapeHTML(r.itemName)}</td>
      <td>${escapeHTML(r.warehouse)}</td>
      <td>${r.qty}</td>
      <td>${escapeHTML(r.consignmentDate) || '-'}</td>
    </tr>
  `).join('');
}

consignmentSearchInput.addEventListener('input', renderConsignmentTable);

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

function findColumnIndex(headerRow, names) {
  for (const name of names) {
    const idx = headerRow.findIndex(h => (h || '').toString().trim() === name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseWarehouseSheet(sheet, warehouse) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];

  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxLoc = findColumnIndex(header, ['庫別名稱']);
  const idxQty = findColumnIndex(header, ['結存數量']);
  const idxExpiry = findColumnIndex(header, ['最短效期']);
  const idxNote = findColumnIndex(header, ['備註']);
  // 以下都只有泰山有、台中沒有（或台中目前是空的）：鎖庫數量本身兩邊都有，但只有泰山有前結存/過期報廢/註記/散裝
  const idxLocked = findColumnIndex(header, ['鎖庫']);
  const idxBeforeLock = findColumnIndex(header, ['鎖庫前結存']);
  const idxExpired = findColumnIndex(header, ['過期/報廢']);
  const idxRemark = findColumnIndex(header, ['註記']);
  // 這欄標題寫「盤點」但實際內容是散裝標記（只會是空白或「散」），是參照表帶過來的，跟標題文字無關
  const idxSplitFlag = findColumnIndex(header, ['盤點']);

  if (idxCode === -1 || idxQty === -1) {
    throw new Error(`「${warehouse}」分頁找不到「品號」或「結存數量」欄位，格式可能跟預期不同`);
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;
    const remark = idxRemark !== -1 ? (row[idxRemark] || '').toString().trim() : '';
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      warehouse,
      warehouseLocation: idxLoc !== -1 ? (row[idxLoc] || '').toString().trim() : '',
      qty: idxQty !== -1 ? Number(row[idxQty]) || 0 : 0,
      nearestExpiry: idxExpiry !== -1 ? (row[idxExpiry] || '').toString().trim() : '',
      note: idxNote !== -1 ? (row[idxNote] || '').toString().trim() : '',
      // ERP 內部為了方便公式加總，鎖庫數量在原始欄位裡是負數存的，沒有業務意義，取絕對值還原成實際數量
      lockedQty: idxLocked !== -1 ? Math.abs(Number(row[idxLocked]) || 0) : 0,
      qtyBeforeLock: idxBeforeLock !== -1 ? Number(row[idxBeforeLock]) || 0 : null,
      expired: idxExpired !== -1 ? (row[idxExpired] || '').toString().trim() : '',
      remark,
      hiddenFromTaishanManager: remark === '隱藏',
      isSplit: idxSplitFlag !== -1 ? (row[idxSplitFlag] || '').toString().trim() === '散' : false
    });
  }
  return records;
}

// 批號分頁裡同一組欄位（品號,品名,規格,單位,包裝單位,批號,庫別...）出現三次：
// 一組是台中庫的真實資料，另外兩組是泰山廠區的資料但彼此是重複貼上（內容一樣）。
// 找出所有候選區塊（每個區塊的欄位位置），呼叫的地方再依實際庫別內容挑選要用哪一個。
function findBatchSheetBlocks(header) {
  const expectedSeq = ['品號', '品名', '規格', '單位', '包裝單位', '批號', '庫別'];
  const candidates = [];
  for (let i = 0; i < header.length; i++) {
    if ((header[i] || '').toString().trim() !== '品號') continue;
    const matches = expectedSeq.every((name, offset) => (header[i + offset] || '').toString().trim() === name);
    if (!matches) continue;
    const window = header.slice(i, i + 20);
    const packagedQtyOffset = window.findIndex(h => (h || '').toString().trim() === '期末包裝庫存');
    candidates.push({
      code: i, name: i + 1, batchNo: i + 5, warehouse: i + 6,
      packagedQty: packagedQtyOffset !== -1 ? i + packagedQtyOffset : -1
    });
  }
  return candidates;
}

function pickBatchBlock(candidates, rows, warehouseName) {
  return candidates.find(c =>
    rows.slice(1, 20).some(r => (r[c.warehouse] || '').toString().trim() === warehouseName)
  ) || null;
}

// 建立「品號 -> 批號清單」對照表，依 warehouseName 選出批號分頁裡對應的那個區塊
// （廠務用料自己的分頁沒有批號欄；廠務的料實際上是泰山庫存撥用的，所以要去泰山廠區底下找）
function buildBatchLookup(sheet, warehouseName) {
  const lookup = new Map();
  if (!sheet) return lookup;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return lookup;

  const cols = pickBatchBlock(findBatchSheetBlocks(rows[0]), rows, warehouseName);
  if (!cols) return lookup;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[cols.code] || '').toString().trim();
    if (!itemCode) continue;
    const warehouse = (row[cols.warehouse] || '').toString().trim();
    if (warehouse !== warehouseName) continue;
    const batchNo = (row[cols.batchNo] || '').toString().trim();
    const packagedQty = cols.packagedQty !== -1 ? Number(row[cols.packagedQty]) || 0 : 0;
    if (!lookup.has(itemCode)) lookup.set(itemCode, []);
    lookup.get(itemCode).push({ batchNo, packagedQty });
  }
  return lookup;
}

// 給「批號」分頁自己的瀏覽畫面用：把泰山廠區跟台中庫兩個區塊都攤平成一筆一筆的清單
function parseBatchListSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const candidates = findBatchSheetBlocks(rows[0]);

  const blocks = ['泰山廠區', '台中庫']
    .map(wh => pickBatchBlock(candidates, rows, wh))
    .filter(Boolean);

  const records = [];
  for (const cols of blocks) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const itemCode = (row[cols.code] || '').toString().trim();
      if (!itemCode) continue;
      const warehouse = (row[cols.warehouse] || '').toString().trim();
      if (!warehouse) continue;
      records.push({
        itemCode,
        itemName: (row[cols.name] || '').toString().trim(),
        warehouse,
        batchNo: (row[cols.batchNo] || '').toString().trim(),
        qty: cols.packagedQty !== -1 ? Number(row[cols.packagedQty]) || 0 : 0
      });
    }
  }
  return records;
}

// 寄庫分頁：小計列的「庫別」欄位是數字不是倉別名稱，要排除；
// 逐日欄位夾在「上月數量」跟「本日數量」中間，用位置而不是欄名找，因為每天的欄名都不一樣。
function parseConsignmentSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];

  const idxCustomer = findColumnIndex(header, ['客戶']);
  const idxItemName = findColumnIndex(header, ['品名']);
  const idxWarehouse = findColumnIndex(header, ['庫別']);
  const idxLastMonth = findColumnIndex(header, ['上月數量']);
  const idxTodayQty = findColumnIndex(header, ['本日數量']);
  const idxDate = findColumnIndex(header, ['寄庫日期']);

  if (idxCustomer === -1 || idxLastMonth === -1 || idxTodayQty === -1) {
    throw new Error('「寄庫」分頁找不到「客戶」「上月數量」或「本日數量」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const customer = (row[idxCustomer] || '').toString().trim();
    if (!customer) continue;
    const warehouseRaw = (row[idxWarehouse] || '').toString().trim();
    // 庫別欄位是數字的話，這列其實是小計/彙總列，不是真正的一筆寄庫資料
    if (warehouseRaw === '' || !isNaN(Number(warehouseRaw))) continue;

    let qty = Number(row[idxLastMonth]) || 0;
    for (let c = idxLastMonth + 1; c < idxTodayQty; c++) {
      qty += Number(row[c]) || 0;
    }

    records.push({
      customer,
      itemName: idxItemName !== -1 ? (row[idxItemName] || '').toString().trim() : '',
      warehouse: warehouseRaw,
      qty,
      consignmentDate: idxDate !== -1 ? (row[idxDate] || '').toString().trim() : ''
    });
  }
  return records;
}

function parseFactoryMaterialSheet(sheet, batchLookup) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxQty = findColumnIndex(header, ['結存數量']);
  if (idxCode === -1 || idxQty === -1) {
    throw new Error('「廠務用料」分頁找不到「品號」或「結存數量」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;
    const itemName = idxName !== -1 ? (row[idxName] || '').toString().trim() : '';
    const qty = Number(row[idxQty]) || 0;
    const batches = batchLookup.get(itemCode);
    if (batches && batches.length) {
      // 對到批號就拆成一列一個批號；沒對到批號的品項還是要顯示，用結存數量當唯一一列
      batches.forEach(b => records.push({ itemCode, itemName, qty: b.packagedQty, batchNo: b.batchNo }));
    } else {
      records.push({ itemCode, itemName, qty, batchNo: '' });
    }
  }
  return records;
}

function parseAvailableMaterialSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];
  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxQty = findColumnIndex(header, ['結存數量']);
  const idxBatch = findColumnIndex(header, ['批號']);
  const idxExpired = findColumnIndex(header, ['過期/報廢']);
  const idxTag = findColumnIndex(header, ['廠務']);
  if (idxCode === -1 || idxQty === -1) {
    throw new Error('「可用原料(泰山)」分頁找不到「品號」或「結存數量」欄位，格式可能跟預期不同');
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      qty: Number(row[idxQty]) || 0,
      batchNo: idxBatch !== -1 ? (row[idxBatch] || '').toString().trim() : '',
      expired: idxExpired !== -1 ? (row[idxExpired] || '').toString().trim() : '',
      tag: idxTag !== -1 ? (row[idxTag] || '').toString().trim() : ''
    });
  }
  return records;
}

// 彙總分頁第一列是「庫別數量 1789」這種標題文字，不是欄位名，真正的欄位名在第二列
function parseSummarySheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (rows.length < 2) return [];
  const header = rows[1];

  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxTaishan = findColumnIndex(header, ['泰山']);
  const idxTaichung = findColumnIndex(header, ['台中']);
  const idxTotalQty = findColumnIndex(header, ['總計件數']);
  const idxUnitWeight = findColumnIndex(header, ['淨重']);
  const idxTotalWeight = findColumnIndex(header, ['總淨重KG']);
  const idxPurchase = findColumnIndex(header, ['採購']);
  const idxCategory = findColumnIndex(header, ['類別']);
  const idxMajorCategory = findColumnIndex(header, ['大類']);
  const idxOrigin = findColumnIndex(header, ['產地']);

  if (idxCode === -1 || idxTotalQty === -1) {
    throw new Error('「彙總」分頁找不到「品號」或「總計件數」欄位，格式可能跟預期不同');
  }

  // 供應商別數量/淨重是分開命名的（例如「磐宇/浜數量」配「盈浜淨重」，不是同一個字首），照實際欄名對
  const vendorDefs = [
    { label: '磐宇/浜', qtyIdx: findColumnIndex(header, ['磐宇/浜數量']), weightIdx: findColumnIndex(header, ['盈浜淨重']) },
    { label: '御宏', qtyIdx: findColumnIndex(header, ['御宏數量']), weightIdx: findColumnIndex(header, ['御宏淨重']) },
    { label: '長紘', qtyIdx: findColumnIndex(header, ['長紘數量']), weightIdx: findColumnIndex(header, ['長紘淨重']) },
    { label: '盈冠', qtyIdx: findColumnIndex(header, ['盈冠數量']), weightIdx: findColumnIndex(header, ['盈冠淨重']) },
    { label: '國內', qtyIdx: findColumnIndex(header, ['國內數量']), weightIdx: findColumnIndex(header, ['國內淨重']) }
  ];

  const records = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;

    const vendors = vendorDefs
      .map(v => ({
        label: v.label,
        qty: v.qtyIdx !== -1 ? Number(row[v.qtyIdx]) || 0 : 0,
        weight: v.weightIdx !== -1 ? Number(row[v.weightIdx]) || 0 : 0
      }))
      .filter(v => v.qty);

    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      taishanQty: idxTaishan !== -1 ? Number(row[idxTaishan]) || 0 : 0,
      taichungQty: idxTaichung !== -1 ? Number(row[idxTaichung]) || 0 : 0,
      totalQty: Number(row[idxTotalQty]) || 0,
      unitWeight: idxUnitWeight !== -1 ? Number(row[idxUnitWeight]) || 0 : 0,
      totalWeight: idxTotalWeight !== -1 ? Number(row[idxTotalWeight]) || 0 : 0,
      purchaseType: idxPurchase !== -1 ? (row[idxPurchase] || '').toString().trim() : '',
      category: idxCategory !== -1 ? (row[idxCategory] || '').toString().trim() : '',
      majorCategory: idxMajorCategory !== -1 ? (row[idxMajorCategory] || '').toString().trim() : '',
      origin: idxOrigin !== -1 ? (row[idxOrigin] || '').toString().trim() : '',
      vendors
    });
  }
  return records;
}

// 這些「真正的資料列」判斷方式都一樣：品號欄位要是純英數字代碼。
// 銷貨/銷退/進貨/退貨/組合/異動/調撥這些分頁裡，同一組欄位標題會在不同部門的區塊重複出現
// （像「轉入台中」「轉入泰山」各自一組標題+資料），標題文字本身也會被當成儲存格值讀到，
// 用「不是純英數字」把這些重複的標題列擋掉，只留下真正的品號。
function isRealItemCode(code) {
  return /^[A-Za-z0-9]+$/.test(code || '');
}

// 這些交易明細分頁裡的庫別欄位，寫法跟泰山/台中庫存表本身不一樣
// （「泰山廠區」「台中庫」，不是單純「泰山」「台中」），要正規化成同一個名稱才能對得起來
function normalizeWarehouse(raw) {
  const s = (raw || '').toString();
  if (s.includes('泰山')) return '泰山';
  if (s.includes('台中')) return '台中';
  return null;
}

// 泰山/台中庫存數字只反映「已核完」的單據；還沒核完的單據，資料還留在銷貨/銷退/進貨/退貨/組合/異動/調撥
// 這些分頁裡（有資料代表還沒核完，核完之後那一列就會清空）。這裡把還沒核完的部分抓出來，
// 換算成「品號 + 倉庫 → 該加或該扣多少」，套用到庫存數字上。方向是使用者親口確認的：
// 銷貨(-)、銷退(+)、進貨(+)、退貨(-)、組合(成品+/元件-)、異動(看自己入庫/出庫欄)、調撥(轉入+/轉出-)。
// 只處理庫別剛好是「泰山」或「台中」的列——異動等分頁的「庫別」有時其實是寄庫客戶的虛擬倉別，
// 不是實體倉庫，這種先不處理。
//
// headerRowIndex 是 0-based：大部分這類分頁的真正欄位標題在實體第 2 列（headerRowIndex=1），
// 因為第 1 列只是「轉入台中」這種標題文字；銷貨分頁例外，標題就在實體第 1 列（headerRowIndex=0）。
function parsePendingAdjustments(wb) {
  const records = [];

  function sheetRows(sheetName) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return null;
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  }

  function addFromRows(rows, headerRowIndex, codeCol, qtyCol, whCol, sign, source) {
    if (!rows || codeCol === -1 || qtyCol === -1 || whCol === -1) return;
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const code = (row[codeCol] || '').toString().trim();
      if (!isRealItemCode(code)) continue;
      const warehouse = normalizeWarehouse(row[whCol]);
      if (!warehouse) continue;
      const qty = Number(row[qtyCol]) || 0;
      if (!qty) continue;
      records.push({ itemCode: code, warehouse, deltaQty: sign * qty, source });
    }
  }

  // 銷貨：5 個地區分頁，欄位位置都一樣，有些地區目前是空的
  ['銷貨-北區', '銷貨-中和', '銷貨-泰山', '銷貨-中區', '銷貨-他庫'].forEach(name => {
    const rows = sheetRows(name);
    if (!rows || !rows.length) return;
    const header = rows[0];
    addFromRows(rows, 0,
      findColumnIndex(header, ['品    號', '品號']),
      findColumnIndex(header, ['銷貨數量']),
      findColumnIndex(header, ['庫別名稱']), -1, '銷貨');
  });

  {
    const rows = sheetRows('銷退');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['品號']),
        findColumnIndex(header, ['銷退數量']), findColumnIndex(header, ['庫別名稱']), 1, '銷退');
    }
  }

  {
    const rows = sheetRows('進貨');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['品    號', '品號']),
        findColumnIndex(header, ['進貨數量']), findColumnIndex(header, ['庫別']), 1, '進貨');
    }
  }

  {
    const rows = sheetRows('進貨退回');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['品號']),
        findColumnIndex(header, ['數量']), findColumnIndex(header, ['庫別名稱']), -1, '退貨');
    }
  }

  // 組合：成品入庫(+)跟元件出庫(-)是同一張單子的兩面，分開抓
  {
    const rows = sheetRows('組合');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['成品品號']),
        findColumnIndex(header, ['成品數量']), findColumnIndex(header, ['入庫庫別']), 1, '組合成品');
      addFromRows(rows, 1, findColumnIndex(header, ['元件品號']),
        findColumnIndex(header, ['元件用量']), findColumnIndex(header, ['出庫庫別']), -1, '組合元件');
    }
  }

  // 異動：入庫(+)出庫(-)是同一列的兩個欄位，各自獨立判斷
  {
    const rows = sheetRows('異動');
    const header = rows && rows[1];
    if (header) {
      const idxCode = findColumnIndex(header, ['品號']);
      const idxWh = findColumnIndex(header, ['庫別']);
      addFromRows(rows, 1, idxCode, findColumnIndex(header, ['入庫異動數量']), idxWh, 1, '異動入庫');
      addFromRows(rows, 1, idxCode, findColumnIndex(header, ['出庫異動數量']), idxWh, -1, '異動出庫');
    }
  }

  {
    const rows = sheetRows('調撥-轉入');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['品號']),
        findColumnIndex(header, ['轉撥數量']), findColumnIndex(header, ['轉入庫別']), 1, '調撥轉入');
    }
  }

  {
    const rows = sheetRows('調撥-轉出');
    const header = rows && rows[1];
    if (header) {
      addFromRows(rows, 1, findColumnIndex(header, ['品號']),
        findColumnIndex(header, ['轉撥數量']), findColumnIndex(header, ['轉出庫別']), -1, '調撥轉出');
    }
  }

  return records;
}

// 每一種資料各自獨立匯入：上傳檔案只是解析、不會馬上寫入，
// 每一項自己按「確認匯入」才會真的動到資料庫，互不影響。
const IMPORT_ITEMS = [
  {
    key: 'stock',
    label: '泰山 / 台中 庫存',
    detect: wb => WAREHOUSES.some(w => !!wb.Sheets[w]),
    prepare: wb => {
      const allRecords = [];
      const foundWarehouses = [];
      for (const warehouse of WAREHOUSES) {
        const sheet = wb.Sheets[warehouse];
        if (!sheet) continue;
        allRecords.push(...parseWarehouseSheet(sheet, warehouse));
        foundWarehouses.push(warehouse);
      }
      const taichungBatchLookup = buildBatchLookup(wb.Sheets['批號'], '台中庫');
      allRecords.forEach(r => {
        if (r.warehouse !== '台中') return;
        r.batches = (taichungBatchLookup.get(r.itemCode) || []).map(b => ({ batchNo: b.batchNo, qty: b.packagedQty }));
      });
      return { allRecords, foundWarehouses };
    },
    describe: data => `${data.foundWarehouses.join('、')}，共 ${data.allRecords.length} 筆`,
    run: async data => {
      const result = await replaceStockForWarehouses(data.allRecords, data.foundWarehouses);
      return `已更新「${data.foundWarehouses.join('、')}」庫存 ${result.written} 筆（清除舊資料 ${result.deleted} 筆）`;
    }
  },
  {
    key: 'factory',
    label: '廠務用料',
    detect: wb => !!wb.Sheets['廠務用料'],
    prepare: wb => parseFactoryMaterialSheet(wb.Sheets['廠務用料'], buildBatchLookup(wb.Sheets['批號'], '泰山廠區')),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceFactoryMaterial(records);
      return `已更新廠務用料 ${result.written} 筆`;
    }
  },
  {
    key: 'available',
    label: '可用原料(泰山)',
    detect: wb => !!wb.Sheets['可用原料(泰山)'],
    prepare: wb => parseAvailableMaterialSheet(wb.Sheets['可用原料(泰山)']),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceAvailableMaterial(records);
      return `已更新可用原料(泰山) ${result.written} 筆`;
    }
  },
  {
    key: 'summary',
    label: '彙總',
    detect: wb => !!wb.Sheets['彙總'],
    prepare: wb => parseSummarySheet(wb.Sheets['彙總']),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceSummary(records);
      return `已更新彙總 ${result.written} 筆`;
    }
  },
  {
    key: 'batchList',
    label: '批號',
    detect: wb => !!wb.Sheets['批號'],
    prepare: wb => parseBatchListSheet(wb.Sheets['批號']),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceBatchList(records);
      return `已更新批號 ${result.written} 筆`;
    }
  },
  {
    key: 'consignment',
    label: '寄庫',
    detect: wb => !!wb.Sheets['寄庫'],
    prepare: wb => parseConsignmentSheet(wb.Sheets['寄庫']),
    describe: records => `共 ${records.length} 筆`,
    run: async records => {
      const result = await replaceConsignment(records);
      return `已更新寄庫 ${result.written} 筆`;
    }
  },
  {
    key: 'pendingAdjustments',
    label: '未核完調整（銷貨/銷退/進貨/退貨/組合/異動/調撥）',
    detect: wb => ['銷貨-北區', '銷貨-中和', '銷貨-泰山', '銷貨-中區', '銷貨-他庫', '銷退', '進貨', '進貨退回', '組合', '異動', '調撥-轉入', '調撥-轉出'].some(n => !!wb.Sheets[n]),
    prepare: wb => parsePendingAdjustments(wb),
    describe: records => `共 ${records.length} 筆未核完調整（會加減到泰山/台中庫存數字上）`,
    run: async records => {
      const result = await replacePendingAdjustments(records);
      return `已更新未核完調整 ${result.written} 筆`;
    }
  }
];

let pendingWorkbook = null;
let pendingImportData = {};

async function handleFileSelected(file) {
  importMsg.style.color = 'var(--color-text-muted)';
  importMsg.textContent = '讀取檔案中...';
  importItemsList.innerHTML = '';
  pendingWorkbook = null;
  pendingImportData = {};
  try {
    const buffer = await file.arrayBuffer();
    pendingWorkbook = XLSX.read(buffer, { type: 'array' });
    renderImportItems();
    importMsg.style.color = '';
    importMsg.textContent = '檔案讀取完成，選擇要匯入的項目：';
  } catch (err) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = '讀取檔案失敗：' + err.message;
  }
}

function renderImportItems() {
  const detected = IMPORT_ITEMS.filter(item => item.detect(pendingWorkbook));

  if (!detected.length) {
    importItemsList.innerHTML = `<p class="hint-text">這份檔案裡沒有找到看得懂的分頁（泰山/台中/廠務用料/可用原料(泰山)/彙總/批號/寄庫），確認上傳的是正確的 ERP 匯出檔。</p>`;
    return;
  }

  importItemsList.innerHTML = detected.map(item => {
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
          <span class="hint-text" data-desc-for="${item.key}">${error ? escapeHTML(error) : escapeHTML(desc)}</span>
        </div>
        <button type="button" class="secondary" data-import-key="${item.key}" ${error ? 'disabled' : ''}>確認匯入</button>
      </div>
    `;
  }).join('');

  importItemsList.querySelectorAll('button[data-import-key]').forEach(btn => {
    btn.addEventListener('click', () => runImportItem(btn.dataset.importKey));
  });
}

async function runImportItem(key) {
  const item = IMPORT_ITEMS.find(i => i.key === key);
  const data = pendingImportData[key];
  if (!item || !data) return;
  const btn = importItemsList.querySelector(`button[data-import-key="${key}"]`);
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
