// 庫存管理系統：登入後才能使用，登入、匯入、查詢都在同一頁。
import { auth } from './firebase-config.js?v=1';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { subscribeToStock, replaceStockForWarehouses } from './inventory-service.js?v=1';
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
const stockTableBody = document.getElementById('stockTableBody');
const stockSummary = document.getElementById('stockSummary');

const importDropZone = document.getElementById('importDropZone');
const importFileInput = document.getElementById('importFileInput');
const importMsg = document.getElementById('importMsg');

const WAREHOUSES = ['泰山', '台中'];

let currentStock = [];
let unsubscribeStock = null;

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

onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = 'none';
    appContent.style.display = 'block';
    userNav.style.display = 'flex';
    currentUserEmail.textContent = user.email;
    if (!unsubscribeStock) {
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
    }
  } else {
    loginBox.style.display = 'block';
    appContent.style.display = 'none';
    userNav.style.display = 'none';
    if (unsubscribeStock) {
      unsubscribeStock();
      unsubscribeStock = null;
    }
    currentStock = [];
  }
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

function renderStockTable() {
  const keyword = searchInput.value.trim().toLowerCase();

  // 依品號分組，把泰山跟台中的庫存併成同一列
  const byItem = new Map();
  currentStock.forEach(s => {
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

  stockSummary.style.color = '';
  stockSummary.textContent = currentStock.length
    ? (keyword ? `共 ${byItem.size} 個品項，篩選後 ${items.length} 筆` : `共 ${byItem.size} 個品項`)
    : '目前沒有庫存資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    stockTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  stockTableBody.innerHTML = items.map(it => {
    const ts = it.warehouses['泰山'];
    const tc = it.warehouses['台中'];
    return `
    <tr>
      <td>${escapeHTML(it.itemCode)}</td>
      <td>${escapeHTML(it.itemName)}</td>
      <td>${ts ? ts.qty : '-'}</td>
      <td>${ts ? formatExpiry(ts.nearestExpiry) : '-'}</td>
      <td>${tc ? tc.qty : '-'}</td>
      <td>${tc ? formatExpiry(tc.nearestExpiry) : '-'}</td>
    </tr>
  `;
  }).join('');
}

searchInput.addEventListener('input', renderStockTable);

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

  if (idxCode === -1 || idxQty === -1) {
    throw new Error(`「${warehouse}」分頁找不到「品號」或「結存數量」欄位，格式可能跟預期不同`);
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      warehouse,
      warehouseLocation: idxLoc !== -1 ? (row[idxLoc] || '').toString().trim() : '',
      qty: idxQty !== -1 ? Number(row[idxQty]) || 0 : 0,
      nearestExpiry: idxExpiry !== -1 ? (row[idxExpiry] || '').toString().trim() : '',
      note: idxNote !== -1 ? (row[idxNote] || '').toString().trim() : ''
    });
  }
  return records;
}

async function handleImportFile(file) {
  importMsg.style.color = 'var(--color-text-muted)';
  importMsg.textContent = '讀取檔案中...';
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const allRecords = [];
    const foundWarehouses = [];
    for (const warehouse of WAREHOUSES) {
      const sheet = workbook.Sheets[warehouse];
      if (!sheet) continue;
      const records = parseWarehouseSheet(sheet, warehouse);
      allRecords.push(...records);
      foundWarehouses.push(warehouse);
    }

    if (foundWarehouses.length === 0) {
      throw new Error('這份檔案裡找不到「泰山」或「台中」分頁，確認上傳的是正確的 ERP 匯出檔');
    }

    importMsg.textContent = `解析完成，共 ${allRecords.length} 筆，正在寫入資料庫...`;
    const result = await replaceStockForWarehouses(allRecords, foundWarehouses);

    importMsg.style.color = 'var(--color-success)';
    importMsg.textContent = `匯入成功！已更新「${foundWarehouses.join('、')}」共 ${result.written} 筆庫存資料（清除舊資料 ${result.deleted} 筆）`;
  } catch (err) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = '匯入失敗：' + err.message;
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
  if (file) handleImportFile(file);
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files[0];
  if (file) handleImportFile(file);
  importFileInput.value = '';
});
